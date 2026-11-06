// Only this small bootstrap runs on arbitrary HTTPS pages.
if (document.querySelector('meta[content="GitLab"], body[data-page]')) {
  document.documentElement.classList.add("gl-actions-host");
  void import(chrome.runtime.getURL("modules/content.js")).catch((error) =>
    console.error("[GitLab Actions] Could not load content modules", error),
  );
}
