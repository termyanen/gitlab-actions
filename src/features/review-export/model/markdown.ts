import type { NotePosition } from "../../../entities/discussion";
import { anchorLine, validLine } from "./position";
export function fence(input: unknown, language?: string) {
  const text = String(input == null ? "" : input);
  const runs = text.match(/`+/g) || [];
  const length = runs.reduce(function (max, run) {
    return Math.max(max, run.length + 1);
  }, 3);
  const marker = "`".repeat(length);
  return marker + (language || "") + "\n" + text + "\n" + marker;
}

export function inline(value: unknown) {
  const text = String(value == null ? "" : value).replace(/[\r\n]+/g, " ");
  const length = (text.match(/`+/g) || []).reduce(function (max, run) {
    return Math.max(max, run.length + 1);
  }, 1);
  const marker = "`".repeat(length);
  return marker + (/^`|`$/.test(text) ? " " + text + " " : text) + marker;
}

export function link(label: string, url: string) {
  return (
    "[" +
    label +
    "](" +
    String(url).replace(/[\s()<>\\]/g, function (ch) {
      return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
    }) +
    ")"
  );
}

export function revision(ref: string | undefined, head?: string) {
  return ref && ref === head
    ? "source commit"
    : ref
      ? inline(ref)
      : "unknown revision";
}

export function positionSummary(
  position: NotePosition | null | undefined,
  head?: string,
) {
  if (!position) return "";
  const locations = [];
  (["new", "old"] as const).forEach(function (side) {
    const path = position[`${side}_path`];
    if (!path) return;
    const first = anchorLine(position, side);
    const range = position.line_range || {};
    const last = validLine(range.end && range.end[`${side}_line`]);
    if (!first && anchorLine(position, side === "new" ? "old" : "new")) return;
    const ref =
      side === "new"
        ? position.head_sha
        : position.base_sha || position.start_sha;
    locations.push(
      inline(
        path +
          (first
            ? ":" + first + (last && last !== first ? "–" + last : "")
            : ""),
      ) +
        " (" +
        side +
        " side, " +
        revision(ref, head) +
        ")",
    );
  });
  if (position.position_type === "image") {
    locations.push(
      "image" +
        (position.x != null && position.y != null
          ? " at " + inline(position.x + "," + position.y)
          : "") +
        (position.width != null && position.height != null
          ? " of " + inline(position.width + "×" + position.height)
          : ""),
    );
  } else if (position.position_type === "file") locations.push("whole file");
  return locations.join("; ");
}

export function attachmentLinks(
  body: string | null | undefined,
  attachment: unknown,
  projectUrl: string,
  origin: string,
) {
  const links = [];
  const matches =
    String(body || "").match(/(?:^|[\s("'=])\/uploads\/[^\s)"'<>]+/g) || [];
  matches.forEach(function (match) {
    links.push(match.replace(/^[\s("'=]/, ""));
  });
  if (typeof attachment === "string") links.push(attachment);
  const resolved = links
    .map(function (link) {
      try {
        const url = new URL(
          link.indexOf("/uploads/") === 0 ? projectUrl + link : link,
          origin,
        );
        return /^https?:$/.test(url.protocol) ? url.href : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return Array.from(new Set(resolved));
}
