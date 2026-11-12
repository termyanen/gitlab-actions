import { isRecord, isString } from "../../../shared/lib/validation";

// Bound native allocation/CPU before encoding or entering synchronous WASM.
export const MAX_MERGE_TEXT_LENGTH = 4_000_000;
export const MAX_MERGE_LINES = 60_000;
export interface TextMergeRequest {
  type: "merge-cherry-pick-text";
  parent: string;
  source: string;
  target: string;
}
export class TextMergeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function isTextMergeRequest(value: unknown): value is TextMergeRequest {
  return (
    isRecord(value) &&
    value.type === "merge-cherry-pick-text" &&
    isString(value.parent) &&
    isString(value.source) &&
    isString(value.target) &&
    value.parent.length + value.source.length + value.target.length <=
      MAX_MERGE_TEXT_LENGTH
  );
}
export function validateMergeText(
  parent: string,
  source: string,
  target: string,
) {
  if (parent.length + source.length + target.length > MAX_MERGE_TEXT_LENGTH)
    throw new TextMergeError("CP_WORK_LIMIT", "Text merge size limit exceeded");
  let lines = 3;
  for (const text of [parent, source, target]) {
    if (text.includes("\0"))
      throw new TextMergeError(
        "CP_BINARY",
        "Binary content cannot be merged as text",
      );
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10 && ++lines > MAX_MERGE_LINES)
        throw new TextMergeError(
          "CP_WORK_LIMIT",
          "Text merge line limit exceeded",
        );
    }
  }
}
