import { reportError } from "../../lib/errors";

/** Chrome exposes callback API errors only during the callback invocation. */
export function reportRuntimeError(): void {
  const error = chrome.runtime.lastError;
  if (error)
    reportError(new Error(error.message || "Chrome API request failed"));
}

export function isExtensionValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

export function addRuntimeListener(
  listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | undefined,
) {
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
