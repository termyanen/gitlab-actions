import { useEffect, useState } from "react";

/** Subscribe before reading so a late initial reply cannot undo a new choice. */
export function useWelcomeLanguage() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    language: unknown;
    loaded: boolean;
    failed: boolean;
  }>({ language: "auto", loaded: false, failed: false });
  useEffect(() => {
    let active = true;
    let changedSinceRead = false;
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (!active || area !== "sync" || !changes.language) return;
      changedSinceRead = true;
      const language: unknown = changes.language.newValue;
      setState({ language, loaded: true, failed: false });
    };
    chrome.storage.onChanged.addListener(changed);
    chrome.storage.sync.get(["language"], (saved: Record<string, unknown>) => {
      const failed = !!chrome.runtime.lastError;
      if (!active || changedSinceRead) return;
      setState({
        language: failed ? "auto" : saved.language,
        loaded: true,
        failed,
      });
    });
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
