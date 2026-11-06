import { reportError } from "../../../shared/lib/errors";
import type { MrAction } from "../../../entities/settings";
import { MR_DEFAULTS } from "../../../entities/settings";
import type { MrActionContext } from "../../../features/mr-actions";
import { createMrActions } from "../../../features/mr-actions";
import { addRuntimeListener } from "../../../shared/api/runtime";
import type { Translate } from "../../../shared/i18n";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { createLifecycle } from "../../../shared/lib/lifecycle";
import { createFeedback } from "../../../shared/ui/feedback";
import { formatElapsed } from "./display";
import { createFailedJobView } from "./failed-jobs";
import { createGitCommands } from "./git-commands";
import { createSensitiveWarning } from "./sensitive-warning";
import type { PaletteAction, ToolbarButton, Tracker } from "./types";
const ACTION_RELOAD_DELAY_MS = 5000;
const ACTION_FEEDBACK_DURATION_MS = 2000;
const TOOLBAR_RETRY_DELAY_MS = 500;

export function startMrToolbar(
  context: MrActionContext,
  tracker: Tracker,
  scope: Lifecycle = createLifecycle(),
) {
  let availableActions: PaletteAction[] = [];
  const { updateTrackerItem, pollTaskStatus } = tracker;
  const { showToast } = createFeedback(() => actions.getSettings());
  const actions = createMrActions(context, { t, showToast, pollTaskStatus });
  const {
    api,
    getMR,
    getMergeMethod,
    doVersionBump,
    doReviewers,
    doJustRebase,
    doRebaseVersion,
    doRebaseAutoMerge,
    doRebaseForce,
    doPipelineRestart,
    doPipelineCancel,
    doDraftToggle,
    doRetryFailed,
    doTriggerJob,
    doShip,
    doForceShip,
    doCopyMr,
    doMrAction,
    getSettings,
  } = actions;
  const { injectFailedJobView } = createFailedJobView(
    context,
    api,
    t,
    scope,
    parsePage,
  );
  const { injectSensitiveWarning } = createSensitiveWarning(
    context,
    api,
    scope,
    parsePage,
    t,
  );
  const { injectGitCommands } = createGitCommands(t, scope);

  // i18n helper with manual language override
  let _i18nMessages: Record<string, { message: string }> | null = null;

  function t(key: string, substitutions?: Parameters<Translate>[1]) {
    if (_i18nMessages && _i18nMessages[key]) {
      let msg = _i18nMessages[key].message || "";
      if (substitutions && substitutions.length) {
        for (let i = 0; i < substitutions.length; i++) {
          msg = msg.replace("$" + (i + 1), String(substitutions[i]));
        }
      }
      return msg;
    }
    try {
      if (chrome && chrome.i18n) {
        const msg = chrome.i18n.getMessage(key, substitutions?.map(String));
        if (msg) return msg;
      }
    } catch {
      /* Optional browser feedback is best effort. */
    }
    return key;
  }

  const _languageReady = new Promise<void>(function (resolve) {
    try {
      chrome.storage.sync.get(
        { language: "auto" },
        scope.guard(function (data: { language: string }) {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }
          if (!data.language || data.language === "auto") {
            resolve();
            return;
          }
          fetch(
            chrome.runtime.getURL(
              "_locales/" + data.language + "/messages.json",
            ),
          )
            .then(function (r) {
              return r.json();
            })
            .then(function (msgs) {
              _i18nMessages = msgs;
              resolve();
            })
            .catch(function () {
              resolve();
            });
        }),
      );
    } catch {
      resolve();
    }
  });

  // Parse current page URL: /<namespace>/<project>/-/merge_requests/<iid>
  function parsePage() {
    const match = window.location.pathname.match(
      /\/(.+?)\/-\/merge_requests\/(\d+)/,
    );
    if (!match) return false;
    // A running action owns the original MR even before the app observes a
    // pushState. Never redirect its subsequent requests to a new route.
    if (
      context.projectPath !== null &&
      (context.projectPath !== match[1] || context.mrIid !== Number(match[2]))
    )
      return false;
    context.projectPath = match[1];
    context.mrIid = parseInt(match[2]);
    return true;
  }

  function getProjectId() {
    const el = document.querySelector<HTMLElement>("[data-project-id]");
    if (el) return parseInt(el.dataset.projectId!);
    const body = document.querySelector("body");
    if (body && body.dataset.projectId) return parseInt(body.dataset.projectId);
    const scripts = document.querySelectorAll("script");
    for (let i = 0; i < scripts.length; i++) {
      const m = (scripts[i].textContent || "").match(
        /"project_id"\s*:\s*(\d+)/,
      );
      if (m) return parseInt(m[1]);
    }
    return null;
  }

  function mrActionDescription(action: MrAction) {
    return (
      t("mrAction_" + action.type) +
      (/^(remove|add|set)_labels$/.test(action.type)
        ? ": " + action.labels
        : "")
    );
  }

  let _actionInProgress = false;

  function runAction(
    btn: HTMLButtonElement,
    actionFn: () => Promise<unknown>,
    actionName: string,
    opts: { reloadOnSuccess?: boolean } = {},
  ) {
    if (_actionInProgress) return;
    _actionInProgress = true;
    opts = opts || {};
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;

    getSettings()
      .then(function (s) {
        if (
          s.notifications_enabled !== false &&
          "Notification" in window &&
          Notification.permission === "default"
        ) {
          Notification.requestPermission().catch(reportError);
        }
      })
      .catch(function () {});

    const mrTitle =
      document.querySelector(".merge-request .detail-page-header .title") ||
      document.querySelector(".detail-page-description .title") ||
      document.querySelector(".merge-request-details .title");
    const titleText = mrTitle ? (mrTitle.textContent || "").trim() : "";

    // Track single jobs in background tracker
    const singleTaskId = "single-" + Date.now();
    updateTrackerItem(
      singleTaskId,
      [actionName],
      "running: " + actionName,
      null,
      "!" + context.mrIid + " " + titleText,
    );

    actionFn()
      .then(function () {
        _actionInProgress = false;
        btn.innerHTML = "&#10003;";
        const msg =
          t("toastCompleted", [actionName]) +
          (titleText ? "\n" + titleText : "");
        showToast(msg, "success");
        updateTrackerItem(
          singleTaskId,
          [actionName],
          "done",
          null,
          "!" + context.mrIid + " " + titleText,
        );
        if (opts.reloadOnSuccess) {
          scope.timeout(function () {
            window.location.reload();
          }, ACTION_RELOAD_DELAY_MS);
        }
      })
      .catch(function (err) {
        _actionInProgress = false;
        btn.innerHTML = origHtml;
        btn.disabled = false;
        const msg =
          t("toastFailed", [actionName, err.message]) +
          (titleText ? "\n" + titleText : "");
        showToast(msg, "error");
        updateTrackerItem(
          singleTaskId,
          [actionName],
          "error",
          err.message,
          "!" + context.mrIid + " " + titleText,
        );
      });
  }

  let _injecting = false;
  function injectButtons() {
    if (scope.disposed) return;
    if (_injecting || document.querySelector(".gl-mr-actions-ext")) return;

    const stateBadge = document.querySelector(".issuable-status-badge .badge");
    if (stateBadge) {
      const stateText = (stateBadge.textContent || "").trim().toLowerCase();
      if (stateText === "merged" || stateText === "closed") return;
    }

    const widgetSection =
      document.querySelector(
        '[data-testid="mr-widget-content"].mr-widget-section',
      ) ||
      document.querySelector('[data-testid="mr-widget-content"]') ||
      document.querySelector(".mr-widget-content") ||
      document.querySelector(".mr-widget-section");
    if (!widgetSection) return;

    _injecting = true;

    Promise.all([getMR(), getSettings(), getMergeMethod(), _languageReady])
      .then(function (results) {
        if (scope.disposed || !parsePage()) return;
        const mr = results[0];
        const s = results[1];
        const mergeMethod = results[2];

        if (document.querySelector(".gl-mr-actions-ext")) return;
        if (mr.state !== "opened") return;

        const container = document.createElement("div");
        container.className = "gl-mr-actions-ext";
        container.addEventListener(
          "click",
          (event) => {
            if (scope.disposed || !parsePage()) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
          },
          true,
        );

        const blocked =
          mr.has_conflicts || mr.blocking_discussions_resolved === false;
        const reviewersJob = s.reviewersJob || MR_DEFAULTS.reviewersJob;
        const fixedReviewers = (s.reviewersList || "")
          .split(/[,\s]+/)
          .map(function (u) {
            return u.replace(/^@/, "").trim();
          })
          .filter(Boolean);
        const isDraft = /^(\[Draft\]|Draft:|WIP:)/i.test(mr.title);
        const rb = mergeMethod === "rebase_merge" || mergeMethod === "ff"; // needs rebase

        const builtinDefs: Record<string, ToolbarButton> = {
          btn_version: {
            label: t("btnVersion"),
            cls: "btn-version",
            action: doVersionBump,
            name: t("btnVersion"),
          },
          btn_rebase: {
            label: t("btnRebase"),
            cls: "btn-pipeline",
            action: doJustRebase,
            name: t("btnRebase"),
            confirm: t("confirmRebase"),
            hide: !rb,
          },
          btn_rebase_version: {
            label: t("btnRebaseVersion"),
            cls: "btn-version",
            action: doRebaseVersion,
            name: t("btnRebaseVersion"),
            confirm: t("confirmRebaseVersion"),
            hide: !rb,
          },
          btn_rebase_automerge: {
            label: rb ? t("btnRebaseAutomerge") : t("labelAutomerge"),
            cls: "btn-ship",
            action: doRebaseAutoMerge,
            name: rb ? t("btnRebaseAutomerge") : t("labelAutomerge"),
            confirm: rb ? t("confirmRebaseAutomerge") : t("confirmAutomerge"),
            hide: blocked,
            reloadOnSuccess: true,
          },
          btn_rebase_force: {
            label: rb ? t("btnRebaseForce") : t("labelForceMerge"),
            cls: "btn-force-ship",
            action: doRebaseForce,
            name: rb ? t("btnRebaseForce") : t("labelForceMerge"),
            confirm: rb ? t("confirmRebaseForce") : t("confirmForce"),
            hide: blocked,
            reloadOnSuccess: true,
          },
          btn_ship: {
            label: rb ? t("btnShip") : t("labelVersionAutomerge"),
            cls: "btn-ship",
            action: doShip,
            name: "Ship",
            confirm: rb ? t("confirmShip") : t("confirmShipNoRebase"),
            hide: blocked,
            reloadOnSuccess: true,
          },
          btn_force_ship: {
            label: rb ? t("btnForceShip") : t("labelVersionForceMerge"),
            cls: "btn-force-ship",
            action: doForceShip,
            name: "Force Ship",
            confirm: rb ? t("confirmForceShip") : t("confirmForceShipNoRebase"),
            hide: blocked,
            reloadOnSuccess: true,
          },
          btn_reviewers: {
            label: t("btnReviewers"),
            cls: "btn-reviewers",
            action: function () {
              return doReviewers(reviewersJob, fixedReviewers);
            },
            name: t("btnReviewers"),
          },
          btn_pipeline_restart: {
            label: t("labelNewPipeline"),
            cls: "btn-pipeline",
            action: doPipelineRestart,
            name: t("labelNewPipeline"),
            confirm: t("confirmNewPipeline"),
          },
          btn_pipeline_cancel: {
            label: t("btnPipelineCancel"),
            cls: "btn-force-ship",
            action: doPipelineCancel,
            name: t("btnPipelineCancel"),
            confirm: t("confirmCancelPipeline"),
          },
          btn_draft_toggle: {
            label: isDraft ? t("labelMarkReady") : t("labelMarkDraft"),
            cls: "btn-draft",
            action: doDraftToggle,
            name: t("btnDraftToggle"),
          },
          btn_retry_failed: {
            label: t("labelRetryFailed"),
            cls: "btn-pipeline",
            action: doRetryFailed,
            name: t("btnRetryFailed"),
          },
          btn_copy_mr: {
            label: t("btnCopyMr"),
            cls: "btn-draft",
            action: doCopyMr,
            name: t("btnCopyMr"),
            quiet: true,
          },
        };

        // Build ordered list of all buttons (builtins + custom)
        const allKeys = Object.keys(builtinDefs);
        (s.customJobs || []).forEach(function (_job, i) {
          allKeys.push("custom_" + i);
        });

        (s.mrActions || []).forEach(function (action) {
          allKeys.push("mr_action_" + action.id);
        });

        const orderedKeys: string[] = [];
        (s.buttonOrder || []).forEach(function (key) {
          if (allKeys.indexOf(key) !== -1) orderedKeys.push(key);
        });
        allKeys.forEach(function (key) {
          if (orderedKeys.indexOf(key) === -1) orderedKeys.push(key);
        });

        orderedKeys.forEach(function (key) {
          if (key.indexOf("mr_action_") === 0) {
            const action = (s.mrActions || []).find(function (a) {
              return key === "mr_action_" + a.id;
            });
            if (!action || !action.label) return;
            const btn = document.createElement("button");
            btn.className = "btn-custom-job";
            btn.dataset.mrActionId = action.id;
            btn.textContent = action.label;
            btn.title = mrActionDescription(action);
            btn.addEventListener("click", function () {
              if (
                !s.skip_confirmations &&
                !confirm(
                  t("mrActionConfirm", [
                    action.label,
                    mrActionDescription(action),
                  ]),
                )
              )
                return;
              runAction(
                btn,
                function () {
                  return doMrAction(action);
                },
                action.label,
                { reloadOnSuccess: true },
              );
            });
            container.appendChild(btn);
          } else if (key.indexOf("custom_") === 0) {
            const idx = parseInt(key.replace("custom_", ""));
            const job = (s.customJobs || [])[idx];
            if (!job || !job.label || !job.jobName) return;
            const btn = document.createElement("button");
            btn.className = "btn-custom-job";
            btn.textContent = job.label;
            btn.title = job.label;
            btn.addEventListener("click", function () {
              runAction(
                btn,
                function () {
                  return doTriggerJob(job.jobName);
                },
                job.label,
              );
            });
            container.appendChild(btn);
          } else {
            const def = builtinDefs[key];
            if (!def || !s[key] || def.hide) return;
            const btn = document.createElement("button");
            btn.className = def.cls;
            btn.textContent = def.label;
            btn.title = def.label;
            btn.addEventListener("click", function () {
              if (def.confirm && !s.skip_confirmations && !confirm(def.confirm))
                return;
              if (def.quiet) {
                const origText = btn.textContent;
                btn.disabled = true;
                def
                  .action()
                  .then(function () {
                    btn.textContent = "\u2713";
                    scope.timeout(function () {
                      btn.textContent = origText;
                      btn.disabled = false;
                    }, ACTION_FEEDBACK_DURATION_MS);
                  })
                  .catch(function () {
                    btn.disabled = false;
                  });
              } else {
                runAction(btn, def.action, def.name, {
                  reloadOnSuccess: def.reloadOnSuccess,
                });
              }
            });
            container.appendChild(btn);
          }
        });

        // Quick comments (#35)
        (s.quickComments || []).forEach(function (qc) {
          if (!qc.label || !qc.text) return;
          const qcBtn = document.createElement("button");
          qcBtn.className = "btn-quick-comment";
          qcBtn.textContent = qc.label;
          qcBtn.title = qc.text;
          qcBtn.addEventListener("click", function () {
            const origText = qcBtn.textContent;
            qcBtn.disabled = true;
            qcBtn.innerHTML = '<span class="spinner"></span>';
            api(
              "POST",
              "/projects/" +
                context.projectId +
                "/merge_requests/" +
                context.mrIid +
                "/notes",
              { body: qc.text },
            )
              .then(function () {
                qcBtn.textContent = "\u2713";
                scope.timeout(function () {
                  qcBtn.textContent = origText;
                  qcBtn.disabled = false;
                }, ACTION_FEEDBACK_DURATION_MS);
              })
              .catch(function (err) {
                showToast(err.message, "error");
                qcBtn.textContent = origText;
                qcBtn.disabled = false;
              });
          });
          container.appendChild(qcBtn);
        });

        // Expose available actions for command palette
        const paletteKeyMap: Record<string, string> = {
          btn_copy_mr: "mr-copy",
          btn_rebase: "mr-rebase",
          btn_version: "mr-version",
          btn_rebase_automerge: "mr-automerge",
          btn_ship: "mr-ship",
          btn_draft_toggle: "mr-draft",
          btn_pipeline_restart: "mr-pipeline-restart",
          btn_pipeline_cancel: "mr-pipeline-cancel",
          btn_retry_failed: "mr-retry-failed",
          btn_reviewers: "mr-reviewers",
          btn_rebase_version: "mr-rebase-version",
          btn_rebase_force: "mr-rebase-force",
          btn_force_ship: "mr-force-ship",
        };
        const paletteActions: PaletteAction[] = [];
        orderedKeys.forEach(function (key) {
          if (key.indexOf("mr_action_") === 0) {
            const action = (s.mrActions || []).find(function (a) {
              return key === "mr_action_" + a.id;
            });
            if (action && action.label)
              paletteActions.push({
                id: key,
                label: action.label,
                icon: "action",
              });
          } else if (key.indexOf("custom_") === 0) {
            const idx = parseInt(key.replace("custom_", ""));
            const job = (s.customJobs || [])[idx];
            if (job && job.label && job.jobName) {
              paletteActions.push({
                id: "custom-job-" + idx,
                label: job.label,
                icon: "action",
              });
            }
          } else {
            const def = builtinDefs[key];
            if (!def || !s[key] || def.hide) return;
            const palId = paletteKeyMap[key];
            if (palId) {
              paletteActions.push({
                id: palId,
                label: def.label,
                icon:
                  key.indexOf("pipeline") !== -1
                    ? "pipe"
                    : key === "btn_copy_mr"
                      ? "copy"
                      : "action",
              });
            }
          }
        });
        // Quick comments as palette actions
        (s.quickComments || []).forEach(function (qc, i) {
          if (qc.label && qc.text) {
            paletteActions.push({
              id: "quick-comment-" + i,
              label: qc.label,
              icon: "action",
            });
          }
        });
        availableActions = paletteActions;

        // Conflicts indicator badge
        if (mr.has_conflicts) {
          const conflictBadge = document.createElement("span");
          conflictBadge.className = "gl-mr-actions-conflict-badge";
          conflictBadge.textContent = t("conflictsBadge");
          conflictBadge.title = t("conflictsBadgeHint");
          container.insertBefore(conflictBadge, container.firstChild);
        }

        // Time tracker — show MR age
        if (s.show_time_tracker !== false) {
          const timeEl = document.createElement("span");
          timeEl.className = "gl-mr-actions-time";
          timeEl.title = t("timeTrackerTitle", [
            new Date(mr.created_at).toLocaleString(),
          ]);
          timeEl.textContent = formatElapsed(mr.created_at);
          container.insertBefore(timeEl, container.firstChild);
        }

        if (container.children.length > 0) {
          widgetSection.appendChild(container);
        }

        // Failed job quick view
        injectFailedJobView(mr, s, widgetSection);

        // Sensitive file warning (#13)
        if (s.show_sensitive_warning) {
          injectSensitiveWarning(mr);
        }

        // Git command generator (#12) — injected into description block, not action bar
        if (s.show_git_commands) {
          // Delay slightly to let Vue render description
          scope.timeout(function () {
            injectGitCommands(mr);
          }, TOOLBAR_RETRY_DELAY_MS);
        }
      })
      .catch(function () {})
      .finally(function () {
        _injecting = false;
      });
  }

  // =========================================================================
  // Init
  // =========================================================================

  function isGitLab() {
    return (
      !!document.querySelector('meta[content="GitLab"]') ||
      !!document.querySelector("body[data-page]")
    );
  }

  // Listen for background worker messages + API proxy requests
  if (
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    chrome.runtime.onMessage
  ) {
    scope.onCleanup(
      addRuntimeListener(function (msg) {
        if (msg.type === "task-result") {
          if (msg.success) {
            showToast(msg.message, "success");
          } else {
            showToast(msg.message, "error");
          }
        }
      }),
    );

    // Commands are called through the extension's isolated-world composition.
  }
  function runPaletteAction(actionId: string) {
    if (scope.disposed || !parsePage()) return;
    const actionMap: Record<string, () => Promise<unknown>> = {
      "mr-copy": function () {
        return doCopyMr();
      },
      "mr-rebase": function () {
        return doJustRebase();
      },
      "mr-version": function () {
        return doVersionBump();
      },
      "mr-rebase-version": function () {
        return doRebaseVersion();
      },
      "mr-automerge": function () {
        return doRebaseAutoMerge();
      },
      "mr-rebase-force": function () {
        return doRebaseForce();
      },
      "mr-ship": function () {
        return doShip();
      },
      "mr-force-ship": function () {
        return doForceShip();
      },
      "mr-draft": function () {
        return doDraftToggle();
      },
      "mr-pipeline-restart": function () {
        return doPipelineRestart();
      },
      "mr-pipeline-cancel": function () {
        return doPipelineCancel();
      },
      "mr-retry-failed": function () {
        return doRetryFailed();
      },
      "mr-reviewers": function () {
        return getSettings().then(function (s) {
          const list = (s.reviewersList || "")
            .split(/[,\s]+/)
            .map(function (u) {
              return u.replace(/^@/, "").trim();
            })
            .filter(Boolean);
          return doReviewers(s.reviewersJob || MR_DEFAULTS.reviewersJob, list);
        });
      },
    };
    if (typeof actionId !== "string") return;
    if (actionId.indexOf("mr_action_") === 0) {
      const actionButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-mr-action-id]"),
      ).find(function (btn) {
        return actionId === "mr_action_" + btn.dataset.mrActionId;
      });
      if (actionButton) actionButton.click();
      return;
    }
    // Custom jobs
    if (actionId.indexOf("custom-job-") === 0) {
      const jobIdx = parseInt(actionId.replace("custom-job-", ""));
      getSettings()
        .then(function (s) {
          const job = (s.customJobs || [])[jobIdx];
          if (job && job.jobName) {
            doTriggerJob(job.jobName).catch(function (err) {
              showToast(err.message || String(err), "error");
            });
          }
        })
        .catch(reportError);
      return;
    }
    // Quick comments
    if (actionId.indexOf("quick-comment-") === 0) {
      const qcIdx = parseInt(actionId.replace("quick-comment-", ""));
      getSettings()
        .then(function (s) {
          const qc = (s.quickComments || [])[qcIdx];
          if (qc && qc.text) {
            api(
              "POST",
              "/projects/" +
                context.projectId +
                "/merge_requests/" +
                context.mrIid +
                "/notes",
              { body: qc.text },
            )
              .then(function () {
                showToast(qc.label + " \u2713", "success");
              })
              .catch(function (err) {
                showToast(err.message || String(err), "error");
              });
          }
        })
        .catch(reportError);
      return;
    }
    if (actionMap[actionId]) {
      actionMap[actionId]().catch(function (err) {
        showToast(err.message || String(err), "error");
      });
    }
  }

  function init() {
    if (!isGitLab() || !parsePage()) return;

    context.projectId = getProjectId();
    if (!context.projectId) return;

    injectButtons();

    // Re-inject on SPA navigation (GitLab uses turbolinks/pjax)
    const observer = scope.observer(function () {
      if (!document.querySelector(".gl-mr-actions-ext") && parsePage()) {
        context.projectId = getProjectId();
        if (context.projectId) injectButtons();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scope.listen(window, "beforeunload", function () {
      observer.disconnect();
    });
  }

  if (document.readyState === "loading") {
    scope.listen(document, "DOMContentLoaded", init);
  } else {
    init();
  }

  return { runPaletteAction, getPaletteActions: () => availableActions };
}
