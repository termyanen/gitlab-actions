import type {
  Commit,
  FileDiff,
  MergeRequest,
} from "../../../entities/merge-request";
import {
  isCommit,
  isFileDiff,
  isMergeRequest,
} from "../../../entities/merge-request";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab-api";
import { toError } from "../../../shared/lib/errors";
import {
  isRecord,
  isUnknownArray,
  type Decoder,
} from "../../../shared/lib/validation";
import { MAX_PAGES, PAGE_SIZE } from "./limits";
import { addWarning, progress } from "./progress";
import { apiUrl, checkAbort, header, request } from "./transport";
import type { ExportOptions, ReviewContext } from "./types";
export function reviewRefs(entity: MergeRequest, context: ReviewContext) {
  const refs = entity && entity.diff_refs;
  if (
    !entity ||
    String(entity.iid) !== String(context.iid) ||
    !refs ||
    !(["base_sha", "start_sha", "head_sha"] as const).every(function (key) {
      return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(refs[key] || "");
    }) ||
    (entity.sha && entity.sha !== refs.head_sha)
  ) {
    throw new Error(
      "The current MR revision is unavailable or still being prepared. Reload the MR and try again.",
    );
  }
  return {
    base_sha: refs.base_sha,
    start_sha: refs.start_sha,
    head_sha: refs.head_sha,
  };
}

// Commits and file diffs have different identities from discussion records.
// Probe an empty page when old GitLab/proxies omit pagination headers, even
// when a page is smaller than the requested size.
export async function reviewPages<T extends Commit | FileDiff>(
  context: ReviewContext,
  path: string,
  kind: "commits" | "diffs",
  options: ExportOptions,
  warnings: string[],
  read: Decoder<T>,
) {
  const items: T[] = [];
  const seen = new Set<string>();
  let page = 1;
  let complete = true;
  const endpoint = new URL(apiUrl(context, path));
  for (let count = 0; count < MAX_PAGES; count++) {
    checkAbort(options.signal);
    let fetched;
    try {
      fetched = await request(
        context,
        path + "?per_page=" + PAGE_SIZE + "&page=" + page,
        Object.assign({}, options, { maxBytes: 4 * 1024 * 1024 }),
      );
      if (!isUnknownArray(fetched.data))
        throw new Error("GitLab did not return a " + kind + " list.");
    } catch (caught) {
      const error = toError(caught);
      if (error.name === "AbortError" || count === 0) throw error;
      addWarning(
        warnings,
        "MR " +
          kind +
          " page " +
          page +
          " could not be loaded: " +
          error.message,
      );
      complete = false;
      break;
    }
    let added = 0;
    if (!isUnknownArray(fetched.data))
      throw new Error("GitLab did not return a list.");
    fetched.data.forEach(function (record) {
      let item: T;
      try {
        item = read(record);
      } catch {
        complete = false;
        addWarning(
          warnings,
          "GitLab returned an incomplete MR " +
            kind +
            " record; some context is missing.",
        );
        return;
      }
      const valid =
        kind === "commits"
          ? isCommit(item) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(item.id)
          : isFileDiff(item) && item.old_path && item.new_path;
      if (!valid) {
        complete = false;
        addWarning(
          warnings,
          "GitLab returned an incomplete MR " +
            kind +
            " record; some context is missing.",
        );
        return;
      }
      const key = isCommit(item)
        ? item.id
        : JSON.stringify([item.old_path, item.new_path]);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
        added++;
      }
    });
    progress(options, { phase: kind, page: page, loaded: items.length });
    const totalHeader = header(fetched.response, "X-Total");
    const total = /^\d+$/.test(totalHeader || "") ? Number(totalHeader) : null;
    const nextHeader = header(fetched.response, "X-Next-Page");
    const links = header(fetched.response, "Link");
    let next = null;
    if (nextHeader != null)
      next =
        nextHeader === ""
          ? 0
          : /^\d+$/.test(nextHeader)
            ? Number(nextHeader)
            : -1;
    else if (links) {
      const match = links.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i);
      if (!match?.[1]) next = 0;
      else {
        try {
          const url = new URL(match[1], endpoint);
          const nextPage = url.searchParams.get("page");
          next =
            url.origin === endpoint.origin &&
            url.pathname === endpoint.pathname &&
            /^\d+$/.test(nextPage || "")
              ? Number(nextPage)
              : -1;
        } catch {
          next = -1;
        }
      }
    }
    if (next === 0 || (!fetched.data.length && next === null)) {
      if (total != null && items.length < total) {
        complete = false;
        addWarning(
          warnings,
          "GitLab reports " +
            total +
            " MR " +
            kind +
            ", but only " +
            items.length +
            " were loaded.",
        );
      }
      break;
    }
    if (
      (next !== null && (!Number.isSafeInteger(next) || next <= page)) ||
      !added
    ) {
      complete = false;
      addWarning(
        warnings,
        "GitLab returned inconsistent MR " +
          kind +
          " pagination; later records may be missing.",
      );
      break;
    }
    page = next === null ? page + 1 : next;
    if (count === MAX_PAGES - 1) {
      complete = false;
      addWarning(
        warnings,
        "Stopped at the safety limit of " +
          MAX_PAGES +
          " MR " +
          kind +
          " pages; later records are missing.",
      );
    }
  }
  return { items: items, complete: complete };
}

export function completeReviewHunks(diff: string) {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  let oldLeft = 0;
  let newLeft = 0;
  let hunks = 0;
  for (const [i, line] of lines.entries()) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (match?.[1]) {
      if (oldLeft || newLeft) return false;
      hunks++;
      oldLeft = match[2] === undefined ? 1 : Number(match[2]);
      newLeft = match[4] === undefined ? 1 : Number(match[4]);
    } else if (hunks && line.indexOf("\\ No newline at end of file") !== 0) {
      if (!line && i === lines.length - 1) continue;
      if (line.charAt(0) === " ") {
        oldLeft--;
        newLeft--;
      } else if (line.charAt(0) === "-") oldLeft--;
      else if (line.charAt(0) === "+") newLeft--;
      else return false;
      if (oldLeft < 0 || newLeft < 0) return false;
    }
  }
  return hunks > 0 && oldLeft === 0 && newLeft === 0;
}

export async function loadReviewVersions(
  context: ReviewContext,
  options: ExportOptions = {},
) {
  options = Object.assign({}, options || {}, { fresh: true });
  if (!context || context.kind !== "merge_requests")
    throw new Error("MR versions are available only for merge requests.");
  const items: { id: string; headSha: string; createdAt: string }[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const path =
    "/projects/" +
    encodeURIComponent(context.projectPath) +
    "/merge_requests/" +
    encodeURIComponent(context.iid) +
    "/versions";
  for (let page = 1; page <= MAX_PAGES; page++) {
    checkAbort(options.signal);
    let fetched;
    try {
      fetched = await request(
        context,
        path + "?per_page=" + GITLAB_PAGE_SIZE + "&page=" + page,
        options,
      );
      if (!isUnknownArray(fetched.data))
        throw new Error("GitLab did not return MR versions.");
    } catch (caught) {
      const error = toError(caught);
      if (error.name === "AbortError") throw error;
      addWarning(
        warnings,
        "MR versions could not be fully loaded: " +
          error.message +
          " Select an available version, enter the reviewed SHA, or review the full MR.",
      );
      break;
    }
    let added = 0;
    if (!isUnknownArray(fetched.data))
      throw new Error("GitLab did not return MR versions.");
    fetched.data.forEach(function (version) {
      if (
        !isRecord(version) ||
        typeof version.head_commit_sha !== "string" ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(
          version.head_commit_sha || "",
        ) ||
        (typeof version.id !== "string" && typeof version.id !== "number")
      ) {
        addWarning(warnings, "An incomplete MR version was omitted.");
        return;
      }
      if (seen.has(String(version.id))) return;
      seen.add(String(version.id));
      added++;
      items.push({
        id: String(version.id),
        headSha: version.head_commit_sha,
        createdAt:
          typeof version.created_at === "string" ? version.created_at : "",
      });
    });
    const next = header(fetched.response, "X-Next-Page");
    if (next === "" || !fetched.data.length) break;
    if (!added || (next !== null && Number(next) !== page + 1)) {
      addWarning(warnings, "MR version pagination was incomplete.");
      break;
    }
    if (page === MAX_PAGES)
      addWarning(
        warnings,
        "MR version pagination limit reached; older versions may be missing.",
      );
  }
  return { items: items, warnings: warnings };
}

export function readReviewEntity(value: unknown) {
  if (!isMergeRequest(value))
    throw new Error(
      "The current MR revision is unavailable or still being prepared. Reload the MR and try again.",
    );
  return value;
}
