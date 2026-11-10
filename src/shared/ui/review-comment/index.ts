import type { Translate } from "../../i18n";
import { element } from "../dom";

const PREVIEW_LINES = 5;
export function createCommentPreviews(
  t: Translate,
  choices: Map<string, boolean>,
  expandedByDefault: boolean,
  allButton: HTMLButtonElement,
) {
  const comments = new Map<
    Element,
    { key: string; box: HTMLElement; button: HTMLButtonElement }
  >();
  const expanded = (key: string) =>
    choices.get(key) ?? choices.get("*") ?? expandedByDefault;
  let expandAll = true;
  const updateAll = () => {
    const long = [...comments.values()].filter((item) => !item.button.hidden);
    allButton.disabled = !long.length;
    expandAll = !long.every((item) => expanded(item.key));
    allButton.textContent = t(
      "aiReview" + (!expandAll && long.length ? "CollapseAll" : "ExpandAll"),
    );
  };
  function update(body: Element) {
    const item = comments.get(body);
    if (!item) return;
    const open = expanded(item.key);
    item.box.dataset.expanded = String(open);
    item.button.textContent = t("aiReview" + (open ? "ShowLess" : "ShowFull"));
    item.button.setAttribute("aria-expanded", String(open));
    if (body.isConnected && body.clientWidth > 0)
      item.button.hidden =
        body.scrollHeight <=
        parseFloat(getComputedStyle(body).lineHeight) * PREVIEW_LINES + 1;
  }
  const refresh = () => {
    for (const body of comments.keys()) update(body);
    updateAll();
  };
  const toggleAll = () => {
    choices.clear();
    // Note keys are numeric IDs or prefixed IDs; * is the window-only default.
    choices.set("*", expandAll);
    refresh();
  };
  allButton.onclick = toggleAll;
  updateAll();
  const observer =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(refresh);
  return {
    render(text: string, key: string, className = "") {
      const box = element("div", "gl-review-comment");
      const body = element("pre", "gl-review-note-text " + className, text);
      const button = element(
        "button",
        "gl-review-button gl-review-comment-toggle",
      );
      button.type = "button";
      button.hidden = text.split("\n").length <= PREVIEW_LINES;
      comments.set(body, { key, box, button });
      button.onclick = () => {
        choices.set(key, !expanded(key));
        update(body);
        updateAll();
      };
      box.appendChild(body);
      box.appendChild(button);
      update(body);
      observer?.observe(body);
      return box;
    },
    refresh,
    dispose() {
      allButton.onclick = null;
      observer?.disconnect();
      comments.clear();
    },
  };
}
