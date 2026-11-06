import { reportRuntimeError } from "../../shared/api/runtime";
import { handleJiraMessage } from "../../features/jira-actions";
import { createJobChains } from "../../features/job-chains";
import { generateStandup } from "../../features/standup";
import { SETTINGS_PAGE } from "../../shared/config/extension";
import { registerInstallHandler } from "../background/install";
import { isJiraMessage, parseBackgroundMessage } from "../background/messages";

const chains = createJobChains();
registerInstallHandler();
chrome.alarms.onAlarm.addListener(chains.wake);
chrome.runtime.onStartup.addListener(chains.startup);
chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const message = parseBackgroundMessage(raw);
  if (!message) {
    sendResponse({ _error: "Invalid extension message" });
    return;
  }
  if (isJiraMessage(message)) return handleJiraMessage(message, sendResponse);
  if (message.type === "generate-standup")
    return generateStandup(message, sender, sendResponse);
  if (message.type === "open-options") {
    chrome.tabs.create({ url: chrome.runtime.getURL(SETTINGS_PAGE) }, () => {
      const error = chrome.runtime.lastError;
      if (error) reportRuntimeError();
      sendResponse(error ? { _error: error.message } : { ok: true });
    });
    return true;
  }
  return chains.handleMessage(message, sender, sendResponse);
});
