export function registerInstallHandler() {
  chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === "install") {
      // Enable useful buttons by default for new users
      const smartDefaults = {
        btn_rebase_automerge: true,
        btn_pipeline_restart: true,
        btn_pipeline_cancel: true,
        btn_draft_toggle: true,
        btn_retry_failed: true,
        sound_enabled: true,
      };
      chrome.storage.sync.set(smartDefaults);

      // Open welcome page
      chrome.tabs.create({ url: "welcome.html" });
    }

    if (details.reason === "update") {
      const currentVersion = chrome.runtime.getManifest().version;
      chrome.storage.sync.set({
        update_version: currentVersion,
        update_previous: details.previousVersion || "",
      });
      chrome.action.setBadgeText({ text: "NEW" });
      chrome.action.setBadgeBackgroundColor({ color: "#1f75cb" });
    }
  });
}
