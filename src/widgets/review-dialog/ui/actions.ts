import type * as Workflow from "../../../entities/review";
import type { FileFilter } from "../../../entities/review";
import type {
  createReviewExporter,
  ExportOptions,
} from "../../../features/review-export";
import type { createReviewImporter } from "../../../features/review-import";
import type { Translate } from "../../../shared/i18n";
import type { createReviewThreads } from "./threads";
import type { ReviewDialogState } from "./types";
export function createReviewDialogActions(
  data: ReturnType<typeof createReviewExporter>,
  getWorkflow: () => typeof Workflow | null,
  getImporter: () =>
    | Pick<
        ReturnType<typeof createReviewImporter>,
        "DEFAULT_REPLY_PROMPT" | "getReplyPrompt"
      >
    | undefined,
  t: Translate,
  callbacks: {
    isCurrent: (state: ReviewDialogState) => boolean;
    status: (state: ReviewDialogState, text: string, error?: boolean) => void;
    invalidate: (state: ReviewDialogState) => void;
    showWarnings: (state: ReviewDialogState, warnings: string[]) => void;
  },
  threads: Pick<
    ReturnType<typeof createReviewThreads>,
    | "chosenCount"
    | "selectedDiscussionIds"
    | "selection"
    | "matchesStatus"
    | "renderThreads"
  >,
) {
  const { isCurrent, status, invalidate, showWarnings } = callbacks;
  const {
    chosenCount,
    selectedDiscussionIds,
    selection,
    matchesStatus,
    renderThreads,
  } = threads;

  function copyPrepared(state: ReviewDialogState) {
    if (!isCurrent(state) || !state.prepared) return Promise.resolve();
    // Copy from a fresh user gesture when available; keep a selectable preview
    // if clipboard permissions or lost activation prevent an asynchronous copy.
    const prepared = state.prepared;
    const text = prepared.text;
    function currentCopy() {
      return isCurrent(state) && state.prepared === prepared;
    }
    function manual() {
      if (!currentCopy()) return;
      state.previewDetails.open = true;
      state.preview.focus();
      state.preview.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        /* The browser API may be unavailable. */
      }
      status(
        state,
        t(copied ? "aiReviewCopied" : "aiReviewManualCopy"),
        !copied,
      );
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      manual();
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text).then(function () {
      if (currentCopy()) status(state, t("aiReviewCopied"));
    }, manual);
  }

  function fileFilter(state: ReviewDialogState) {
    if (!getWorkflow()) return undefined;
    const value: Partial<FileFilter> = {};
    state.filterFields.forEach(function (field) {
      value[field.key] = field.input.value;
    });
    return getWorkflow()!.normalizeFilter(value);
  }

  function repeatReview(state: ReviewDialogState, copy: boolean) {
    if (
      !isCurrent(state) ||
      state.busy ||
      state.loading ||
      state.context.kind !== "merge_requests"
    )
      return;
    const discussionIds = selectedDiscussionIds(state);
    if (
      state.baseline.value === "manual" &&
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(state.baselineSha.value.trim())
    ) {
      status(state, t("aiReviewPreviousSha"), true);
      return;
    }
    let scope;
    try {
      scope = fileFilter(state);
    } catch {
      status(state, t("aiReviewFilterInvalid"), true);
      return;
    }
    if (state.loadController) state.loadController!.abort();
    state.loadController = null;
    state.loading = false;
    invalidate(state);
    showWarnings(state, []);
    const run = ++state.exportRun,
      controller = (state.exportController = new AbortController());
    state.busy = true;
    updateActions(state);
    status(state, t("aiReviewPreparing"));
    data
      .prepareRepeatReview(state.context, {
        signal: controller.signal,
        discussionIds: discussionIds,
        baselineHead:
          state.baseline.value === "manual"
            ? state.baselineSha.value.trim()
            : state.baseline.value,
        fileFilter: scope,
        includeCode: state.includeCode.checked,
        includeDescription: state.includeDescription.checked,
        prompt: state.prompt.value,
      })
      .then(function (result) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.prepared = result;
        state.preview.value = result.text;
        state.size.textContent = t("aiReviewSize", [
          result.text.length.toLocaleString(),
        ]);
        showWarnings(state, result.warnings || []);
        state.previewDetails.open = !copy || state.previewDetails.open;
        status(state, t("aiReviewReady"));
        if (copy) return copyPrepared(state);
      })
      .catch(function (error) {
        if (
          isCurrent(state) &&
          run === state.exportRun &&
          error.name !== "AbortError"
        )
          status(state, error.message, true);
      })
      .then(function () {
        if (isCurrent(state) && run === state.exportRun) {
          state.busy = false;
          updateActions(state);
        }
      });
  }

  function prepareReplies(state: ReviewDialogState, copy: boolean) {
    if (
      !isCurrent(state) ||
      state.busy ||
      state.context.kind !== "merge_requests" ||
      !getImporter()
    )
      return;
    const discussionIds = selectedDiscussionIds(state, true);
    if (state.loading || !discussionIds.length) return;
    // This export loads its own context; a late picker response must not replace it.
    if (state.loadController) state.loadController!.abort();
    state.loadController = null;
    state.loading = false;
    invalidate(state);
    showWarnings(state, []);
    const run = ++state.exportRun;
    const controller = (state.exportController = new AbortController());
    state.busy = true;
    status(state, t("aiReviewImportPromptLoading"));
    updateActions(state);
    Promise.resolve()
      .then(function () {
        if (!isCurrent(state) || run !== state.exportRun) return;
        return getImporter()!.getReplyPrompt(state.context, {
          signal: controller.signal,
          discussionIds: discussionIds,
          prompt: state.prompt.value,
        });
      })
      .then(function (text) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.prepared = { text: text! };
        state.preview.value = text!;
        state.size.textContent = t("aiReviewSize", [
          text!.length.toLocaleString(),
        ]);
        state.previewDetails.open = !copy || state.previewDetails.open;
        status(state, t("aiReviewReady"));
        if (copy) return copyPrepared(state);
      })
      .catch(function (error) {
        if (
          isCurrent(state) &&
          run === state.exportRun &&
          error.name !== "AbortError"
        ) {
          status(
            state,
            t("aiReviewImportPromptError") + ": " + error.message,
            true,
          );
        }
      })
      .then(function () {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.busy = false;
        updateActions(state);
      });
  }

  function prepare(state: ReviewDialogState, copy: boolean) {
    if (!isCurrent(state) || state.busy || state.copyButton.disabled) return;
    if (state.prepared) {
      if (copy) copyPrepared(state);
      else state.previewDetails.open = true;
      return;
    }
    if (state.task === "repeat") {
      repeatReview(state, copy);
      return;
    }
    if (state.task === "replies") {
      prepareReplies(state, copy);
      return;
    }
    const fresh = freshReview(state);
    if (fresh && state.loading) {
      state.loadController!.abort();
      state.loadController = null;
      state.loading = false;
    }
    const run = ++state.exportRun;
    state.exportController = new AbortController();
    state.busy = true;
    status(state, t("aiReviewPreparing"));
    updateActions(state);
    const opts: ExportOptions = fresh ? {} : selection(state);
    try {
      if (fresh) opts.fileFilter = fileFilter(state);
    } catch {
      state.busy = false;
      updateActions(state);
      status(state, t("aiReviewFilterInvalid"), true);
      return;
    }
    opts.prompt = state.prompt.value;
    opts.includeCode = state.includeCode.checked;
    if (fresh) opts.includeExisting = state.includeExisting.checked;
    opts.includeDescription = state.includeDescription.checked;
    opts.includeReplies =
      state.context.kind === "merge_requests" && state.includeReplies.checked;
    opts.signal = state.exportController.signal;
    opts.onProgress = function (progress) {
      if (
        !isCurrent(state) ||
        run !== state.exportRun ||
        progress.total == null
      )
        return;
      status(
        state,
        t("aiReviewCodeProgress", [progress.loaded, progress.total]),
      );
    };
    const request = fresh
      ? data.prepareFreshReview(state.context, opts)
      : data.prepareExport(state.snapshot!, opts);
    request
      .then(function (result) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.prepared = result;
        state.previewDetails.open = !copy || state.previewDetails.open;
        state.preview.value = result.text;
        state.size.textContent = t("aiReviewSize", [
          result.text.length.toLocaleString(),
        ]);
        showWarnings(
          state,
          result.warnings ||
            (!fresh && state.snapshot && state.snapshot.warnings) ||
            [],
        );
        state.busy = false;
        updateActions(state);
        status(state, t("aiReviewReady"));
        if (copy) copyPrepared(state);
      })
      .catch(function (error) {
        if (!isCurrent(state) || run !== state.exportRun) return;
        state.busy = false;
        updateActions(state);
        if (error.name !== "AbortError")
          status(state, error.message || t("aiReviewLoadFailed"), true);
      });
  }

  function load(state: ReviewDialogState, preserve: boolean) {
    if (state.loadController) state.loadController!.abort();
    invalidate(state);
    const controller = new AbortController();
    state.loadController = controller;
    state.loading = true;
    state.retryButton.hidden = true;
    state.list.replaceChildren();
    status(state, t("aiReviewLoading"));
    updateActions(state);
    data
      .load(state.context, {
        noteId: state.intent.noteId,
        noteAnchor: state.intent.noteAnchor,
        visibleNote: state.intent.visibleNote,
        signal: controller.signal,
        onProgress: function (progress) {
          if (
            isCurrent(state) &&
            controller === state.loadController &&
            progress.phase === "discussions"
          ) {
            status(state, t("aiReviewLoaded", [progress.loaded]));
          }
        },
      })
      .then(function (snapshot) {
        if (!isCurrent(state) || controller !== state.loadController) return;
        state.snapshot = snapshot;
        state.needsLoad = false;
        state.loading = false;
        state.subject.textContent =
          (snapshot.entity && snapshot.entity.title) ||
          state.context.projectPath;
        const oldSelected = state.selected;
        state.selected = new Set();
        let foundIntent = false;
        snapshot.discussions.forEach(function (thread) {
          const notes = data.getNotes(thread!);
          const matchesFilter = matchesStatus(state, thread);
          const matchesIntent = notes.some(function (note) {
            return String(note.id) === state.intent.noteId;
          });
          if (matchesIntent) foundIntent = true;
          notes.forEach(function (note) {
            const id = String(note.id);
            const choose =
              preserve && state.selectionEdited
                ? oldSelected.has(id)
                : state.intent.noteId
                  ? matchesIntent && id === state.intent.noteId
                  : true;
            if (choose && matchesFilter) state.selected.add(id);
          });
        });
        state.intentFound = foundIntent;
        if (state.initialSelection == null)
          state.initialSelection = JSON.stringify(
            Array.from(state.selected).sort(),
          );
        showWarnings(state, snapshot.warnings || []);
        renderThreads(state);
        if (state.intent.noteId && !foundIntent) {
          status(
            state,
            t("aiReviewNoteUnavailable") + " (#" + state.intent.noteId + ")",
            true,
          );
          state.retryButton.hidden = false;
        } else {
          status(
            state,
            t("aiReviewLoaded", [
              snapshot.discussions.filter(function (thread) {
                return data.getNotes(thread).length;
              }).length,
            ]),
          );
          if (
            !preserve &&
            state.intent.noteId &&
            state.task === "feedback" &&
            !state.taskChanged
          )
            prepare(state, true);
        }
      })
      .catch(function (error) {
        if (!isCurrent(state) || controller !== state.loadController) return;
        state.loading = false;
        state.snapshot = null;
        updateActions(state);
        if (error.name !== "AbortError") {
          status(state, t("aiReviewLoadFailed") + ": " + error.message, true);
          state.retryButton.hidden = false;
        }
      });
  }

  function updateActions(state: ReviewDialogState) {
    const fresh = freshReview(state),
      mode = state.task,
      mr = state.context.kind === "merge_requests";
    if (state.promptMode !== mode) {
      if (state.promptMode)
        state.prompts[state.promptMode] = state.prompt.value;
      state.promptMode = mode;
      state.prompt.value = state.prompts[mode];
    }
    state.promptLabel.textContent = t("aiReviewTaskPrompt");
    state.prompt.setAttribute("aria-label", state.promptLabel.textContent);
    state.tabs.forEach(function (tab) {
      const selected = tab.dataset.task === mode;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    if (mr) state.body.setAttribute("aria-labelledby", "gl-review-tab-" + mode);
    state.body.classList.toggle("gl-review-single-column", fresh);
    state.picker.hidden = fresh;
    state.contextHint.hidden = mode !== "feedback";
    state.taskHint.textContent = t(
      {
        fresh: "aiReviewTaskReviewHint",
        feedback: "aiReviewTaskFixHint",
        replies: "aiReviewTaskReplyHint",
        repeat: "aiReviewTaskRepeatHint",
      }[mode],
    );
    if (mode === "feedback" && (!mr || !state.includeReplies.checked))
      state.taskHint.textContent = t("aiReviewTaskFixOnlyHint");
    state.repliesToggle.hidden = !mr || mode !== "feedback";
    state.repeatOptions.hidden = mode !== "repeat";
    state.scopeOptions.hidden =
      !mr || !getWorkflow() || mode === "replies" || mode === "feedback";
    state.descriptionToggle.hidden = mode === "replies";
    state.codeToggle.hidden = !fresh && mode !== "repeat";
    state.codeHint.hidden = state.codeToggle.hidden;
    state.existingToggle.hidden = !fresh;
    state.existingHint.hidden = !fresh;
    const enabled = !!state.snapshot && !state.loading && !state.busy;
    const hasContent =
      chosenCount(state) > 0 || (!mr && state.includeDescription.checked);
    const missingIntent =
      state.intent.noteId && !state.intentFound && !chosenCount(state);
    const replyCount = selectedDiscussionIds(state, true).length;
    const disabled =
      !isCurrent(state) ||
      (fresh
        ? !!state.busy
        : mode === "repeat"
          ? !!state.busy || !!state.loading
          : mode === "replies"
            ? !enabled || !replyCount
            : !enabled || !hasContent || !!missingIntent);
    state.previewButton.disabled = disabled;
    state.copyButton.disabled = disabled;
    state.baseline.disabled = !!state.busy;
    state.baselineSha.disabled = !!state.busy;
    state.allButton.disabled = !enabled;
    state.threadButton.disabled = !enabled;
    const thread = intentThread(state);
    state.threadButton.hidden = !thread || data.getNotes(thread).length < 2;
    state.selectButton.disabled = !enabled;
    state.unresolvedButton.disabled = !enabled;
    state.clearButton.disabled = !enabled;
    state.count.textContent = t("aiReviewSelectedCount", [chosenCount(state)]);
    state.cancelButton.hidden = !state.busy;
    state.refreshButton.disabled = !!state.loading;
    state.filter.disabled = !state.snapshot || !!state.loading;
    state.includeGeneral.disabled = state.filter.disabled;
    state.generalToggle.hidden = state.filter.value !== "unresolved";
    let summary = fresh
      ? t("aiReviewSummaryFresh")
      : mode === "feedback"
        ? t("aiReviewSummaryFix", [chosenCount(state)])
        : t(
            mode === "replies"
              ? "aiReviewSummaryReplies"
              : "aiReviewSummaryRepeat",
            [
              mode === "replies"
                ? replyCount
                : selectedDiscussionIds(state).length,
            ],
          );
    if (mode !== "replies")
      summary +=
        " " +
        t(
          state.includeDescription.checked
            ? "aiReviewSummaryDescriptionOn"
            : "aiReviewSummaryDescriptionOff",
        );
    if (fresh || mode === "repeat") {
      summary +=
        " " +
        t(
          state.includeCode.checked
            ? "aiReviewSummaryCodeOn"
            : "aiReviewSummaryCodeOff",
        );
      if (
        state.filterFields.some(function (field) {
          return field.input.value.trim();
        })
      )
        summary += " " + t("aiReviewSummaryFiltered");
    }
    if (fresh)
      summary +=
        " " +
        t(
          state.includeExisting.checked
            ? "aiReviewSummaryExistingOn"
            : "aiReviewSummaryExistingOff",
        );
    if (mode === "repeat" && !state.baseline.value)
      summary += " " + t("aiReviewSummaryFullRepeat");
    if (
      mode === "replies" &&
      state.snapshot &&
      state.snapshot!.discussions.filter(function (thread) {
        return data.getNotes(thread).some(function (note) {
          return state.selected.has(String(note.id));
        });
      }).length !== replyCount
    )
      summary += " " + t("aiReviewSummaryDraftsExcluded");
    state.taskSummary.textContent = summary;
    state.nextStep.textContent = t(
      mode === "feedback"
        ? mr && state.includeReplies.checked
          ? "aiReviewNextFixStep"
          : "aiReviewNextFixOnlyStep"
        : "aiReviewNextStep",
    );
    state.emptyHint.hidden =
      fresh || mode === "repeat" || !!chosenCount(state) || !!state.loading;
  }

  function freshReview(state: ReviewDialogState) {
    return state.context.kind === "merge_requests" && state.task === "fresh";
  }

  function intentThread(state: ReviewDialogState) {
    return (
      state.snapshot &&
      state.intent.noteId &&
      state.snapshot!.discussions.find(function (thread) {
        return data.getNotes(thread).some(function (note) {
          return String(note.id) === state.intent.noteId;
        });
      })
    );
  }
  return { prepare, load, updateActions, intentThread };
}
