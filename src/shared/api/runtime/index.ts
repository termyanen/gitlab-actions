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
