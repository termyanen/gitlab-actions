import type { FileDiff } from "../../../entities/merge-request";
import type { ImportComment } from "./types";
export interface DownloadedDiff extends FileDiff {
  invalidUtf8?: boolean;
}
// Git quotes unusual paths and may encode UTF-8 bytes as octal escapes.
function patchPath(token: string, prefix: string) {
  if (token.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\(?:["\\]|[0-3][0-7]{2}))*"$/.test(token)) return null;
    try {
      token = decodeURIComponent(
        token
          .slice(1, -1)
          .replace(/%/g, "%25")
          .replace(
            /\\(["\\]|[0-3][0-7]{2})/g,
            function (_: string, escape: string) {
              return escape.length === 1
                ? escape
                : "%" + parseInt(escape, 8).toString(16).padStart(2, "0");
            },
          ),
      );
    } catch {
      return null;
    }
  }
  return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

// Git's file and hunk delimiters are ASCII even when the files use different encodings.
function findPatchLine(bytes: Uint8Array, start: number, prefix: string) {
  const firstByte = prefix.charCodeAt(0);
  for (
    let pos = bytes.indexOf(firstByte, start);
    pos !== -1;
    pos = bytes.indexOf(firstByte, pos + 1)
  ) {
    if (pos && bytes[pos - 1] !== 10) continue;
    let i = 1;
    while (i < prefix.length && bytes[pos + i] === prefix.charCodeAt(i)) i++;
    if (i === prefix.length) return pos;
  }
  return bytes.length;
}

export function downloadedChanges(patch: Uint8Array, targets: ImportComment[]) {
  const marker = "diff --git ";
  if (
    !patch.length ||
    findPatchLine(patch, 0, marker) !== 0 ||
    patch[patch.length - 1] !== 10
  )
    throw new Error("GitLab did not return a complete MR diff.");
  const paths = new Set(
    targets.map(function (target) {
      return target.path;
    }),
  );
  const files: DownloadedDiff[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let start = 0;
  while (start < patch.length) {
    const end = findPatchLine(patch, start + marker.length, marker);
    const section = patch.subarray(start + marker.length, end);
    start = end;
    const hunk = findPatchLine(section, 0, "@@ ");
    let header;
    try {
      header = decoder.decode(
        hunk === section.length ? section : section.subarray(0, hunk - 1),
      );
    } catch {
      continue;
    }
    const markers = header.match(/\n--- ([^\n]+)\n\+\+\+ ([^\n]+)$/);
    if (!markers) {
      // A pure copy/rename has no hunk but its paths still count when checking uniqueness.
      const rename = header.match(
        /\n(?:rename|copy) from ([^\n]+)\n(?:rename|copy) to ([^\n]+)\n/,
      );
      if (rename?.[1] && rename[2]) {
        const from = patchPath(rename[1], ""),
          to = patchPath(rename[2], "");
        if (from && to && (paths.has(from) || paths.has(to)))
          files.push({ old_path: from, new_path: to, diff: "" });
      }
      continue;
    }
    if (!markers[1] || !markers[2]) continue;
    const left = markers[1].replace(/\t$/, ""),
      right = markers[2].replace(/\t$/, "");
    const oldToken =
      left === "/dev/null" ? right.replace(/^("?)b\//, "$1a/") : left;
    const newToken =
      right === "/dev/null" ? left.replace(/^("?)a\//, "$1b/") : right;
    if (header.slice(0, header.indexOf("\n")) !== oldToken + " " + newToken)
      continue;
    const oldPath = patchPath(oldToken, "a/"),
      newPath = patchPath(newToken, "b/");
    if (oldPath && newPath && (paths.has(oldPath) || paths.has(newPath))) {
      const file: DownloadedDiff = { old_path: oldPath, new_path: newPath };
      try {
        file.diff = decoder.decode(section.subarray(hunk));
      } catch {
        file.invalidUtf8 = true;
      }
      files.push(file);
    }
  }
  return files;
}
