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
