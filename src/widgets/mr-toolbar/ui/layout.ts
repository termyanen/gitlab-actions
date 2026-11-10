import type { Translate } from "../../../shared/i18n";

// Separate passive MR information from controls without regrouping the user's
// ordered actions. All labels reuse the existing 27-language catalog.
export function createToolbarLayout(t: Translate) {
  const container = document.createElement("section");
  container.className = "gl-mr-actions-ext";
  container.setAttribute("aria-label", t("popupTitle"));
  const header = document.createElement("div");
  header.className = "gl-mr-actions-header";
  const title = document.createElement("strong");
  title.className = "gl-mr-actions-title";
  title.textContent = t("popupTitle");
  header.append(title);
  const status = document.createElement("div");
  status.className = "gl-mr-actions-status";
  status.hidden = true;

  function group(label: string, className: string) {
    const section = document.createElement("div");
    section.className = "gl-mr-actions-group";
    section.setAttribute("role", "group");
    section.setAttribute("aria-label", label);
    const heading = document.createElement("div");
    heading.className = "gl-mr-actions-group-label";
    heading.textContent = label;
    const buttons = document.createElement("div");
    buttons.className = className;
    section.append(heading, buttons);
    return { section, buttons };
  }
  const actions = group(t("mrActions"), "gl-mr-actions-buttons");
  const comments = group(t("quickComments"), "gl-mr-actions-comments");
  container.append(header, status, actions.section, comments.section);
  return {
    container,
    header,
    actions: actions.buttons,
    comments: comments.buttons,
    finish(hasTime: boolean) {
      actions.section.hidden = !actions.buttons.children.length;
      comments.section.hidden = !comments.buttons.children.length;
      if (
        actions.section.hidden &&
        comments.section.hidden &&
        !hasTime &&
        status.hidden
      )
        container.style.display = "none";
    },
  };
}

export function appendToolbarStatus(container: Element, badge: HTMLElement) {
  const status = container.querySelector<HTMLElement>(".gl-mr-actions-status");
  if (status) {
    status.hidden = false;
    status.append(badge);
  } else {
    // Also support an already-mounted toolbar during a delayed scan.
    container.prepend(badge);
  }
  if (container instanceof HTMLElement)
    container.style.removeProperty("display");
}

// GitLab's default (medium) size matches the surrounding Merge controls. btn-sm
// has higher-specificity host rules that shrink the target despite our fallback.
export function toolbarButtonClass(kind: string) {
  return "btn btn-default gl-button gl-mr-actions-button " + kind;
}
