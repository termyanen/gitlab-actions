import type {
  Pipeline,
  Job,
  PipelineSelection,
} from "../../../entities/pipeline";
import { sleep } from "../../../shared/lib/time";
import type { MrServices } from "./types";
export function createPipelineActions({
  context,
  api,
  getMR,
  t,
  showToast,
  pollTaskStatus,
}: MrServices) {
  function getCurrentPipeline() {
    return getMR().then(function (mr) {
      if (mr.head_pipeline && mr.head_pipeline.id) {
        return {
          id: mr.head_pipeline.id,
          projectId:
            mr.head_pipeline.project_id ||
            mr.source_project_id ||
            context.projectId,
        };
      }
      // Older servers may omit head_pipeline. Never run a job for
      // an earlier commit just because its pipeline is first in the list.
      return api<Pipeline[]>(
        "GET",
        "/projects/" +
          context.projectId +
          "/merge_requests/" +
          context.mrIid +
          "/pipelines",
      ).then(function (pipelines) {
        let latest = null;
        for (let i = 0; i < pipelines.length; i++) {
          const pipeline = pipelines[i];
          if (mr.sha && pipeline.sha !== mr.sha) continue;
          // GitLab prefers MR pipelines over branch pipelines, then orders
          // each group newest first. Preserve that preference for this SHA.
          latest = pipeline;
          break;
        }
        if (!latest) throw new Error("No pipelines found");
        return {
          id: latest.id,
          projectId:
            latest.project_id || mr.source_project_id || context.projectId,
        };
      });
    });
  }

  function getPipelineJobs(pipeline: PipelineSelection, jobName?: string) {
    const seen: Record<number, boolean> = {};
    let collected: Job[] = [];
    function readPage(page: number): Promise<Job[]> {
      let path =
        "/projects/" +
        pipeline.projectId +
        "/pipelines/" +
        pipeline.id +
        "/jobs?per_page=100";
      if (page > 1) path += "&page=" + page;
      return api<Job[]>("GET", path).then(function (jobs) {
        collected = collected.concat(jobs);
        // GitLab sorts jobs newest first. Named lookups can stop as soon as
        // the latest attempt is found; bulk retries need every page.
        if (jobName && findLatestJobByName(jobs, jobName)) return collected;
        if (jobs.length < 100) return collected;
        // Protect against a proxy/server ignoring the page parameter.
        let hasNewJobs = false;
        for (let i = 0; i < jobs.length; i++) {
          if (!seen[jobs[i].id]) hasNewJobs = true;
          seen[jobs[i].id] = true;
        }
        if (!hasNewJobs)
          throw new Error(t("errorJobsPageRepeated", [String(pipeline.id)]));
        return readPage(page + 1);
      });
    }
    return readPage(1);
  }

  function doReviewers(
    jobName = "get-reviewers",
    fixedReviewers: string[] = [],
  ): Promise<{
    action: string;
    usernames?: string[];
    comment?: string | null;
    jobId?: number;
  }> {
    jobName = jobName || "get-reviewers";
    fixedReviewers = fixedReviewers || [];

    // If fixed reviewers configured — post comment mentioning them
    if (fixedReviewers.length) {
      showToast(t("toastAssigningReviewers"), "success");
      const body =
        "Reviewers: " +
        fixedReviewers
          .map(function (u) {
            return "@" + u;
          })
          .join(" ");
      return api(
        "POST",
        "/projects/" +
          context.projectId +
          "/merge_requests/" +
          context.mrIid +
          "/notes",
        { body: body },
      ).then(function () {
        return { action: "commented", usernames: fixedReviewers };
      });
    }

    return api<{ body: string }[]>(
      "GET",
      "/projects/" +
        context.projectId +
        "/merge_requests/" +
        context.mrIid +
        "/notes?per_page=100",
    ).then(function (notes): Promise<{
      action: string;
      comment?: string | null;
      jobId?: number;
    }> {
      let reviewerNote: string | null = null;
      for (let i = notes.length - 1; i >= 0; i--) {
        if (/Reviewers?\s*:/i.test(notes[i].body)) {
          reviewerNote = notes[i].body;
          break;
        }
      }

      if (reviewerNote) {
        showToast(t("toastRepostingReviewers"), "success");
        return api(
          "POST",
          "/projects/" +
            context.projectId +
            "/merge_requests/" +
            context.mrIid +
            "/notes",
          {
            body: reviewerNote,
          },
        ).then(function () {
          return { action: "reposted", comment: reviewerNote };
        });
      }

      showToast(t("toastNoReviewersTriggering", [jobName]), "success");
      let pipeline: PipelineSelection;
      return getCurrentPipeline()
        .then(function (selected) {
          pipeline = selected;
          return getPipelineJobs(pipeline, jobName);
        })
        .then(function (jobs) {
          const job = findLatestJobByName(jobs, jobName);
          if (!job)
            throw new Error(
              'Job "' +
                jobName +
                '" not found in pipeline #' +
                pipeline.id +
                " (project " +
                pipeline.projectId +
                ")",
            );

          if (job.status === "manual" || job.status === "skipped") {
            return api<Job>(
              "POST",
              "/projects/" + pipeline.projectId + "/jobs/" + job.id + "/play",
            ).then(function () {
              return { action: "triggered", jobId: job.id };
            });
          } else if (job.status === "failed" || job.status === "canceled") {
            return api<Job>(
              "POST",
              "/projects/" + pipeline.projectId + "/jobs/" + job.id + "/retry",
            ).then(function () {
              return { action: "retried", jobId: job.id };
            });
          } else {
            return { action: "already " + job.status, jobId: job.id };
          }
        });
    });
  }

  function doPipelineRestart() {
    return getMR().then(function (mr) {
      showToast(t("toastCreatingPipeline", [mr.source_branch]), "success");
      return api("POST", "/projects/" + context.projectId + "/pipeline", {
        ref: mr.source_branch,
      });
    });
  }

  function doPipelineCancel() {
    return api<Pipeline[]>(
      "GET",
      "/projects/" +
        context.projectId +
        "/merge_requests/" +
        context.mrIid +
        "/pipelines",
    ).then(function (pipelines) {
      const running = pipelines.filter(function (p) {
        return ["running", "pending", "created"].indexOf(p.status) !== -1;
      });
      if (!running.length) throw new Error(t("toastNoRunningPipelines"));
      showToast(
        t("toastCancellingPipelines", [String(running.length)]),
        "success",
      );
      return Promise.all(
        running.map(function (p) {
          return api(
            "POST",
            "/projects/" + context.projectId + "/pipelines/" + p.id + "/cancel",
          ).catch(function () {});
        }),
      );
    });
  }

  function doDraftToggle() {
    return getMR().then(function (mr) {
      const isDraft = mr.title.match(/^(\[Draft\]|Draft:|WIP:)\s*/i);
      let newTitle: string;
      if (isDraft) {
        newTitle = mr.title.replace(/^(\[Draft\]|Draft:|WIP:)\s*/i, "");
        showToast(t("toastMarkingReady"), "success");
      } else {
        newTitle = "Draft: " + mr.title;
        showToast(t("toastMarkingDraft"), "success");
      }
      return api(
        "PUT",
        "/projects/" + context.projectId + "/merge_requests/" + context.mrIid,
        {
          title: newTitle,
        },
      ).then(function () {
        return { wasDraft: !!isDraft, newTitle: newTitle };
      });
    });
  }

  function doRetryFailed() {
    let pipeline: PipelineSelection;
    return getCurrentPipeline()
      .then(function (selected) {
        pipeline = selected;
        return getPipelineJobs(pipeline);
      })
      .then(function (jobs) {
        const failed = jobs.filter(function (j) {
          return j.status === "failed";
        });
        if (!failed.length) throw new Error(t("toastNoFailedJobs"));
        showToast(t("toastRetrying", [String(failed.length)]), "success");
        return Promise.all(
          failed.map(function (job) {
            return api<Job>(
              "POST",
              "/projects/" + pipeline.projectId + "/jobs/" + job.id + "/retry",
            ).catch(function () {});
          }),
        );
      });
  }

  function findLatestJobByName(jobs: Job[], jobName: string) {
    // When a job is retried, GitLab creates a new job with the same name.
    // Pick the one with the highest ID (most recent).
    let found = null;
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].name === jobName) {
        if (!found || jobs[i].id > found.id) found = jobs[i];
      }
    }
    return found;
  }

  function startJob(
    jobs: Job[],
    jobName: string,
    pipeline: PipelineSelection,
  ): Promise<number> {
    const job = findLatestJobByName(jobs, jobName);
    if (!job)
      throw new Error(
        'Job "' +
          jobName +
          '" not found in pipeline #' +
          pipeline.id +
          " (project " +
          pipeline.projectId +
          ")",
      );

    if (job.status === "success") {
      showToast(t("toastJobAlreadySucceeded", [jobName]), "success");
      return Promise.resolve(job.id);
    } else if (job.status === "manual" || job.status === "skipped") {
      showToast(t("toastPlayingJob", [jobName]), "success");
      return api<Job>(
        "POST",
        "/projects/" + pipeline.projectId + "/jobs/" + job.id + "/play",
      ).then(function (resp) {
        return resp.id || job.id;
      });
    } else if (job.status === "failed" || job.status === "canceled") {
      showToast(t("toastRetryingJob", [jobName]), "success");
      return api<Job>(
        "POST",
        "/projects/" + pipeline.projectId + "/jobs/" + job.id + "/retry",
      )
        .then(function (resp) {
          return resp.id || job.id;
        })
        .catch(function (err) {
          // 403 = job already retried, refetch and find the new one
          if (err.message && err.message.indexOf("403") !== -1) {
            return getPipelineJobs(pipeline, jobName).then(
              function (freshJobs) {
                const fresh = findLatestJobByName(freshJobs, jobName);
                if (!fresh)
                  throw new Error(
                    'Job "' + jobName + '" not found after refetch',
                  );
                if (fresh.id !== job.id)
                  return startJob(freshJobs, jobName, pipeline);
                throw err;
              },
            );
          }
          throw err;
        });
    } else if (
      [
        "running",
        "pending",
        "created",
        "preparing",
        "waiting_for_resource",
        "scheduled",
      ].indexOf(job.status) !== -1
    ) {
      showToast(t("toastJobAlreadyStatus", [jobName, job.status]), "success");
      return Promise.resolve(job.id);
    } else {
      throw new Error(
        'Job "' + jobName + '" is in unexpected status: ' + job.status,
      );
    }
  }

  function waitForJob(jobId: number, jobName: string, maxAttempts = 120) {
    maxAttempts = maxAttempts || 120;
    let attempt = 0;
    function findJobByName(name: string) {
      // Find the latest job with this name in the pipeline (retry creates new jobs)
      return api<Pipeline[]>(
        "GET",
        "/projects/" +
          context.projectId +
          "/merge_requests/" +
          context.mrIid +
          "/pipelines",
      )
        .then(function (pipelines) {
          if (!pipelines.length) return null;
          return api<Job[]>(
            "GET",
            "/projects/" +
              context.projectId +
              "/pipelines/" +
              pipelines[0].id +
              "/jobs?per_page=100",
          );
        })
        .then(function (jobs) {
          if (!jobs) return null;
          for (let i = 0; i < jobs.length; i++) {
            if (jobs[i].name === name) return jobs[i];
          }
          return null;
        });
    }
    function check(): Promise<Job> {
      attempt++;
      if (attempt > maxAttempts)
        throw new Error('Timeout waiting for job "' + jobName + '"');
      return sleep(20000)
        .then(function () {
          // Look up by name in pipeline (handles retry creating new job IDs)
          return findJobByName(jobName);
        })
        .then(function (job) {
          if (!job)
            return api<Job>(
              "GET",
              "/projects/" + context.projectId + "/jobs/" + jobId,
            );
          return job;
        })
        .then(function (job) {
          showToast(t("toastWaitingForJob", [jobName, job.status]), "success");
          if (job.status === "success") return job;
          if (job.status === "failed")
            throw new Error('Job "' + jobName + '" failed');
          if (job.status === "canceled")
            throw new Error('Job "' + jobName + '" was canceled');
          return check();
        });
    }
    return check();
  }

  function doTriggerJob(jobNameStr: string) {
    // Support comma-separated job names for chaining: "job1, job2, job3"
    const jobNames = jobNameStr
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);

    // Single job — run directly in content script
    if (jobNames.length === 1) {
      let pipeline: PipelineSelection;
      return getCurrentPipeline()
        .then(function (selected) {
          pipeline = selected;
          return getPipelineJobs(pipeline, jobNames[0]);
        })
        .then(function (jobs) {
          return startJob(jobs, jobNames[0], pipeline);
        });
    }

    // Multi-job chain — delegate to background service worker (survives page navigation)
    return getMR().then(function (mr) {
      const mrTitle = "!" + context.mrIid + " " + (mr.title || "");
      return new Promise<{ taskId: string }>(function (resolve, reject) {
        chrome.runtime.sendMessage(
          {
            type: "start-job-chain",
            jobs: jobNames,
            gitlabUrl: context.origin,
            projectId: context.projectId,
            mrIid: context.mrIid,
            mrTitle: mrTitle,
          },
          function (response) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (response && response.taskId) {
              pollTaskStatus(response.taskId, jobNames, mrTitle);
              resolve({ taskId: response.taskId });
            } else {
              reject(new Error("Failed to start background job chain"));
            }
          },
        );
      });
    });
  }
  return {
    getCurrentPipeline,
    getPipelineJobs,
    doReviewers,
    doPipelineRestart,
    doPipelineCancel,
    doDraftToggle,
    doRetryFailed,
    findLatestJobByName,
    startJob,
    waitForJob,
    doTriggerJob,
  };
}
