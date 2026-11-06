import {
  JOB_POLL_INTERVAL_MS,
  JOB_POLL_MAX_ATTEMPTS,
} from "../../../entities/pipeline";
import { NOTIFICATION_ICON } from "../../../shared/config/extension";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab";
import type { ActiveMergeRequest } from "../../../entities/merge-request";
import type { Job, Pipeline } from "../../../entities/pipeline";
import { api } from "../../../shared/api/background-proxy";
import { createTaskStore, TASK_ALARM } from "./store";
import type { ChainMessage, ChainTask } from "./types";
export function createJobChains() {
  const tasks: Record<string, ChainTask> = {};
  let taskSequence = 0;
  const store = createTaskStore(tasks);
  const running = new Set<string>();
  const ready = store.load().then(() => {
    store.syncAlarm();
    resume();
  });
  // The rejection is returned to every task request; never start a mutation when
  // durable state could not be read. Attach a handler before the first message.
  void ready.catch((error) =>
    console.error("Could not restore job chains", error),
  );
  function checkpoint(task: ChainTask) {
    if (!Object.values(tasks).includes(task)) return Promise.resolve();
    task.updatedAt = Date.now();
    return store.save();
  }
  function resume() {
    for (const [id, task] of Object.entries(tasks))
      if (task.status !== "done" && task.status !== "error") runJobChain(id);
  }
  function wake(alarm: chrome.alarms.Alarm) {
    if (alarm.name === TASK_ALARM) void ready.then(resume).catch(() => {});
  }
  function startup() {
    // Chrome may discard alarms across browser restarts. Recreate them even
    // when no GitLab tab has sent a message to this worker yet.
    void ready
      .then(() => {
        store.syncAlarm();
        resume();
      })
      .catch(() => {});
  }
  async function mutateJob(
    task: ChainTask,
    job: Job,
    operation: "play" | "retry",
  ) {
    task.phase = "dispatching";
    task.pendingJobId = job.id;
    task.pendingOperation = operation;
    await checkpoint(task);
    if (task._cancelled) throw new Error("Cancelled by user");
    return api<{ id?: number }>(
      task,
      "POST",
      "/projects/" +
        (task.pipelineProjectId || task.projectId) +
        "/jobs/" +
        job.id +
        "/" +
        operation,
    );
  }
  async function reconcile(task: ChainTask, jobName: string) {
    const job = await findJobByName(task, jobName);
    if (
      !job ||
      (task.pendingOperation === "retry" && job.id === task.pendingJobId) ||
      ["manual", "skipped", "failed", "canceled"].includes(job.status)
    ) {
      throw new Error(
        "Job start outcome is unknown after worker restart. Check the pipeline before starting a new chain.",
      );
    }
    task.phase = "waiting";
    await checkpoint(task);
    return { id: job.id, name: jobName, skipped: job.status === "success" };
  }
  function findJobByName(task: ChainTask, jobName: string) {
    // Resolve once per chain. A new push/pipeline must not redirect a running
    // chain to another pipeline, including while waiting for or retrying a job.
    const pipelinePromise = task.pipelineId
      ? Promise.resolve(task.pipelineId)
      : api<ActiveMergeRequest>(
          task,
          "GET",
          "/projects/" + task.projectId + "/merge_requests/" + task.mrIid,
        ).then(function (mr) {
          if (task._cancelled) throw new Error("Cancelled by user");
          if (mr.head_pipeline && mr.head_pipeline.id) {
            task.pipelineId = mr.head_pipeline.id;
            task.pipelineProjectId =
              mr.head_pipeline.project_id ||
              mr.source_project_id ||
              task.projectId;
            return task.pipelineId;
          }
          return api<Pipeline[]>(
            task,
            "GET",
            "/projects/" +
              task.projectId +
              "/merge_requests/" +
              task.mrIid +
              "/pipelines",
          ).then(function (pipelines) {
            if (task._cancelled) throw new Error("Cancelled by user");
            let latest = null;
            for (let i = 0; i < pipelines.length; i++) {
              const pipeline = pipelines[i];
              if (mr.sha && pipeline.sha !== mr.sha) continue;
              // Preserve GitLab's MR-pipeline preference within this SHA.
              latest = pipeline;
              break;
            }
            if (!latest) return null;
            task.pipelineId = latest.id;
            task.pipelineProjectId =
              latest.project_id || mr.source_project_id || task.projectId;
            return task.pipelineId;
          });
        });
    const seen: Record<number, boolean> = {};
    function readPage(pipelineId: number, page: number): Promise<Job | null> {
      let path =
        "/projects/" +
        (task.pipelineProjectId || task.projectId) +
        "/pipelines/" +
        pipelineId +
        "/jobs?per_page=" +
        GITLAB_PAGE_SIZE;
      if (page > 1) path += "&page=" + page;
      return api<Job[]>(task, "GET", path).then(function (jobs) {
        if (task._cancelled) throw new Error("Cancelled by user");
        // Pick the newest attempt within this pipeline; pagination must never
        // redirect polling or a retry to a newly created MR pipeline.
        let found: Job | null = null;
        let hasNewJobs = false;
        for (let i = 0; i < jobs.length; i++) {
          if (jobs[i].name === jobName && (!found || jobs[i].id > found.id))
            found = jobs[i];
          if (!seen[jobs[i].id]) hasNewJobs = true;
          seen[jobs[i].id] = true;
        }
        if (found || jobs.length < GITLAB_PAGE_SIZE) return found;
        if (!hasNewJobs)
          throw new Error(
            chrome.i18n.getMessage("errorJobsPageRepeated", [
              String(pipelineId),
            ]),
          );
        return readPage(pipelineId, page + 1);
      });
    }
    return pipelinePromise.then(function (pipelineId) {
      if (!pipelineId) return null;
      return checkpoint(task).then(() => readPage(pipelineId, 1));
    });
  }
  function startJobByName(
    task: ChainTask,
    jobName: string,
  ): Promise<{ id: number; name: string; skipped?: boolean }> {
    return findJobByName(task, jobName).then(function (job) {
      if (!job)
        throw new Error(
          'Job "' +
            jobName +
            '" not found in pipeline' +
            (task.pipelineId ? " #" + task.pipelineId : ""),
        );

      if (job.status === "success") {
        return { id: job.id, name: jobName, skipped: true };
      } else if (job.status === "manual" || job.status === "skipped") {
        return mutateJob(task, job, "play").then(function (resp) {
          return { id: resp.id || job.id, name: jobName };
        });
      } else if (job.status === "failed" || job.status === "canceled") {
        return mutateJob(task, job, "retry")
          .then(function (resp) {
            return { id: resp.id || job.id, name: jobName };
          })
          .catch(function (err) {
            // 403 = already retried, refetch to find the new job
            if (err.message && err.message.indexOf("403") !== -1) {
              return findJobByName(task, jobName).then(function (fresh) {
                if (!fresh)
                  throw new Error(
                    'Job "' + jobName + '" not found after refetch',
                  );
                if (fresh.id !== job.id) return startJobByName(task, jobName);
                throw err;
              });
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
        return { id: job.id, name: jobName };
      } else {
        throw new Error(
          'Job "' + jobName + '" has unexpected status: ' + job.status,
        );
      }
    });
  }
  function waitForJobComplete(
    task: ChainTask,
    jobName: string,
    maxAttempts?: number,
  ) {
    maxAttempts = maxAttempts || JOB_POLL_MAX_ATTEMPTS;
    let attempt = task.waitAttempts || 0;
    function check(): Promise<Job> {
      attempt++;
      task.waitAttempts = attempt;
      if (task._cancelled) throw new Error("Cancelled by user");
      if (attempt > maxAttempts!)
        throw new Error('Timeout waiting for "' + jobName + '"');
      return checkpoint(task)
        .then(
          () =>
            new Promise<void>(function (resolve) {
              setTimeout(resolve, JOB_POLL_INTERVAL_MS);
            }),
        )
        .then(function () {
          return findJobByName(task, jobName);
        })
        .then(function (job) {
          if (!job) throw new Error('Job "' + jobName + '" not found');
          if (job.status === "success") return job;
          if (job.status === "failed")
            throw new Error('Job "' + jobName + '" failed');
          if (job.status === "canceled")
            throw new Error('Job "' + jobName + '" canceled');
          return check();
        });
    }
    return check();
  }
  function runJobChain(taskId: string) {
    const task = tasks[taskId];
    if (
      !task ||
      task._cancelled ||
      running.has(taskId) ||
      task.status === "done" ||
      task.status === "error"
    )
      return;
    running.add(taskId);
    void (async () => {
      try {
        while (!task._cancelled && task.currentIndex < task.jobs.length) {
          const jobName = task.jobs[task.currentIndex];
          task.status = "running: " + jobName;
          broadcastProgress(taskId);
          const result =
            task.phase === "dispatching"
              ? await reconcile(task, jobName)
              : task.phase === "waiting"
                ? { skipped: false }
                : await startJobByName(task, jobName);
          if (task._cancelled) return;
          task.phase = "waiting";
          await checkpoint(task);
          if (!result.skipped) await waitForJobComplete(task, jobName);
          if (task._cancelled) return;
          task.currentIndex++;
          task.phase = "ready";
          task.waitAttempts = 0;
          delete task.pendingJobId;
          delete task.pendingOperation;
          await checkpoint(task);
        }
        if (task._cancelled) return;
        task.status = "done";
        task.phase = "complete";
        await checkpoint(task);
        notifyResult(
          taskId,
          true,
          "All jobs completed: " + task.jobs.join(" → "),
        );
      } catch (error) {
        if (task._cancelled) return;
        task.status = "error";
        task.error = error instanceof Error ? error.message : String(error);
        // Preserve dispatching if persistence fails: recovery reconciles instead of replaying.
        await checkpoint(task).catch(() => {});
        notifyResult(
          taskId,
          false,
          'Job chain failed at "' +
            task.jobs[task.currentIndex] +
            '": ' +
            task.error,
        );
      } finally {
        running.delete(taskId);
        store.syncAlarm();
      }
    })();
  }
  function broadcastToTabs(gitlabUrl: string, message: unknown) {
    chrome.tabs
      .query({ url: gitlabUrl + "/*" })
      .then(function (tabs) {
        tabs.forEach(function (tab) {
          chrome.tabs.sendMessage(tab.id!, message).catch(function () {});
        });
      })
      .catch(function () {});
  }
  function broadcastProgress(taskId: string) {
    const task = tasks[taskId];
    if (!task) return;
    broadcastToTabs(task.gitlabUrl, {
      type: "task-progress",
      taskId: taskId,
      jobs: task.jobs,
      status: task.status,
      mrTitle: task.mrTitle,
    });
  }
  function notifyResult(taskId: string, success: boolean, message: string) {
    const task = tasks[taskId];
    if (task) {
      broadcastToTabs(task.gitlabUrl, {
        type: "task-result",
        taskId: taskId,
        success: success,
        message: message,
        jobs: task.jobs,
        mrTitle: task.mrTitle,
      });
    }

    chrome.storage.sync.get({ notifications_enabled: true }, function (s) {
      if (s.notifications_enabled !== false) {
        chrome.notifications.create("task-" + taskId, {
          type: "basic",
          iconUrl: NOTIFICATION_ICON,
          title: success ? "Job Chain Completed" : "Job Chain Failed",
          message: message,
        });
      }
    });
  }
  function handleMessage(
    msg: ChainMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) {
    void ready
      .then(() => dispatch(msg, sender, sendResponse))
      .catch((error) => sendResponse({ _error: error.message }));
    return true;
  }
  async function dispatch(
    msg: ChainMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) {
    if (msg.type === "start-job-chain") {
      // Each explicit start can target a new pipeline, even for the same MR/jobs.
      let taskId = "task-" + Date.now() + "-" + ++taskSequence;
      while (tasks[taskId])
        taskId = "task-" + Date.now() + "-" + ++taskSequence;
      tasks[taskId] = {
        jobs: msg.jobs,
        currentIndex: 0,
        gitlabUrl: msg.gitlabUrl,
        projectId: msg.projectId,
        mrIid: msg.mrIid,
        pipelineId: null,
        mrTitle: msg.mrTitle || "!" + msg.mrIid,
        status: "starting",
        phase: "ready",
        error: null,
        _tabId: sender.tab?.id ?? null,
      };
      try {
        await checkpoint(tasks[taskId]);
      } catch (error) {
        delete tasks[taskId];
        throw error;
      }
      store.syncAlarm();
      runJobChain(taskId);
      sendResponse({ taskId: taskId });
      return true;
    }
    if (msg.type === "get-task-status") {
      const task = tasks[msg.taskId];
      sendResponse(
        task
          ? { status: task.status, error: task.error }
          : { status: "not_found" },
      );
      return true;
    }
    if (msg.type === "cancel-task") {
      const ct = tasks[msg.taskId];
      if (ct && ct.status !== "done" && ct.status !== "error") {
        ct.status = "error";
        ct.error = "Cancelled by user";
        ct._cancelled = true;
        await checkpoint(ct);
        store.syncAlarm();
        broadcastProgress(msg.taskId);
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "get-active-tasks") {
      const active: {
        taskId: string;
        jobs: string[];
        status: string;
        mrTitle?: string;
      }[] = [];
      for (const id in tasks) {
        const t = tasks[id];
        if (t.status !== "done" && t.status !== "error") {
          active.push({
            taskId: id,
            jobs: t.jobs,
            status: t.status,
            mrTitle: t.mrTitle,
          });
        }
      }
      sendResponse(active);
      return true;
    }
  }
  return {
    handleMessage,
    ready,
    wake,
    startup,
    tasks,
    findJobByName,
    startJobByName,
    waitForJobComplete,
    runJobChain,
  };
}
