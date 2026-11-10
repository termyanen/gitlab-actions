import { useCallback, useEffect, useState } from "react";
import { isLanguage, readMessages } from "../../i18n";

export type UiTranslate = (key: string, substitutions?: string[]) => string;
type LoadedMessages = {
  language: string;
  messages: Record<string, { message: string }> | undefined;
};

/** Locale requests belong to a page; a late reply never replaces a newer locale. */
export function useUiLanguage(value: unknown) {
  const selected = isLanguage(value) ? value : "auto";
  const [loaded, setLoaded] = useState<LoadedMessages>({
    language: "auto",
    messages: undefined,
  });
  const language =
    selected === "auto"
      ? chrome.i18n.getUILanguage?.() || "en"
      : selected.replace("_", "-");
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    if (selected === "auto") return;
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const response = await fetch(
          chrome.runtime.getURL(`_locales/${selected}/messages.json`),
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Locale response unavailable");
        const value: unknown = await response.json();
        const messages = readMessages(value);
        if (active) setLoaded({ language: selected, messages });
      } catch {
        if (active) setLoaded({ language: selected, messages: undefined });
      }
    }
    // The reader handles malformed, missing and aborted packaged resources.
    load().catch(() => {
      if (active) setLoaded({ language: selected, messages: undefined });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selected]);
  const messages =
    selected !== "auto" && loaded.language === selected
      ? loaded.messages
      : undefined;
  const t: UiTranslate = useCallback(
    (key, substitutions) => {
      const localized = messages?.[key]?.message;
      if (!localized) return chrome.i18n.getMessage(key, substitutions) || key;
      return localized.replace(
        /\$(\d+)/g,
        (token: string, number: string) =>
          substitutions?.[Number(number) - 1] ?? token,
      );
    },
    [messages],
  );
  return {
    t,
    language,
    loading: selected !== "auto" && loaded.language !== selected,
  };
}
