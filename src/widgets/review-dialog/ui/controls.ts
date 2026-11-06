import { reportError } from "../../../shared/lib/errors";
import type * as Workflow from "../../../entities/review";
import type { ReviewContext } from "../../../entities/review";
import type { createReviewExporter } from "../../../features/review-export";
import type { createReviewImporter } from "../../../features/review-import";
import { ROUTE_POLL_INTERVAL_MS } from "../../../shared/config/runtime";
import type { Translate } from "../../../shared/i18n";
import { element } from "../../../shared/ui/dom";
import { createReviewDialogActions } from "./actions";
import { createReviewThreads } from "./threads";
import type {
  ImportDialog,
  ReviewDialogState,
  ReviewIntent,
  ReviewSettings,
  ReviewTask,
} from "./types";
import { createReviewWindow } from "./window";
const CONTROLS_MOUNT_DEBOUNCE_MS = 180;

export function startReviewControls(
  data: ReturnType<typeof createReviewExporter>,
  getWorkflow: () => typeof Workflow | null,
  getImporter: () =>
    | Pick<
        ReturnType<typeof createReviewImporter>,
        "DEFAULT_REPLY_PROMPT" | "getReplyPrompt"
      >
    | undefined,
  getImportDialog: () => ImportDialog | undefined,
) {
  const {
    renderThreads,
    syncChecks,
    selectedDiscussionIds,
    chosenCount,
    selection,
    matchesStatus,
    visibleThreads,
  } = createReviewThreads(data, t, invalidate, (state) => updateActions(state));
  const { prepare, load, updateActions, intentThread } =
    createReviewDialogActions(
      data,
      getWorkflow,
      getImporter,
      t,
      { isCurrent, status, invalidate, showWarnings },
      {
        chosenCount,
        selectedDiscussionIds,
        selection,
        matchesStatus,
        renderThreads,
      },
    );
  if (!document.querySelector('meta[content="GitLab"], body[data-page]'))
    return;
  const settings: ReviewSettings = {
    show_ai_review_copy: true,
    ai_review_prompt: data.DEFAULT_PROMPT,
    ai_review_fresh_prompt: data.DEFAULT_FRESH_REVIEW_PROMPT,
    ai_review_file_filter: {},
    ai_review_include_description: null,
    ai_review_fresh_existing: false,
    ai_review_reply_prompt: "",
    ai_review_repeat_prompt: "",
    language: "auto",
    ai_review_confirm_close: false,
  };
  if (getWorkflow())
    Object.assign(settings, getWorkflow()!.instructionDefaults());
  let messages: Record<string, { message: string }> | null = null;
  settings.ai_review_confirm_close = false;
  let active: ReviewDialogState | null = null;
  let disposed = false;
  let pageKey = "";
  // An empty context key is a valid destination (for example, a pipeline).
  let retainedRoute: string | null = null;
  let mountTimer: ReturnType<typeof setTimeout> | null;
  let languageRun = 0;
  let descriptionSaveRun = 0;
  let relativeRoot: string | undefined;
  const { open } = createReviewWindow({
    route,
    getImportDialog,
    close,
    settings,
    data,
    getImporter,
    getWorkflow,
    activate: (state) => {
      active = state;
    },
    t,
    button,
    setTask,
    invalidate,
    load,
    rememberDescription,
    rememberExisting,
    status,
    intentThread,
    prepare,
    copyValues,
    threads: {
      renderThreads,
      syncChecks,
      selectedDiscussionIds,
      chosenCount,
      selection,
      matchesStatus,
      visibleThreads,
    },
  });

  function t(key: string, substitutions?: Parameters<Translate>[1]) {
    let text = messages && messages[key] && messages[key].message;
    if (!text) {
      try {
        text = chrome.i18n.getMessage(key, substitutions?.map(String));
      } catch {
        /* The browser API may be unavailable. */
      }
      if (text) return text;
    }
    return String(text || key).replace(/\$(\d+)/g, function (match, number) {
      return substitutions && substitutions[Number(number) - 1] !== undefined
        ? String(substitutions[Number(number) - 1])
        : match;
    });
  }

  function button(
    key: string,
    onClick: (event: MouseEvent) => void,
    className?: string,
  ) {
    const el = element(
      "button",
      "gl-review-button" + (className ? " " + className : ""),
      t(key),
    );
    el.type = "button";
    el.addEventListener("click", onClick);
    return el;
  }

  function iconButton(
    key: string,
    onClick: (event: MouseEvent) => void,
    picker?: boolean | "import",
  ) {
    const el = button(key, onClick, "gl-review-icon-button");
    el.setAttribute("title", t(key));
    el.setAttribute("aria-label", t(key));
    const icon = element("span", "gl-review-icon");
    icon.setAttribute("aria-hidden", "true");
    // Fixed extension-owned SVG; no comment or other page content enters HTML.
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
      (picker === "import"
        ? '<path d="M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M10 3v11m-4-4 4 4 4-4"/>'
        : picker
          ? '<path d="M14 3H5a2 2 0 0 0-2 2v12l4-3h10a2 2 0 0 0 2-2v-2M8 18h7l4 3v-5"/>'
          : '<rect x="3" y="7" width="12" height="14" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h5M15 17h2a2 2 0 0 0 2-2v-4"/>') +
      '<path d="m19 2 1.1 2.9L23 6l-2.9 1.1L19 10l-1.1-2.9L15 6l2.9-1.1L19 2Z"/></svg>';
    el.replaceChildren(icon);
    return el;
  }

  function route() {
    if (relativeRoot !== undefined) {
      return data.parsePage({
        origin: window.location.origin,
        pathname: window.location.pathname,
        relativeUrlRoot: relativeRoot,
      });
    }
    let prefix = "";
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="gitlab-relative-url-root"], meta[name="relative-url-root"]',
    );
    if (meta) prefix = meta.content || "";
    if (!prefix && document.body)
      prefix = document.body.getAttribute("data-relative-url-root") || "";
    if (!prefix) {
      // gon is in the page's JS world; read just its JSON string, never execute it.
      const scripts = document.querySelectorAll("script:not([src])");
      for (let i = 0; i < scripts.length; i++) {
        const match = (scripts[i].textContent || "").match(
          /(?:gon\.)?"?relative_url_root"?\s*(?:=|:)\s*("(?:[^"\\]|\\.)*")/,
        );
        if (match) {
          try {
            prefix = JSON.parse(match[1]);
          } catch {
            /* The browser API may be unavailable. */
          }
          break;
        }
      }
    }
    relativeRoot = typeof prefix === "string" ? prefix : "";
    return data.parsePage({
      origin: window.location.origin,
      pathname: window.location.pathname,
      relativeUrlRoot: relativeRoot,
    });
  }

  function contextKey(context: ReviewContext | null) {
    return context
      ? context.origin +
          "/" +
          context.projectPath +
          "/" +
          context.kind +
          "/" +
          context.iid
      : "";
  }

  function copyValues(state: ReviewDialogState) {
    const prompts = Object.assign({}, state.prompts);
    if (state.promptMode) prompts[state.promptMode] = state.prompt.value;
    return JSON.stringify([
      prompts,
      state.filterFields.map(function (field) {
        return field.input.value;
      }),
      state.filter.value,
      state.search.value,
      state.includeGeneral.checked,
      state.includeDescription.checked,
      state.includeCode.checked,
      state.includeExisting.checked,
      state.includeReplies.checked,
      state.baseline.value,
      state.baselineSha.value,
    ]);
  }

  function hasChanges(state: ReviewDialogState) {
    return (
      state.initialValues !== copyValues(state) ||
      (state.initialSelection != null &&
        state.initialSelection !==
          JSON.stringify(Array.from(state.selected).sort()))
    );
  }

  function close(force?: boolean | Event) {
    if (!active) return true;
    if (
      force !== true &&
      settings.ai_review_confirm_close === true &&
      hasChanges(active) &&
      typeof window.confirm === "function" &&
      !window.confirm(t("aiReviewConfirmDiscard"))
    )
      return false;
    const old = active;
    active = null;
    if (old.loadController) old.loadController.abort();
    if (old.exportController) old.exportController.abort();
    if (old.versionsController) old.versionsController.abort();
    old.overlay.remove();
    document.removeEventListener("keydown", old.onKeydown, true);
    if (old.previousFocus && old.previousFocus.isConnected)
      old.previousFocus.focus();
    return true;
  }

  function isCurrent(state: ReviewDialogState) {
    return (
      active === state && contextKey(route()) === contextKey(state.context)
    );
  }

  function status(state: ReviewDialogState, text: string, error?: boolean) {
    state.status.textContent = text;
    state.status.classList.toggle("gl-review-error", !!error);
  }

  function invalidate(state: ReviewDialogState) {
    state.exportRun++;
    if (state.exportController) state.exportController.abort();
    state.prepared = null;
    state.preview.value = "";
    state.size.textContent = "";
    state.busy = false;
    updateActions(state);
  }

  function rememberDescription(state: ReviewDialogState) {
    const run = ++descriptionSaveRun;
    settings.ai_review_include_description = state.includeDescription.checked;
    if (state.descriptionSaveFailed) {
      state.descriptionSaveFailed = false;
      status(state, "");
    }
    function failed(error: unknown) {
      if (!error || !isCurrent(state) || run !== descriptionSaveRun) return;
      state.descriptionSaveFailed = true;
      status(state, t("settingsSaveFailed"), true);
    }
    try {
      chrome.storage.sync.set(
        {
          ai_review_include_description: settings.ai_review_include_description,
        },
        function () {
          failed(chrome.runtime.lastError);
        },
      );
    } catch (error) {
      failed(error);
    }
  }

  function rememberExisting(state: ReviewDialogState) {
    settings.ai_review_fresh_existing = state.includeExisting.checked;
    try {
      chrome.storage.sync.set(
        { ai_review_fresh_existing: settings.ai_review_fresh_existing },
        function () {
          if (chrome.runtime.lastError && isCurrent(state))
            status(state, t("settingsSaveFailed"), true);
        },
      );
    } catch {
      if (isCurrent(state)) status(state, t("settingsSaveFailed"), true);
    }
  }

  function setTask(state: ReviewDialogState, task: ReviewTask) {
    if (
      !isCurrent(state) ||
      state.context.kind !== "merge_requests" ||
      state.task === task
    )
      return;
    state.task = task;
    state.taskChanged = true;
    state.previewDetails.open = false;
    if (task === "fresh" && state.loading) {
      state.loadController!.abort();
      state.loadController = null;
      state.loading = false;
      state.needsLoad = true;
    }
    invalidate(state);
    if (task === "fresh") state.retryButton.hidden = true;
    showWarnings(state, []);
    status(state, "");
    if (
      task !== "fresh" &&
      (!state.snapshot || state.needsLoad) &&
      !state.loading
    )
      load(state, true);
    if (task === "repeat") loadVersions(state);
    state.body.scrollTop = 0;
    state.output.scrollTop = 0;
  }

  function loadVersions(state: ReviewDialogState) {
    if (state.versionsController || state.versionsLoaded || !getWorkflow())
      return;
    const controller = (state.versionsController = new AbortController());
    data
      .loadReviewVersions(state.context, {
        signal: controller.signal,
      })
      .then(function (result) {
        if (!isCurrent(state) || controller !== state.versionsController)
          return;
        state.versionsLoaded = true;
        result.items.forEach(function (entry) {
          const date = new Date(entry.createdAt || "");
          const option = element(
            "option",
            "",
            "#" +
              entry.id +
              " · " +
              entry.headSha.slice(0, 10) +
              (Number.isFinite(date.getTime())
                ? " · " + date.toLocaleString()
                : ""),
          );
          option.value = entry.headSha;
          state.baseline.appendChild(option);
        });
        if (result.warnings.length)
          state.versionsHint.textContent =
            t("aiReviewPreviousHint") + " " + result.warnings.join(" ");
      })
      .catch(function (error) {
        if (
          isCurrent(state) &&
          controller === state.versionsController &&
          error.name !== "AbortError"
        )
          state.versionsHint.textContent =
            t("aiReviewPreviousHint") + " " + error.message;
      });
  }

  function showWarnings(state: ReviewDialogState, warnings: string[]) {
    state.warning.replaceChildren();
    state.warning.hidden = !warnings.length;
    if (!warnings.length) return;
    state.warning.appendChild(element("strong", "", t("aiReviewPartial")));
    const details = element("details");
    details.appendChild(element("summary", "", String(warnings.length)));
    const list = element("ul");
    warnings.forEach(function (warning) {
      list.appendChild(element("li", "", warning));
    });
    details.appendChild(list);
    state.warning.appendChild(details);
  }

  const noteSelector =
    '[id^="note_"], [id^="note-"], [id^="draft_"], [data-note-id]';

  function noteId(el: Element) {
    const id = (el.id || "").match(/^(?:note[_-]|draft_)(\d+)$/);
    if (id) return id[1];
    const attr = el.getAttribute("data-note-id");
    return /^\d+$/.test(attr || "") ? attr : null;
  }

  function noteKey(root: Element) {
    const id = noteId(root);
    if (!id) return null;
    // Older GitLab versions give drafts the same note_<id> anchor shape as
    // published notes. Their numeric IDs belong to different API resources.
    const draft =
      /^draft_\d+$/.test(root.id || "") ||
      !!root.closest(
        '.draft-note, .draft-note-component, .draft-notes, [data-testid="draft-note"]',
      );
    return (draft ? "draft:" : "") + id;
  }

  function noteIntent(root: Element) {
    const key = noteKey(root);
    if (!key) return null;
    const intent: ReviewIntent = { noteId: key, noteAnchor: root.id };
    if (key.indexOf("draft:") === 0) {
      // Never copy the entire note root: it also contains controls and may
      // contain other comments. This is only a fallback for older draft APIs.
      const saved = Array.from(
        root.querySelectorAll<HTMLTextAreaElement>(
          "textarea.hidden.js-task-list-field",
        ),
      ).find(function (el) {
        return (
          el.closest(noteSelector) === root &&
          el.closest(".note-body") &&
          !el.closest(".note-form") &&
          el.value.trim()
        );
      });
      if (saved) {
        intent.visibleNote = { body: saved.value, format: "markdown" };
        return intent;
      }
      const body = Array.from(
        root.querySelectorAll<HTMLElement>(
          '.note-text, [data-testid="work-item-note-body"]',
        ),
      ).find(function (el) {
        return el.closest(noteSelector) === root;
      });
      if (body) {
        const text = (
          typeof body.innerText === "string"
            ? body.innerText
            : body.textContent || ""
        ).trim();
        if (text) intent.visibleNote = { body: text, format: "text" };
      }
    }
    return intent;
  }

  function mount() {
    if (disposed) return;
    const context = route();
    const nextKey = contextKey(context);
    getImportDialog()?.syncRoute?.();
    if (retainedRoute !== null && nextKey === pageKey) {
      retainedRoute = null;
      if (active) {
        updateActions(active);
        if (active.needsLoad && active.task !== "fresh") load(active, true);
        if (active.task === "repeat") loadVersions(active);
      }
    }
    if (nextKey !== pageKey) {
      if (
        retainedRoute === nextKey &&
        document.querySelector(".gl-review-overlay, .gl-review-import-overlay")
      )
        return;
      if (
        close() === false ||
        (getImportDialog() && getImportDialog()!.close() === false)
      ) {
        retainedRoute = nextKey;
        active?.loadController?.abort();
        active?.exportController?.abort();
        active?.versionsController?.abort();
        if (active) {
          active.exportRun++;
          active.busy = false;
          if (active.loading) active.needsLoad = true;
          active.loading = false;
          active.loadController = null;
          active.versionsController = undefined;
          status(active, "");
          updateActions(active);
        }
        return;
      }
      retainedRoute = null;
      document
        .querySelectorAll(".gl-review-launcher, .gl-review-inline")
        .forEach(function (el) {
          el.remove();
        });
      pageKey = nextKey;
    }
    if (!context || settings.show_ai_review_copy === false) return;
    let launcher = document.querySelector(
      ".gl-review-launcher:not(.gl-review-import-launcher)",
    );
    if (!launcher) {
      launcher = iconButton(
        "aiReviewOpen",
        function () {
          open();
        },
        true,
      );
      launcher.classList.add("gl-review-launcher");
    }
    // Keep the control in the actual action row, including when GitLab mounts
    // that row after the header or replaces it during client-side navigation.
    const header = document.querySelector(".detail-page-header");
    const nativeAction =
      header &&
      (header.querySelector(".js-sidebar-toggle") ||
        header.querySelector(".js-mr-more-dropdown") ||
        header.querySelector('[data-testid="edit-title-button"]'));
    const actions =
      (nativeAction && nativeAction.parentElement) ||
      document.querySelector(".js-issuable-actions") ||
      document.querySelector(".detail-page-header-actions");
    const target =
      actions ||
      document.querySelector(
        '.detail-page-header, .merge-request-details, .issue-details, [data-testid="work-item-title"], .detail-page-description',
      );
    launcher.classList.toggle("gl-review-in-actions", !!actions);
    launcher.classList.toggle("gl-review-floating", !target);
    const sidebarToggle =
      actions && actions.querySelector(".js-sidebar-toggle");
    if (sidebarToggle && sidebarToggle.parentElement === actions) {
      const children = Array.from(actions.children);
      if (
        launcher.parentElement !== actions ||
        children.indexOf(launcher) + 1 !== children.indexOf(sidebarToggle)
      )
        actions.insertBefore(launcher, sidebarToggle);
    } else if (launcher.parentElement !== (target || document.body))
      (target || document.body).appendChild(launcher);
    if (context.kind === "merge_requests" && getImportDialog()) {
      let importLauncher = document.querySelector(".gl-review-import-launcher");
      if (!importLauncher) {
        importLauncher = iconButton(
          "aiReviewImportOpen",
          function () {
            const current = route();
            if (!current || current.kind !== "merge_requests") return;
            if (close() === false) return;
            getImportDialog()!.open(current, { t: t });
          },
          "import",
        );
        importLauncher.classList.add("gl-review-launcher");
        importLauncher.classList.add("gl-review-import-launcher");
      }
      importLauncher.classList.toggle("gl-review-in-actions", !!actions);
      importLauncher.classList.toggle("gl-review-floating", !target);
      const siblings = Array.from(launcher.parentElement!.children);
      if (
        importLauncher.parentElement !== launcher.parentElement ||
        siblings.indexOf(importLauncher) + 1 !== siblings.indexOf(launcher)
      ) {
        launcher.parentElement!.insertBefore(importLauncher, launcher);
      }
    }
    document.querySelectorAll(noteSelector).forEach(function (root) {
      const id = noteId(root);
      if (
        !id ||
        root.closest(
          '.gl-review-overlay, .system-note, [data-system-note="true"]',
        )
      )
        return;
      // Modern work-item thread wrappers also have data-note-id. Attach to the
      // actual note, not its enclosing discussion or another note's inner node.
      const anchors =
        '[id="note_' +
        id +
        '"], [id="note-' +
        id +
        '"], [id="draft_' +
        id +
        '"]';
      const key = noteKey(root);
      if (
        Array.from(root.querySelectorAll(anchors)).some(function (el) {
          return noteKey(el) === key;
        })
      )
        return;
      const parentNote =
        root.parentElement && root.parentElement.closest(anchors);
      if (parentNote && noteKey(parentNote) === key) return;
      if (root.querySelector(".gl-review-inline")) return;
      const header = root.querySelector(
        '.note-header, [data-testid="note-header"]',
      );
      if (
        !header &&
        !root.querySelector(
          '.note-text, .note-body, [data-testid="work-item-note-body"]',
        )
      )
        return;
      const bar = element("span", "gl-review-inline");
      bar.appendChild(
        iconButton("aiReviewCopyComment", function (event) {
          event.stopPropagation();
          // GitLab can reuse a note node when a newly posted comment is saved.
          // Resolve its current ID on click instead of retaining the mounted ID.
          const intent = noteIntent(root);
          if (intent) open(intent);
        }),
      );
      (header || root).appendChild(bar);
    });
  }

  function scheduleMount() {
    if (mountTimer) return;
    mountTimer = setTimeout(function () {
      mountTimer = null;
      mount();
    }, CONTROLS_MOUNT_DEBOUNCE_MS);
  }

  function language() {
    const run = ++languageRun;
    messages = null;
    if (!settings.language || settings.language === "auto")
      return Promise.resolve();
    return fetch(
      chrome.runtime.getURL("_locales/" + settings.language + "/messages.json"),
    )
      .then(function (response) {
        return response.json();
      })
      .then(function (value) {
        if (run === languageRun) messages = value;
      })
      .catch(function () {});
  }

  chrome.storage.sync.get(settings, function (values) {
    if (chrome.runtime.lastError) return;
    Object.assign(settings, values);
    language().then(mount).catch(reportError);
  });
  const onSettingsChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "sync") return;
    if (changes.ai_review_response_language && active) invalidate(active);
    let relevant = false;
    Object.keys(settings).forEach(function (key) {
      if (changes[key]) {
        settings[key] = changes[key].newValue;
        // A remembered checkbox value applies to future pickers. Saving it (or
        // receiving another tab's choice) must not close an ongoing export.
        if (
          key !== "ai_review_include_description" &&
          key !== "ai_review_fresh_existing" &&
          key !== "ai_review_confirm_close"
        )
          relevant = true;
      }
    });
    if (!relevant) return;
    if (close() === false) return;
    if (getImportDialog() && getImportDialog()!.close() === false) return;
    document
      .querySelectorAll(".gl-review-launcher, .gl-review-inline")
      .forEach(function (el) {
        el.remove();
      });
    language().then(mount).catch(reportError);
  };
  chrome.storage.onChanged?.addListener(onSettingsChanged);
  const observer = new MutationObserver(function (records) {
    if (
      records.some(function (record) {
        return (
          !("closest" in record.target) ||
          !(record.target as Element).closest(
            ".gl-review-overlay, .gl-review-launcher, .gl-review-inline",
          )
        );
      })
    )
      scheduleMount();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["id", "data-note-id"],
  });
  window.addEventListener("popstate", scheduleMount);
  document.addEventListener("turbo:load", scheduleMount);
  document.addEventListener("turbolinks:load", scheduleMount);
  // pushState does not emit popstate; avoid altering GitLab's history functions.
  const routeTimer = setInterval(function () {
    if (retainedRoute !== null || contextKey(route()) !== pageKey) mount();
  }, ROUTE_POLL_INTERVAL_MS);
  return () => {
    disposed = true;
    observer.disconnect();
    if (mountTimer) clearTimeout(mountTimer);
    clearInterval(routeTimer);
    chrome.storage.onChanged?.removeListener(onSettingsChanged);
    window.removeEventListener("popstate", scheduleMount);
    document.removeEventListener("turbo:load", scheduleMount);
    document.removeEventListener("turbolinks:load", scheduleMount);
    close(true);
    document
      .querySelectorAll(".gl-review-launcher, .gl-review-inline")
      .forEach((el) => el.remove());
  };
}
