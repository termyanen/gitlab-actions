import type { Discussion, Note } from "../../../entities/discussion";
import type { DiffRefs } from "../../../entities/merge-request";
import type {
  createReviewExporter,
  ReviewSnapshot,
} from "../../../features/review-export";
import type { Translate } from "../../../shared/i18n";
import { element } from "../../../shared/ui/dom";
import type { ReviewDialogState } from "./types";
export function createReviewThreads(
  data: ReturnType<typeof createReviewExporter>,
  t: Translate,
  invalidate: (state: ReviewDialogState) => void,
  updateActions: (state: ReviewDialogState) => void,
) {
  function positionText(note: Note) {
    const p = note.position || note.original_position;
    if (!p) return "";
    const path = p.new_path || p.old_path || "";
    const line = p.new_line || p.old_line;
    return path + (line ? ":" + line : "");
  }

  function earlierRevision(thread: Discussion, snapshot: ReviewSnapshot) {
    const entity = snapshot.entity || {};
    const refs: Partial<DiffRefs> = entity.diff_refs || {};
    return (
      thread.outdated === true ||
      data.getNotes(thread).some(function (note) {
        if (note.outdated === true) return true;
        const p = note.original_position || note.position;
        if (!p) return false;
        return !!(
          (p.head_sha &&
            (entity.sha || refs.head_sha) &&
            p.head_sha !== (entity.sha || refs.head_sha)) ||
          (p.base_sha && refs.base_sha && p.base_sha !== refs.base_sha) ||
          (p.start_sha && refs.start_sha && p.start_sha !== refs.start_sha)
        );
      })
    );
  }

  function matchesStatus(state: ReviewDialogState, thread: Discussion) {
    const value = state.filter.value;
    const threadStatus = data.getStatus(thread);
    return (
      value === "all" ||
      threadStatus === value ||
      (value === "unresolved" &&
        state.includeGeneral.checked &&
        threadStatus === "general")
    );
  }

  function visibleThreads(state: ReviewDialogState) {
    if (!state.snapshot) return [];
    const query = state.search.value.trim().toLowerCase();
    return state.snapshot!.discussions.filter(function (thread) {
      const notes = data.getNotes(thread!);
      if (!notes.length) return false;
      if (!matchesStatus(state, thread)) return false;
      if (!query) return true;
      return notes.some(function (note) {
        return (
          [
            note.body,
            positionText(note),
            note.author && note.author.name,
            note.author && note.author.username,
          ]
            .join(" ")
            .toLowerCase()
            .indexOf(query) !== -1
        );
      });
    });
  }

  function renderThreads(state: ReviewDialogState) {
    state.list.replaceChildren();
    const threads = visibleThreads(state);
    if (!threads.length)
      state.list.appendChild(
        element("p", "gl-review-muted", t("aiReviewEmpty")),
      );
    threads.forEach(function (thread) {
      const notes = data.getNotes(thread!);
      const card = element("article", "gl-review-thread");
      const heading = element("div", "gl-review-thread-heading");
      const label = element("label", "gl-review-thread-label");
      const check = element("input");
      check.type = "checkbox";
      const selected = notes.filter(function (note) {
        return state.selected.has(String(note.id));
      }).length;
      check.checked = selected === notes.length;
      check.indeterminate = selected > 0 && selected < notes.length;
      check.setAttribute("aria-label", t("aiReviewScopeThread"));
      label.appendChild(check);
      const stateKey = {
        unresolved: "aiReviewUnresolved",
        resolved: "aiReviewResolved",
        general: "aiReviewGeneral",
      }[data.getStatus(thread)];
      label.appendChild(
        element("span", "gl-review-badge", t(stateKey || "aiReviewGeneral")),
      );
      if (earlierRevision(thread, state.snapshot!))
        label.appendChild(
          element("span", "gl-review-muted", t("aiReviewOutdated")),
        );
      const location = positionText(notes[0]);
      if (location)
        label.appendChild(element("span", "gl-review-path", location));
      heading.appendChild(label);
      const link = element("a", "gl-review-link", "↗");
      link.href =
        notes[0].web_url ||
        state.context.webUrl + "#note_" + encodeURIComponent(notes[0].id);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", t("aiReviewLink"));
      heading.appendChild(link);
      card.appendChild(heading);
      check.addEventListener("change", function () {
        state.selectionEdited = true;
        notes.forEach(function (note) {
          if (check.checked) state.selected.add(String(note.id));
          else state.selected.delete(String(note.id));
        });
        invalidate(state);
        // Keep focus and expanded replies while updating checkbox states.
        syncChecks(state);
      });
      check.dataset.reviewThread = String(thread.id);

      notes.forEach(function (note, index) {
        const row = element("div", "gl-review-note");
        const noteLabel = element("label", "gl-review-note-label");
        const noteCheck = element("input");
        noteCheck.type = "checkbox";
        noteCheck.checked = state.selected.has(String(note.id));
        noteCheck.dataset.reviewNote = String(note.id);
        noteCheck.setAttribute(
          "aria-label",
          t("aiReviewScopeComment") + " #" + note.id,
        );
        noteCheck.addEventListener("change", function () {
          state.selectionEdited = true;
          if (noteCheck.checked) state.selected.add(String(note.id));
          else state.selected.delete(String(note.id));
          invalidate(state);
          syncChecks(state);
        });
        noteLabel.appendChild(noteCheck);
        const author = note.author || {};
        noteLabel.appendChild(
          element(
            "strong",
            "",
            author.name || author.username || "#" + note.id,
          ),
        );
        if (note.created_at) {
          const date = new Date(note.created_at);
          if (!isNaN(date.getTime()))
            noteLabel.appendChild(
              element("time", "gl-review-muted", date.toLocaleString()),
            );
        }
        row.appendChild(noteLabel);
        row.appendChild(element("pre", "gl-review-note-text", note.body || ""));
        if (index === 0) card.appendChild(row);
        else {
          let replies = card.querySelector("details");
          if (!replies) {
            replies = element("details", "gl-review-replies");
            replies.appendChild(
              element(
                "summary",
                "",
                t("aiReviewShowReplies") + " (" + (notes.length - 1) + ")",
              ),
            );
            // A directly selected reply should be visible on opening the picker.
            replies.open = !!state.intent.noteId;
            card.appendChild(replies);
          }
          replies.appendChild(row);
        }
      });
      state.list.appendChild(card);
    });
    updateActions(state);
  }

  function syncChecks(state: ReviewDialogState) {
    state.list
      .querySelectorAll<HTMLInputElement>("[data-review-note]")
      .forEach(function (check) {
        check.checked = state.selected.has(check.dataset.reviewNote!);
      });
    state.list
      .querySelectorAll<HTMLInputElement>("[data-review-thread]")
      .forEach(function (check) {
        const thread = state.snapshot!.discussions.find(function (item) {
          return String(item.id) === check.dataset.reviewThread;
        });
        const notes = data.getNotes(thread!);
        const count = notes.filter(function (note) {
          return state.selected.has(String(note.id));
        }).length;
        check.checked = count === notes.length;
        check.indeterminate = count > 0 && count < notes.length;
      });
  }

  function selectedDiscussionIds(state: ReviewDialogState, replies?: boolean) {
    return (state.snapshot ? state.snapshot!.discussions : [])
      .filter(function (thread) {
        const notes = data.getNotes(thread).filter(function (note) {
          return !note.draft && !/^draft:/.test(String(note.id));
        });
        if (
          replies &&
          (!/^[a-f0-9]{40}$/i.test(thread.id) ||
            notes.some(function (note) {
              return (
                note.noteable_type && note.noteable_type !== "MergeRequest"
              );
            }))
        )
          return false;
        return notes.some(function (note) {
          return state.selected.has(String(note.id));
        });
      })
      .map(function (thread) {
        return String(thread.id);
      });
  }

  function chosenCount(state: ReviewDialogState) {
    return state.selected.size;
  }

  function selection(state: ReviewDialogState) {
    const discussionIds: string[] = [];
    const noteIds: string[] = [];
    state.snapshot!.discussions.forEach(function (thread) {
      const notes = data.getNotes(thread!);
      const chosen = notes.filter(function (note) {
        return state.selected.has(String(note.id));
      });
      if (chosen.length && chosen.length === notes.length)
        discussionIds.push(String(thread.id));
      else
        chosen.forEach(function (note) {
          noteIds.push(String(note.id));
        });
    });
    return { discussionIds: discussionIds, noteIds: noteIds };
  }
  return {
    renderThreads,
    syncChecks,
    selectedDiscussionIds,
    chosenCount,
    selection,
    matchesStatus,
    visibleThreads,
  };
}
