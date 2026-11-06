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
