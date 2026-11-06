import type { DiffRefs } from "../../../entities/merge-request";
import type { ImportOptions, ImportError } from "./types";

export function abortError() {
  const e = new Error("Import cancelled.");
  e.name = "AbortError";
  return e;
}

export function checkAbort(signal?: AbortSignal) {
  if (signal && signal.aborted) throw abortError();
}

export function progress(
  options: ImportOptions,
  value: Parameters<NonNullable<ImportOptions["onProgress"]>>[0],
) {
  if (options.onProgress) options.onProgress(value);
}

export function warning(warnings: string[], text: string) {
  if (warnings.indexOf(text) < 0) warnings.push(text);
}

export function replyNotice(changed: boolean) {
  const key = changed
    ? "aiReviewReplyVersionChanged"
    : "aiReviewReplyVerifyPushed";
  const fallback = changed
    ? "The MR version has changed. Replies remain linked to their discussions; verify their text against the pushed fixes. New findings from an old revision are blocked."
    : "These replies are linked to discussions, not a code revision. Before publishing, verify that the described fixes have been pushed to this MR.";
  return (
    (typeof chrome !== "undefined" &&
      chrome.i18n &&
      chrome.i18n.getMessage(key)) ||
    fallback
  );
}

export function clone<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sha(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
  );
}

export function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function unsupported(error: ImportError) {
  return error.httpStatus === 404 || error.httpStatus === 405;
}

export function sameRefs(a: DiffRefs, b: DiffRefs) {
  return (
    a.base_sha === b.base_sha &&
    a.start_sha === b.start_sha &&
    a.head_sha === b.head_sha
  );
}
