import type { ActiveMergeRequest } from "../../../entities/merge-request";
import type { Pipeline } from "../../../entities/pipeline";
import type { ApiError } from "../../../shared/api/gitlab";
import { sleep } from "../../../shared/lib/time";
import type { MergeOptions, MrServices } from "./types";
import type { createVersionActions } from "./version";
const REBASE_MAX_POLLS = 60;
const MR_READY_MAX_POLLS = 40;
const NEW_PIPELINE_MAX_POLLS = 15;
const REBASE_POLL_INTERVAL_MS = 2000;
const MR_READY_POLL_INTERVAL_MS = 3000;
const FORCE_SHIP_SETTLE_MS = 15000;
export function createMergeActions(
  { context, api, getMR, t, showToast }: MrServices,
  { doVersionBump }: ReturnType<typeof createVersionActions>,
) {
  let _mergeMethod: string | null = null;

  function getMergeMethod() {
    if (_mergeMethod) return Promise.resolve(_mergeMethod);
    return api<{ merge_method?: string }>(
      "GET",
      "/projects/" + context.projectId,
    ).then(function (project) {
      _mergeMethod = project.merge_method || "merge";
      return _mergeMethod;
    });
  }

  function needsRebase() {
    return getMergeMethod().then(function (method) {
      return method === "rebase_merge" || method === "ff";
    });
  }

  // =========================================================================
  // Actions
  // =========================================================================

  function doRebase(skipCI?: boolean) {
    return api(
      "PUT",
      "/projects/" +
        context.projectId +
        "/merge_requests/" +
        context.mrIid +
        "/rebase",
      skipCI ? { skip_ci: true } : {},
    ).then(function () {
      return pollRebase(0);
    });
  }

  function pollRebase(attempt = 0): Promise<ActiveMergeRequest> {
    attempt = (attempt || 0) + 1;
    if (attempt > REBASE_MAX_POLLS)
      throw new Error("Timeout waiting for rebase to complete");
    return sleep(REBASE_POLL_INTERVAL_MS)
      .then(function () {
        return getMR(true);
      })
      .then(function (mr) {
        if (typeof mr.rebase_in_progress !== "boolean")
          throw new Error(t("errorRebaseStatusMissing"));
        if (mr.rebase_in_progress) return pollRebase(attempt);
        if (mr.merge_error) throw new Error("Rebase failed: " + mr.merge_error);
        return mr;
      });
  }

  function doRebaseVersion() {
    let _rebase = false;
    return needsRebase()
      .then(function (r) {
        _rebase = r;
        if (_rebase) {
          showToast(t("toastStep12Rebasing"), "success");
          return doRebase(false);
        }
      })
      .then(function () {
        showToast(t("toastVersionBump"), "success");
        return doVersionBump();
      });
  }

  function doRebaseAutoMerge() {
    let _rebase = false;
    return needsRebase()
      .then(function (r) {
        _rebase = r;
        if (_rebase) {
          showToast(t("toastStep12Rebasing"), "success");
          return doRebase(false);
        }
      })
      .then(function () {
        showToast(
          _rebase ? t("toastStep22Automerge") : t("toastEnablingAutomerge"),
          "success",
        );
        return doAutoMergeWithRetry(
          MR_READY_MAX_POLLS,
          MR_READY_POLL_INTERVAL_MS,
        );
      });
  }

  function doRebaseForce() {
    let _rebase = false;
    return needsRebase()
      .then(function (r) {
        _rebase = r;
        if (_rebase) {
          showToast(t("toastStep12RebasingSki"), "success");
          return doRebase(true);
        }
      })
      .then(function () {
        showToast(
          _rebase ? t("toastStep22Cancelling") : t("toastCancellingMerging"),
          "success",
        );
        return Promise.all([
          getMergeOptions(),
          api<Pipeline[]>(
            "GET",
            "/projects/" +
              context.projectId +
              "/merge_requests/" +
              context.mrIid +
              "/pipelines",
          ),
        ]);
      })
      .then(function (results) {
        const mergeOpts = results[0];
        const pipelines = results[1];
        const cancelPromises = pipelines
          .filter(function (p) {
            return ["running", "pending", "created"].indexOf(p.status) !== -1;
          })
          .map(function (p) {
            return api(
              "POST",
              "/projects/" +
                context.projectId +
                "/pipelines/" +
                p.id +
                "/cancel",
            ).catch(function () {});
          });
        return Promise.all(cancelPromises).then(function () {
          return mergeOpts;
        });
      })
      .then(function (mergeOpts) {
        return sleep(REBASE_POLL_INTERVAL_MS).then(function () {
          return api(
            "PUT",
            "/projects/" +
              context.projectId +
              "/merge_requests/" +
              context.mrIid +
              "/merge",
            {
              squash: mergeOpts.squash,
              should_remove_source_branch:
                mergeOpts.should_remove_source_branch,
            },
          );
        });
      });
  }

  function getMergeOptions() {
    return getMR().then(function (mr) {
      return {
        squash: !!mr.squash,
        should_remove_source_branch: !!(
          mr.force_remove_source_branch || mr.should_remove_source_branch
        ),
      };
    });
  }

  function doAutoMerge() {
    return getMR().then(function (mr) {
      if (mr.has_conflicts) throw new Error("MR has conflicts");
      if (mr.blocking_discussions_resolved === false)
        throw new Error("Unresolved threads");
      return api(
        "PUT",
        "/projects/" +
          context.projectId +
          "/merge_requests/" +
          context.mrIid +
          "/merge",
        {
          merge_when_pipeline_succeeds: true,
          squash: !!mr.squash,
          should_remove_source_branch: !!(
            mr.force_remove_source_branch || mr.should_remove_source_branch
          ),
        },
      );
    });
  }

  function waitForBranchInMR(branch: string, maxAttempts = MR_READY_MAX_POLLS) {
    maxAttempts = maxAttempts || MR_READY_MAX_POLLS;
    // Step 1: get actual branch HEAD from repository API
    return api<{ commit: { id: string } }>(
      "GET",
      "/projects/" +
        context.projectId +
        "/repository/branches/" +
        encodeURIComponent(branch),
    ).then(function (branchData) {
      const expectedSha = branchData.commit.id;
      // Step 2: poll MR until sha matches
      // GitLab 18.x: check both sha and diff_head_sha — either may update first
      let attempt = 0;
      function check(): Promise<ActiveMergeRequest> {
        attempt++;
        if (attempt > maxAttempts) {
          // GitLab 18.x bug: sha fields may lag — verify via MR commits API as fallback
          return api<{ id: string }[]>(
            "GET",
            "/projects/" +
              context.projectId +
              "/merge_requests/" +
              context.mrIid +
              "/commits",
          ).then(function (commits) {
            if (commits && commits.length && commits[0].id === expectedSha)
              return getMR();
            throw new Error("Timeout waiting for MR to sync with branch HEAD");
          });
        }
        return sleep(MR_READY_POLL_INTERVAL_MS)
          .then(function () {
            return getMR();
          })
          .then(function (mr) {
            showToast(
              t("toastWaitingMrSync", [String(attempt), String(maxAttempts)]),
              "success",
            );
            if (mr.sha === expectedSha || mr.diff_head_sha === expectedSha)
              return mr;
            return check();
          });
      }
      return check();
    });
  }

  function waitForNewPipeline(
    oldSha: string,
    maxAttempts = NEW_PIPELINE_MAX_POLLS,
  ) {
    maxAttempts = maxAttempts || NEW_PIPELINE_MAX_POLLS;
    const activePipelineStatuses = [
      "running",
      "pending",
      "created",
      "waiting_for_resource",
      "preparing",
      "scheduled",
    ];
    let attempt = 0;
    function check(): Promise<ActiveMergeRequest> {
      attempt++;
      if (attempt > maxAttempts)
        throw new Error("Timeout waiting for new pipeline");
      return sleep(MR_READY_POLL_INTERVAL_MS)
        .then(function () {
          return getMR();
        })
        .then(function (mr) {
          // GitLab 18.x: check both sha fields
          const currentSha = mr.sha || mr.diff_head_sha;
          if (currentSha === oldSha) return check();
          // SHA changed, now check pipeline
          return api<Pipeline[]>(
            "GET",
            "/projects/" +
              context.projectId +
              "/merge_requests/" +
              context.mrIid +
              "/pipelines",
          ).then(function (pipelines) {
            if (
              pipelines.length > 0 &&
              activePipelineStatuses.indexOf(pipelines[0].status) !== -1
            ) {
              return mr;
            }
            return check();
          });
        });
    }
    return check();
  }

  function doAutoMergeWithRetry(
    maxRetries = MR_READY_MAX_POLLS,
    interval = MR_READY_POLL_INTERVAL_MS,
  ) {
    maxRetries = maxRetries || MR_READY_MAX_POLLS;
    interval = interval || MR_READY_POLL_INTERVAL_MS;
    let attempt = 0;
    let _mergeOpts: MergeOptions;
    // GitLab also returns 405 while mergeability is being calculated. Keep
    // retrying it within the normal limit, as with 406/422 readiness responses.
    const fatalPatterns = [
      "has_conflicts",
      "conflict",
      "you don't have permissions",
    ];
    function isFatal(err: ApiError) {
      if ([401, 403, 404].indexOf(err.httpStatus || 0) !== -1) return true;
      const lower = (err.message || "").toLowerCase();
      return fatalPatterns.some(function (p) {
        return lower.indexOf(p) !== -1;
      });
    }
    function tryMerge(): Promise<unknown> {
      attempt++;
      showToast(
        t("toastAutomergeAttempt", [String(attempt), String(maxRetries)]),
        "success",
      );
      return api(
        "PUT",
        "/projects/" +
          context.projectId +
          "/merge_requests/" +
          context.mrIid +
          "/merge",
        {
          merge_when_pipeline_succeeds: true,
          squash: _mergeOpts.squash,
          should_remove_source_branch: _mergeOpts.should_remove_source_branch,
        },
      ).catch(function (err) {
        if (attempt < maxRetries && !isFatal(err)) {
          return sleep(interval).then(tryMerge);
        }
        throw err;
      });
    }
    return getMergeOptions().then(function (opts) {
      _mergeOpts = opts;
      return tryMerge();
    });
  }

  function waitMRReady(maxAttempts = MR_READY_MAX_POLLS) {
    // Wait until GitLab processes the new commit: pipeline started
    maxAttempts = maxAttempts || MR_READY_MAX_POLLS;
    const activePipelineStatuses = [
      "running",
      "pending",
      "created",
      "waiting_for_resource",
      "preparing",
      "scheduled",
    ];
    function isReady(
      pipeline: Pipeline | null | undefined,
      mr: ActiveMergeRequest,
      isHead?: boolean,
    ) {
      if (!pipeline) return false;
      const sha =
        mr.diff_head_sha || (mr.diff_refs && mr.diff_refs.head_sha) || mr.sha;
      // Merged-results and merge-train pipelines run a synthetic commit. Its
      // SHA differs from the source SHA; trust the MR's own head reference.
      const syntheticHead =
        isHead &&
        (pipeline.ref === "refs/merge-requests/" + context.mrIid + "/merge" ||
          pipeline.ref === "refs/merge-requests/" + context.mrIid + "/train");
      if (!syntheticHead && sha && pipeline.sha && pipeline.sha !== sha)
        return false;
      if (activePipelineStatuses.indexOf(pipeline.status) !== -1) return true;
      // A short pipeline can finish before the next poll. Its matching SHA
      // proves it belongs to this revision even though it is no longer active.
      return !!(
        (syntheticHead || (sha && pipeline.sha === sha)) &&
        ["success", "failed", "canceled"].indexOf(pipeline.status) !== -1
      );
    }
    let attempt = 0;
    function check(): Promise<ActiveMergeRequest> {
      attempt++;
      if (attempt > maxAttempts)
        throw new Error(
          "Timeout: GitLab did not create pipeline after " +
            maxAttempts * 3 +
            "s",
        );
      return sleep(MR_READY_POLL_INTERVAL_MS)
        .then(function () {
          return getMR();
        })
        .then(function (mr) {
          showToast(
            t("toastWaitingPipeline") +
              " (" +
              attempt +
              "/" +
              maxAttempts +
              ")",
            "success",
          );
          const hp = mr.head_pipeline;
          if (isReady(hp, mr, true)) return mr;
          // GitLab 18.x: head_pipeline may lag — check pipelines API directly
          return api<Pipeline[]>(
            "GET",
            "/projects/" +
              context.projectId +
              "/merge_requests/" +
              context.mrIid +
              "/pipelines",
          ).then(function (pipelines) {
            if (
              pipelines.some(function (pipeline) {
                return isReady(pipeline, mr);
              })
            )
              return mr;
            return check();
          });
        });
    }
    return check();
  }

  function doShip() {
    let _rebase = false;
    return needsRebase()
      .then(function (r) {
        _rebase = r;
        if (_rebase) {
          showToast(t("toastRebasing"), "success");
          return doRebase(false);
        }
      })
      .then(function () {
        showToast(t("toastVersionBump"), "success");
        return doVersionBump();
      })
      .then(function (result) {
        showToast(t("toastWaitingSync", [result.version]), "success");
        return waitForBranchInMR(result.branch);
      })
      .then(function () {
        showToast(t("toastWaitingPipeline"), "success");
        return waitMRReady();
      })
      .then(function () {
        showToast(t("toastEnablingAutomerge"), "success");
        return doAutoMergeWithRetry(
          MR_READY_MAX_POLLS,
          MR_READY_POLL_INTERVAL_MS,
        );
      });
  }

  function doForceShip() {
    let _rebase = false;
    return needsRebase()
      .then(function (r) {
        _rebase = r;
        if (_rebase) {
          showToast(t("toastStep12RebasingSki"), "success");
          return doRebase(true);
        }
      })
      .then(function () {
        showToast(t("toastVersionBump"), "success");
        return doVersionBump();
      })
      .then(function (result) {
        showToast(t("toastWaitingSync", [result.version]), "success");
        return waitForBranchInMR(result.branch);
      })
      .then(function () {
        showToast(t("toastWaiting15s"), "success");
        return sleep(FORCE_SHIP_SETTLE_MS);
      })
      .then(function () {
        showToast(t("toastStep22Cancelling"), "success");
        return Promise.all([
          getMergeOptions(),
          api<Pipeline[]>(
            "GET",
            "/projects/" +
              context.projectId +
              "/merge_requests/" +
              context.mrIid +
              "/pipelines",
          ),
        ]);
      })
      .then(function (results) {
        const mergeOpts = results[0];
        const pipelines = results[1];
        const cancelPromises = pipelines
          .filter(function (p) {
            return ["running", "pending", "created"].indexOf(p.status) !== -1;
          })
          .map(function (p) {
            return api(
              "POST",
              "/projects/" +
                context.projectId +
                "/pipelines/" +
                p.id +
                "/cancel",
            ).catch(function () {});
          });
        return Promise.all(cancelPromises).then(function () {
          return mergeOpts;
        });
      })
      .then(function (mergeOpts) {
        return sleep(REBASE_POLL_INTERVAL_MS).then(function () {
          return api(
            "PUT",
            "/projects/" +
              context.projectId +
              "/merge_requests/" +
              context.mrIid +
              "/merge",
            {
              squash: mergeOpts.squash,
              should_remove_source_branch:
                mergeOpts.should_remove_source_branch,
            },
          );
        });
      });
  }
  function doJustRebase() {
    showToast(t("toastRebasing"), "success");
    return doRebase(false);
  }
  return {
    doJustRebase,
    getMergeMethod,
    needsRebase,
    doRebase,
    pollRebase,
    doRebaseVersion,
    doRebaseAutoMerge,
    doRebaseForce,
    getMergeOptions,
    doAutoMerge,
    waitForBranchInMR,
    waitForNewPipeline,
    doAutoMergeWithRetry,
    waitMRReady,
    doShip,
    doForceShip,
  };
}
