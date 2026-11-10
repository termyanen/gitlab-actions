import { MR_WIDGET_SELECTORS, SEL } from "../../../shared/config/gitlab";
import type { ActiveMergeRequest } from "../../../entities/merge-request";
import type { MrAction, MrSettings } from "../../../entities/settings";
import { BUTTON_DEFAULTS, MR_DEFAULTS } from "../../../entities/settings";
import type { MrActionContext } from "../../../features/mr-actions";
import { createMrActions } from "../../../features/mr-actions";
import { addRuntimeListener } from "../../../shared/api/runtime";
import type { Translate } from "../../../shared/i18n";
import { isLanguage, readMessages } from "../../../shared/i18n";
import { errorMessage, reportError } from "../../../shared/lib/errors";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { createLifecycle } from "../../../shared/lib/lifecycle";
import { isRecord } from "../../../shared/lib/validation";
import { createFeedback } from "../../../shared/ui/feedback";
import { formatElapsed } from "./display";
import {
  appendToolbarStatus,
  createToolbarLayout,
  toolbarButtonClass,
} from "./layout";
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
  let durationLocale: string | undefined;
  let _i18nMessages: Record<string, { message: string }> | null = null;

  function t(key: string, substitutions?: Parameters<Translate>[1]) {
    if (_i18nMessages && _i18nMessages[key]) {
      let msg = _i18nMessages[key].message || "";
      if (substitutions && substitutions.length) {
        for (const [i, substitution] of substitutions.entries()) {
          msg = msg.replace("$" + (i + 1), String(substitution));
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
          if (isLanguage(data.language))
            durationLocale = data.language.replace("_", "-");
          fetch(
            chrome.runtime.getURL(
              "_locales/" + data.language + "/messages.json",
            ),
          )
            .then(function (r) {
              return r.json();
            })
            .then(readMessages)
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
    if (!match?.[1] || !match[2]) return false;
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
    for (const element of document.querySelectorAll<HTMLElement>(
      SEL.projectId,
    )) {
      const id = Number(element.dataset.projectId);
      if (Number.isSafeInteger(id) && id > 0) return id;
    }
    const scripts = document.querySelectorAll("script");
    for (const currentScript of scripts) {
      const m = (currentScript.textContent || "").match(
        /"project_id"\s*:\s*(\d+)/,
      );
      if (m?.[1]) {
        const id = Number(m[1]);
        if (Number.isSafeInteger(id) && id > 0) return id;
      }
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
  const pendingButtons = new Set<HTMLButtonElement>();
  let paletteButtons = new Map<string, HTMLButtonElement>();
  function releaseButton(button: HTMLButtonElement) {
    pendingButtons.delete(button);
    if (!button.isConnected) {
      for (const [identity, candidate] of buttons) {
        if (candidate === button) buttons.delete(identity);
      }
    }
  }

  function runAction(
    btn: HTMLButtonElement,
    actionFn: () => Promise<unknown>,
    actionName: string,
    opts: { reloadOnSuccess?: boolean } = {},
  ) {
    if (_actionInProgress) return;
    _actionInProgress = true;
    pendingButtons.add(btn);
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
      .catch(function (err: unknown) {
        _actionInProgress = false;
        btn.innerHTML = origHtml;
        btn.disabled = false;
        const msg =
          t("toastFailed", [actionName, errorMessage(err)]) +
          (titleText ? "\n" + titleText : "");
        showToast(msg, "error");
        updateTrackerItem(
          singleTaskId,
          [actionName],
          "error",
          errorMessage(err),
          "!" + context.mrIid + " " + titleText,
        );
      })
      .finally(() => releaseButton(btn));
  }

  function getWidgetSection() {
    for (const selector of MR_WIDGET_SELECTORS) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  let buttons = new Map<string, HTMLButtonElement>();
  function renderButtons(
    mr: ActiveMergeRequest,
    mergeMethod: string,
    s: MrSettings,
    widgetSection: Element,
  ) {
    const focused = document.activeElement;
    // Reuse unchanged controls so a settings save preserves focus and busy state.
    // Keep hidden running controls only until their operation settles.
    const nextButtons = new Map(
      [...buttons].filter(([, button]) => pendingButtons.has(button)),
    );
    const keyedButtons = new Map<string, HTMLButtonElement>();
    function reuseButton(identity: string, key: string, target: HTMLElement) {
      const existing = buttons.get(identity);
      if (!existing) return false;
      nextButtons.set(identity, existing);
      keyedButtons.set(key, existing);
      target.appendChild(existing);
      return true;
    }
    const layout = createToolbarLayout(t);
    const { container } = layout;
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
    const isDraft = /^(\[Draft\]|Draft:|WIP:)/i.test(mr.title || "");
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
        if (!action || !action.label || action.enabled === false) return;
        const identity = JSON.stringify([
          key,
          action.label,
          action.type,
          action.labels,
          s.skip_confirmations,
        ]);
        if (reuseButton(identity, key, layout.actions)) return;
        const btn = document.createElement("button");
        nextButtons.set(identity, btn);
        keyedButtons.set(key, btn);
        btn.className = toolbarButtonClass("btn-custom-job");
        btn.dataset.mrActionId = action.id;
        btn.textContent = action.label;
        btn.title = mrActionDescription(action);
        btn.addEventListener("click", function () {
          if (
            !s.skip_confirmations &&
            !confirm(
              t("mrActionConfirm", [action.label, mrActionDescription(action)]),
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
        layout.actions.appendChild(btn);
      } else if (key.indexOf("custom_") === 0) {
        const idx = parseInt(key.replace("custom_", ""));
        const job = (s.customJobs || [])[idx];
        if (!job || !job.label || !job.jobName || job.enabled === false) return;
        const identity = JSON.stringify([key, job.label, job.jobName]);
        if (reuseButton(identity, key, layout.actions)) return;
        const btn = document.createElement("button");
        nextButtons.set(identity, btn);
        keyedButtons.set(key, btn);
        btn.className = toolbarButtonClass("btn-custom-job");
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
        layout.actions.appendChild(btn);
      } else {
        const def = builtinDefs[key];
        if (!def || !s[key] || def.hide) return;
        const identity = JSON.stringify([
          key,
          def.label,
          s.skip_confirmations,
          key === "btn_reviewers" ? [reviewersJob, fixedReviewers] : null,
        ]);
        if (reuseButton(identity, key, layout.actions)) return;
        const btn = document.createElement("button");
        nextButtons.set(identity, btn);
        keyedButtons.set(key, btn);
        btn.className = toolbarButtonClass(def.cls);
        btn.textContent = def.label;
        btn.title = def.label;
        btn.addEventListener("click", function () {
          if (def.confirm && !s.skip_confirmations && !confirm(def.confirm))
            return;
          if (def.quiet) {
            const origText = btn.textContent;
            btn.disabled = true;
            pendingButtons.add(btn);
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
              })
              .finally(() => releaseButton(btn));
          } else {
            runAction(btn, def.action, def.name, {
              ...(def.reloadOnSuccess === undefined
                ? {}
                : { reloadOnSuccess: def.reloadOnSuccess }),
            });
          }
        });
        layout.actions.appendChild(btn);
      }
    });

    // Quick comments (#35)
    (s.quickComments || []).forEach(function (qc, i) {
      if (!qc.label || !qc.text) return;
      const key = "quick-comment-" + i;
      const identity = JSON.stringify([key, qc]);
      if (reuseButton(identity, key, layout.comments)) return;
      const qcBtn = document.createElement("button");
      nextButtons.set(identity, qcBtn);
      keyedButtons.set(key, qcBtn);
      qcBtn.className = toolbarButtonClass("btn-quick-comment");
      qcBtn.textContent = qc.label;
      qcBtn.title = qc.text;
      qcBtn.addEventListener("click", function () {
        const origText = qcBtn.textContent;
        qcBtn.disabled = true;
        pendingButtons.add(qcBtn);
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
          .catch(function (err: unknown) {
            showToast(errorMessage(err), "error");
            qcBtn.textContent = origText;
            qcBtn.disabled = false;
          })
          .finally(() => releaseButton(qcBtn));
      });
      layout.comments.appendChild(qcBtn);
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
        if (action && action.label && action.enabled !== false)
          paletteActions.push({
            id: key,
            label: action.label,
            icon: "action",
          });
      } else if (key.indexOf("custom_") === 0) {
        const idx = parseInt(key.replace("custom_", ""));
        const job = (s.customJobs || [])[idx];
        if (job && job.label && job.jobName && job.enabled !== false) {
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
    paletteButtons = new Map();
    for (const [key, button] of keyedButtons) {
      const id = paletteKeyMap[key] ?? key.replace(/^custom_/, "custom-job-");
      paletteButtons.set(id, button);
    }

    keyedButtons.clear();

    // Conflicts indicator badge
    if (mr.has_conflicts) {
      const conflictBadge = document.createElement("span");
      conflictBadge.className = "gl-mr-actions-conflict-badge";
      conflictBadge.textContent = t("conflictsBadge");
      conflictBadge.title = t("conflictsBadgeHint");
      appendToolbarStatus(container, conflictBadge);
    }

    // Age is passive metadata, not another action button. Unit names follow
    // the chosen extension language; invalid dates do not render a NaN badge.
    const elapsed =
      s.show_time_tracker !== false && mr.created_at
        ? formatElapsed(mr.created_at, durationLocale)
        : null;
    if (elapsed !== null && mr.created_at) {
      const timeEl = document.createElement("time");
      timeEl.className = "gl-mr-actions-time";
      timeEl.dateTime = mr.created_at;
      timeEl.title = new Date(mr.created_at).toLocaleString(durationLocale);
      timeEl.innerHTML =
        '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
      const label = document.createElement("span");
      label.textContent = t("timeTrackerTitle", [elapsed]);
      timeEl.append(label);
      layout.header.append(timeEl);
    }

    const previous = document.querySelector(".gl-mr-actions-ext");
    const warning = previous?.querySelector(".gl-mr-ext-sensitive-warning");
    if (warning instanceof HTMLElement) appendToolbarStatus(container, warning);
    // Keep an invisible mount marker when everything is disabled, allowing
    // live settings and delayed warning scans to reveal the same toolbar.
    layout.finish(elapsed !== null);
    if (previous) {
      previous.replaceWith(container);
      previous.replaceChildren();
    } else widgetSection.appendChild(container);
    buttons.clear();
    buttons = nextButtons;
    if (focused instanceof HTMLElement && container.contains(focused))
      focused.focus({ preventScroll: true });
  }

  const buttonSettingsKeys = [
    ...Object.keys(BUTTON_DEFAULTS),
    "customJobs",
    "mrActions",
    "buttonOrder",
    "quickComments",
    "reviewersJob",
    "reviewersList",
    "skip_confirmations",
    "show_time_tracker",
  ];
  let renderCurrentButtons: ((settings: MrSettings) => void) | undefined;
  let settingsRevision = 0;
  let settingsRead = 0;
  let renderedSettings = "";
  function refreshSettings() {
    if (
      scope.disposed ||
      !parsePage() ||
      !renderCurrentButtons ||
      !document.querySelector(".gl-mr-actions-ext")
    )
      return;
    const read = ++settingsRead;
    getSettings()
      .then((settings) => {
        if (
          scope.disposed ||
          !parsePage() ||
          read !== settingsRead ||
          !document.querySelector(".gl-mr-actions-ext")
        )
          return;
        const signature = JSON.stringify(
          buttonSettingsKeys.map((key) => settings[key]),
        );
        if (signature === renderedSettings) return;
        renderedSettings = signature;
        renderCurrentButtons?.(settings);
      })
      .catch(reportError);
  }
  function onSettingsChanged(
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) {
    if (
      area !== "sync" ||
      !Object.keys(changes).some(
        (key) => key === "projectProfiles" || buttonSettingsKeys.includes(key),
      )
    )
      return;
    settingsRevision++;
    refreshSettings();
  }
  chrome.storage.onChanged?.addListener(onSettingsChanged);
  scope.onCleanup(() => {
    chrome.storage.onChanged?.removeListener(onSettingsChanged);
    buttons.clear();
    pendingButtons.clear();
    paletteButtons.clear();
    availableActions = [];
    renderCurrentButtons = undefined;
  });

  let _injecting = false;
  let injectionError = "";
  function injectButtons() {
    if (scope.disposed) return;
    if (_injecting || document.querySelector(".gl-mr-actions-ext")) return;

    const stateBadge = document.querySelector(".issuable-status-badge .badge");
    if (stateBadge) {
      const stateText = (stateBadge.textContent || "").trim().toLowerCase();
      if (stateText === "merged" || stateText === "closed") return;
    }

    if (!getWidgetSection()) return;

    _injecting = true;
    // A replacement widget must use fresh MR state, not the previous render's
    // cached MR while a settings event or storage callback is in flight.
    renderCurrentButtons = undefined;
    settingsRead++;
    availableActions = [];
    paletteButtons.clear();
    const initialSettingsRevision = settingsRevision;

    Promise.all([getMR(), getSettings(), getMergeMethod(), _languageReady])
      .then(function (results) {
        if (scope.disposed || !parsePage()) return;
        const mr = results[0];
        const s = results[1];
        const mergeMethod = results[2];

        if (document.querySelector(".gl-mr-actions-ext")) return;
        if (mr.state !== "opened") return;
        // GitLab may replace its Vue widget while the API reads are pending.
        const widgetSection = getWidgetSection();
        if (!widgetSection) return;

        renderCurrentButtons = (settings) => {
          const target = getWidgetSection();
          if (target) renderButtons(mr, mergeMethod, settings, target);
        };
        renderedSettings = JSON.stringify(
          buttonSettingsKeys.map((key) => s[key]),
        );
        renderButtons(mr, mergeMethod, s, widgetSection);
        if (settingsRevision !== initialSettingsRevision) refreshSettings();
        injectionError = "";

        // Failed job quick view
        injectFailedJobView(mr, s, widgetSection);

        // Sensitive file warning (#13)
        if (s.show_sensitive_warning) {
          injectSensitiveWarning(s);
        }

        // Git command generator (#12) — injected into description block, not action bar
        if (s.show_git_commands) {
          // Delay slightly to let Vue render description
          scope.timeout(function () {
            injectGitCommands(mr);
          }, TOOLBAR_RETRY_DELAY_MS);
        }
      })
      .catch(function (error: unknown) {
        if (scope.disposed || !parsePage()) return;
        const message = errorMessage(error);
        // DOM updates can retry the read. Log a failure once until it changes
        // or the toolbar recovers, instead of silently hiding the whole panel.
        if (message !== injectionError) {
          injectionError = message;
          reportError(error);
        }
      })
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
        if (
          isRecord(msg) &&
          msg.type === "task-result" &&
          typeof msg.success === "boolean" &&
          typeof msg.message === "string"
        ) {
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
    // Use the current rendered control, including its confirmation and busy guard.
    // Stale palette entries cannot execute a button hidden by a settings update.
    const button = paletteButtons.get(actionId);
    if (button?.isConnected) button.click();
  }

  function init() {
    if (!isGitLab() || !parsePage()) return;

    const tryMount = () => {
      if (
        _injecting ||
        document.querySelector(".gl-mr-actions-ext") ||
        !parsePage()
      )
        return;
      context.projectId = getProjectId();
      if (context.projectId) injectButtons();
    };
    // Observe before the first attempt: lazy GitLab views can add the project
    // metadata or widget later, including an attribute-only hydration update.
    const observer = scope.observer(tryMount);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-project-id"],
    });
    tryMount();
    scope.listen(window, "beforeunload", function () {
      observer.disconnect();
    });
  }

  if (document.readyState === "loading") {
    scope.listen(document, "DOMContentLoaded", init);
  } else {
    init();
  }

  return {
    runPaletteAction,
    getPaletteActions: () =>
      availableActions.filter(
        (action) => paletteButtons.get(action.id)?.isConnected,
      ),
  };
}
