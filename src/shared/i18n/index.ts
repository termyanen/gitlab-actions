import { decoder, isString, objectOf, recordOf } from "../lib/validation";
export const readMessages = decoder(
  recordOf(objectOf<{ message: string }>({ message: isString })),
  "extension locale messages",
);
export type Translate = (
  key: string,
  substitutions?: (string | number | null | undefined)[],
) => string;

export function msg(key: string, substitutions?: (string | number)[]) {
  try {
    return chrome.i18n.getMessage(key, substitutions?.map(String)) || key;
  } catch {
    return key;
  }
}

// Chrome locale codes are persisted in settings and used as _locales paths.
export const LANGUAGES = [
  {
    code: "en",
    label: "English",
    english: "English",
  },
  {
    code: "ru",
    label: "Русский",
    english: "Russian",
  },
  {
    code: "de",
    label: "Deutsch",
    english: "German",
  },
  {
    code: "es",
    label: "Español",
    english: "Spanish",
  },
  {
    code: "fr",
    label: "Français",
    english: "French",
  },
  {
    code: "ja",
    label: "日本語",
    english: "Japanese",
  },
  {
    code: "zh_CN",
    label: "简体中文",
    english: "Simplified Chinese",
  },
  {
    code: "pt_BR",
    label: "Português (Brasil)",
    english: "Brazilian Portuguese",
  },
  {
    code: "it",
    label: "Italiano",
    english: "Italian",
  },
  {
    code: "pl",
    label: "Polski",
    english: "Polish",
  },
  {
    code: "ko",
    label: "한국어",
    english: "Korean",
  },
  {
    code: "tr",
    label: "Türkçe",
    english: "Turkish",
  },
  {
    code: "nl",
    label: "Nederlands",
    english: "Dutch",
  },
  {
    code: "id",
    label: "Bahasa Indonesia",
    english: "Indonesian",
  },
  {
    code: "vi",
    label: "Tiếng Việt",
    english: "Vietnamese",
  },
  {
    code: "cs",
    label: "Čeština",
    english: "Czech",
  },
  {
    code: "sv",
    label: "Svenska",
    english: "Swedish",
  },
  {
    code: "ro",
    label: "Română",
    english: "Romanian",
  },
  {
    code: "hi",
    label: "हिन्दी",
    english: "Hindi",
  },
  {
    code: "fi",
    label: "Suomi",
    english: "Finnish",
  },
  {
    code: "da",
    label: "Dansk",
    english: "Danish",
  },
  {
    code: "hu",
    label: "Magyar",
    english: "Hungarian",
  },
  {
    code: "el",
    label: "Ελληνικά",
    english: "Greek",
  },
  {
    code: "sk",
    label: "Slovenčina",
    english: "Slovak",
  },
  {
    code: "th",
    label: "ไทย",
    english: "Thai",
  },
  {
    code: "bg",
    label: "Български",
    english: "Bulgarian",
  },
  {
    code: "ms",
    label: "Bahasa Melayu",
    english: "Malay",
  },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export function isLanguage(value: unknown): value is LanguageCode | "auto" {
  return (
    value === "auto" || LANGUAGES.some((language) => language.code === value)
  );
}
