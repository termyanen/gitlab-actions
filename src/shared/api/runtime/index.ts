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
  listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0],
) {
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
