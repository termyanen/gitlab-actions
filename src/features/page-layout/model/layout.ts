import { msg } from "../../../shared/i18n";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { requireElement } from "../../../shared/ui/dom";
export function startPageLayout(scope: Lifecycle, enabled: boolean) {
  let button: HTMLButtonElement | undefined;
  scope.onCleanup(() => {
    button?.remove();
    document.body.classList.remove("gl-mr-ext-bars-collapsed");
  });
  // Collapse top bars (#63)
  // =========================================================================

  if (!enabled) return;
  let collapsed = sessionStorage.getItem("gl_mr_ext_bars_collapsed") === "1";

  function applyCollapse(state: boolean) {
    document.body.classList.toggle("gl-mr-ext-bars-collapsed", state);
    sessionStorage.setItem("gl_mr_ext_bars_collapsed", state ? "1" : "0");
  }

  function injectCollapseBtn() {
    if (document.querySelector(".gl-mr-ext-collapse-btn")) return;
    const btn = document.createElement("button");
    button = btn;
    btn.className = "gl-mr-ext-collapse-btn";
    btn.title = msg("collapseTopBars");
    btn.innerHTML =
      '<svg viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 10l5-5 5 5"/></svg>';
    btn.addEventListener("click", function () {
      collapsed = !collapsed;
      requireElement(btn.querySelector("svg")).style.transform = collapsed
        ? "rotate(180deg)"
        : "";
      applyCollapse(collapsed);
    });
    document.body.appendChild(btn);
    applyCollapse(collapsed);
  }

  if (document.readyState === "loading") {
    scope.listen(document, "DOMContentLoaded", injectCollapseBtn);
  } else {
    injectCollapseBtn();
  }
}
