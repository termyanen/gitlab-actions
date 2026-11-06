import type { Discussion, NotePosition } from "../../../entities/discussion";
import { getNotes } from "./discussions";
import {
  MAX_FILE_BYTES,
  MAX_FILE_REQUESTS,
  MAX_SNIPPET_CHARS,
  MAX_SNIPPET_LINES,
} from "./limits";
import { fence, inline, positionSummary, revision } from "./markdown";
import { anchorLine, validLine } from "./position";
import { addWarning, progress } from "./progress";
import { checkAbort, request } from "./transport";
import type {
  ExportOptions,
  FileReader,
  ReviewError,
  ReviewSnapshot,
} from "./types";
function excerpt(content: string, position: NotePosition, side: "old" | "new") {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const range = position.line_range || {};
  let first = anchorLine(position, side);
  let last = validLine(range.end && range.end[`${side}_line`]) || first;
  if (!first) {
    first = 1;
    last = 1;
  }
  if (first > lines.length)
    return {
      text: "",
      notice:
        "The referenced line is outside this revision. Locate the code by its original content; no guessed snippet was included.",
    };
  const start = Math.max(1, first - 8);
  const end = Math.min(
    lines.length,
    Math.max(first, last || first) + 8,
    start + MAX_SNIPPET_LINES - 1,
  );
  let body = lines
    .slice(start - 1, end)
    .map(function (line, index) {
      return start + index + ": " + line;
    })
    .join("\n");
  const notices = [];
  if (last && end < last)
    notices.push(
      "The requested multi-line range exceeds the context limit; remaining lines are omitted.",
    );
  if (body.length > MAX_SNIPPET_CHARS) {
    body = body.slice(0, MAX_SNIPPET_CHARS);
    notices.push("Snippet truncated at " + MAX_SNIPPET_CHARS + " characters.");
  }
  notices.push(
    "Excerpt only: lines " + start + "–" + end + " of " + lines.length + ".",
  );
  return { text: body, notice: notices.join(" ") };
}

export function fileLoader(
  snapshot: ReviewSnapshot,
  options: ExportOptions,
  _warnings: string[],
) {
  const cache = new Map<string, Promise<string>>();
  let requests = 0;
  return function (project: number | string, path: string, ref: string) {
    const key = JSON.stringify([project, path, ref]);
    if (cache.has(key)) return cache.get(key)!;
    const promise = (async function () {
      checkAbort(options.signal);
      if (++requests > MAX_FILE_REQUESTS)
        throw new Error(
          "Code-context request limit reached; fetch remaining files from the repository.",
        );
      const endpoint =
        "/projects/" +
        encodeURIComponent(project) +
        "/repository/files/" +
        encodeURIComponent(path);
      let content;
      try {
        content = (
          await request<string>(
            snapshot.context,
            endpoint + "/raw?ref=" + encodeURIComponent(ref),
            { signal: options.signal, raw: true, maxBytes: MAX_FILE_BYTES },
          )
        ).data;
      } catch (caught) {
        const error = caught as ReviewError;
        if (
          error.name === "AbortError" ||
          (error.httpStatus !== 404 && error.httpStatus !== 405)
        )
          throw error;
        // The JSON repository-files endpoint also works on older GitLab releases.
        const file = (
          await request<{ content: string; encoding: string; size?: number }>(
            snapshot.context,
            endpoint + "?ref=" + encodeURIComponent(ref),
            { signal: options.signal, maxBytes: MAX_FILE_BYTES * 2 },
          )
        ).data;
        if (
          !file ||
          typeof file.content !== "string" ||
          file.encoding !== "base64"
        )
          throw new Error("GitLab did not return readable file content.");
        if (
          Number(file.size) > MAX_FILE_BYTES ||
          file.content.length > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4096
        )
          throw new Error("File exceeds the 256 KiB context limit.");
        let binary;
        try {
          binary = atob(file.content.replace(/\s/g, ""));
        } catch {
          throw new Error("GitLab returned invalid encoded file content.");
        }
        if (binary.length > MAX_FILE_BYTES)
          throw new Error("File exceeds the 256 KiB context limit.");
        content = new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(binary, function (c) {
            return c.charCodeAt(0);
          }),
        );
      }
      if (content.indexOf("\u0000") >= 0)
        throw new Error("Binary file content is not included.");
      if (/^version https:\/\/git-lfs.github.com\/spec\/v1\r?\n/.test(content))
        throw new Error("Git LFS object contents are not included.");
      progress(options, { phase: "code", loaded: requests });
      return content;
    })();
    cache.set(key, promise);
    return promise;
  };
}

export async function codeContext(
  snapshot: ReviewSnapshot,
  discussion: Discussion,
  readFile: FileReader,
  options: ExportOptions,
  warnings: string[],
) {
  const entity = snapshot.entity || {};
  const notes = getNotes(discussion);
  const note = notes.find(function (item) {
    return item.original_position || item.position;
  });
  if (!note) return "";
  const position = note.original_position || note.position;
  if (
    !position ||
    (position.position_type &&
      position.position_type !== "text" &&
      position.position_type !== "file")
  ) {
    addWarning(
      warnings,
      "Image/binary diff context is not included for discussion " +
        discussion.id +
        ".",
    );
    return "Image or binary diff. Consult the original discussion for visual context.";
  }
  const source =
    entity.source_project_id ||
    entity.project_id ||
    snapshot.context.projectPath;
  const target =
    entity.target_project_id ||
    entity.project_id ||
    snapshot.context.projectPath;
  const head = entity.sha || (entity.diff_refs && entity.diff_refs.head_sha);
  const multipleAnchors =
    new Set(
      notes
        .map(function (item) {
          return positionSummary(item.original_position || item.position, head);
        })
        .filter(Boolean),
    ).size > 1;
  const newLine = anchorLine(position, "new");
  const oldLine = anchorLine(position, "old");
  const tasks: {
    label: string;
    path: string;
    ref: string;
    project: string | number;
    fallback: string | number;
    side: "old" | "new";
  }[] = [];
  if (
    position.new_path &&
    position.head_sha &&
    (newLine || position.position_type === "file")
  ) {
    tasks.push({
      label: "Comment anchor revision (new side)",
      path: position.new_path,
      ref: position.head_sha,
      project: source,
      fallback: target,
      side: "new",
    });
  }
  if (
    position.old_path &&
    (position.base_sha || position.start_sha) &&
    (oldLine || position.position_type === "file")
  ) {
    tasks.push({
      label: "Comment anchor revision (old side)",
      path: position.old_path,
      ref: (position.base_sha || position.start_sha)!,
      project: target,
      fallback: source,
      side: "old",
    });
  }
  if (!head) {
    addWarning(
      warnings,
      "Current source revision is unavailable for discussion " +
        discussion.id +
        "; locate the code in the checked-out repository.",
    );
  }
  if (
    !tasks.some(function (task) {
      return task.label.indexOf("Comment anchor") === 0;
    })
  ) {
    addWarning(
      warnings,
      "Original code position is incomplete for discussion " +
        discussion.id +
        "; original code could not be included.",
    );
  }
  const contexts = await Promise.all(
    tasks.map(async function (task) {
      checkAbort(options.signal);
      let actualProject = task.project;
      try {
        let content;
        try {
          content = await readFile(task.project, task.path, task.ref);
        } catch (caught) {
          const error = caught as ReviewError;
          if (
            error.name === "AbortError" ||
            task.fallback === task.project ||
            (error.httpStatus !== 404 && error.httpStatus !== 403)
          )
            throw error;
          content = await readFile(task.fallback, task.path, task.ref);
          actualProject = task.fallback;
        }
        const snippet = excerpt(content, position, task.side);
        if (
          !snippet.text ||
          snippet.notice.indexOf("truncated") >= 0 ||
          snippet.notice.indexOf("remaining lines") >= 0
        )
          addWarning(
            warnings,
            "Discussion " + discussion.id + ": " + snippet.notice,
          );
        let provenance = multipleAnchors
          ? " · " + inline(task.path) + " @ " + revision(task.ref, head)
          : "";
        if (source !== target || actualProject !== task.project)
          provenance += " · project " + inline(actualProject);
        return (
          "#### " +
          task.label +
          (task.side === "new" && task.ref === head ? " — source commit" : "") +
          provenance +
          "\n\n" +
          snippet.notice +
          (snippet.text ? "\n\n" + fence(snippet.text, "text") : "")
        );
      } catch (caught) {
        const error = caught as ReviewError;
        if (error.name === "AbortError") throw error;
        addWarning(
          warnings,
          "Code unavailable for " +
            task.path +
            " at " +
            task.ref +
            ": " +
            error.message,
        );
        return (
          "#### " + task.label + "\n\nCode unavailable; see limitations above."
        );
      }
    }),
  );
  return contexts.join("\n\n");
}
