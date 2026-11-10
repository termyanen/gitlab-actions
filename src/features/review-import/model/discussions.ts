import type {
  Discussion,
  Note,
  NotePosition,
} from "../../../entities/discussion";
import { readDiscussion, readDraftNote } from "../../../entities/discussion";
import type { ReviewContext } from "../../../entities/review";
import { digest } from "../../../shared/lib/digest";
import { toError } from "../../../shared/lib/errors";
import {
  decodeArray,
  decodeResponse,
  decoder,
  isNumber,
  objectOf,
} from "../../../shared/lib/validation";
import { equalPosition } from "./diff";
import { paginate, request } from "./transport";
import type {
  CompactLocation,
  ExistingNote,
  ExistingNotes,
  ImportItem,
  ImportOptions,
  ReplyContext,
} from "./types";
import { positive, sha, unsupported } from "./utils";
import { endpoint } from "./validation";
const readCurrentUser = decoder(
  objectOf<{ id: number }>({
    id: isNumber,
  }),
  "GitLab current user response",
);

export function findExisting(existing: ExistingNotes, item: ImportItem) {
  return existing.notes.find(function (note) {
    return (
      note.body === item.body &&
      (item.type === "reply"
        ? note.isReply && note.discussion_id === item.discussion_id
        : !note.isReply && equalPosition(note.position, item.position))
    );
  });
}

export function discussionState(discussion: Discussion) {
  const notes = discussion.notes.filter(function (note) {
    return !note.system;
  });
  let resolvable = notes.filter(function (note) {
    return (
      note.resolvable === true ||
      (note.resolvable !== false && note.resolved === true)
    );
  });
  if (
    resolvable.length ||
    discussion.resolvable === true ||
    (discussion.resolvable !== false && discussion.resolved === true)
  ) {
    resolvable = notes.filter(function (note) {
      return (
        note.resolvable === true ||
        (note.resolvable !== false && typeof note.resolved === "boolean")
      );
    });
    if (resolvable.length)
      return resolvable.every(function (note) {
        return note.resolved === true;
      })
        ? "resolved"
        : "unresolved";
  }
  if (
    !notes.length ||
    notes.every(function (note) {
      return note.resolvable === false;
    }) ||
    discussion.resolvable === false
  )
    return "general";
  return discussion.resolved === true
    ? "resolved"
    : discussion.resolvable === true
      ? "unresolved"
      : "general";
}

export function validateDiscussion(discussion: Discussion) {
  if (
    !discussion ||
    typeof discussion.id !== "string" ||
    !Array.isArray(discussion.notes) ||
    discussion.notes.some(function (note) {
      return !note || !positive(note.id) || typeof note.body !== "string";
    })
  )
    throw new Error("Some existing review comments could not be checked.");
  return discussion;
}

export async function loadDiscussions(
  context: ReviewContext,
  options: ImportOptions,
) {
  const discussions = await paginate<Discussion>(
    context,
    endpoint(context) + "/discussions",
    options,
    function (d) {
      return d.id;
    },
    readDiscussion,
  );
  return discussions.map(validateDiscussion);
}

export function targetNote(
  discussion: Discussion | undefined,
  item: ImportItem,
) {
  return (
    discussion &&
    discussion.id === item.discussion_id &&
    isMrDiscussion(discussion) &&
    discussion.notes.find(function (note) {
      return !note.system && note.id === item.note_id;
    })
  );
}

export function isMrDiscussion(discussion: Discussion) {
  return discussion.notes.every(function (note) {
    return (
      note.system ||
      !note.noteable_type ||
      note.noteable_type === "MergeRequest"
    );
  });
}

export function discussionFingerprint(discussion: Discussion) {
  const notes = discussion.notes
    .filter(function (note) {
      return !note.system;
    })
    .map(function (note) {
      return [note.id, note.body, note.resolved];
    });
  notes.sort(function (a, b) {
    return Number(a[0]) - Number(b[0]);
  });
  return digest(
    JSON.stringify([
      discussionState(discussion),
      discussion.resolved,
      discussion.resolvable,
      notes,
    ]),
  );
}

export function replyContext(
  context: ReviewContext,
  discussion: Discussion,
  note: Note,
) {
  const result: ReplyContext = {
    body: note.body,
    url: context.webUrl + "#note_" + note.id,
  };
  if (note.author)
    result.author = {
      ...(note.author.name === undefined ? {} : { name: note.author.name }),
      ...(note.author.username === undefined
        ? {}
        : { username: note.author.username }),
    };
  let position = note.position || note.original_position;
  if (!position) {
    const anchored = discussion.notes.find(function (n) {
      return !n.system && (n.position || n.original_position);
    });
    if (anchored) position = anchored.position || anchored.original_position;
  }
  if (position) {
    result.side = positive(position.new_line) ? "new" : "old";
    const path =
      position[`${result.side}_path`] ||
      position.new_path ||
      position.old_path ||
      undefined;
    if (path !== undefined) result.path = path;
    const line = position[`${result.side}_line`];
    if (line !== undefined) result.line = line;
  }
  const state = discussionState(discussion);
  result.resolvable = state !== "general";
  if (state !== "general") result.resolved = state === "resolved";
  return result;
}

export function otherReplyDraft(existing: ExistingNotes, item: ImportItem) {
  return (
    item.type === "reply" &&
    existing.notes.find(function (note) {
      return (
        note.draft &&
        note.discussion_id === item.discussion_id &&
        note.body !== item.body
      );
    })
  );
}

export function compactLocation(position?: NotePosition | null) {
  if (!position) return null;
  const newer =
    positive(position.new_line) ||
    (!positive(position.old_line) && position.new_path);
  const result: CompactLocation = {
    ...((newer ? position.new_path : position.old_path) == null
      ? {}
      : { path: (newer ? position.new_path : position.old_path) || "" }),
    side: newer ? "new" : "old",
  };
  const line = newer ? position.new_line : position.old_line;
  if (positive(line)) result.line = line;
  if (sha(position.head_sha)) result.head_sha = position.head_sha;
  if (!newer && sha(position.base_sha)) result.base_sha = position.base_sha;
  return result.path ? result : null;
}

export async function existingNotes(
  context: ReviewContext,
  options: ImportOptions,
) {
  const user = (
    await request(context, "/user", options).then(
      decodeResponse(readCurrentUser),
    )
  ).data;
  if (!user || !positive(user.id))
    throw new Error("Sign in to GitLab before importing comments.");
  const notes: ExistingNote[] = [];
  const discussions = await loadDiscussions(context, options);
  discussions.forEach(function (discussion) {
    if (!Array.isArray(discussion.notes))
      throw new Error("Some existing review comments could not be checked.");
    discussion.notes.forEach(function (note, index) {
      if (!note || note.system || !note.author || note.author.id !== user.id)
        return;
      if (!positive(note.id) || typeof note.body !== "string")
        throw new Error("An existing review comment is incomplete.");
      notes.push({
        body: note.body,
        position: note.position || null,
        url: context.webUrl + "#note_" + note.id,
        id: note.id,
        draft: false,
        discussion_id: discussion.id,
        isReply: index > 0,
      });
    });
  });
  let draftSupported = true;
  try {
    // The Draft Notes API returns all the current user's drafts and does not
    // paginate; probing page 2 would receive the same complete list again.
    const drafts = (
      await request(context, endpoint(context) + "/draft_notes", options).then(
        decodeResponse(decodeArray(readDraftNote)),
      )
    ).data;
    if (!Array.isArray(drafts))
      throw new Error("GitLab returned an incomplete draft list.");
    drafts.forEach(function (note) {
      if (!note || !positive(note.id) || typeof note.note !== "string")
        throw new Error("An existing draft comment is incomplete.");
      if (note.author_id != null && note.author_id !== user.id) return;
      // Older GitLab returns a position object with null refs for general drafts.
      const position =
        note.position && (note.position.old_path || note.position.new_path)
          ? note.position
          : null;
      notes.push({
        body: note.note,
        position: position,
        url: context.webUrl + "#draft_" + note.id,
        id: note.id,
        draft: true,
        discussion_id: note.discussion_id || null,
        isReply: note.discussion_id != null,
      });
    });
  } catch (errorValue) {
    const error = toError(errorValue);
    if (!unsupported(error)) throw error;
    draftSupported = false;
  }
  return {
    notes: notes,
    discussions: discussions,
    userId: user.id,
    draftSupported: draftSupported,
  };
}
