const FOCUSABLE = "button, input, select, textarea, summary, a[href]";

/** The caller owns registration/removal of this document-level handler. */
export function createDialogKeydown(dialog: HTMLElement, close: () => unknown) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const targets = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter(
      (el) =>
        !("disabled" in el && el.disabled) &&
        !el.closest("[hidden], [inert]") &&
        el.tabIndex !== -1 &&
        el.getClientRects().length,
    );
    if (!targets.length) return;
    const first = targets[0];
    const last = targets[targets.length - 1];
    const outside = !dialog.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || outside)
    ) {
      event.preventDefault();
      first.focus();
    }
  };
}
