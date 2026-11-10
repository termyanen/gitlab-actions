import type { NotePosition } from "../../../entities/discussion";
import {
  readCreatedComment,
  readDiscussion,
} from "../../../entities/discussion";
import type {
  InstructionOptions,
  ReviewContext,
} from "../../../entities/review";
import * as defaultWorkflow from "../../../entities/review";
import {
  DEFAULT_REPLY_PROMPT,
  DEFAULT_REVIEW_PROMPT,
} from "../../../entities/review";
import { toError } from "../../../shared/lib/errors";
import {
  decodeResponse,
  decoder,
  isNumber,
  objectOf,
} from "../../../shared/lib/validation";
import { equalPosition } from "./diff";
import {
  discussionFingerprint,
  discussionState,
  existingNotes,
  findExisting,
  otherReplyDraft,
  targetNote,
  validateDiscussion,
} from "./discussions";
import { createDeliveryJournal } from "./journal";
import { createImportPlanner } from "./plan";
import { createImportPrompts } from "./prompts";
import { metadata, request } from "./transport";
import type {
  ImportError,
  ImportItem,
  ImportOptions,
  ImportPlan,
  ImportResult,
  ImportResultItem,
  InternalPlan,
} from "./types";
import {
  checkAbort,
  clone,
  positive,
  progress,
  replyNotice,
  sameRefs,
  warning,
} from "./utils";
import { endpoint, safeContext } from "./validation";
const readCurrentUser = decoder(
  objectOf<{ id: number }>({
    id: isNumber,
  }),
  "GitLab current user response",
);
export function createReviewImporter(
  reviewWorkflow: typeof defaultWorkflow | null = defaultWorkflow,
) {
  function instruction(
    id: string,
    fallback: string,
    options: InstructionOptions,
    variables?: Record<string, string>,
  ) {
    return reviewWorkflow
      ? reviewWorkflow.instruction(id, options, variables)
      : fallback.replace(
          /\{(language|selection)\}/g,
          function (match: string, key: string) {
            return variables && variables[key] !== undefined
              ? variables[key]
              : match;
          },
        );
  }

  const plans = new WeakMap<ImportPlan, InternalPlan>();

  const running = new Set<string>();
  const {
    operationKey,
    pending,
    remember,
    forget,
    checkedPending,
    confirmed,
    confirmedUrl,
  } = createDeliveryJournal();
  const { getResponseFormat, getPrompt, getReplyPrompt } = createImportPrompts(
    reviewWorkflow,
    instruction,
  );
  const { prepare, revise } = createImportPlanner(plans, running, {
    operationKey,
    confirmed,
    checkedPending,
    confirmedUrl,
    pending,
    remember,
    forget,
  });

  function resultItem(
    item: ImportItem,
    status: ImportResultItem["status"],
    message?: string,
    url?: string,
  ) {
    const result: ImportResultItem = {
      id: item.id,
      status: status,
      message: message || "",
    };
    if (url) result.url = url;
    return result;
  }
  async function reconcile(
    context: ReviewContext,
    item: ImportItem,
    options: ImportOptions,
  ) {
    if (options.signal && options.signal.aborted) return null;
    try {
      return findExisting(await existingNotes(context, options), item) || null;
    } catch {
      return null;
    }
  }

  async function resolvePublishedReply(
    context: ReviewContext,
    internal: InternalPlan,
    item: ImportItem,
    noteId: number | string,
    options: ImportOptions,
    result: ImportResultItem,
  ) {
    // The reply is already confirmed. Resolution must never change its delivery
    // status or clear its journal entry, including when the PUT response is lost.
    let began = false;
    try {
      if (!item.discussion_id) throw new Error("Missing reply discussion ID");
      const path =
        endpoint(context) +
        "/discussions/" +
        encodeURIComponent(item.discussion_id || "");
      const user = (
        await request(context, "/user", options).then(
          decodeResponse(readCurrentUser),
        )
      ).data;
      if (!user || user.id !== internal.userId)
        throw new Error("Your GitLab account changed.");
      const thread = validateDiscussion(
        (
          await request(context, path, options).then(
            decodeResponse(readDiscussion),
          )
        ).data,
      );
      if (
        !targetNote(thread, item) ||
        !thread.notes.some(function (note) {
          return note.id === noteId && note.body === item.body;
        })
      )
        throw new Error(
          "The published reply could not be verified in this discussion.",
        );
      if (discussionState(thread) === "resolved") {
        result.resolveStatus = "resolved";
        return result;
      }
      const beforeReply = clone(thread);
      beforeReply.notes = beforeReply.notes.filter(function (note) {
        return note.id !== noteId;
      });
      if (
        discussionState(thread) !== "unresolved" ||
        discussionFingerprint(beforeReply) !==
          internal.replyFingerprints[item.id]
      )
        throw new Error(
          "The discussion changed after the preview. Review it in GitLab before resolving it.",
        );
      checkAbort(options.signal);
      began = true;
      const updated = validateDiscussion(
        (
          await request(context, path, options, { resolved: true }, "PUT").then(
            decodeResponse(readDiscussion),
          )
        ).data,
      );
      if (!targetNote(updated, item) || discussionState(updated) !== "resolved")
        throw new Error(
          "GitLab did not confirm that the discussion was resolved.",
        );
      result.resolveStatus = "resolved";
    } catch (errorValue) {
      const error = toError(errorValue);
      result.resolveStatus =
        began &&
        !(
          (error.httpStatus || 0) >= 400 &&
          (error.httpStatus || 0) < 500 &&
          error.httpStatus !== 408
        )
          ? "unknown"
          : "failed";
      result.resolveMessage = error.message;
    }
    return result;
  }

  async function publish(
    plan: ImportPlan,
    selectedIds: string[],
    options: ImportOptions = {},
  ) {
    const internal = plans.get(plan);
    const locks = typeof navigator !== "undefined" && navigator.locks;
    if (!internal || !locks || typeof locks.request !== "function")
      return publishUnlocked(plan, selectedIds, options);
    // Storage reads/writes are not an atomic claim across tabs. Hold one
    // origin-scoped Web Lock while checking and sending to this MR, including
    // draft/public sends and alternate legacy/modern MR URL shapes.
    try {
      return await locks.request(
        "glReviewImport:" +
          internal.context.apiRoot +
          endpoint(internal.context),
        { mode: "exclusive", ifAvailable: true },
        function (lock) {
          if (!lock) {
            const error: ImportError = new Error(
              "Comments are already being sent for this merge request in another tab. Wait for that send to finish, then check the review again.",
            );
            error.beforeSend = true;
            throw error;
          }
          return publishUnlocked(plan, selectedIds, options);
        },
      );
    } catch (errorValue) {
      const error = toError(errorValue);
      if (error.beforeSend === undefined) error.beforeSend = true;
      throw error;
    }
  }

  async function publishUnlocked(
    plan: ImportPlan,
    selectedIds: string[],
    options: ImportOptions = {},
  ) {
    options = options || {};
    function refusal(message: string) {
      const error: ImportError = new Error(message);
      error.beforeSend = true;
      return error;
    }
    const stored = plans.get(plan);
    if (!stored)
      throw refusal("Check the review again before sending comments.");
    const internal = stored;
    let context;
    try {
      context = safeContext(internal.context);
    } catch (errorValue) {
      const error = toError(errorValue);
      error.beforeSend = true;
      throw error;
    }
    if (
      !Array.isArray(selectedIds) ||
      selectedIds.some(function (id) {
        return typeof id !== "string";
      })
    )
      throw refusal("Select the review comments to send.");
    const selected = new Set(selectedIds);
    if (
      selected.size !== selectedIds.length ||
      selectedIds.some(function (id) {
        return !internal.items.some(function (item) {
          return item.id === id;
        });
      })
    )
      throw refusal(
        "The selected comments do not match this review. Check it again.",
      );
    const mode = options.mode || "draft";
    if (mode !== "draft" && mode !== "publish")
      throw refusal(
        "Choose whether to publish comments or add them to review.",
      );
    const resolveIds =
      options.resolveIds === undefined ? [] : options.resolveIds;
    if (
      !Array.isArray(resolveIds) ||
      new Set(resolveIds).size !== resolveIds.length ||
      resolveIds.some(function (id) {
        const item = internal.items.find(function (entry) {
          return entry.id === id;
        });
        return (
          typeof id !== "string" ||
          !selected.has(id) ||
          !item ||
          item.status !== "ready" ||
          item.type !== "reply" ||
          !item.replyTo ||
          item.replyTo.resolvable !== true ||
          item.replyTo.resolved !== false
        );
      })
    )
      throw refusal(
        "Only selected replies to open, resolvable discussions can resolve a discussion.",
      );
    // Drafts never resolve discussions, even if an older UI passes selections.
    const resolving = new Set(mode === "publish" ? resolveIds : []);
    if (typeof options.csrfToken !== "string" || !options.csrfToken.trim())
      throw refusal("Reload the GitLab page before sending comments.");
    const lock = context.webUrl;
    if (running.has(lock))
      throw refusal("Comments are already being sent for this merge request.");
    running.add(lock);
    const output: ImportResult = { items: [], warnings: [] };
    const targets = internal.items.filter(function (item) {
      return selected.has(item.id);
    });
    let everBegan = false;
    function append(result: ImportResultItem) {
      internal.outcomes[result.id] = result.status;
      output.items.push(result);
      progress(options, {
        phase: "publishing",
        completed: output.items.length,
        total: targets.length,
        item: result,
      });
    }
    try {
      let current = await metadata(context, options);
      if (!sameRefs(current.refs, internal.refs)) {
        if (
          !targets.some(function (item) {
            return item.type === "reply";
          })
        )
          throw new Error(
            "The merge request changed after the preview. Check the review again before sending comments.",
          );
        warning(output.warnings, replyNotice(true));
      }
      const existing = await existingNotes(context, options);
      if (existing.userId !== internal.userId)
        throw new Error(
          "Your GitLab account changed. Check the review again before sending comments.",
        );
      if (mode === "draft" && !existing.draftSupported)
        throw new Error(
          "This GitLab version cannot add review drafts through the API. You can choose Publish instead.",
        );
      for (const item of targets) {
        if (item.status !== "ready") {
          append(
            resultItem(
              item,
              item.status === "duplicate" ? "duplicate" : "skipped",
              item.message,
              item.existingUrl,
            ),
          );
          continue;
        }
        if (options.signal && options.signal.aborted) {
          append(
            resultItem(
              item,
              "skipped",
              "Sending was cancelled before this comment.",
            ),
          );
          continue;
        }
        const duplicate = findExisting(existing, item);
        const key = operationKey(context, item, internal.userId);
        if (duplicate) {
          await confirmed(key, duplicate, output.warnings);
          append(
            resultItem(
              item,
              "duplicate",
              "This comment already exists.",
              duplicate.url,
            ),
          );
          continue;
        }
        let began = false;
        let ownsPending = false;
        try {
          if (item.type === "reply" && !item.discussion_id)
            throw new Error("Missing reply discussion ID");
          const saved = await checkedPending(key, existing, context, options);
          if (saved) {
            if (saved.status === "published" || saved.status === "draft")
              append(
                resultItem(
                  item,
                  "duplicate",
                  "This comment was already confirmed as saved in GitLab.",
                  confirmedUrl(context, saved),
                ),
              );
            else
              append(
                resultItem(
                  item,
                  "unknown",
                  "A previous send has an unknown result. This comment was not sent again.",
                ),
              );
            continue;
          }
          if (item.type === "reply") {
            const freshThread = validateDiscussion(
              (
                await request(
                  context,
                  endpoint(context) +
                    "/discussions/" +
                    encodeURIComponent(item.discussion_id || ""),
                  options,
                ).then(decodeResponse(readDiscussion))
              ).data,
            );
            if (!targetNote(freshThread, item)) {
              append(
                resultItem(
                  item,
                  "skipped",
                  "The original comment is no longer in this discussion. Check the reply again.",
                ),
              );
              continue;
            }
            if (
              discussionFingerprint(freshThread) !==
              internal.replyFingerprints[item.id]
            ) {
              append(
                resultItem(
                  item,
                  "skipped",
                  "This discussion changed after the preview. Check the reply again.",
                ),
              );
              continue;
            }
            if (mode === "draft" && otherReplyDraft(existing, item)) {
              append(
                resultItem(
                  item,
                  "failed",
                  "You already have a different draft reply in this discussion. It has not been changed. Publish directly or review that draft in GitLab.",
                ),
              );
              continue;
            }
          }
          // New findings depend on the checked revision; replies depend on the
          // verified discussion above and survive pushes or rewritten history.
          current = await metadata(context, options);
          if (!sameRefs(current.refs, internal.refs)) {
            warning(output.warnings, replyNotice(true));
            if (item.type !== "reply") {
              append(
                resultItem(
                  item,
                  "skipped",
                  "The merge request changed. Check the review again.",
                ),
              );
              continue;
            }
          }
          checkAbort(options.signal);
          ownsPending = true;
          await remember(key, "pending");
          checkAbort(options.signal);
          const payload: {
            note?: string;
            body?: string;
            in_reply_to_discussion_id?: string;
            position?: NotePosition;
          } = mode === "draft" ? { note: item.body } : { body: item.body };
          if (item.type === "reply" && mode === "draft") {
            if (!item.discussion_id)
              throw new Error("Missing reply discussion ID");
            payload.in_reply_to_discussion_id = item.discussion_id;
          } else if (item.position) {
            payload.position = clone(item.position);
            if (payload.position.old_line === null)
              delete payload.position.old_line;
            if (payload.position.new_line === null)
              delete payload.position.new_line;
          }
          began = true;
          everBegan = true;
          const writePath =
            mode === "draft"
              ? "/draft_notes"
              : item.type === "reply"
                ? "/discussions/" +
                  encodeURIComponent(item.discussion_id || "") +
                  "/notes"
                : "/discussions";
          const created = (
            await request(
              context,
              endpoint(context) + writePath,
              options,
              payload,
            ).then(decodeResponse(readCreatedComment))
          ).data;
          const note =
            mode === "draft" || item.type === "reply"
              ? created
              : created && Array.isArray(created.notes) && created.notes[0];
          const createdPosition =
            note &&
            note.position &&
            (note.position.old_path || note.position.new_path)
              ? note.position
              : null;
          const locationConfirmed =
            item.type === "reply"
              ? mode !== "draft" ||
                (note &&
                  note.discussion_id === item.discussion_id &&
                  note.resolve_discussion !== true)
              : equalPosition(createdPosition, item.position);
          if (
            !note ||
            !positive(note.id) ||
            (mode === "draft" ? note.note : note.body) !== item.body ||
            !locationConfirmed
          )
            throw new Error(
              "GitLab did not confirm the expected comment and location.",
            );
          const url =
            context.webUrl +
            (mode === "draft" ? "#draft_" : "#note_") +
            note.id;
          existing.notes.push({
            body: item.body,
            position: item.position,
            url: url,
            id: note.id,
            draft: mode === "draft",
            isReply: item.type === "reply",
            discussion_id: item.discussion_id || null,
          });
          await confirmed(
            key,
            { draft: mode === "draft", id: note.id },
            output.warnings,
          );
          const result = resultItem(
            item,
            mode === "draft" ? "draft" : "published",
            mode === "draft" ? "Added to your review drafts." : "Published.",
            url,
          );
          if (resolving.has(item.id))
            await resolvePublishedReply(
              context,
              internal,
              item,
              note.id,
              options,
              result,
            );
          append(result);
        } catch (errorValue) {
          const error = toError(errorValue);
          if (
            !began ||
            ((error.httpStatus || 0) >= 400 &&
              (error.httpStatus || 0) < 500 &&
              error.httpStatus !== 408)
          ) {
            if (ownsPending) await forget(key).catch(function () {});
            append(
              resultItem(
                item,
                error.name === "AbortError" ? "skipped" : "failed",
                error.message,
              ),
            );
          } else {
            await remember(key, "unknown").catch(function () {});
            const recovered = await reconcile(context, item, options);
            if (recovered) {
              await confirmed(key, recovered, output.warnings);
              existing.notes.push(recovered);
              const recoveredResult = resultItem(
                item,
                recovered.draft ? "draft" : "published",
                "The comment was found in GitLab after an interrupted response.",
                recovered.url,
              );
              if (!recovered.draft && resolving.has(item.id))
                await resolvePublishedReply(
                  context,
                  internal,
                  item,
                  recovered.id,
                  options,
                  recoveredResult,
                );
              append(recoveredResult);
            } else
              append(
                resultItem(
                  item,
                  "unknown",
                  "GitLab did not confirm whether this comment was saved. Check the merge request; this comment will not be retried automatically.",
                ),
              );
          }
        }
      }
      return output;
    } catch (errorValue) {
      const error = toError(errorValue);
      error.beforeSend = !everBegan;
      throw error;
    } finally {
      running.delete(lock);
    }
  }

  return {
    DEFAULT_REVIEW_PROMPT: DEFAULT_REVIEW_PROMPT,
    DEFAULT_REPLY_PROMPT: DEFAULT_REPLY_PROMPT,
    getPrompt: getPrompt,
    getReplyPrompt: getReplyPrompt,
    getResponseFormat: getResponseFormat,
    prepare: prepare,
    revise: revise,
    publish: publish,
  };
}
