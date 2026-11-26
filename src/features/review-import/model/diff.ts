import type { NotePosition } from "../../../entities/discussion";
import type {
  DiffRefs,
  FileDiff,
  LegacyChanges,
} from "../../../entities/merge-request";
import {
  readFileDiff,
  readLegacyChanges,
} from "../../../entities/merge-request";
import type { ReviewContext } from "../../../entities/review";
import { toError } from "../../../shared/lib/errors";
import { decodeResponse } from "../../../shared/lib/validation";
import { downloadedChanges, type DownloadedDiff } from "./download";
import { MAX_RAW_DIFF_BYTES } from "./limits";
import { paginate, request } from "./transport";
import type {
  DiffLine,
  ImportComment,
  ImportOptions,
  VerifiedDiff,
} from "./types";
import { positive, sameRefs, unsupported, warning } from "./utils";
import { endpoint } from "./validation";

function parseDiff(diff: string) {
  const old = new Map<number, DiffLine>();
  const fresh = new Map<number, DiffLine>();
  let hunk: {
    old: number;
    fresh: number;
    oldLeft: number;
    newLeft: number;
  } | null = null;
  let found = false;
  function finish() {
    if (hunk && (hunk.oldLeft !== 0 || hunk.newLeft !== 0))
      throw new Error("The file diff is incomplete.");
  }
  String(diff || "")
    .split("\n")
    .forEach(function (raw, index, lines) {
      const line = raw.replace(/\r$/, "");
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        finish();
        found = true;
        hunk = {
          old: Number(match[1]),
          fresh: Number(match[3]),
          oldLeft: match[2] === undefined ? 1 : Number(match[2]),
          newLeft: match[4] === undefined ? 1 : Number(match[4]),
        };
        return;
      }
      if (!hunk) return;
      if (
        line.indexOf("\\ No newline at end of file") === 0 ||
        (index === lines.length - 1 && line === "")
      )
        return;
      const prefix = line.charAt(0);
      if (prefix !== " " && prefix !== "+" && prefix !== "-")
        throw new Error("The file diff cannot be read safely.");
      const entry = {
        code: line.slice(1),
        old_line: prefix !== "+" ? hunk.old : null,
        new_line: prefix !== "-" ? hunk.fresh : null,
      };
      if (prefix !== "+") {
        if (!positive(hunk.old) || old.has(hunk.old))
          throw new Error("The old file lines are ambiguous.");
        old.set(hunk.old++, entry);
        hunk.oldLeft--;
      }
      if (prefix !== "-") {
        if (!positive(hunk.fresh) || fresh.has(hunk.fresh))
          throw new Error("The new file lines are ambiguous.");
        fresh.set(hunk.fresh++, entry);
        hunk.newLeft--;
      }
      if (hunk.oldLeft < 0 || hunk.newLeft < 0)
        throw new Error("The file diff contains inconsistent line numbers.");
    });
  finish();
  if (!found)
    throw new Error("No readable text changes were returned for this file.");
  return { old: old, new: fresh };
}

function diffKey(file: Pick<FileDiff, "old_path" | "new_path">) {
  return file &&
    typeof file.old_path === "string" &&
    typeof file.new_path === "string"
    ? JSON.stringify([file.old_path, file.new_path])
    : null;
}

function verifiedDiff(file: DownloadedDiff) {
  const result: VerifiedDiff = {
    old_path: file.old_path,
    new_path: file.new_path,
  };
  try {
    if (file.invalidUtf8)
      throw new Error("The downloaded diff for this file is not valid UTF-8.");
    if (file.too_large || typeof file.diff !== "string" || !file.diff)
      throw new Error(
        "GitLab did not provide the full text diff for this file.",
      );
    result.lines = parseDiff(file.diff);
  } catch (errorValue) {
    const error = toError(errorValue);
    result.error = error.message;
  }
  return result;
}

function changeFiles(
  data: LegacyChanges,
  context: ReviewContext,
  refs: DiffRefs,
) {
  if (
    !data ||
    !Array.isArray(data.changes) ||
    data.changes.some(function (file) {
      return diffKey(file) === null;
    })
  )
    throw new Error("GitLab did not return the file changes.");
  // Older /changes responses do not include diff_refs. Still verify any
  // revision/identity fields supplied, then re-read metadata after loading.
  if (
    (data.iid != null && String(data.iid) !== context.iid) ||
    (data.sha != null && data.sha !== refs.head_sha) ||
    (data.diff_refs != null && !sameRefs(data.diff_refs, refs))
  )
    throw new Error(
      "The merge request changed while the review was being checked. Check the review again.",
    );
  return data.changes;
}

export function targetKey(target: Record<string, unknown>) {
  return String(target.side) + ":" + String(target.path);
}

function verifyTargets(
  result: Map<string, VerifiedDiff | { error: string }>,
  targets: ImportComment[],
  files: DownloadedDiff[],
) {
  const parsed = new Map<DownloadedDiff, VerifiedDiff>();
  return targets.filter(function (target) {
    const key = targetKey(target);
    const matches = files.filter(function (file) {
      return (
        file[target.side === "old" ? "old_path" : "new_path"] === target.path
      );
    });
    if (!matches.length) return true;
    const known = result.get(key);
    const file = matches[0];
    if (
      !file ||
      matches.length !== 1 ||
      (known && (!("old_path" in known) || diffKey(known) !== diffKey(file)))
    ) {
      result.set(key, {
        error:
          "More than one file matches this path across the loaded merge request changes.",
      });
      return false;
    }
    const verified = parsed.get(file) ?? verifiedDiff(file);
    parsed.set(file, verified);
    result.set(key, verified);
    return !!verified.error;
  });
}

export async function loadDiffs(
  context: ReviewContext,
  options: ImportOptions,
  warnings: string[],
  targets: ImportComment[],
  refs: DiffRefs,
) {
  const result = new Map<string, VerifiedDiff | { error: string }>();
  let needed = Array.from(
    new Map(
      targets.map(function (target) {
        return [targetKey(target), target];
      }),
    ).values(),
  );
  function failedLookup(message: string) {
    warning(warnings, message);
    needed.forEach(function (target) {
      const key = targetKey(target);
      if (!result.has(key)) result.set(key, { error: message });
    });
    return result;
  }
  let files: FileDiff[];
  try {
    files = await paginate(
      context,
      endpoint(context) + "/diffs",
      options,
      diffKey,
      readFileDiff,
    );
  } catch (errorValue) {
    const error = toError(errorValue);
    if (error.name === "AbortError") throw error;
    if (error.httpStatus === 401 || error.httpStatus === 403)
      return failedLookup(error.message);
    files = [];
    if (unsupported(error)) {
      try {
        const legacy = (
          await request(context, endpoint(context) + "/changes", options).then(
            decodeResponse(readLegacyChanges),
          )
        ).data;
        files = changeFiles(legacy, context, refs);
      } catch (fallbackErrorValue) {
        const fallbackError = toError(fallbackErrorValue);
        if (fallbackError.name === "AbortError") throw fallbackError;
        return failedLookup(
          "File changes could not be loaded: " + fallbackError.message,
        );
      }
    }
  }
  needed = verifyTargets(result, needed, files);
  if (!needed.length) return result;

  const bounded = Object.assign({}, options, { maxBytes: MAX_RAW_DIFF_BYTES });
  let recoveryError: ReturnType<typeof toError> | undefined;
  try {
    const raw = (
      await request(
        context,
        endpoint(context) + "/changes?access_raw_diffs=true",
        bounded,
      ).then(decodeResponse(readLegacyChanges))
    ).data;
    needed = verifyTargets(result, needed, changeFiles(raw, context, refs));
  } catch (errorValue) {
    const error = toError(errorValue);
    if (error.name === "AbortError") throw error;
    if (error.errorCode !== "DIFF_TOO_LARGE" && !unsupported(error))
      return failedLookup(error.message);
    recoveryError = error;
  }
  if (needed.length) {
    try {
      const download = await request(context, ".diff", bounded);
      if (!(download.data instanceof Uint8Array))
        throw new Error("Invalid downloaded diff");
      needed = verifyTargets(
        result,
        needed,
        downloadedChanges(download.data, needed),
      );
    } catch (errorValue) {
      const error = toError(errorValue);
      if (error.name === "AbortError") throw error;
      if (
        recoveryError &&
        recoveryError.errorCode === "DIFF_TOO_LARGE" &&
        error.errorCode !== "DIFF_TOO_LARGE"
      )
        warning(warnings, recoveryError.message);
      recoveryError = error;
    }
    if (needed.length) {
      if (recoveryError) {
        let message =
          typeof chrome !== "undefined" &&
          chrome.i18n &&
          chrome.i18n.getMessage("aiReviewImportDiffRecoveryFailed", [
            recoveryError.message,
          ]);
        message =
          message ||
          "Additional file changes could not be loaded: " +
            recoveryError.message;
        if (
          recoveryError.errorCode !== "DIFF_TOO_LARGE" &&
          !unsupported(recoveryError)
        )
          return failedLookup(message);
        warning(warnings, message);
      } else
        warning(
          warnings,
          "GitLab did not provide a verifiable diff for every requested file. Only comments on verified lines can be imported.",
        );
    }
  }
  return result;
}

export function normalizedPosition(position?: NotePosition | null) {
  if (!position) return null;
  if (position.position_type !== "text") return { unsupported: true };
  return {
    position_type: "text",
    base_sha: position.base_sha,
    start_sha: position.start_sha,
    head_sha: position.head_sha,
    old_path: position.old_path,
    new_path: position.new_path,
    old_line: position.old_line == null ? null : Number(position.old_line),
    new_line: position.new_line == null ? null : Number(position.new_line),
    line_range: position.line_range || null,
  };
}

export function equalPosition(
  a?: NotePosition | null,
  b?: NotePosition | null,
) {
  return (
    JSON.stringify(normalizedPosition(a)) ===
    JSON.stringify(normalizedPosition(b))
  );
}
