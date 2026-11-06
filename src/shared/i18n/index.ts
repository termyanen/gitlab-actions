export type Translate = (
  key: string,
  substitutions?: (string | number | null | undefined)[],
) => string;

export function msg(key: string) {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
}
