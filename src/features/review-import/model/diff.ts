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

function verifiedDiff(file: FileDiff) {
  const result: VerifiedDiff = {
    old_path: file.old_path,
    new_path: file.new_path,
  };
  try {
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

export async function loadDiffs(
  context: ReviewContext,
  options: ImportOptions,
  warnings: string[],
  targets: ImportComment[],
  refs: DiffRefs,
) {
  let files;
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
    if (!unsupported(error)) {
      warning(
        warnings,
        "File changes could not be fully loaded: " + error.message,
      );
      return [];
    }
    try {
      const legacy = (
        await request(context, endpoint(context) + "/changes", options).then(
          decodeResponse(readLegacyChanges),
        )
      ).data;
      files = changeFiles(legacy, context, refs);
      if (legacy.overflow)
        warning(
          warnings,
          "GitLab limited the file changes. Only comments on verified lines can be imported.",
        );
    } catch (fallbackErrorValue) {
      const fallbackError = toError(fallbackErrorValue);
      if (fallbackError.name === "AbortError") throw fallbackError;
      warning(
        warnings,
        "File changes could not be loaded: " + fallbackError.message,
      );
      return [];
    }
  }
  const result = files.map(verifiedDiff);
  const needed = targets.filter(function (target) {
    const matches = result.filter(function (file) {
      return (
        file[target.side === "old" ? "old_path" : "new_path"] === target.path
      );
    });
    return !matches.length || (matches.length === 1 && matches[0]?.error);
  });
  if (!needed.length) return result;
  try {
    // One lazy request per check, shared by all missing/truncated files.
    // /raw_diffs also has display limits; access_raw_diffs bypasses the
    // database-backed limit and remains available on older API v4 servers.
    const raw = (
      await request(
        context,
        endpoint(context) + "/changes?access_raw_diffs=true",
        Object.assign({}, options, { maxBytes: MAX_RAW_DIFF_BYTES }),
      ).then(decodeResponse(readLegacyChanges))
    ).data;
    const recoveredFiles = changeFiles(raw, context, refs);
    needed.forEach(function (target) {
      const matches = result.filter(function (file) {
        return (
          file[target.side === "old" ? "old_path" : "new_path"] === target.path
        );
      });
      if (matches.length > 1 || (matches.length === 1 && !matches[0]?.error))
        return;
      const candidates = recoveredFiles.filter(function (file) {
        return (
          file[target.side === "old" ? "old_path" : "new_path"] === target.path
        );
      });
      const candidate = candidates[0];
      const match = matches[0];
      if (
        candidates.length !== 1 ||
        !candidate ||
        (match && diffKey(candidate) !== diffKey(match))
      )
        return;
      const recovered = verifiedDiff(candidate);
      if (recovered.error) return;
      if (match) result[result.indexOf(match)] = recovered;
      else result.push(recovered);
    });
    if (
      raw.overflow ||
      needed.some(function (target) {
        const matches = result.filter(function (file) {
          return (
            file[target.side === "old" ? "old_path" : "new_path"] ===
            target.path
          );
        });
        return matches.length !== 1 || matches[0]?.error;
      })
    )
      warning(
        warnings,
        "GitLab limited the file changes. Only comments on verified lines can be imported.",
      );
  } catch (errorValue) {
    const error = toError(errorValue);
    if (error.name === "AbortError") throw error;
    const message =
      typeof chrome !== "undefined" &&
      chrome.i18n &&
      chrome.i18n.getMessage("aiReviewImportDiffRecoveryFailed", [
        error.message,
      ]);
    warning(
      warnings,
      message ||
        "Additional file changes could not be loaded: " + error.message,
    );
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
