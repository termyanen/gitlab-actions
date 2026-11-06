import { reportError } from "../../../shared/lib/errors";
import { msg } from "../../../shared/i18n";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import {
  createChildLifecycle,
  createLifecycle,
} from "../../../shared/lib/lifecycle";
const COPIED_FEEDBACK_DURATION_MS = 2000;

export function createStandupDialog(scope: Lifecycle = createLifecycle()) {
  const GITLAB_URL = window.location.origin;
  let active: Lifecycle | undefined;
  function openStandupModal() {
    if (scope.disposed) return;
    const existing = document.querySelector(".gl-standup-overlay");
    active?.dispose();
    if (existing) {
      existing.remove();
      return;
    }
    const session = createChildLifecycle(scope);
    active = session;

    const overlay = document.createElement("div");
    overlay.className = "gl-standup-overlay";
    session.onCleanup(() => overlay.remove());

    const modal = document.createElement("div");
    modal.className = "gl-standup-modal";

    const now = new Date();
    function pad2(n: number) {
      return n < 10 ? "0" + n : "" + n;
    }
    const todayIso =
      now.getFullYear() +
      "-" +
      pad2(now.getMonth() + 1) +
      "-" +
      pad2(now.getDate());

    modal.innerHTML =
      '<div class="gl-standup-header">' +
      "<span>" +
      escHtml(msg("standupTitle")) +
      "</span>" +
      '<div class="gl-standup-date-nav">' +
      '<button class="gl-standup-date-btn gl-standup-prev" title="Previous day">\u2039</button>' +
      '<input type="date" class="gl-standup-date" value="' +
      todayIso +
      '" max="' +
      todayIso +
      '">' +
      '<button class="gl-standup-date-btn gl-standup-next" title="Next day" disabled>\u203a</button>' +
      "</div>" +
      '<button class="gl-standup-close" title="Close">&times;</button>' +
      "</div>" +
      '<div class="gl-standup-body">' +
      '<div class="gl-standup-loading"><div class="gl-standup-spinner"></div></div>' +
      "</div>" +
      '<div class="gl-standup-actions" style="display:none">' +
      '<button class="gl-standup-copy">' +
      escHtml(msg("standupCopy")) +
      "</button>" +
      "</div>";

    overlay.appendChild(modal);

    const dateInput =
      modal.querySelector<HTMLInputElement>(".gl-standup-date")!;
    const prevBtn = modal.querySelector<HTMLButtonElement>(".gl-standup-prev")!;
    const nextBtn = modal.querySelector<HTMLButtonElement>(".gl-standup-next")!;
    const bodyEl = modal.querySelector<HTMLDivElement>(".gl-standup-body")!;
    const actionsEl = modal.querySelector<HTMLDivElement>(
      ".gl-standup-actions",
    )!;
    const copyBtn = modal.querySelector<HTMLButtonElement>(".gl-standup-copy")!;
    let currentText = "";
    let request = 0;

    function updateNavButtons() {
      nextBtn.disabled = dateInput.value >= todayIso;
    }

    function loadDate(dateStr: string) {
      const currentRequest = ++request;
      bodyEl.innerHTML =
        '<div class="gl-standup-loading"><div class="gl-standup-spinner"></div></div>';
      actionsEl.style.display = "none";
      chrome.runtime.sendMessage(
        { type: "generate-standup", gitlabUrl: GITLAB_URL, date: dateStr },
        session.once(function (resp: { text?: string; _error?: string }) {
          const lastErr = chrome.runtime.lastError;
          if (currentRequest !== request) return;
          if (lastErr || !resp || resp._error) {
            const errText =
              resp && resp._error
                ? resp._error
                : lastErr && lastErr.message
                  ? lastErr.message
                  : "No response";
            bodyEl.innerHTML =
              '<div class="gl-standup-error">' + escHtml(errText) + "</div>";
            return;
          }
          currentText = resp.text || "";
          bodyEl.innerHTML =
            '<pre class="gl-standup-content">' +
            escHtml(currentText) +
            "</pre>";
          actionsEl.style.display = "";
        }),
      );
    }

    function shiftDate(days: number) {
      const d = new Date(dateInput.value + "T00:00:00");
      d.setDate(d.getDate() + days);
      const iso =
        d.getFullYear() +
        "-" +
        pad2(d.getMonth() + 1) +
        "-" +
        pad2(d.getDate());
      if (iso > todayIso) return;
      dateInput.value = iso;
      updateNavButtons();
      loadDate(iso);
    }

    dateInput.addEventListener("change", function () {
      updateNavButtons();
      loadDate(dateInput.value);
    });
    prevBtn.addEventListener("click", function () {
      shiftDate(-1);
    });
    nextBtn.addEventListener("click", function () {
      shiftDate(1);
    });

    copyBtn.addEventListener("click", function () {
      navigator.clipboard
        .writeText(currentText)
        .then(
          session.once(function () {
            const orig = copyBtn.textContent;
            copyBtn.textContent = "\u2713 " + msg("standupCopied");
            session.timeout(function () {
              copyBtn.textContent = orig;
            }, COPIED_FEEDBACK_DURATION_MS);
          }),
        )
        .catch(reportError);
    });

    function closeStandup() {
      session.dispose();
    }
    modal
      .querySelector<HTMLButtonElement>(".gl-standup-close")!
      .addEventListener("click", closeStandup);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeStandup();
    });
    session.listen(document, "keydown", function onEsc(e) {
      if (e.key === "Escape" && document.querySelector(".gl-standup-overlay")) {
        closeStandup();
      }
    });

    document.body.appendChild(overlay);
    loadDate(todayIso);
  }
  return { open: openStandupModal };
}
