import { createDialogKeydown } from "../../../shared/ui/dialog";
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
  data: Pick<
    ReturnType<typeof createReviewExporter>,
    "DEFAULT_PROMPT" | "DEFAULT_FRESH_REVIEW_PROMPT" | "getNotes" | "getStatus"
  >;
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
    if (getImportDialog()?.close() === false) return;
    if (close() === false) return;

    const taskTabs: HTMLButtonElement[] = [];
    const reviewIntent = intent || {};
    const overlay = element("div", "gl-review-overlay");
    const dialog = element("section", "gl-review-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "gl-review-title");
    const header = element("header", "gl-review-header");
    const titleBox = element("div");
    const title = element("h2", "", t("aiReviewTitle"));
    title.id = "gl-review-title";
    titleBox.appendChild(title);
    const viewSubject = element(
      "p",
      "gl-review-subject",
      context.projectPath +
        (context.kind === "issues" ? " #" : " !") +
        context.iid,
    );
    titleBox.appendChild(viewSubject);
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
          taskTabs[next].focus();
          setTask(state, tasks[next]);
        });
        taskTabs.push(tab);
        tabs.appendChild(tab);
      },
    );
    dialog.appendChild(tabs);
    const viewStatus = element("div", "gl-review-status");
    viewStatus.setAttribute("role", "status");
    dialog.appendChild(viewStatus);
    const viewWarning = element("div", "gl-review-warning");
    viewWarning.hidden = true;
    dialog.appendChild(viewWarning);
    const body = element("div", "gl-review-columns");
    body.id = "gl-review-task-panel";
    if (context.kind === "merge_requests")
      body.setAttribute("role", "tabpanel");
    const left = element("section", "gl-review-picker");
    const filters = element("div", "gl-review-filters");
    const viewSearch = element("input");
    viewSearch.type = "search";
    viewSearch.placeholder = t("aiReviewSearch");
    viewSearch.setAttribute("aria-label", t("aiReviewSearch"));
    viewSearch.addEventListener("input", function () {
      renderThreads(state);
    });
    filters.appendChild(viewSearch);
    const viewFilter = element("select");
    viewFilter.setAttribute("aria-label", t("aiReviewAll"));
    ["all", "unresolved", "resolved", "general"].forEach(function (value) {
      const option = element(
        "option",
        "",
        t("aiReview" + value.charAt(0).toUpperCase() + value.slice(1)),
      );
      option.value = value;
      viewFilter.appendChild(option);
    });
    viewFilter.value = reviewIntent.noteId ? "all" : "unresolved";
    viewFilter.addEventListener("change", function () {
      if (viewFilter.value !== "unresolved") viewIncludeGeneral.checked = false;
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
    filterControl.appendChild(viewFilter);
    filters.appendChild(filterControl);
    left.appendChild(filters);
    const viewGeneralToggle = element("label", "gl-review-general-toggle");
    const viewIncludeGeneral = element("input");
    viewIncludeGeneral.type = "checkbox";
    viewIncludeGeneral.checked = false;
    viewIncludeGeneral.addEventListener("change", function () {
      if (!state.snapshot || viewFilter.value !== "unresolved") return;
      const threads = viewIncludeGeneral.checked
        ? visibleThreads(state)
        : state.snapshot.discussions;
      threads.forEach(function (thread) {
        if (data.getStatus(thread) !== "general") return;
        data.getNotes(thread).forEach(function (note) {
          if (viewIncludeGeneral.checked) state.selected.add(String(note.id));
          else state.selected.delete(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    viewGeneralToggle.appendChild(viewIncludeGeneral);
    viewGeneralToggle.appendChild(element("span", "", t("aiReviewGeneral")));
    left.appendChild(viewGeneralToggle);
    const tools = element("div", "gl-review-tools");
    const viewUnresolvedButton = button("aiReviewUnresolved", function () {
      viewFilter.value = "unresolved";
      viewSearch.value = "";
      viewIncludeGeneral.checked = false;
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
    const viewSelectButton = button("aiReviewSelectShown", function () {
      state.selectionEdited = true;
      visibleThreads(state).forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      syncChecks(state);
    });
    const viewClearButton = button("aiReviewClear", function () {
      state.selectionEdited = true;
      state.selected.clear();
      invalidate(state);
      syncChecks(state);
    });
    const viewRefreshButton = button("aiReviewRefresh", function () {
      load(state, true);
    });
    tools.appendChild(viewUnresolvedButton);
    tools.appendChild(viewSelectButton);
    tools.appendChild(viewClearButton);
    tools.appendChild(viewRefreshButton);
    left.appendChild(tools);
    const viewCount = element("div", "gl-review-count");
    left.appendChild(viewCount);
    const viewList = element("div", "gl-review-list");
    left.appendChild(viewList);
    const viewContextHint = element(
      "p",
      "gl-review-muted gl-review-context-hint",
      t("aiReviewCommentContext"),
    );
    left.appendChild(viewContextHint);
    body.appendChild(left);

    const right = element("section", "gl-review-output");
    const viewTaskHint = element("p", "gl-review-task-hint");
    right.appendChild(viewTaskHint);
    const viewTaskSummary = element("p", "gl-review-task-summary");
    viewTaskSummary.setAttribute("aria-live", "polite");
    right.appendChild(viewTaskSummary);
    const viewEmptyHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewChooseFeedback"),
    );
    right.appendChild(viewEmptyHint);
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
    const viewFilterFields = (workflow ? workflow.FILTER_FIELDS : []).map(
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
        input.setAttribute("aria-label", label.textContent);
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
    const viewScopeOptions = reviewOptions;
    advanced.appendChild(reviewOptions);
    const repeatOptions = element("div", "gl-review-repeat-options");
    repeatOptions.hidden = !workflow || context.kind !== "merge_requests";
    const baselineLabel = element(
      "label",
      "gl-review-preview-label",
      t("aiReviewPreviousRevision"),
    );
    const viewBaseline = element("select", "gl-review-filter");
    viewBaseline.setAttribute("aria-label", t("aiReviewPreviousRevision"));
    const automatic = element("option", "", t("aiReviewPreviousNone"));
    automatic.value = "";
    viewBaseline.appendChild(automatic);
    const manualOption = element("option", "", t("aiReviewPreviousManual"));
    manualOption.value = "manual";
    viewBaseline.appendChild(manualOption);
    viewBaseline.addEventListener("change", function () {
      viewBaselineSha.hidden = viewBaseline.value !== "manual";
      invalidate(state);
    });
    const baselineWrap = element("span", "gl-review-select");
    baselineWrap.appendChild(viewBaseline);
    baselineLabel.appendChild(baselineWrap);
    repeatOptions.appendChild(baselineLabel);
    const viewBaselineSha = element("input", "gl-review-baseline-sha");
    viewBaselineSha.type = "text";
    viewBaselineSha.maxLength = 64;
    viewBaselineSha.hidden = true;
    viewBaselineSha.placeholder = t("aiReviewPreviousSha");
    viewBaselineSha.setAttribute("aria-label", t("aiReviewPreviousSha"));
    viewBaselineSha.addEventListener("input", function () {
      invalidate(state);
    });
    baselineLabel.appendChild(viewBaselineSha);
    const viewVersionsHint = element(
      "p",
      "gl-review-muted gl-review-versions-hint",
      t("aiReviewPreviousHint"),
    );
    repeatOptions.appendChild(viewVersionsHint);
    const viewRepeatOptions = repeatOptions;
    right.appendChild(repeatOptions);
    const include = element("label", "gl-review-description-toggle");
    const viewIncludeDescription = element("input");
    viewIncludeDescription.type = "checkbox";
    viewIncludeDescription.checked =
      typeof settings.ai_review_include_description === "boolean"
        ? settings.ai_review_include_description
        : !reviewIntent.noteId;
    viewIncludeDescription.addEventListener("change", function () {
      invalidate(state);
      rememberDescription(state);
    });
    include.appendChild(viewIncludeDescription);
    include.appendChild(element("span", "", t("aiReviewIncludeDescription")));
    const viewDescriptionToggle = include;
    right.appendChild(include);
    const viewRepliesToggle = element(
      "label",
      "gl-review-description-toggle gl-review-replies-toggle",
    );
    const viewIncludeReplies = element("input");
    viewIncludeReplies.type = "checkbox";
    viewIncludeReplies.checked = true;
    viewIncludeReplies.addEventListener("change", function () {
      invalidate(state);
    });
    viewRepliesToggle.appendChild(viewIncludeReplies);
    viewRepliesToggle.appendChild(
      element("span", "", t("aiReviewIncludeReplies")),
    );
    right.appendChild(viewRepliesToggle);
    const codeToggle = element(
      "label",
      "gl-review-description-toggle gl-review-code-toggle",
    );
    codeToggle.hidden = context.kind !== "merge_requests";
    const viewIncludeCode = element("input");
    viewIncludeCode.type = "checkbox";
    viewIncludeCode.checked = false;
    viewIncludeCode.addEventListener("change", function () {
      invalidate(state);
    });
    codeToggle.appendChild(viewIncludeCode);
    codeToggle.appendChild(element("span", "", t("aiReviewIncludeCode")));
    const viewCodeToggle = codeToggle;
    right.appendChild(codeToggle);
    const codeHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewIncludeCodeHint"),
    );
    codeHint.hidden = codeToggle.hidden;
    const viewCodeHint = codeHint;
    right.appendChild(codeHint);
    const viewExistingToggle = element(
      "label",
      "gl-review-description-toggle gl-review-existing-toggle",
    );
    viewExistingToggle.hidden = true;
    const viewIncludeExisting = element("input");
    viewIncludeExisting.type = "checkbox";
    viewIncludeExisting.checked = settings.ai_review_fresh_existing === true;
    viewIncludeExisting.addEventListener("change", function () {
      invalidate(state);
      rememberExisting(state);
    });
    viewExistingToggle.appendChild(viewIncludeExisting);
    viewExistingToggle.appendChild(
      element("span", "", t("aiReviewIncludeExisting")),
    );
    right.appendChild(viewExistingToggle);
    const viewExistingHint = element(
      "p",
      "gl-review-muted",
      t("aiReviewIncludeExistingHint"),
    );
    viewExistingHint.hidden = true;
    right.appendChild(viewExistingHint);
    const promptDetails = element("details", "gl-review-prompt-details");
    const viewPromptLabel = element("summary", "", t("aiReviewPrompt"));
    promptDetails.appendChild(viewPromptLabel);
    const viewPrompt = element(
      "textarea",
      "gl-review-prompt gl-review-task-prompt",
    );
    viewPrompt.value = settings.ai_review_prompt || data.DEFAULT_PROMPT;
    viewPrompt.rows = 5;
    viewPrompt.maxLength = REVIEW_PROMPT_MAX_LENGTH;
    viewPrompt.setAttribute("aria-label", t("aiReviewPrompt"));
    viewPrompt.addEventListener("input", function () {
      invalidate(state);
    });
    promptDetails.appendChild(viewPrompt);
    promptDetails.appendChild(
      element("p", "gl-review-muted", t("aiReviewPromptSessionHint")),
    );
    promptDetails.appendChild(
      button("aiReviewResetPrompt", function () {
        viewPrompt.value =
          {
            fresh: data.DEFAULT_FRESH_REVIEW_PROMPT,
            feedback: data.DEFAULT_PROMPT,
            replies: getImporter()?.DEFAULT_REPLY_PROMPT,
            repeat: workflow && workflow.DEFAULT_REPEAT_PROMPT,
          }[state.task] || "";
        invalidate(state);
      }),
    );
    advanced.appendChild(promptDetails);
    right.appendChild(advanced);
    const viewPreviewDetails = element("details", "gl-review-preview-details");
    viewPreviewDetails.appendChild(
      element("summary", "", t("aiReviewPreview")),
    );
    right.appendChild(viewPreviewDetails);
    const viewPreview = element("textarea", "gl-review-preview");
    viewPreview.id = "gl-review-preview";
    viewPreview.readOnly = true;
    viewPreview.spellcheck = false;
    viewPreview.placeholder = t("aiReviewLoadHint");
    viewPreview.setAttribute("aria-label", t("aiReviewPreview"));
    viewPreviewDetails.appendChild(viewPreview);
    const viewSize = element("div", "gl-review-muted");
    viewPreviewDetails.appendChild(viewSize);
    const viewNextStep = element("p", "gl-review-muted gl-review-next-step");
    right.appendChild(viewNextStep);
    body.appendChild(right);
    dialog.appendChild(body);
    const footer = element("footer", "gl-review-footer");
    const viewRetryButton = button("aiReviewRetry", function () {
      load(state, false);
    });
    viewRetryButton.hidden = true;
    footer.appendChild(viewRetryButton);
    const viewCancelButton = button("aiReviewCancel", function () {
      invalidate(state);
      status(state, "");
    });
    viewCancelButton.hidden = true;
    footer.appendChild(viewCancelButton);
    const viewThreadButton = button("aiReviewSelectThread", function () {
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
    viewThreadButton.hidden = true;
    tools.appendChild(viewThreadButton);
    const viewAllButton = button("aiReviewSelectAll", function () {
      if (!state.snapshot) return;
      state.selectionEdited = true;
      viewFilter.value = "all";
      viewSearch.value = "";
      viewIncludeGeneral.checked = false;
      state.snapshot.discussions.forEach(function (thread) {
        data.getNotes(thread).forEach(function (note) {
          state.selected.add(String(note.id));
        });
      });
      invalidate(state);
      renderThreads(state);
    });
    tools.appendChild(viewAllButton);
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
    const viewPreviewButton = button("aiReviewPreview", function () {
      prepare(state, false);
    });
    footer.appendChild(viewPreviewButton);
    const viewCopyButton = button(
      "aiReviewCopyTask",
      function () {
        prepare(state, true);
      },
      "gl-review-primary",
    );
    footer.appendChild(viewCopyButton);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    const viewOnKeydown = createDialogKeydown(dialog, close);

    const state: ReviewDialogState = {
      context: context,
      intent: reviewIntent,
      selected: new Set(),
      selectionEdited: false,
      exportRun: 0,
      previousFocus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      task: "feedback",
      tabs: taskTabs,
      prompts: {
        feedback: settings.ai_review_prompt || data.DEFAULT_PROMPT,
        fresh:
          settings.ai_review_fresh_prompt || data.DEFAULT_FRESH_REVIEW_PROMPT,
        replies:
          settings.ai_review_reply_prompt ||
          getImporter()?.DEFAULT_REPLY_PROMPT ||
          "",
        repeat:
          settings.ai_review_repeat_prompt ||
          getWorkflow()?.DEFAULT_REPEAT_PROMPT ||
          "",
      },
      overlay: overlay,
      subject: viewSubject,
      status: viewStatus,
      warning: viewWarning,
      body: body,
      picker: left,
      search: viewSearch,
      filter: viewFilter,
      generalToggle: viewGeneralToggle,
      includeGeneral: viewIncludeGeneral,
      unresolvedButton: viewUnresolvedButton,
      selectButton: viewSelectButton,
      clearButton: viewClearButton,
      refreshButton: viewRefreshButton,
      count: viewCount,
      list: viewList,
      contextHint: viewContextHint,
      output: right,
      taskHint: viewTaskHint,
      taskSummary: viewTaskSummary,
      emptyHint: viewEmptyHint,
      filterFields: viewFilterFields,
      scopeOptions: viewScopeOptions,
      baseline: viewBaseline,
      baselineSha: viewBaselineSha,
      versionsHint: viewVersionsHint,
      repeatOptions: viewRepeatOptions,
      includeDescription: viewIncludeDescription,
      descriptionToggle: viewDescriptionToggle,
      repliesToggle: viewRepliesToggle,
      includeReplies: viewIncludeReplies,
      includeCode: viewIncludeCode,
      codeToggle: viewCodeToggle,
      codeHint: viewCodeHint,
      existingToggle: viewExistingToggle,
      includeExisting: viewIncludeExisting,
      existingHint: viewExistingHint,
      promptLabel: viewPromptLabel,
      prompt: viewPrompt,
      previewDetails: viewPreviewDetails,
      preview: viewPreview,
      size: viewSize,
      nextStep: viewNextStep,
      retryButton: viewRetryButton,
      cancelButton: viewCancelButton,
      threadButton: viewThreadButton,
      allButton: viewAllButton,
      previewButton: viewPreviewButton,
      copyButton: viewCopyButton,
      onKeydown: viewOnKeydown,
      initialValues: "",
    };
    activate(state);
    document.addEventListener("keydown", state.onKeydown, true);
    document.body.appendChild(overlay);
    if (context.kind === "merge_requests") state.tabs[1].focus();
    else state.search.focus();
    state.initialValues = copyValues(state);
    load(state, false);
  }
  return { open };
}
