import type { ReviewContext } from "../../../entities/review";
import type { MergeRequest } from "../../../entities/merge-request";
import type { ImportComment, ReviewInput } from "./types";
import { sha, positive } from "./utils";

export function currentOrigin() {
  const loc =
    window.location || (typeof location !== "undefined" ? location : null);
  return loc && loc.origin;
}

export function assertCurrentPage(context: ReviewContext) {
  const loc =
    window.location || (typeof location !== "undefined" ? location : null);
  const expected = new URL(context.webUrl).pathname;
  if (
    !loc ||
    loc.origin !== context.origin ||
    (loc.pathname &&
      loc.pathname !== expected &&
      loc.pathname.indexOf(expected + "/") !== 0)
  )
    throw new Error(
      "The open merge request has changed. Reopen the import on the correct page.",
    );
}

export function safeContext(input: ReviewContext) {
  if (
    !input ||
    input.kind !== "merge_requests" ||
    !/^\d+$/.test(String(input.iid)) ||
    Number(input.iid) < 1
  )
    throw new Error("Open a merge request to import review comments.");
  const web = new URL(input.webUrl);
  const api = new URL(input.apiRoot);
  if (
    !/^https?:$/.test(web.protocol) ||
    web.origin !== currentOrigin() ||
    api.origin !== web.origin ||
    input.origin !== web.origin ||
    web.username ||
    web.password ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    web.search ||
    web.hash
  )
    throw new Error(
      "Review comments can only be imported into the current GitLab site.",
    );
  const root = api.pathname.match(/^(.*)\/api\/v4\/?$/);
  if (!root) throw new Error("The GitLab API address is invalid.");
  const path = web.pathname.slice(root[1].length);
  if (web.pathname.indexOf(root[1] + "/") !== 0)
    throw new Error(
      "The merge request address does not match this GitLab site.",
    );
  const parsed = path.match(/^\/(.+)\/(?:-\/)?merge_requests\/(\d+)\/?$/);
  if (
    !parsed ||
    decodeURIComponent(parsed[1].replace(/\/-$/, "")) !== input.projectPath ||
    String(Number(parsed[2])) !== String(Number(input.iid))
  )
    throw new Error(
      "The merge request address does not match the selected project.",
    );
  if (
    typeof input.projectPath !== "string" ||
    input.projectPath.split("/").some(function (part) {
      return !part || part === "." || part === "..";
    })
  )
    throw new Error("The project path is invalid.");
  const context: ReviewContext = {
    origin: web.origin,
    webUrl: web.href.replace(/\/$/, ""),
    projectPath: input.projectPath,
    kind: "merge_requests",
    iid: String(Number(input.iid)),
    apiRoot: api.href.replace(/\/$/, ""),
  };
  assertCurrentPage(context);
  return context;
}

export function endpoint(context: ReviewContext) {
  return (
    "/projects/" +
    encodeURIComponent(context.projectPath) +
    "/merge_requests/" +
    context.iid
  );
}

export function readRefs(entity: MergeRequest, context: ReviewContext) {
  const refs = entity && entity.diff_refs;
  if (
    !entity ||
    String(entity.iid) !== context.iid ||
    !refs ||
    !sha(refs.base_sha) ||
    !sha(refs.start_sha) ||
    !sha(refs.head_sha) ||
    (entity.sha && entity.sha !== refs.head_sha)
  )
    throw new Error(
      "The merge request changes are not ready. Reload and try again.",
    );
  return {
    base_sha: refs.base_sha,
    start_sha: refs.start_sha,
    head_sha: refs.head_sha,
  };
}

export function parseInput(text: string, context: ReviewContext) {
  if (typeof text !== "string" || text.length > 1024 * 1024)
    throw new Error("Paste a JSON review no larger than 1 MiB.");
  text = text.trim();
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1];
  let data: ReviewInput;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "The review is not valid JSON. Ask the AI to return the requested JSON format.",
    );
  }
  if (!data || Array.isArray(data) || data.version !== 1)
    throw new Error("This review format is not supported. Use version 1.");
  let url;
  try {
    url = new URL(data.mr_url);
  } catch {
    throw new Error("The review must include the merge request URL.");
  }
  if (url.href.replace(/\/$/, "") !== context.webUrl)
    throw new Error("This review belongs to a different merge request.");
  if (!Array.isArray(data.comments) || data.comments.length > 200)
    throw new Error(
      "The review must contain a comments array with at most 200 comments.",
    );
  const repliesOnly =
    data.comments.length > 0 &&
    data.comments.every(function (item) {
      return item && item.type === "reply";
    });
  if (!(repliesOnly && data.head_sha == null) && !sha(data.head_sha))
    throw new Error("The review must include the full reviewed commit SHA.");
  const ids = new Set();
  data.comments.forEach(function (item) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      item.id.length > 128 ||
      /[\x00-\x1f\x7f]/.test(item.id) ||
      ids.has(item.id)
    )
      throw new Error("Each review comment must have its own unique text ID.");
    ids.add(item.id);
  });
  return data;
}

export function bodyError(body: unknown) {
  if (typeof body !== "string" || !body.trim() || body.length > 65536)
    return "The comment must contain text, up to 65,536 characters.";
  // Quick actions can merge, close, assign, or otherwise change the MR. An
  // imported review authorizes comments only, never these additional actions.
  // GitLab versions disagree on fence parsing. Treat a column-zero command
  // conservatively even inside a fence; an indented code example is safe.
  const commands = body.replace(/\r/g, "");
  if (/^\/[a-z][\w-]*/im.test(commands))
    return "Remove GitLab slash commands from the comment before importing it.";
  return null;
}

export function itemError(item: ImportComment) {
  const invalidBody = bodyError(item.body);
  if (invalidBody) return invalidBody;
  if (
    ["resolve", "resolved", "resolve_discussion"].some(function (key) {
      return item[key] != null && item[key] !== false;
    })
  )
    return "Importing replies does not resolve discussions. Remove the resolve instruction.";
  if (item.type != null && item.type !== "comment" && item.type !== "reply")
    return "Use comment or reply as the item type.";
  if (item.type === "reply") {
    if (
      typeof item.discussion_id !== "string" ||
      !/^[a-f0-9]{40}$/i.test(item.discussion_id) ||
      !positive(item.note_id)
    )
      return "A reply needs the exact discussion ID and a published comment ID.";
    if (
      ["path", "side", "line", "code", "position"].some(function (key) {
        return item[key] != null;
      })
    )
      return "A reply belongs to its existing discussion. Remove the new-comment file location.";
    return null;
  }
  if (item.discussion_id != null || item.note_id != null)
    return "Use type reply to answer an existing review comment.";
  if (
    item.path === null &&
    item.side === null &&
    item.line === null &&
    item.code === null
  )
    return null;
  if (
    typeof item.path !== "string" ||
    !item.path ||
    item.path.length > 4096 ||
    /^[/\\]/.test(item.path) ||
    /[\x00-\x1f\x7f\\]/.test(item.path) ||
    item.path.split("/").some(function (part) {
      return !part || part === "." || part === "..";
    })
  )
    return "Use the exact file path relative to the repository.";
  if (item.side !== "old" && item.side !== "new")
    return "Choose the old or new side of the file.";
  if (!positive(item.line))
    return "The line number must be a positive integer.";
  if (typeof item.code !== "string" || /[\r\n]/.test(item.code))
    return "Include the exact complete code line without a line break.";
  return null;
}
