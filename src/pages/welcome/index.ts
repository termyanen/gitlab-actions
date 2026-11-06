export function startWelcome() {
  document
    .getElementById("openSettings")!
    .addEventListener("click", function (e) {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    });

  // i18n: localize all elements with data-i18n attribute
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    const key = el.getAttribute("data-i18n");
    const msg = chrome.i18n.getMessage(key || "");
    if (msg) el.textContent = msg;
  });
}
