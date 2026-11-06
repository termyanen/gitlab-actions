import { reportRuntimeError } from "../../shared/api/runtime";
import { SETTINGS_PAGE } from "../../shared/config/extension";
export function startWelcome() {
  document
    .getElementById("openSettings")!
    .addEventListener("click", function (e) {
      e.preventDefault();
      chrome.tabs.create(
        { url: chrome.runtime.getURL(SETTINGS_PAGE) },
        reportRuntimeError,
      );
    });

  // i18n: localize all elements with data-i18n attribute
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    const key = el.getAttribute("data-i18n");
    const msg = chrome.i18n.getMessage(key || "");
    if (msg) el.textContent = msg;
  });
}
