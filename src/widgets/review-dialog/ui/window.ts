import type { Discussion } from "../../../entities/discussion";
import type * as Workflow from "../../../entities/review";
import type { ReviewContext } from "../../../entities/review";
import {
  REVIEW_FILE_FILTER_MAX_LENGTH,
  REVIEW_PROMPT_MAX_LENGTH,
} from "../../../entities/review";
import type { createReviewExporter } from "../../../features/review-export";
import type { createReviewImporter } from "../../../features/review-import";
import type { Translate } from "../../../shared/i18n";
import { element } from "../../../shared/ui/dom";
import type { createReviewThreads } from "./threads";
import type {
  ImportDialog,
  ReviewDialogState,
  ReviewIntent,
  ReviewSettings,
  ReviewTask,
} from "./types";
const taskKeys = {
  fresh: "aiReviewTaskReview",
  feedback: "aiReviewTaskFix",
  replies: "aiReviewTaskReply",
  repeat: "aiReviewTaskRepeat",
};
interface ReviewWindowDependencies {
  route: () => ReviewContext | null;
  getImportDialog: () => ImportDialog | undefined;
  close: (force?: boolean | Event) => boolean;
  settings: ReviewSettings;
  data: ReturnType<typeof createReviewExporter>;
  getImporter: () =>
    | Pick<
        ReturnType<typeof createReviewImporter>,
        "DEFAULT_REPLY_PROMPT" | "getReplyPrompt"
      >
    | undefined;
  getWorkflow: () => typeof Workflow | null;
  activate: (state: ReviewDialogState) => void;
  t: Translate;
  button: (
    key: string,
    handler: (event: MouseEvent) => void,
    className?: string,
  ) => HTMLButtonElement;
  setTask: (state: ReviewDialogState, task: ReviewTask) => void;
  invalidate: (state: ReviewDialogState) => void;
  load: (state: ReviewDialogState, preserve: boolean) => void;
  rememberDescription: (state: ReviewDialogState) => void;
  rememberExisting: (state: ReviewDialogState) => void;
  status: (state: ReviewDialogState, text: string, error?: boolean) => void;
  intentThread: (
    state: ReviewDialogState,
  ) => "" | Discussion | null | undefined;
  prepare: (state: ReviewDialogState, copy: boolean) => void;
  copyValues: (state: ReviewDialogState) => string;
  threads: ReturnType<typeof createReviewThreads>;
}

export function createReviewWindow(dependencies: ReviewWindowDependencies) {
  const {
    route,
    getImportDialog,
    close,
    settings,
    data,
    getImporter,
    getWorkflow,
    activate,
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
    threads,
  } = dependencies;
  const { visibleThreads, syncChecks, renderThreads } = threads;

  function open(intent?: ReviewIntent) {
    const context = route();
    if (!context) return;
    if (getImportDialog() && getImportDialog()!.close() === false) return;
    if (close() === false) return;
    const state = {
      context: context,
      intent: intent || {},
      selected: new Set(),
      selectionEdited: false,
      exportRun: 0,
      previousFocus: document.activeElement as HTMLElement | null,
      task: "feedback",
      tabs: [] as HTMLButtonElement[],
      prompts: {
        feedback: settings.ai_review_prompt || data.DEFAULT_PROMPT,
        fresh:
          settings.ai_review_fresh_prompt || data.DEFAULT_FRESH_REVIEW_PROMPT,
        replies:
          settings.ai_review_reply_prompt ||
          (getImporter() && getImporter()!.DEFAULT_REPLY_PROMPT) ||
          "",
        repeat:
          settings.ai_review_repeat_prompt ||
          (getWorkflow() && getWorkflow()!.DEFAULT_REPEAT_PROMPT) ||
          "",
      },
    } satisfies Partial<ReviewDialogState> as ReviewDialogState;
    activate(state);
    const overlay = (state.overlay = element("div", "gl-review-overlay"));
    const dialog = element("section", "gl-review-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "gl-review-title");
    const header = element("header", "gl-review-header");
    const titleBox = element("div");
    const title = element("h2", "", t("aiReviewTitle"));
    title.id = "gl-review-title";
    titleBox.appendChild(title);
    state.subject = element(
      "p",
      "gl-review-subject",
      context.projectPath +
        (context.kind === "issues" ? " #" : " !") +
        context.iid,
    );
    titleBox.appendChild(state.subject);
    header.appendChild(titleBox);
    header.appendChild(button("aiReviewClose", close));
    dialog.appendChild(header);
    const tabs = element("div", "gl-review-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("aiReviewChooseTask"));
    tabs.hidden = context.kind !== "merge_requests";
    (Object.keys(taskKeys) as ReviewTask[]).forEach(
      function (task, index, tasks) {
        const tab = button(taskKeys[task], function () {
          setTask(state, task);
        });
        tab.dataset.task = task;
        tab.id = "gl-review-tab-" + task;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", "gl-review-task-panel");
        tab.addEventListener("keydown", function (event) {
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % tasks.length
              : event.key === "ArrowLeft"
                ? (index + tasks.length - 1) % tasks.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tasks.length - 1
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          state.tabs[next].focus();
          setTask(state, tasks[next]);
        });
        state.tabs.push(tab);
        tabs.appendChild(tab);
      },
    );
    dialog.appendChild(tabs);
    state.status = element("div", "gl-review-status");
    state.status.setAttribute("role", "status");
    dialog.appendChild(state.status);
    state.warning = element("div", "gl-review-warning");
    state.warning.hidden = true;
    dialog.appendChild(state.warning);
    const body = (state.body = element("div", "gl-review-columns"));
    body.id = "gl-review-task-panel";
    if (context.kind === "merge_requests")
      body.setAttribute("role", "tabpanel");
    const left = (state.picker = element("section", "gl-review-picker"));
    const filters = element("div", "gl-review-filters");
    state.search = element("input");
    state.search.type = "search";
    state.search.placeholder = t("aiReviewSearch");
    state.search.setAttribute("aria-label", t("aiReviewSearch"));
    state.search.addEventListener("input", function () {
      renderThreads(state);
    });
    filters.appendChild(state.search);
    state.filter = element("select");
    state.filter.setAttribute("aria-label", t("aiReviewAll"));
    ["all", "unresolved", "resolved", "general"].forEach(function (value) {
      const option = element(
        "option",
        "",
        t("aiReview" + value.charAt(0).toUpperCase() + value.slice(1)),
      );
      option.value = value;
      state.filter.appendChild(option);
    });
    state.filter.value = state.intent.noteId ? "all" : "unresolved";
    state.filter.addEventListener("change", function () {
      if (state.filter.value !== "unresolved")
        state.includeGeneral.checked = false;
      state.selectionEdited = true;
      state.selected.clear();
      visibleThreads(state).forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    const filterControl = element("span", "gl-review-select");
    filterControl.appendChild(state.filter);
    filters.appendChild(filterControl);
    left.appendChild(filters);
    state.generalToggle = element("label", "gl-review-general-toggle");
    state.includeGeneral = element("input");
    state.includeGeneral.type = "checkbox";
    state.includeGeneral.checked = false;
    state.includeGeneral.addEventListener("change", function () {
      if (!state.snapshot || state.filter.value !== "unresolved") return;
      const threads = state.includeGeneral.checked
        ? visibleThreads(state)
        : state.snapshot!.discussions;
      threads.forEach(function (thread) {
        if (data.getStatus(thread) !== "general") return;
        data.getNotes(thread).forEach(function (note) {
          if (state.includeGeneral.checked) state.selected.add(String(note.id));
          else state.selected.delete(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    state.generalToggle.appendChild(state.includeGeneral);
    state.generalToggle.appendChild(element("span", "", t("aiReviewGeneral")));
    left.appendChild(state.generalToggle);
    const tools = element("div", "gl-review-tools");
    state.unresolvedButton = button("aiReviewUnresolved", function () {
      state.filter.value = "unresolved";
      state.search.value = "";
      state.includeGeneral.checked = false;
      state.selectionEdited = true;
      state.selected.clear();
      visibleThreads(state).forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    state.selectButton = button("aiReviewSelectShown", function () {
      state.selectionEdited = true;
      visibleThreads(state).forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      syncChecks(state);
    });
    state.clearButton = button("aiReviewClear", function () {
      state.selectionEdited = true;
      state.selected.clear();
      invalidate(state);
      syncChecks(state);
    });
    state.refreshButton = button("aiReviewRefresh", function () {
      load(state, true);
    });
    tools.appendChild(state.unresolvedButton);
    tools.appendChild(state.selectButton);
    tools.appendChild(state.clearButton);
    tools.appendChild(state.refreshButton);
    left.appendChild(tools);
    state.count = element("div", "gl-review-count");
    left.appendChild(state.count);
    state.list = element("div", "gl-review-list");
    left.appendChild(state.list);
    state.contextHint = element(
      "p",
      "gl-review-muted gl-review-context-hint",
      t("aiReviewCommentContext"),
    );
    left.appendChild(state.contextHint);
    body.appendChild(left);

    const right = (state.output = element("section", "gl-review-output"));
    state.taskHint = element("p", "gl-review-task-hint");
    right.appendChild(state.taskHint);
    state.taskSummary = element("p", "gl-review-task-summary");
    state.taskSummary.setAttribute("aria-live", "polite");
    right.appendChild(state.taskSummary);
    state.emptyHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewChooseFeedback"),
    );
    right.appendChild(state.emptyHint);
    const advanced = element("details", "gl-review-advanced");
    advanced.appendChild(element("summary", "", t("aiReviewAdvanced")));
    const workflow = getWorkflow();
    const reviewOptions = element(
      "details",
      "gl-review-prompt-details gl-review-scope",
    );
    reviewOptions.hidden = !workflow || context.kind !== "merge_requests";
    reviewOptions.appendChild(element("summary", "", t("aiReviewFileFilters")));
    reviewOptions.appendChild(
      element("p", "gl-review-muted", t("aiReviewFileFiltersHint")),
    );
    state.filterFields = (workflow ? workflow.FILTER_FIELDS : []).map(
      function (key, index) {
        const label = element(
          "label",
          "gl-review-preview-label",
          t(
            [
              "aiReviewIncludeExtensions",
              "aiReviewIncludeFiles",
              "aiReviewIgnoreFiles",
              "aiReviewIgnoreDirs",
            ][index],
          ),
        );
        const input = element("textarea", "gl-review-prompt");
        input.rows = 2;
        input.maxLength = REVIEW_FILE_FILTER_MAX_LENGTH;
        input.setAttribute("aria-label", label.textContent!);
        input.value =
          settings.ai_review_file_filter &&
          typeof settings.ai_review_file_filter[key] === "string"
            ? settings.ai_review_file_filter[key]
            : "";
        input.addEventListener("input", function () {
          invalidate(state);
        });
        label.appendChild(input);
        reviewOptions.appendChild(label);
        return { key: key, input: input };
      },
    );
    reviewOptions.appendChild(
      element("p", "gl-review-muted", t("aiReviewPromptSessionHint")),
    );
    state.scopeOptions = reviewOptions;
    advanced.appendChild(reviewOptions);
    const repeatOptions = element("div", "gl-review-repeat-options");
    repeatOptions.hidden = !workflow || context.kind !== "merge_requests";
    const baselineLabel = element(
      "label",
      "gl-review-preview-label",
      t("aiReviewPreviousRevision"),
    );
    state.baseline = element("select", "gl-review-filter");
    state.baseline.setAttribute("aria-label", t("aiReviewPreviousRevision"));
    const automatic = element("option", "", t("aiReviewPreviousNone"));
    automatic.value = "";
    state.baseline.appendChild(automatic);
    const manualOption = element("option", "", t("aiReviewPreviousManual"));
    manualOption.value = "manual";
    state.baseline.appendChild(manualOption);
    state.baseline.addEventListener("change", function () {
      state.baselineSha.hidden = state.baseline.value !== "manual";
      invalidate(state);
    });
    const baselineWrap = element("span", "gl-review-select");
    baselineWrap.appendChild(state.baseline);
    baselineLabel.appendChild(baselineWrap);
    repeatOptions.appendChild(baselineLabel);
    state.baselineSha = element("input", "gl-review-baseline-sha");
    state.baselineSha.type = "text";
    state.baselineSha.maxLength = 64;
    state.baselineSha.hidden = true;
    state.baselineSha.placeholder = t("aiReviewPreviousSha");
    state.baselineSha.setAttribute("aria-label", t("aiReviewPreviousSha"));
    state.baselineSha.addEventListener("input", function () {
      invalidate(state);
    });
    baselineLabel.appendChild(state.baselineSha);
    state.versionsHint = element(
      "p",
      "gl-review-muted gl-review-versions-hint",
      t("aiReviewPreviousHint"),
    );
    repeatOptions.appendChild(state.versionsHint);
    state.repeatOptions = repeatOptions;
    right.appendChild(repeatOptions);
    const include = element("label", "gl-review-description-toggle");
    state.includeDescription = element("input");
    state.includeDescription.type = "checkbox";
    state.includeDescription.checked =
      typeof settings.ai_review_include_description === "boolean"
        ? settings.ai_review_include_description
        : !state.intent.noteId;
    state.includeDescription.addEventListener("change", function () {
      invalidate(state);
      rememberDescription(state);
    });
    include.appendChild(state.includeDescription);
    include.appendChild(element("span", "", t("aiReviewIncludeDescription")));
    state.descriptionToggle = include;
    right.appendChild(include);
    state.repliesToggle = element(
      "label",
      "gl-review-description-toggle gl-review-replies-toggle",
    );
    state.includeReplies = element("input");
    state.includeReplies.type = "checkbox";
    state.includeReplies.checked = true;
    state.includeReplies.addEventListener("change", function () {
      invalidate(state);
    });
    state.repliesToggle.appendChild(state.includeReplies);
    state.repliesToggle.appendChild(
      element("span", "", t("aiReviewIncludeReplies")),
    );
    right.appendChild(state.repliesToggle);
    const codeToggle = element(
      "label",
      "gl-review-description-toggle gl-review-code-toggle",
    );
    codeToggle.hidden = context.kind !== "merge_requests";
    state.includeCode = element("input");
    state.includeCode.type = "checkbox";
    state.includeCode.checked = false;
    state.includeCode.addEventListener("change", function () {
      invalidate(state);
    });
    codeToggle.appendChild(state.includeCode);
    codeToggle.appendChild(element("span", "", t("aiReviewIncludeCode")));
    state.codeToggle = codeToggle;
    right.appendChild(codeToggle);
    const codeHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewIncludeCodeHint"),
    );
    codeHint.hidden = codeToggle.hidden;
    state.codeHint = codeHint;
    right.appendChild(codeHint);
    state.existingToggle = element(
      "label",
      "gl-review-description-toggle gl-review-existing-toggle",
    );
    state.existingToggle.hidden = true;
    state.includeExisting = element("input");
    state.includeExisting.type = "checkbox";
    state.includeExisting.checked = settings.ai_review_fresh_existing === true;
    state.includeExisting.addEventListener("change", function () {
      invalidate(state);
      rememberExisting(state);
    });
    state.existingToggle.appendChild(state.includeExisting);
    state.existingToggle.appendChild(
      element("span", "", t("aiReviewIncludeExisting")),
    );
    right.appendChild(state.existingToggle);
    state.existingHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewIncludeExistingHint"),
    );
    state.existingHint.hidden = true;
    right.appendChild(state.existingHint);
    const promptDetails = element("details", "gl-review-prompt-details");
    state.promptLabel = element("summary", "", t("aiReviewPrompt"));
    promptDetails.appendChild(state.promptLabel);
    state.prompt = element(
      "textarea",
      "gl-review-prompt gl-review-task-prompt",
    );
    state.prompt.value = settings.ai_review_prompt || data.DEFAULT_PROMPT;
    state.prompt.rows = 5;
    state.prompt.maxLength = REVIEW_PROMPT_MAX_LENGTH;
    state.prompt.setAttribute("aria-label", t("aiReviewPrompt"));
    state.prompt.addEventListener("input", function () {
      invalidate(state);
    });
    promptDetails.appendChild(state.prompt);
    promptDetails.appendChild(
      element("p", "gl-review-muted", t("aiReviewPromptSessionHint")),
    );
    promptDetails.appendChild(
      button("aiReviewResetPrompt", function () {
        state.prompt.value =
          {
            fresh: data.DEFAULT_FRESH_REVIEW_PROMPT,
            feedback: data.DEFAULT_PROMPT,
            replies: getImporter() && getImporter()!.DEFAULT_REPLY_PROMPT,
            repeat: workflow && workflow.DEFAULT_REPEAT_PROMPT,
          }[state.task] || "";
        invalidate(state);
      }),
    );
    advanced.appendChild(promptDetails);
    right.appendChild(advanced);
    state.previewDetails = element("details", "gl-review-preview-details");
    state.previewDetails.appendChild(
      element("summary", "", t("aiReviewPreview")),
    );
    right.appendChild(state.previewDetails);
    state.preview = element("textarea", "gl-review-preview");
    state.preview.id = "gl-review-preview";
    state.preview.readOnly = true;
    state.preview.spellcheck = false;
    state.preview.placeholder = t("aiReviewLoadHint");
    state.preview.setAttribute("aria-label", t("aiReviewPreview"));
    state.previewDetails.appendChild(state.preview);
    state.size = element("div", "gl-review-muted");
    state.previewDetails.appendChild(state.size);
    state.nextStep = element("p", "gl-review-muted gl-review-next-step");
    right.appendChild(state.nextStep);
    body.appendChild(right);
    dialog.appendChild(body);
    const footer = element("footer", "gl-review-footer");
    state.retryButton = button("aiReviewRetry", function () {
      load(state, false);
    });
    state.retryButton.hidden = true;
    footer.appendChild(state.retryButton);
    state.cancelButton = button("aiReviewCancel", function () {
      invalidate(state);
      status(state, "");
    });
    state.cancelButton.hidden = true;
    footer.appendChild(state.cancelButton);
    state.threadButton = button("aiReviewSelectThread", function () {
      const thread = intentThread(state);
      if (!thread) return;
      state.selectionEdited = true;
      state.selected.clear();
      data.getNotes(thread).forEach(function (note) {
        state.selected.add(String(note.id));
      });
      invalidate(state);
      syncChecks(state);
    });
    state.threadButton.hidden = true;
    tools.appendChild(state.threadButton);
    state.allButton = button("aiReviewSelectAll", function () {
      state.selectionEdited = true;
      state.filter.value = "all";
      state.search.value = "";
      state.includeGeneral.checked = false;
      state.snapshot!.discussions.forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    tools.appendChild(state.allButton);
    const importButton = button(
      "aiReviewPasteResult",
      function () {
        if (!getImportDialog() || context.kind !== "merge_requests") return;
        if (close() !== false) getImportDialog()!.open(context, { t: t });
      },
      "gl-review-import-result",
    );
    importButton.hidden =
      context.kind !== "merge_requests" || !getImportDialog();
    footer.appendChild(importButton);
    state.previewButton = button("aiReviewPreview", function () {
      prepare(state, false);
    });
    footer.appendChild(state.previewButton);
    state.copyButton = button(
      "aiReviewCopyTask",
      function () {
        prepare(state, true);
      },
      "gl-review-primary",
    );
    footer.appendChild(state.copyButton);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    state.onKeydown = function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      if (event.key === "Tab") {
        const targets = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, summary, a[href]",
          ),
        ).filter(function (el) {
          return (
            !("disabled" in el && el.disabled) &&
            !el.hidden &&
            el.tabIndex !== -1 &&
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
      }
    };
    document.addEventListener("keydown", state.onKeydown, true);
    document.body.appendChild(overlay);
    if (context.kind === "merge_requests") state.tabs[1].focus();
    else state.search.focus();
    state.initialValues = copyValues(state);
    load(state, false);
  }
  return { open };
}
