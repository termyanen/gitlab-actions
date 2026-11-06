import type { Note, Discussion, DraftNote } from "../../../entities/discussion";
import type { MergeRequest } from "../../../entities/merge-request";
import type { ReviewContext, ExportOptions, ReviewError } from "./types";
import { PAGE_SIZE, MAX_PAGES } from "./limits";
import { addWarning, progress } from "./progress";
import { checkAbort, header, apiUrl, request } from "./transport";

export { getNotes, getStatus } from "../../../entities/discussion/content";

// Older installations and proxies sometimes omit all pagination headers. Probe
// until an empty page in that case, even when the server caps per_page below 100.
async function paginate<K extends "notes" | "discussions">(
  context: ReviewContext,
  path: string,
  options: ExportOptions,
  warnings: string[],
  kind: K,
): Promise<{
  items: (K extends "notes" ? Note : Discussion)[];
  complete: boolean;
}> {
  const result: (Note | Discussion)[] = [];
  const byId = new Map<string, Note | Discussion>();
  const visited = new Set();
  let page = 1;
  let complete = true;
  const endpoint = apiUrl(context, path);
  for (let count = 0; count < MAX_PAGES; count++) {
    checkAbort(options.signal);
    if (visited.has(page)) {
      addWarning(
        warnings,
        "Comment pagination repeated a page; some comments may be missing.",
      );
      complete = false;
      break;
    }
    visited.add(page);
    let fetched;
    try {
      fetched = await request<(Note | Discussion)[]>(
        context,
        path +
          "?per_page=" +
          PAGE_SIZE +
          "&page=" +
          page +
          (kind === "notes" ? "&sort=asc&order_by=created_at" : ""),
        options,
      );
      if (!Array.isArray(fetched.data))
        throw new Error("GitLab did not return a comment list.");
    } catch (caught) {
      const error = caught as ReviewError;
      if (error.name === "AbortError" || !result.length) throw error;
      addWarning(
        warnings,
        "Comments after page " +
          (count + 1) +
          " could not be loaded: " +
          error.message,
      );
      complete = false;
      break;
    }
    const data = fetched.data;
    let added = 0;
    data.forEach(function (item) {
      if (
        !item ||
        item.id == null ||
        (kind === "discussions" && !Array.isArray(item.notes)) ||
        (kind === "notes" && typeof item.body !== "string")
      ) {
        addWarning(
          warnings,
          "GitLab returned an incomplete comment record; some comments may be missing.",
        );
        complete = false;
        return;
      }
      const id = String(item.id);
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, item);
        result.push(item);
        added++;
      } else if (kind === "discussions") {
        const ids = new Set(
          existing.notes!.filter(Boolean).map(function (note) {
            return String(note.id);
          }),
        );
        item.notes!.forEach(function (note) {
          if (note && !ids.has(String(note.id))) {
            existing.notes!.push(note);
            ids.add(String(note.id));
            added++;
          }
        });
      }
    });
    progress(options, {
      phase: "discussions",
      page: page,
      loaded: result.length,
    });
    const totalHeader = header(fetched.response, "X-Total");
    const total =
      totalHeader != null && /^\d+$/.test(totalHeader)
        ? Number(totalHeader)
        : null;
    const nextHeader = header(fetched.response, "X-Next-Page");
    const link = header(fetched.response, "Link");
    let next = null;
    if (nextHeader != null) {
      if (nextHeader === "") next = 0;
      else if (/^\d+$/.test(nextHeader)) next = Number(nextHeader);
      else next = -1;
    } else if (link) {
      const found = link.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i);
      if (found) {
        try {
          const nextUrl = new URL(found[1], endpoint);
          const baseUrl = new URL(endpoint);
          const nextPage = nextUrl.searchParams.get("page");
          next =
            nextUrl.origin === baseUrl.origin &&
            nextUrl.pathname === baseUrl.pathname &&
            /^\d+$/.test(nextPage || "")
              ? Number(nextPage)
              : -1;
        } catch {
          next = -1;
        }
      } else next = 0;
    }
    if (next === 0 || (!data.length && next === null)) {
      if (total != null && result.length < total) {
        complete = false;
        addWarning(
          warnings,
          "GitLab reports " +
            total +
            " comment records, but only " +
            result.length +
            " were loaded.",
        );
      }
      break;
    }
    if ((next !== null && next <= page) || (data.length && !added)) {
      complete = false;
      addWarning(
        warnings,
        "GitLab returned inconsistent comment pagination; some comments may be missing.",
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
          " comment pages; later comments are not included.",
      );
    }
  }
  return {
    items: result as (K extends "notes" ? Note : Discussion)[],
    complete: complete,
  };
}

function containsNote(discussions: Discussion[], noteId: string) {
  return discussions.some(function (thread) {
    return thread.notes.some(function (note) {
      return (
        note &&
        String(note.id) === noteId &&
        (note.system || typeof note.body === "string")
      );
    });
  });
}

function mergeDiscussions(previous: Discussion[], fresh: Discussion[]) {
  // Prefer refreshed content and ownership if an ordinary comment was turned
  // into a thread, while retaining replies absent from a partial refresh.
  const ownership = new Map();
  fresh.forEach(function (thread) {
    thread.notes.forEach(function (note) {
      if (note && note.id != null && typeof note.body === "string")
        ownership.set(String(note.id), String(thread.id));
    });
  });
  const byId = new Map<string, Discussion>();
  const merged = previous.map(function (thread) {
    const copy = Object.assign({}, thread, {
      notes: thread.notes.filter(function (note) {
        const owner = note && ownership.get(String(note.id));
        return owner === undefined || owner === String(thread.id);
      }),
    });
    byId.set(String(copy.id), copy);
    return copy;
  });
  fresh.forEach(function (thread) {
    const existing = byId.get(String(thread.id));
    if (!existing) {
      merged.push(thread);
      byId.set(String(thread.id), thread);
      return;
    }
    const notes = existing.notes.slice();
    const indices = new Map<string, number>();
    notes.forEach(function (note, index) {
      if (note && note.id != null) indices.set(String(note.id), index);
    });
    thread.notes.forEach(function (note) {
      if (note && typeof note.body === "string" && indices.has(String(note.id)))
        notes[indices.get(String(note.id))!] = note;
      else {
        if (note && note.id != null && !indices.has(String(note.id)))
          indices.set(String(note.id), notes.length);
        notes.push(note);
      }
    });
    Object.assign(existing, thread, { notes: notes });
  });
  return merged.filter(function (thread) {
    return thread.notes.length;
  });
}

function draftUrl(context: ReviewContext, id: string, anchor?: string) {
  const anchors = ["draft_" + id, "note_" + id, "note-" + id];
  return (
    context.webUrl +
    "#" +
    (anchors.indexOf(anchor || "") >= 0 ? anchor : anchors[0])
  );
}

async function recoverRequestedDraft(
  context: ReviewContext,
  path: string,
  discussions: Discussion[],
  options: ExportOptions,
  warnings: string[],
  id: string,
) {
  if (context.kind !== "merge_requests") {
    addWarning(
      warnings,
      "Requested draft " +
        id +
        " could not be loaded: draft comments are supported only for merge requests.",
    );
    return { items: discussions, complete: false };
  }
  let raw: DraftNote;
  let pageOnly = false;
  try {
    raw = (
      await request<DraftNote>(
        context,
        path + "/draft_notes/" + id,
        Object.assign({}, options, { fresh: true }),
      )
    ).data;
    if (
      !raw ||
      String(raw.id) !== id ||
      typeof raw.note !== "string" ||
      !raw.note.trim()
    ) {
      throw new Error("GitLab did not return the requested draft comment.");
    }
  } catch (caught) {
    const error = caught as ReviewError;
    if (error.name === "AbortError") throw error;
    const visible = options.visibleNote;
    if (
      [404, 405, 501].indexOf(error.httpStatus || 0) >= 0 &&
      visible &&
      typeof visible.body === "string" &&
      visible.body.trim()
    ) {
      raw = { id: id, note: visible.body, author: visible.author };
      pageOnly = true;
      if (visible.format === "markdown") {
        addWarning(
          warnings,
          "Draft " +
            id +
            " was copied from saved page Markdown because the draft API is unavailable (" +
            error.message +
            "). Code positions and hidden replies may be unavailable.",
        );
      } else {
        addWarning(
          warnings,
          "Draft " +
            id +
            " was copied from rendered page text only because the draft API is unavailable (" +
            error.message +
            "). Original Markdown, code positions, and hidden replies may be unavailable.",
        );
      }
    } else {
      addWarning(
        warnings,
        "Requested draft " + id + " could not be loaded: " + error.message,
      );
      return { items: discussions, complete: false };
    }
  }
  // Draft IDs belong to a separate namespace and can collide with published
  // note IDs. The draft API's `note` field is the original Markdown body.
  const note = Object.assign({}, raw, {
    id: "draft:" + id,
    draft_id: raw.id,
    draft: true,
    body: raw.note,
    system: false,
    web_url: draftUrl(context, id, options.noteAnchor),
    resolvable: !!raw.position,
    resolved: false,
  });
  const discussionId = String(
    raw.discussion_id == null ? "" : raw.discussion_id,
  );
  // Only public discussion hashes can identify a thread. Never interpret an
  // unexpected numeric value as a matching public discussion ID.
  const parent =
    /^[a-f0-9]{40}$/i.test(discussionId) &&
    discussions.find(function (thread) {
      return String(thread.id) === discussionId;
    });
  if (parent) {
    return {
      items: discussions.map(function (thread) {
        return thread === parent
          ? Object.assign({}, thread, { notes: thread.notes.concat([note]) })
          : thread;
      }),
      complete: !pageOnly,
    };
  }
  if (discussionId) {
    addWarning(
      warnings,
      "Draft " +
        id +
        " was loaded individually, but its thread context is missing; replies and resolution details may be unavailable.",
    );
  }
  return {
    items: discussions.concat([
      { id: "draft-" + id, individual_note: !discussionId, notes: [note] },
    ]),
    complete: !pageOnly && !discussionId,
  };
}

async function recoverRequestedNote(
  context: ReviewContext,
  path: string,
  discussions: Discussion[],
  options: ExportOptions,
  warnings: string[],
) {
  const id = String(options.noteId == null ? "" : options.noteId);
  const draft = id.match(/^draft:([1-9]\d*)$/);
  if (draft)
    return recoverRequestedDraft(
      context,
      path,
      discussions,
      options,
      warnings,
      draft[1],
    );
  if (!/^[1-9]\d*$/.test(id) || containsNote(discussions, id))
    return { items: discussions, complete: true };
  let note;
  const freshOptions = Object.assign({}, options, { fresh: true });
  try {
    note = (await request<Note>(context, path + "/notes/" + id, freshOptions))
      .data;
    if (
      !note ||
      String(note.id) !== id ||
      typeof note.body !== "string" ||
      note.system
    ) {
      throw new Error("GitLab did not return the requested human comment.");
    }
  } catch (caught) {
    const error = caught as ReviewError;
    if (error.name === "AbortError") throw error;
    addWarning(
      warnings,
      "Requested comment " + id + " could not be loaded: " + error.message,
    );
    return { items: discussions, complete: false };
  }
  if (
    (note.type === null || note.type === "Note") &&
    !note.position &&
    !note.original_position &&
    note.resolvable !== true
  ) {
    return {
      items: discussions.concat([
        { id: "note-" + id, individual_note: true, notes: [note] },
      ]),
      complete: true,
    };
  }
  let complete: boolean;
  try {
    const refreshed = await paginate(
      context,
      path + "/discussions",
      freshOptions,
      warnings,
      "discussions",
    );
    discussions = mergeDiscussions(discussions, refreshed.items);
    complete = refreshed.complete;
  } catch (caught) {
    const error = caught as ReviewError;
    if (error.name === "AbortError") throw error;
    complete = false;
    addWarning(
      warnings,
      "Discussions could not be refreshed for comment " +
        id +
        ": " +
        error.message,
    );
  }
  if (!containsNote(discussions, id)) {
    addWarning(
      warnings,
      "Requested comment " +
        id +
        " was loaded individually, but its thread context is missing; replies and resolution details may be unavailable.",
    );
    discussions = discussions.concat([
      { id: "recovered-note-" + id, notes: [note] },
    ]);
    complete = false;
  }
  return { items: discussions, complete: complete };
}

export async function load(
  context: ReviewContext,
  options: ExportOptions = {},
) {
  options = options || {};
  checkAbort(options.signal);
  const warnings: string[] = [];
  const path =
    "/projects/" +
    encodeURIComponent(context.projectPath) +
    "/" +
    context.kind +
    "/" +
    encodeURIComponent(context.iid);
  progress(options, { phase: "metadata", loaded: 0 });
  const results = await Promise.allSettled([
    request<MergeRequest>(context, path, options),
    (async function () {
      try {
        return await paginate(
          context,
          path + "/discussions",
          options,
          warnings,
          "discussions",
        );
      } catch (caught) {
        const error = caught as ReviewError;
        if (
          error.name === "AbortError" ||
          error.httpStatus === 401 ||
          error.httpStatus === 403
        )
          throw error;
        addWarning(
          warnings,
          "Full discussions are unavailable (" +
            error.message +
            "). Falling back to individual notes: threaded replies, code positions, and resolution status may be missing.",
        );
        const notes = await paginate(
          context,
          path + "/notes",
          options,
          warnings,
          "notes",
        );
        return {
          items: notes.items.map(function (note) {
            return {
              id: "note-" + note.id,
              individual_note: true,
              notes: [note],
            };
          }),
          complete: false,
        };
      }
    })(),
  ]);
  checkAbort(options.signal);
  if (results[1].status === "rejected") throw results[1].reason;
  let entity = null;
  let complete = results[1].value.complete;
  if (
    results[0].status === "fulfilled" &&
    results[0].value.data &&
    typeof results[0].value.data === "object" &&
    !Array.isArray(results[0].value.data) &&
    results[0].value.data.iid != null
  ) {
    entity = results[0].value.data;
  } else {
    complete = false;
    addWarning(
      warnings,
      "MR/issue metadata could not be loaded; description, branches, and current revision may be missing." +
        (results[0].status === "rejected"
          ? " " + results[0].reason.message
          : ""),
    );
  }
  const recovered = await recoverRequestedNote(
    context,
    path,
    results[1].value.items,
    options,
    warnings,
  );
  checkAbort(options.signal);
  const discussions = recovered.items;
  complete = complete && recovered.complete;
  discussions.forEach(function (discussion) {
    const seen = new Set();
    discussion.notes = discussion.notes.filter(function (note) {
      if (!note || note.id == null || typeof note.body !== "string") {
        complete = false;
        addWarning(
          warnings,
          "An incomplete note was omitted; some review text may be missing.",
        );
        return false;
      }
      if (seen.has(String(note.id))) return false;
      seen.add(String(note.id));
      return true;
    });
    if (
      Number(discussion.notes_count) > discussion.notes.length ||
      discussion.truncated === true ||
      discussion.has_more === true
    ) {
      complete = false;
      addWarning(
        warnings,
        "Discussion " +
          discussion.id +
          " was truncated by GitLab; some replies are missing.",
      );
    }
  });
  return {
    context: context,
    entity: entity,
    discussions: discussions,
    warnings: warnings,
    complete: complete,
    loadedAt: new Date().toISOString(),
  };
}
