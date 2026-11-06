import type { ReviewContext } from "../../../entities/review";
import type {
  createReviewImporter,
  ImportEdit,
  ImportItem,
  ImportResultItem,
} from "../../../features/review-import";
import type { Translate } from "../../../shared/i18n";
import { element } from "../../../shared/ui/dom";
import { createImportRenderer } from "./render";
import type { ImportDialogState } from "./types";
export function createImportDialog(
  getImporter: () => ReturnType<typeof createReviewImporter> | undefined,
) {
  const { button, selectable, editable, canResolve, render } =
    createImportRenderer({
      startEditor,
      updateActions,
      saveEditor,
      cancelEditor,
    });
  let active: ImportDialogState | null = null;
  let confirmClose = false;

  function samePage(context: ReviewContext) {
    try {
      const expected = new URL(context.webUrl);
      const path = expected.pathname.replace(/\/$/, "");
      return (
        window.location.origin === expected.origin &&
        (window.location.pathname === path ||
          window.location.pathname.indexOf(path + "/") === 0)
      );
    } catch {
      return false;
    }
  }

  function current(state: ImportDialogState) {
    if (active !== state) return false;
    if (samePage(state.context)) return true;
    if (state.retainedRoute !== window.location.pathname) close();
    return false;
  }

  function checkCurrent(state: ImportDialogState, run: number) {
    if (
      current(state) &&
      state.run === run &&
      !state.controller!.signal.aborted
    )
      return;
    const error = new Error("Cancelled");
    error.name = "AbortError";
    throw error;
  }

  function close(force?: boolean | Event) {
    if (!active) return true;
    const dirty =
      active.input.value.trim() || active.editor || active.busy === "sending";
    const completed =
      active.plan &&
      active.plan.items.length &&
      !active.editor &&
      !active.busy &&
      active.plan.items.every(function (item) {
        const result = active!.results.get(item.id) || item;
        return (
          ["published", "draft", "duplicate"].indexOf(result.status) !== -1 &&
          (!result.resolveStatus || result.resolveStatus === "resolved")
        );
      });
    if (
      force !== true &&
      confirmClose &&
      dirty &&
      !completed &&
      typeof window.confirm === "function" &&
      !window.confirm(
        active.t(
          active.busy === "sending"
            ? "aiReviewConfirmStopAndClose"
            : "aiReviewConfirmDiscard",
        ),
      )
    ) {
      if (!samePage(active.context)) {
        active.retainedRoute = window.location.pathname;
        active.controller?.abort();
        active.run++;
        // A send may have reached GitLab. Preserve the input, but require a
        // new validation (including the delivery journal) before any retry.
        if (active.busy === "sending") {
          active.plan = null;
          active.selected.clear();
          active.resolveSelected.clear();
        }
        active.busy = "";
        render(active);
      }
      return false;
    }
    const old = active;
    active = null;
    if (old.controller) old.controller.abort();
    old.overlay.remove();
    document.removeEventListener("keydown", old.onKeydown, true);
    if (old.previousFocus && old.previousFocus.isConnected)
      old.previousFocus.focus();
    return true;
  }

  function setStatus(state: ImportDialogState, text: string, error?: boolean) {
    state.status.textContent = text;
    state.status.classList.toggle("gl-review-error", !!error);
  }

  function warnings(state: ImportDialogState, notices: string[]) {
    state.warning.replaceChildren();
    state.warning.hidden = !notices.length;
    if (!notices.length) return;
    state.warning.appendChild(
      element("strong", "", state.t("aiReviewImportWarning")),
    );
    const list = element("ul");
    notices.forEach(function (text) {
      list.appendChild(element("li", "", text));
    });
    state.warning.appendChild(list);
  }

  function updateActions(state: ImportDialogState) {
    const busy = !!state.busy;
    const locked = busy || !!state.editor || !samePage(state.context);
    const count = state.selected.size;
    state.copyPrompt.disabled = locked;
    state.copyReplyPrompt.disabled = locked;
    state.copyFormat.disabled = locked;
    state.validate.disabled = locked || !state.input.value.trim();
    state.input.readOnly = state.busy === "sending" || !!state.editor;
    state.publish.disabled = locked || !state.plan || !count;
    state.drafts.disabled =
      state.publish.disabled ||
      !!(state.plan && state.plan.draftSupported === false);
    state.select.disabled =
      locked ||
      !state.plan ||
      !state.plan!.items.some(function (item) {
        return selectable(state, item);
      });
    state.clear.disabled = locked || !count;
    state.add.disabled =
      locked || !state.plan || state.plan.items.length >= 200;
    state.add.setAttribute(
      "title",
      state.t(
        state.plan && state.plan.items.length >= 200
          ? "aiReviewImportCommentLimit"
          : "aiReviewImportAddComment",
      ),
    );
    state.stop.hidden = state.busy !== "sending";
    state.stop.disabled = !!state.stopping;
    state.count.textContent = state.t("aiReviewSelectedCount", [count]);
    state.replyHint.hidden =
      !state.plan ||
      !state.plan!.items.some(function (item) {
        return item.type === "reply";
      });
    state.list
      .querySelectorAll<HTMLInputElement>("[data-import-item]")
      .forEach(function (check) {
        const item =
          state.plan &&
          state.plan!.items.find(function (item) {
            return item.id === check.dataset.importItem;
          });
        check.disabled = locked || !item || !selectable(state, item);
        check.checked = state.selected.has(check.dataset.importItem!);
      });
    state.list
      .querySelectorAll<HTMLInputElement>("[data-import-resolve]")
      .forEach(function (check) {
        const item = state.plan!.items.find(function (item) {
          return item.id === check.dataset.importResolve;
        });
        check.disabled =
          locked ||
          !item ||
          !canResolve(item) ||
          !selectable(state, item) ||
          !state.selected.has(item.id);
        check.checked = state.resolveSelected.has(check.dataset.importResolve!);
      });
    state.list
      .querySelectorAll<HTMLButtonElement>("[data-import-edit]")
      .forEach(function (edit) {
        edit.disabled = locked;
      });
    if (state.editorInput) state.editorInput.readOnly = busy;
    if (state.saveEdit) state.saveEdit.disabled = busy;
    state.dialog.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function startEditor(state: ImportDialogState, item?: ImportItem) {
    if (
      !current(state) ||
      state.busy ||
      state.editor ||
      !state.plan ||
      (item && !editable(state, item))
    )
      return;
    if (!item && state.plan.items.length >= 200) {
      setStatus(state, state.t("aiReviewImportCommentLimit"), true);
      return;
    }
    let id = item && item.id;
    if (!item) {
      do {
        id = "manual-" + ++state.manualId;
      } while (
        state.plan!.items.some(function (existing) {
          return existing.id === id;
        })
      );
    }
    state.editor = {
      id: id!,
      add: !item,
      body: item && typeof item.body === "string" ? item.body : "",
    };
    render(state);
    state.editorInput!.focus();
  }

  function cancelEditor(state: ImportDialogState) {
    if (!current(state) || !state.editor) return;
    state.run++;
    if (state.controller) state.controller!.abort();
    state.busy = "";
    state.editor = null;
    setStatus(state, state.t("aiReviewImportChecked", [state.selected.size]));
    render(state);
  }

  function saveEditor(state: ImportDialogState) {
    if (!current(state) || state.busy || !state.editor || !state.plan) return;
    const editor = state.editor!;
    const edit: ImportEdit = { id: editor.id, body: editor.body };
    if (editor.add) edit.add = true;
    const run = ++state.run;
    const controller = (state.controller = new AbortController());
    state.busy = "revising";
    editor.error = "";
    setStatus(state, state.t("aiReviewImportChecking"));
    updateActions(state);
    Promise.resolve()
      .then(function () {
        checkCurrent(state, run);
        return getImporter()!.revise(state.plan!, [edit], {
          signal: controller.signal,
        });
      })
      .then(function (plan) {
        if (!current(state) || state.run !== run) return;
        // Keep exclusions and confirmed outcomes. A fresh validation refusal
        // takes precedence over a previous retry error on an unchanged row.
        state.results.delete(editor.id);
        plan.items.forEach(function (item) {
          const previous = state.results.get(item.id);
          if (
            previous &&
            (previous.status === "failed" || previous.status === "skipped") &&
            item.status !== "ready"
          )
            state.results.delete(item.id);
        });
        state.plan = plan;
        state.resolveSelected = new Set(
          plan.items
            .filter(function (item) {
              return (
                canResolve(item) &&
                selectable(state, item) &&
                state.resolveSelected.has(item.id)
              );
            })
            .map(function (item) {
              return item.id;
            }),
        );
        state.selected = new Set(
          plan.items
            .filter(function (item) {
              return (
                selectable(state, item) &&
                (state.selected.has(item.id) ||
                  (editor.add && item.id === editor.id))
              );
            })
            .map(function (item) {
              return item.id;
            }),
        );
        state.input.value = JSON.stringify(plan.source, null, 2);
        state.editor = null;
        warnings(state, plan.warnings || []);
        setStatus(
          state,
          state.t("aiReviewImportChecked", [state.selected.size]),
        );
      })
      .catch(function (error) {
        if (!current(state) || state.run !== run || error.name === "AbortError")
          return;
        editor.error =
          state.t("aiReviewImportEditError") + ": " + error.message;
        setStatus(state, editor.error, true);
      })
      .then(function () {
        if (!current(state) || state.run !== run) return;
        state.busy = "";
        render(state);
        if (state.editorInput) state.editorInput!.focus();
      });
  }

  function invalidate(state: ImportDialogState) {
    // A write cannot be retargeted by editing the input while it is running.
    if (state.busy === "sending") return;
    state.run++;
    if (state.controller) state.controller!.abort();
    state.busy = "";
    state.editor = null;
    state.plan = null;
    state.selected.clear();
    state.resolveSelected.clear();
    state.results.clear();
    warnings(state, []);
    setStatus(state, state.t("aiReviewImportEdited"));
    render(state);
  }

  function copyPrompt(state: ImportDialogState, replies: boolean | "format") {
    if (!current(state) || state.busy || state.editor) return;
    const formatOnly = replies === "format";
    const label = state.t(
      formatOnly ? "aiReviewImportFormat" : "aiReviewImportPrompt",
    );
    state.promptSummary.textContent = label;
    state.prompt.setAttribute("aria-label", label);
    const run = ++state.run,
      controller = (state.controller = new AbortController());
    state.busy = "prompt";
    state.prompt.value = "";
    state.promptDetails.hidden = true;
    setStatus(state, formatOnly ? "" : state.t("aiReviewImportPromptLoading"));
    updateActions(state);
    Promise.resolve()
      .then(function () {
        checkCurrent(state, run);
        if (formatOnly) return getImporter()!.getResponseFormat();
        return getImporter()![replies ? "getReplyPrompt" : "getPrompt"](
          state.context,
          { signal: controller.signal },
        );
      })
      .then(function (text) {
        if (!current(state) || state.run !== run) return;
        state.prompt.value = text;
        state.promptDetails.hidden = false;
        state.promptDetails.open = true;
        let write;
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText)
            throw new Error("Clipboard unavailable");
          write = navigator.clipboard.writeText(text);
        } catch (error) {
          write = Promise.reject(error);
        }
        return Promise.resolve(write).then(
          function () {
            if (current(state) && state.run === run)
              setStatus(state, state.t("aiReviewCopied"));
          },
          function () {
            if (!current(state) || state.run !== run) return;
            setStatus(state, state.t("aiReviewImportCopyFailed"));
            state.prompt.focus();
            state.prompt.select();
          },
        );
      })
      .catch(function (error) {
        if (current(state) && state.run === run && error.name !== "AbortError")
          setStatus(
            state,
            state.t("aiReviewImportPromptError") + ": " + error.message,
            true,
          );
      })
      .then(function () {
        if (!current(state) || state.run !== run) return;
        state.busy = "";
        updateActions(state);
      });
  }

  function prepare(state: ImportDialogState) {
    if (
      !current(state) ||
      state.busy ||
      state.editor ||
      !state.input.value.trim()
    )
      return;
    const run = ++state.run;
    const controller = (state.controller = new AbortController());
    state.busy = "checking";
    state.plan = null;
    state.results.clear();
    state.selected.clear();
    state.resolveSelected.clear();
    warnings(state, []);
    setStatus(state, state.t("aiReviewImportChecking"));
    render(state);
    Promise.resolve()
      .then(function () {
        checkCurrent(state, run);
        return getImporter()!.prepare(state.context, state.input.value, {
          signal: controller.signal,
        });
      })
      .then(function (plan) {
        if (!current(state) || state.run !== run) return;
        state.plan = plan;
        state.subject.textContent =
          (plan.mrTitle ||
            state.context.projectPath + " !" + state.context.iid) +
          (plan.headSha ? " · " + plan.headSha.slice(0, 12) : "");
        plan.items.forEach(function (item) {
          if (item.status === "ready") state.selected.add(item.id);
        });
        warnings(state, plan.warnings || []);
        setStatus(
          state,
          state.t("aiReviewImportChecked", [state.selected.size]),
        );
      })
      .catch(function (error) {
        if (current(state) && state.run === run && error.name !== "AbortError")
          setStatus(
            state,
            state.t("aiReviewImportError") + ": " + error.message,
            true,
          );
      })
      .then(function () {
        if (!current(state) || state.run !== run) return;
        state.busy = "";
        render(state);
      });
  }

  function acceptResult(state: ImportDialogState, result: ImportResultItem) {
    if (
      !result ||
      !state.plan!.items.some(function (item) {
        return item.id === result.id;
      })
    )
      return;
    state.results.set(result.id, result);
    if (result.status !== "failed" && result.status !== "skipped")
      state.selected.delete(result.id);
  }

  function publish(state: ImportDialogState, mode: "draft" | "publish") {
    if (
      !current(state) ||
      state.busy ||
      state.editor ||
      !state.plan ||
      !state.selected.size
    )
      return;
    const selected = state.plan.items
      .filter(function (item) {
        return state.selected.has(item.id) && selectable(state, item);
      })
      .map(function (item) {
        return item.id;
      });
    if (!selected.length) return;
    const controller = (state.controller = new AbortController());
    const run = ++state.run;
    const completed = new Set();
    state.busy = "sending";
    state.stopping = false;
    setStatus(state, state.t("aiReviewImportSending"));
    updateActions(state);
    const csrfMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="csrf-token"]',
    );
    const csrfToken =
      (csrfMeta && (csrfMeta.content || csrfMeta.getAttribute("content"))) ||
      "";
    Promise.resolve()
      .then(function () {
        checkCurrent(state, run);
        return getImporter()!.publish(state.plan!, selected, {
          mode: mode,
          signal: controller.signal,
          csrfToken: csrfToken,
          resolveIds:
            mode === "publish"
              ? selected.filter(function (id) {
                  return state.resolveSelected.has(id);
                })
              : [],
          onProgress: function (progress) {
            if (!current(state) || state.run !== run || !progress.item) return;
            completed.add(progress.item.id);
            acceptResult(state, progress.item);
            render(state);
          },
        });
      })
      .then(function (result) {
        if (!current(state) || state.run !== run) return;
        (result.items || []).forEach(function (item) {
          completed.add(item.id);
          acceptResult(state, item);
        });
        selected.forEach(function (id) {
          if (!completed.has(id))
            acceptResult(state, { id: id, status: "unknown", message: "" });
        });
        warnings(
          state,
          (state.plan!.warnings || []).concat(result.warnings || []),
        );
        setStatus(
          state,
          state.t(
            state.stopping ? "aiReviewImportStopped" : "aiReviewImportFinished",
          ),
        );
      })
      .catch(function (error) {
        if (!current(state) || state.run !== run) return;
        // A missing response must never expose an automatic resend action. The
        // data layer reconciles uncertain delivery when the user checks again.
        selected.forEach(function (id) {
          if (!completed.has(id))
            acceptResult(state, {
              id: id,
              status: error.beforeSend
                ? error.name === "AbortError"
                  ? "skipped"
                  : "failed"
                : "unknown",
              message: error.name === "AbortError" ? "" : error.message,
            });
        });
        setStatus(
          state,
          state.t(
            error.name === "AbortError"
              ? "aiReviewImportStopped"
              : "aiReviewImportError",
          ),
          error.name !== "AbortError",
        );
      })
      .then(function () {
        if (!current(state) || state.run !== run) return;
        state.busy = "";
        state.stopping = false;
        render(state);
      });
  }

  function open(context: ReviewContext, options?: { t?: Translate }) {
    if (
      !getImporter() ||
      !context ||
      context.kind !== "merge_requests" ||
      !samePage(context)
    )
      return;
    if (close() === false) return;
    const state = {
      context: context,
      t:
        (options && options.t) ||
        function (key) {
          return key;
        },
      previousFocus: document.activeElement,
      selected: new Set(),
      resolveSelected: new Set(),
      results: new Map(),
      plan: null,
      editor: null,
      manualId: 0,
      busy: "",
      run: 0,
    } as ImportDialogState;
    active = state;
    state.overlay = element(
      "div",
      "gl-review-overlay gl-review-import-overlay",
    );
    const dialog = (state.dialog = element(
      "section",
      "gl-review-dialog gl-review-import-dialog",
    ));
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "gl-review-import-title");
    const header = element("header", "gl-review-header");
    const titleBox = element("div");
    const title = element("h2", "", state.t("aiReviewImportTitle"));
    title.id = "gl-review-import-title";
    titleBox.appendChild(title);
    state.subject = element(
      "p",
      "gl-review-subject",
      context.projectPath + " !" + context.iid,
    );
    titleBox.appendChild(state.subject);
    header.appendChild(titleBox);
    header.appendChild(button(state, "aiReviewClose", close));
    dialog.appendChild(header);
    state.status = element("div", "gl-review-status");
    state.status.setAttribute("role", "status");
    dialog.appendChild(state.status);
    state.warning = element("div", "gl-review-warning");
    state.warning.hidden = true;
    dialog.appendChild(state.warning);
    const columns = element(
      "div",
      "gl-review-columns gl-review-import-columns",
    );
    const inputPane = element(
      "section",
      "gl-review-output gl-review-import-input-pane",
    );
    inputPane.appendChild(
      element(
        "p",
        "gl-review-muted gl-review-import-help",
        state.t("aiReviewImportHelp"),
      ),
    );
    const promptActions = element("div", "gl-review-copy-prompt-actions");
    state.copyPrompt = button(state, "aiReviewImportCopyPrompt", function () {
      copyPrompt(state, false);
    });
    state.copyReplyPrompt = button(
      state,
      "aiReviewImportCopyAllReplyPrompt",
      function () {
        copyPrompt(state, true);
      },
    );
    state.copyFormat = button(state, "aiReviewImportCopyFormat", function () {
      copyPrompt(state, "format");
    });
    promptActions.appendChild(state.copyPrompt);
    promptActions.appendChild(state.copyReplyPrompt);
    promptActions.appendChild(state.copyFormat);
    const promptShortcuts = element("details", "gl-review-advanced");
    promptShortcuts.appendChild(
      element("summary", "", state.t("aiReviewAdvanced")),
    );
    promptShortcuts.appendChild(promptActions);
    inputPane.appendChild(promptShortcuts);
    state.promptDetails = element("details", "gl-review-prompt-details");
    state.promptDetails.hidden = true;
    state.promptSummary = element(
      "summary",
      "",
      state.t("aiReviewImportPrompt"),
    );
    state.promptDetails.appendChild(state.promptSummary);
    state.prompt = element("textarea", "gl-review-prompt");
    state.prompt.readOnly = true;
    state.prompt.spellcheck = false;
    state.prompt.setAttribute("aria-label", state.t("aiReviewImportPrompt"));
    state.promptDetails.appendChild(state.prompt);
    inputPane.appendChild(state.promptDetails);
    const inputLabel = element(
      "label",
      "gl-review-preview-label",
      state.t("aiReviewImportInput"),
    );
    inputLabel.htmlFor = "gl-review-import-input";
    inputPane.appendChild(inputLabel);
    state.input = element(
      "textarea",
      "gl-review-preview gl-review-import-input",
    );
    state.input.id = "gl-review-import-input";
    state.input.spellcheck = false;
    state.input.placeholder = state.t("aiReviewImportInputHint");
    state.input.setAttribute("aria-label", state.t("aiReviewImportInput"));
    state.input.addEventListener("input", function () {
      invalidate(state);
    });
    inputPane.appendChild(state.input);
    state.validate = button(state, "aiReviewImportValidate", function () {
      prepare(state);
    });
    inputPane.appendChild(state.validate);
    columns.appendChild(inputPane);
    const previewPane = element(
      "section",
      "gl-review-picker gl-review-import-preview-pane",
    );
    previewPane.appendChild(
      element(
        "h3",
        "gl-review-import-preview-title",
        state.t("aiReviewImportPreview"),
      ),
    );
    const actions = element("div", "gl-review-tools");
    state.select = button(state, "aiReviewImportSelectReady", function () {
      if (!state.plan || state.busy || state.editor) return;
      state.plan.items.forEach(function (item) {
        if (selectable(state, item)) state.selected.add(item.id);
      });
      updateActions(state);
    });
    state.clear = button(state, "aiReviewClear", function () {
      if (!state.busy && !state.editor) {
        state.selected.clear();
        updateActions(state);
      }
    });
    state.add = button(state, "aiReviewImportAddComment", function () {
      startEditor(state);
    });
    actions.appendChild(state.select);
    actions.appendChild(state.clear);
    actions.appendChild(state.add);
    previewPane.appendChild(actions);
    state.count = element("div", "gl-review-count");
    previewPane.appendChild(state.count);
    state.list = element("div", "gl-review-list");
    previewPane.appendChild(state.list);
    columns.appendChild(previewPane);
    dialog.appendChild(columns);
    const footer = element(
      "footer",
      "gl-review-footer gl-review-import-footer",
    );
    footer.appendChild(
      element(
        "p",
        "gl-review-muted gl-review-import-send-hint",
        state.t("aiReviewImportSendHint"),
      ),
    );
    state.replyHint = element(
      "p",
      "gl-review-muted gl-review-import-send-hint",
      state.t("aiReviewImportReplyHint"),
    );
    state.replyHint.hidden = true;
    footer.appendChild(state.replyHint);
    state.stop = button(state, "aiReviewImportStop", function () {
      if (state.busy !== "sending" || state.stopping) return;
      state.stopping = true;
      state.controller!.abort();
      updateActions(state);
    });
    footer.appendChild(state.stop);
    state.drafts = button(state, "aiReviewImportAddDrafts", function () {
      publish(state, "draft");
    });
    footer.appendChild(state.drafts);
    state.publish = button(
      state,
      "aiReviewImportPublish",
      function () {
        publish(state, "publish");
      },
      "gl-review-primary",
    );
    footer.appendChild(state.publish);
    dialog.appendChild(footer);
    state.overlay.appendChild(dialog);
    state.overlay.addEventListener("click", function (event) {
      if (event.target === state.overlay) close();
    });
    state.onKeydown = function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      if (event.key !== "Tab") return;
      const targets = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button, input, textarea, summary, a[href]",
        ),
      ).filter(function (el) {
        return (
          !("disabled" in el && el.disabled) &&
          !el.hidden &&
          !el.closest("[hidden]") &&
          el.getClientRects().length
        );
      });
      if (!targets.length) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", state.onKeydown, true);
    document.body.appendChild(state.overlay);
    render(state);
    state.input.focus();
  }

  let closeSettingChanged = false;
  const onSettingsChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "sync" || !changes.ai_review_confirm_close) return;
    closeSettingChanged = true;
    confirmClose = changes.ai_review_confirm_close.newValue === true;
  };
  if (typeof chrome !== "undefined" && chrome.storage) {
    chrome.storage.onChanged?.addListener(onSettingsChanged);
    chrome.storage.sync?.get({ ai_review_confirm_close: false }, (values) => {
      if (chrome.runtime.lastError || closeSettingChanged) return;
      confirmClose = values.ai_review_confirm_close === true;
    });
  }
  return {
    open,
    close,
    syncRoute() {
      if (active?.retainedRoute && samePage(active.context)) {
        active.retainedRoute = undefined;
        updateActions(active);
      }
    },
    dispose() {
      close(true);
      if (typeof chrome !== "undefined")
        chrome.storage?.onChanged?.removeListener(onSettingsChanged);
    },
  };
}
