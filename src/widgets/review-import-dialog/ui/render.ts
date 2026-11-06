import type { ImportItem } from "../../../features/review-import";
import { element } from "../../../shared/ui/dom";
import type { ImportDialogState } from "./types";
const outcomeKeys: Record<string, string> = {
  ready: "aiReviewImportReady",
  invalid: "aiReviewImportInvalid",
  duplicate: "aiReviewImportDuplicate",
  published: "aiReviewImportPublished",
  draft: "aiReviewImportDraft",
  failed: "aiReviewImportFailed",
  unknown: "aiReviewImportUnknown",
  skipped: "aiReviewImportSkipped",
};
export function createImportRenderer(actions: {
  startEditor: (state: ImportDialogState, item?: ImportItem) => void;
  updateActions: (state: ImportDialogState) => void;
  saveEditor: (state: ImportDialogState) => void;
  cancelEditor: (state: ImportDialogState) => void;
}) {
  const { startEditor, updateActions, saveEditor, cancelEditor } = actions;

  function button(
    state: ImportDialogState,
    key: string,
    handler: (event: MouseEvent) => void,
    className?: string,
  ) {
    const el = element(
      "button",
      "gl-review-button" + (className ? " " + className : ""),
      state.t(key),
    );
    el.type = "button";
    el.setAttribute("data-import-action", key);
    el.addEventListener("click", handler);
    return el;
  }

  function selectable(state: ImportDialogState, item: ImportItem) {
    const result = state.results.get(item.id);
    return (
      item.status === "ready" &&
      (!result || result.status === "failed" || result.status === "skipped")
    );
  }

  function editable(state: ImportDialogState, item: ImportItem) {
    const result = state.results.get(item.id) || item;
    return (
      item.editable !== false &&
      ["ready", "invalid", "failed", "skipped"].indexOf(result.status) !== -1
    );
  }

  function canResolve(item: ImportItem) {
    return (
      item.type === "reply" &&
      item.replyTo &&
      item.replyTo.resolvable === true &&
      item.replyTo.resolved === false
    );
  }

  function editButton(state: ImportDialogState, item: ImportItem) {
    const el = button(
      state,
      "aiReviewImportEdit",
      function () {
        startEditor(state, item);
      },
      "gl-review-icon-button gl-review-import-edit",
    );
    el.dataset.importEdit = item.id;
    el.setAttribute("title", state.t("aiReviewImportEdit"));
    el.setAttribute("aria-label", state.t("aiReviewImportEdit"));
    const icon = element("span", "gl-review-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15v5Z"/></svg>';
    el.replaceChildren(icon);
    return el;
  }

  function safeLink(state: ImportDialogState, href?: string) {
    try {
      const url = new URL(href!, state.context.webUrl);
      return /^https?:$/.test(url.protocol) &&
        url.origin === state.context.origin
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  function replyContext(state: ImportDialogState, item: ImportItem) {
    const original = item.replyTo;
    if (!original) return null;
    const box = element("section", "gl-review-import-original");
    const heading = element("div", "gl-review-import-original-heading");
    heading.appendChild(
      element("strong", "", state.t("aiReviewImportOriginalComment")),
    );
    const author = original.author;
    const name =
      typeof author === "string"
        ? author
        : author && (author.username ? "@" + author.username : author.name);
    if (name) heading.appendChild(element("span", "gl-review-muted", name));
    if (typeof original.resolved === "boolean")
      heading.appendChild(
        element(
          "span",
          "gl-review-muted",
          state.t(
            original.resolved ? "aiReviewResolved" : "aiReviewUnresolved",
          ),
        ),
      );
    const href = original.url && safeLink(state, original.url);
    if (href) {
      const link = element("a", "gl-review-link", "↗");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", state.t("aiReviewLink"));
      heading.appendChild(link);
    }
    box.appendChild(heading);
    if (original.path)
      box.appendChild(
        element(
          "p",
          "gl-review-path gl-review-import-original-path",
          original.path + (original.line ? ":" + original.line : ""),
        ),
      );
    box.appendChild(
      element(
        "pre",
        "gl-review-note-text",
        typeof original.body === "string" ? original.body : "",
      ),
    );
    return box;
  }

  function render(state: ImportDialogState) {
    state.editorInput = null;
    state.saveEdit = null;
    state.list.replaceChildren();
    if (!state.plan) {
      state.list.appendChild(
        element("p", "gl-review-muted", state.t("aiReviewImportEmpty")),
      );
      updateActions(state);
      return;
    }
    state.plan.items.forEach(function (item) {
      const result = state.results.get(item.id) || item;
      const card = element("article", "gl-review-thread gl-review-import-item");
      card.setAttribute("data-import-result", result.status);
      const heading = element("div", "gl-review-thread-heading");
      const label = element("label", "gl-review-thread-label");
      const check = element("input");
      check.type = "checkbox";
      check.dataset.importItem = item.id;
      check.setAttribute(
        "aria-label",
        item.type === "reply"
          ? state.t("aiReviewImportReply") +
              (item.note_id ? " #" + item.note_id : "")
          : item.path
            ? item.path + ":" + item.line
            : state.t("aiReviewGeneral"),
      );
      check.addEventListener("change", function () {
        if (state.busy || state.editor || !selectable(state, item)) return;
        if (check.checked) state.selected.add(item.id);
        else state.selected.delete(item.id);
        updateActions(state);
      });
      label.appendChild(check);
      label.appendChild(
        element(
          "span",
          "gl-review-badge",
          state.t(outcomeKeys[result.status] || "aiReviewImportInvalid"),
        ),
      );
      if (item.type === "reply") {
        label.appendChild(
          element("span", "gl-review-muted", state.t("aiReviewImportReply")),
        );
        if (item.note_id)
          label.appendChild(
            element("span", "gl-review-path", "#" + item.note_id),
          );
      } else if (item.path) {
        label.appendChild(element("span", "gl-review-path", item.path));
        label.appendChild(
          element(
            "span",
            "gl-review-muted",
            state.t(
              item.side === "old"
                ? "aiReviewImportOldLine"
                : "aiReviewImportNewLine",
              [item.line],
            ),
          ),
        );
      } else
        label.appendChild(
          element("span", "gl-review-muted", state.t("aiReviewGeneral")),
        );
      heading.appendChild(label);
      if (editable(state, item)) heading.appendChild(editButton(state, item));
      const href =
        (result.url || item.existingUrl) &&
        safeLink(state, result.url || item.existingUrl);
      if (href) {
        const link = element("a", "gl-review-link", "↗");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", state.t("aiReviewLink"));
        heading.appendChild(link);
      }
      card.appendChild(heading);
      const body = element("div", "gl-review-note");
      if (item.type === "reply") {
        const original = replyContext(state, item);
        if (original) body.appendChild(original);
        body.appendChild(
          element(
            "strong",
            "gl-review-import-reply-label",
            state.t("aiReviewImportReplyText"),
          ),
        );
      }
      if (typeof item.code === "string")
        body.appendChild(element("pre", "gl-review-import-code", item.code));
      if (state.editor && state.editor.id === item.id && !state.editor.add)
        body.appendChild(renderEditor(state));
      else
        body.appendChild(
          element(
            "pre",
            "gl-review-note-text gl-review-import-text",
            typeof item.body === "string" ? item.body : "",
          ),
        );
      if (canResolve(item)) {
        const resolveLabel = element(
          "label",
          "gl-review-description-toggle gl-review-import-resolve",
        );
        const resolveCheck = element("input");
        resolveCheck.type = "checkbox";
        resolveCheck.dataset.importResolve = item.id;
        resolveCheck.addEventListener("change", function () {
          if (
            state.busy ||
            state.editor ||
            !selectable(state, item) ||
            !state.selected.has(item.id)
          )
            return;
          if (resolveCheck.checked) state.resolveSelected.add(item.id);
          else state.resolveSelected.delete(item.id);
          updateActions(state);
        });
        resolveLabel.appendChild(resolveCheck);
        resolveLabel.appendChild(
          element("span", "", state.t("aiReviewImportResolveAfterReply")),
        );
        body.appendChild(resolveLabel);
      }
      if (result.message)
        body.appendChild(
          element(
            "p",
            "gl-review-import-message gl-review-muted",
            result.message,
          ),
        );
      if (result.resolveStatus) {
        const resolveKey =
          result.resolveStatus === "resolved"
            ? "aiReviewImportResolveSuccess"
            : result.resolveStatus === "unknown"
              ? "aiReviewImportResolveUnknown"
              : "aiReviewImportResolveFailed";
        body.appendChild(
          element(
            "p",
            "gl-review-import-message " +
              (result.resolveStatus === "resolved"
                ? "gl-review-muted"
                : "gl-review-error"),
            state.t(resolveKey),
          ),
        );
        if (result.resolveMessage)
          body.appendChild(
            element(
              "p",
              "gl-review-import-message gl-review-muted",
              result.resolveMessage,
            ),
          );
      }
      if (result.status === "unknown")
        body.appendChild(
          element(
            "p",
            "gl-review-import-message gl-review-error",
            state.t("aiReviewImportUnsafeRetry"),
          ),
        );
      card.appendChild(body);
      state.list.appendChild(card);
    });
    if (state.editor && state.editor.add) {
      const newCard = element(
        "article",
        "gl-review-thread gl-review-import-item gl-review-import-new",
      );
      newCard.appendChild(
        element(
          "div",
          "gl-review-thread-heading",
          state.t("aiReviewImportAddComment") +
            " · " +
            state.t("aiReviewGeneral"),
        ),
      );
      const newBody = element("div", "gl-review-note");
      newBody.appendChild(renderEditor(state));
      newCard.appendChild(newBody);
      state.list.appendChild(newCard);
    }
    updateActions(state);
  }

  function renderEditor(state: ImportDialogState) {
    const editor = state.editor!;
    const form = element("div", "gl-review-import-editor");
    const label = element(
      "label",
      "gl-review-import-editor-label",
      state.t("aiReviewImportEditorLabel"),
    );
    label.htmlFor = "gl-review-import-editor-input";
    form.appendChild(label);
    const input = (state.editorInput = element(
      "textarea",
      "gl-review-import-editor-input",
    ));
    input.id = "gl-review-import-editor-input";
    input.value = editor.body;
    input.setAttribute("aria-label", state.t("aiReviewImportEditorLabel"));
    input.addEventListener("input", function () {
      if (state.editor === editor && !state.busy) editor.body = input.value;
    });
    form.appendChild(input);
    form.appendChild(
      element(
        "p",
        "gl-review-muted gl-review-import-edit-hint",
        state.t("aiReviewImportEditingHint"),
      ),
    );
    if (editor.error) {
      const error = element(
        "p",
        "gl-review-error gl-review-import-edit-hint",
        editor.error,
      );
      error.setAttribute("role", "alert");
      form.appendChild(error);
    }
    const actions = element("div", "gl-review-import-editor-actions");
    state.saveEdit = button(state, "aiReviewImportSaveEdit", function () {
      saveEditor(state);
    });
    actions.appendChild(state.saveEdit);
    actions.appendChild(
      button(state, "aiReviewImportCancelEdit", function () {
        cancelEditor(state);
      }),
    );
    form.appendChild(actions);
    return form;
  }
  return { button, selectable, editable, canResolve, render, renderEditor };
}
