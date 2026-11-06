import { reportRuntimeError } from "../../shared/api/runtime";
import { WELCOME_PAGE } from "../../shared/config/extension";
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
      chrome.storage.sync.set(smartDefaults, reportRuntimeError);

      // Open welcome page
      chrome.tabs.create({ url: WELCOME_PAGE }, reportRuntimeError);
    }

    if (details.reason === "update") {
      const currentVersion = chrome.runtime.getManifest().version;
      chrome.storage.sync.set(
        {
          update_version: currentVersion,
          update_previous: details.previousVersion || "",
        },
        reportRuntimeError,
      );
      chrome.action.setBadgeText({ text: "NEW" }, reportRuntimeError);
      chrome.action.setBadgeBackgroundColor(
        { color: "#1f75cb" },
        reportRuntimeError,
      );
    }
  });
}
