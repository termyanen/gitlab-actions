import type { Note } from "../../../entities/discussion";
import type { ReviewContext } from "../../../entities/review";
import { digest } from "../../../shared/lib/digest";
import { normalizedPosition } from "./diff";
import { request } from "./transport";
import type {
  ExistingNotes,
  ImportError,
  ImportItem,
  ImportOptions,
  JournalEntry,
} from "./types";
import { positive, warning } from "./utils";
import { endpoint } from "./validation";
export function createDeliveryJournal() {
  const JOURNAL_PREFIX = "glReviewImportPending:";
  const journal = new Map<string, JournalEntry>();

  // A local SHA-256 also works on older HTTP GitLab installations where
  // crypto.subtle is unavailable. Only this digest, never comment text, is saved.
  function operationKey(
    context: ReviewContext,
    item: ImportItem,
    userId: number,
  ) {
    // Preserve previously saved new-comment keys. Replies belong to a thread,
    // independently of its historical code anchor or the selected parent note.
    return digest(
      JSON.stringify(
        item.type === "reply"
          ? [context.webUrl, userId, "reply", item.discussion_id, item.body]
          : [
              context.webUrl,
              userId,
              item.body,
              normalizedPosition(item.position),
            ],
      ),
    );
  }

  function storageCall(
    method: "get" | "set" | "remove",
    argument: string | Record<string, JournalEntry>,
  ): Promise<Record<string, JournalEntry> | undefined> {
    const local =
      typeof chrome !== "undefined" ? chrome.storage?.local : undefined;
    if (!local || typeof local[method] !== "function")
      return Promise.resolve(method === "get" ? {} : undefined);
    return new Promise((resolve, reject) => {
      const finish = (value?: Record<string, JournalEntry>) => {
        if (chrome.runtime && chrome.runtime.lastError)
          reject(
            new Error(
              "The browser could not save the import progress. Try again before sending comments.",
            ),
          );
        else resolve(value);
      };
      try {
        if (method === "get") local.get(argument as string, finish);
        else if (method === "set")
          local.set(argument as Record<string, JournalEntry>, () => finish());
        else local.remove(argument as string, () => finish());
      } catch {
        reject(
          new Error(
            "The browser could not save the import progress. Try again before sending comments.",
          ),
        );
      }
    });
  }

  async function pending(key: string) {
    if (journal.has(key)) return journal.get(key);
    const data = await storageCall("get", JOURNAL_PREFIX + key);
    const saved = data && data[JOURNAL_PREFIX + key];
    if (
      saved &&
      (saved.status === "pending" ||
        saved.status === "unknown" ||
        ((saved.status === "draft" || saved.status === "published") &&
          positive(saved.id)))
    ) {
      journal.set(key, saved);
      return saved;
    }
    return null;
  }

  async function remember(
    key: string,
    status: JournalEntry["status"],
    id?: number | string,
  ) {
    const value: JournalEntry = { status: status, time: Date.now() };
    if (positive(id)) value.id = id;
    journal.set(key, value);
    const patch: Record<string, JournalEntry> = {};
    patch[JOURNAL_PREFIX + key] = value;
    await storageCall("set", patch);
  }

  async function forget(key: string) {
    journal.delete(key);
    await storageCall("remove", JOURNAL_PREFIX + key);
  }

  async function checkedPending(
    key: string,
    existing: ExistingNotes,
    context: ReviewContext,
    options: ImportOptions,
  ) {
    const saved = await pending(key);
    // A confirmed draft can be deleted in GitLab. Only a successfully loaded
    // complete draft list proves absence; unknown sends remain protected.
    if (
      saved &&
      saved.status === "draft" &&
      existing.draftSupported &&
      !existing.notes.some(function (note) {
        return note.draft && note.id === saved.id;
      })
    ) {
      await forget(key);
      return null;
    }
    // Published replies can also be deleted. A lagging discussion list alone
    // is not proof: verify the confirmed note ID before releasing its journal.
    if (
      saved &&
      saved.status === "published" &&
      !existing.discussions.some(function (discussion) {
        return discussion.notes.some(function (note) {
          return note.id === saved.id;
        });
      })
    ) {
      try {
        const note = (
          await request<Note>(
            context,
            endpoint(context) + "/notes/" + saved.id,
            options,
          )
        ).data;
        if (!note || note.id !== saved.id || typeof note.body !== "string")
          throw new Error(
            "GitLab could not verify the previously published comment. Check the review again.",
          );
      } catch (errorValue) {
        const error = errorValue as ImportError;
        if (error.httpStatus !== 404) throw error;
        await forget(key);
        return null;
      }
    }
    return saved;
  }

  async function confirmed(
    key: string,
    note: { draft: boolean; id: number | string },
    warnings: string[],
  ) {
    try {
      await remember(key, note.draft ? "draft" : "published", note.id);
    } catch {
      warning(
        warnings,
        "The comment is saved in GitLab, but the browser could not save the local import progress.",
      );
    }
  }

  function confirmedUrl(context: ReviewContext, entry: JournalEntry) {
    return (
      context.webUrl +
      (entry.status === "draft" ? "#draft_" : "#note_") +
      entry.id
    );
  }
  return {
    operationKey,
    pending,
    remember,
    forget,
    checkedPending,
    confirmed,
    confirmedUrl,
  };
}
export type DeliveryJournal = ReturnType<typeof createDeliveryJournal>;
