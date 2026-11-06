import { registerInstallHandler } from "../background/install";
import { parseBackgroundMessage, isJiraMessage } from "../background/messages";
import { createJobChains } from "../../features/job-chains";
import { handleJiraMessage } from "../../features/jira-actions";
import { generateStandup } from "../../features/standup";

const chains = createJobChains();
registerInstallHandler();
chrome.alarms.onAlarm.addListener(chains.wake);
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
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    return;
  }
  return chains.handleMessage(message, sender, sendResponse);
});
