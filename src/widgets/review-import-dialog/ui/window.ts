import type { ReviewContext } from "../../../entities/review";
import type { ImportItem } from "../../../features/review-import";
import type { Translate } from "../../../shared/i18n";
import { createDialogKeydown } from "../../../shared/ui/dialog";
import { element } from "../../../shared/ui/dom";
import type { createImportRenderer } from "./render";
import type { ImportDialogState } from "./types";
interface ImportWindowActions {
  close: (force?: boolean | Event) => boolean;
  copyPrompt: (state: ImportDialogState, replies: boolean | "format") => void;
  invalidate: (state: ImportDialogState) => void;
  prepare: (state: ImportDialogState) => void;
  updateActions: (state: ImportDialogState) => void;
  startEditor: (state: ImportDialogState, item?: ImportItem) => void;
  publish: (state: ImportDialogState, mode: "draft" | "publish") => void;
}
export function createImportWindow(
  renderer: Pick<
    ReturnType<typeof createImportRenderer>,
    "button" | "selectable"
  >,
  actions: ImportWindowActions,
) {
  const { button, selectable } = renderer;
  const {
    close,
    copyPrompt,
    invalidate,
    prepare,
    updateActions,
    startEditor,
    publish,
  } = actions;
  return (
    context: ReviewContext,
    options?: { t?: Translate },
  ): ImportDialogState => {
    const t: Translate = options?.t || ((key) => key);
    const viewOverlay = element(
      "div",
      "gl-review-overlay gl-review-import-overlay",
    );
    const dialog = element(
      "section",
      "gl-review-dialog gl-review-import-dialog",
    );
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "gl-review-import-title");
    const header = element("header", "gl-review-header");
    const titleBox = element("div");
    const title = element("h2", "", t("aiReviewImportTitle"));
    title.id = "gl-review-import-title";
    titleBox.appendChild(title);
    const viewSubject = element(
      "p",
      "gl-review-subject",
      context.projectPath + " !" + context.iid,
    );
    titleBox.appendChild(viewSubject);
    header.appendChild(titleBox);
    header.appendChild(button({ t }, "aiReviewClose", close));
    dialog.appendChild(header);
    const viewStatus = element("div", "gl-review-status");
    viewStatus.setAttribute("role", "status");
    dialog.appendChild(viewStatus);
    const viewWarning = element("div", "gl-review-warning");
    viewWarning.hidden = true;
    dialog.appendChild(viewWarning);
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
        t("aiReviewImportHelp"),
      ),
    );
    const promptActions = element("div", "gl-review-copy-prompt-actions");
    const viewCopyPrompt = button(
      { t },
      "aiReviewImportCopyPrompt",
      function () {
        copyPrompt(state, false);
      },
    );
    const viewCopyReplyPrompt = button(
      { t },
      "aiReviewImportCopyAllReplyPrompt",
      function () {
        copyPrompt(state, true);
      },
    );
    const viewCopyFormat = button(
      { t },
      "aiReviewImportCopyFormat",
      function () {
        copyPrompt(state, "format");
      },
    );
    promptActions.appendChild(viewCopyPrompt);
    promptActions.appendChild(viewCopyReplyPrompt);
    promptActions.appendChild(viewCopyFormat);
    const promptShortcuts = element("details", "gl-review-advanced");
    promptShortcuts.appendChild(element("summary", "", t("aiReviewAdvanced")));
    promptShortcuts.appendChild(promptActions);
    inputPane.appendChild(promptShortcuts);
    const viewPromptDetails = element("details", "gl-review-prompt-details");
    viewPromptDetails.hidden = true;
    const viewPromptSummary = element("summary", "", t("aiReviewImportPrompt"));
    viewPromptDetails.appendChild(viewPromptSummary);
    const viewPrompt = element("textarea", "gl-review-prompt");
    viewPrompt.readOnly = true;
    viewPrompt.spellcheck = false;
    viewPrompt.setAttribute("aria-label", t("aiReviewImportPrompt"));
    viewPromptDetails.appendChild(viewPrompt);
    inputPane.appendChild(viewPromptDetails);
    const inputLabel = element(
      "label",
      "gl-review-preview-label",
      t("aiReviewImportInput"),
    );
    inputLabel.htmlFor = "gl-review-import-input";
    inputPane.appendChild(inputLabel);
    const viewInput = element(
      "textarea",
      "gl-review-preview gl-review-import-input",
    );
    viewInput.id = "gl-review-import-input";
    viewInput.spellcheck = false;
    viewInput.placeholder = t("aiReviewImportInputHint");
    viewInput.setAttribute("aria-label", t("aiReviewImportInput"));
    viewInput.addEventListener("input", function () {
      invalidate(state);
    });
    inputPane.appendChild(viewInput);
    const viewValidate = button({ t }, "aiReviewImportValidate", function () {
      prepare(state);
    });
    inputPane.appendChild(viewValidate);
    columns.appendChild(inputPane);
    const previewPane = element(
      "section",
      "gl-review-picker gl-review-import-preview-pane",
    );
    previewPane.appendChild(
      element(
        "h3",
        "gl-review-import-preview-title",
        t("aiReviewImportPreview"),
      ),
    );
    const actions = element("div", "gl-review-tools");
    const viewSelect = button({ t }, "aiReviewImportSelectReady", function () {
      if (!state.plan || state.busy || state.editor) return;
      state.plan.items.forEach(function (item) {
        if (selectable(state, item)) state.selected.add(item.id);
      });
      updateActions(state);
    });
    const viewClear = button({ t }, "aiReviewClear", function () {
      if (!state.busy && !state.editor) {
        state.selected.clear();
        updateActions(state);
      }
    });
    const viewAdd = button({ t }, "aiReviewImportAddComment", function () {
      startEditor(state);
    });
    actions.appendChild(viewSelect);
    actions.appendChild(viewClear);
    actions.appendChild(viewAdd);
    previewPane.appendChild(actions);
    const viewCount = element("div", "gl-review-count");
    previewPane.appendChild(viewCount);
    const viewList = element("div", "gl-review-list");
    previewPane.appendChild(viewList);
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
        t("aiReviewImportSendHint"),
      ),
    );
    const viewReplyHint = element(
      "p",
      "gl-review-muted gl-review-import-send-hint",
      t("aiReviewImportReplyHint"),
    );
    viewReplyHint.hidden = true;
    footer.appendChild(viewReplyHint);
    const viewStop = button({ t }, "aiReviewImportStop", function () {
      if (state.busy !== "sending" || state.stopping) return;
      state.stopping = true;
      state.controller!.abort();
      updateActions(state);
    });
    footer.appendChild(viewStop);
    const viewDrafts = button({ t }, "aiReviewImportAddDrafts", function () {
      publish(state, "draft");
    });
    footer.appendChild(viewDrafts);
    const viewPublish = button(
      { t },
      "aiReviewImportPublish",
      function () {
        publish(state, "publish");
      },
      "gl-review-primary",
    );
    footer.appendChild(viewPublish);
    dialog.appendChild(footer);
    viewOverlay.appendChild(dialog);
    viewOverlay.addEventListener("click", function (event) {
      if (event.target === viewOverlay) close();
    });
    const viewOnKeydown = createDialogKeydown(dialog, close);

    const state: ImportDialogState = {
      context: context,
      t,
      previousFocus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      selected: new Set(),
      resolveSelected: new Set(),
      results: new Map(),
      plan: null,
      editor: null,
      manualId: 0,
      busy: "",
      run: 0,
      overlay: viewOverlay,
      dialog: dialog,
      subject: viewSubject,
      status: viewStatus,
      warning: viewWarning,
      copyPrompt: viewCopyPrompt,
      copyReplyPrompt: viewCopyReplyPrompt,
      copyFormat: viewCopyFormat,
      promptDetails: viewPromptDetails,
      promptSummary: viewPromptSummary,
      prompt: viewPrompt,
      input: viewInput,
      validate: viewValidate,
      select: viewSelect,
      clear: viewClear,
      add: viewAdd,
      count: viewCount,
      list: viewList,
      replyHint: viewReplyHint,
      stop: viewStop,
      drafts: viewDrafts,
      publish: viewPublish,
      onKeydown: viewOnKeydown,
      editorInput: null,
      saveEdit: null,
    };
    return state;
  };
}
