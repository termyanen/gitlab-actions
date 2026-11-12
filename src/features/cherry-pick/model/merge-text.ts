import { isRecord, isString } from "../../../shared/lib/validation";
import { TextMergeError, validateMergeText } from "./merge-contract";
export { TextMergeError } from "./merge-contract";

/** Only compute in the extension worker; never expose native resources to pages. */
export async function mergeText(
  parent: string,
  source: string,
  target: string,
): Promise<string> {
  validateMergeText(parent, source, target);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "merge-cherry-pick-text", parent, source, target },
      (response: unknown) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(
            new TextMergeError(
              "CP_MERGE_UNAVAILABLE",
              "Text merge worker unavailable",
            ),
          );
        } else if (isRecord(response) && isString(response.content)) {
          resolve(response.content);
        } else {
          const code =
            isRecord(response) &&
            isString(response.code) &&
            /^CP_[A-Z_]+$/.test(response.code)
              ? response.code
              : "CP_MERGE_FAILED";
          reject(new TextMergeError(code, "Text merge failed"));
        }
      },
    );
  });
}
