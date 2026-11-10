import type { ReviewContext } from "../../../entities/review";
import { emptyRecord } from "../../../shared/lib/records";
import { loadDiffs } from "./diff";
import {
  discussionFingerprint,
  existingNotes,
  findExisting,
  otherReplyDraft,
  replyContext,
  targetNote,
} from "./discussions";
import type { DeliveryJournal } from "./journal";
import { metadata } from "./transport";
import type {
  ImportEdit,
  ImportItem,
  ImportOptions,
  ImportPlan,
  InternalPlan,
} from "./types";
import {
  checkAbort,
  clone,
  progress,
  replyNotice,
  sameRefs,
  warning,
} from "./utils";
import {
  bodyError,
  itemError,
  parseInput,
  safeContext,
  validComment,
} from "./validation";
export function createImportPlanner(
  plans: WeakMap<ImportPlan, InternalPlan>,
  running: Set<string>,
  {
    operationKey,
    confirmed,
    checkedPending,
    confirmedUrl,
    pending,
  }: DeliveryJournal,
) {
  async function prepare(
    inputContext: ReviewContext,
    jsonText: string,
    options: ImportOptions = {},
  ) {
    options = options || {};
    const context = safeContext(inputContext);
    const input = parseInput(jsonText, context);
    const warnings: string[] = [];
    progress(options, { phase: "checking" });
    const meta = await metadata(context, options);
    const hasReplies = input.comments.some(function (item) {
      return item.type === "reply";
    });
    const stale =
      input.head_sha != null && input.head_sha !== meta.refs.head_sha;
    if (stale && !hasReplies)
      throw new Error(
        "The merge request has changed since this review. Ask the AI to review the current commit.",
      );
    if (stale) warning(warnings, replyNotice(true));
    if (hasReplies && input.head_sha == null)
      warning(warnings, replyNotice(false));
    const inlineTargets = !stale
      ? input.comments.filter(validComment).filter(function (item) {
          return item.type !== "reply" && item.path !== null;
        })
      : [];
    const loaded = await Promise.all([
      inlineTargets.length
        ? loadDiffs(context, options, warnings, inlineTargets, meta.refs)
        : Promise.resolve([]),
      existingNotes(context, options),
    ]);
    const files = loaded[0];
    const existing = loaded[1];
    if (!existing.draftSupported)
      warning(
        warnings,
        "This GitLab version does not provide draft comments through the API. Publishing comments remains available.",
      );
    const current = await metadata(context, options);
    const changedDuringCheck = !sameRefs(current.refs, meta.refs);
    if (changedDuringCheck && !hasReplies)
      throw new Error(
        "The merge request changed while the review was being checked. Check the review again.",
      );
    if (changedDuringCheck) warning(warnings, replyNotice(true));
    const items: ImportItem[] = [];
    const signatures = new Set<string>();
    const repliedThreads = new Set<string>();
    const replyFingerprints: Record<string, string> = emptyRecord();
    for (const [index, source] of input.comments.entries()) {
      checkAbort(options.signal);
      const item: ImportItem = {
        id: source.id,
        type: source.type === "reply" ? "reply" : "comment",
        path: typeof source.path === "string" ? source.path : null,
        side:
          source.side === "old" || source.side === "new" ? source.side : null,
        line: typeof source.line === "number" ? source.line : null,
        code: typeof source.code === "string" ? source.code : null,
        body: typeof source.body === "string" ? source.body : "",
        status: "ready",
        message: "",
        position: null,
        editable: true,
      };
      let error = itemError(source);
      if (!error && item.type !== "reply" && (stale || changedDuringCheck))
        error =
          "The merge request changed. Ask the AI to review the current code before posting this new finding.";
      if (item.type === "reply") {
        if (typeof source.discussion_id === "string")
          item.discussion_id = source.discussion_id;
        if (typeof source.note_id === "number") item.note_id = source.note_id;
        item.path = null;
        item.side = null;
        item.line = null;
        item.code = null;
        if (!error) {
          const discussion = existing.discussions.find(function (d) {
            return d.id === item.discussion_id;
          });
          const target = targetNote(discussion, item);
          if (!discussion || !target)
            error =
              "The requested published comment was not found in this merge request discussion.";
          else if (repliedThreads.has(discussion.id))
            error = "Include only one reply per discussion in this import.";
          else {
            repliedThreads.add(discussion.id);
            item.replyTo = replyContext(context, discussion, target);
            replyFingerprints[item.id] = discussionFingerprint(discussion);
            if (otherReplyDraft(existing, item))
              item.message =
                "You already have a different draft reply in this discussion. Publish this reply directly or review the existing draft in GitLab.";
          }
        }
      } else if (!error && source.path !== null) {
        const matches = files.filter(function (file) {
          return (
            file[source.side === "old" ? "old_path" : "new_path"] ===
            source.path
          );
        });
        const match = matches[0];
        if (matches.length !== 1 || !match)
          error =
            "This file could not be uniquely found in the loaded merge request changes.";
        else if (match.error) error = match.error;
        else {
          const line =
            (source.side === "old" || source.side === "new") &&
            typeof source.line === "number"
              ? match.lines?.[source.side].get(source.line)
              : undefined;
          if (!line)
            error =
              "This line is not in the verified diff. Choose a line from the merge request changes.";
          else if (line.code !== source.code)
            error =
              "The code on this line does not match the review. Ask the AI to check the exact line.";
          else
            item.position = Object.assign(
              {
                position_type: "text",
                old_path: match.old_path,
                new_path: match.new_path,
              },
              meta.refs,
              { old_line: line.old_line, new_line: line.new_line },
            );
        }
      }
      if (error) {
        item.status = "invalid";
        item.message = error;
      } else {
        const key = operationKey(context, item, existing.userId);
        const duplicate = findExisting(existing, item);
        if (duplicate) {
          item.status = "duplicate";
          item.message = duplicate.draft
            ? "This comment is already in your review drafts."
            : "This comment is already published.";
          item.existingUrl = duplicate.url;
          await confirmed(key, duplicate, warnings);
        } else {
          const saved = await checkedPending(key, existing, context, options);
          if (
            saved &&
            (saved.status === "published" || saved.status === "draft")
          ) {
            item.status = "duplicate";
            item.message =
              "This comment was already confirmed as saved in GitLab.";
            item.existingUrl = confirmedUrl(context, saved);
          } else if (saved) {
            item.status = "invalid";
            item.editable = false;
            item.message =
              "A previous send has an unknown result. Check GitLab before sending this comment again; it will not be retried automatically.";
          } else if (signatures.has(key)) {
            item.status = "duplicate";
            item.message =
              "The same comment and location appear more than once in this import.";
          }
        }
        signatures.add(key);
      }
      if (item.status === "duplicate") item.editable = false;
      items.push(item);
      progress(options, {
        phase: "checking",
        completed: index + 1,
        total: input.comments.length,
      });
    }
    const plan = {
      context: clone(context),
      headSha: meta.refs.head_sha,
      refs: clone(meta.refs),
      mrTitle: String(meta.entity.title || ""),
      items: items,
      warnings: warnings,
      draftSupported: existing.draftSupported,
      source: clone(input),
    };
    plans.set(plan, {
      context: context,
      refs: clone(meta.refs),
      items: clone(items),
      userId: existing.userId,
      replyFingerprints: replyFingerprints,
      source: clone(input),
      outcomes: emptyRecord(),
    });
    return plan;
  }

  async function revise(
    plan: ImportPlan,
    edits: ImportEdit[],
    options: ImportOptions = {},
  ) {
    options = options || {};
    const stored = plans.get(plan);
    if (!stored) throw new Error("Check the review before editing comments.");
    const internal = stored;
    const context = safeContext(internal.context);
    checkAbort(options.signal);
    if (running.has(context.webUrl))
      throw new Error(
        "Wait until comments finish sending before editing the preview.",
      );
    if (!Array.isArray(edits) || !edits.length || edits.length > 200)
      throw new Error("Choose the comment text to edit.");
    const source = clone(internal.source);
    const edited = new Set<string>();
    const originals: ImportItem[] = [];
    edits.forEach(function (edit) {
      if (
        !edit ||
        typeof edit.id !== "string" ||
        !edit.id.trim() ||
        edit.id.length > 128 ||
        /[\x00-\x1f\x7f]/.test(edit.id) ||
        edited.has(edit.id) ||
        Object.keys(edit).some(function (key) {
          return key !== "id" && key !== "body" && key !== "add";
        }) ||
        (edit.add != null && typeof edit.add !== "boolean")
      )
        throw new Error(
          "Each edit needs a unique comment ID and text; its discussion and file location cannot be changed.",
        );
      const invalidBody = bodyError(edit.body);
      if (invalidBody) throw new Error(invalidBody);
      edited.add(edit.id);
      const item = internal.items.find(function (value) {
        return value.id === edit.id;
      });
      if (edit.add === true) {
        if (
          item ||
          source.comments.some(function (value) {
            return value.id === edit.id;
          })
        )
          throw new Error("The new comment needs its own unique ID.");
        source.comments.push({
          id: edit.id,
          type: "comment",
          path: null,
          side: null,
          line: null,
          code: null,
          body: edit.body,
        });
        if (source.head_sha == null) source.head_sha = internal.refs.head_sha;
      } else {
        if (!item)
          throw new Error("This comment is not in the checked preview.");
        originals.push(item);
        const original = source.comments.find((value) => value.id === edit.id);
        if (!original)
          throw new Error("This comment is not in the checked source.");
        original.body = edit.body;
      }
    });
    if (source.comments.length > 200)
      throw new Error("A review can contain at most 200 comments.");
    function checkEditableState() {
      if (running.has(context.webUrl))
        throw new Error(
          "Wait until comments finish sending before editing the preview.",
        );
      originals.forEach(function (item) {
        const outcome = internal.outcomes[item.id] || "";
        if (
          item.editable === false ||
          item.status === "duplicate" ||
          ["published", "draft", "unknown", "duplicate"].indexOf(outcome) >= 0
        )
          throw new Error(
            "This comment is already saved or its delivery is uncertain. Check it in GitLab before making another comment.",
          );
      });
    }
    async function checkEditable() {
      checkEditableState();
      for (const item of originals) {
        const saved = await pending(
          operationKey(context, item, internal.userId),
        );
        if (saved)
          throw new Error(
            "This comment was already sent or its delivery is uncertain. Check it in GitLab before making another comment.",
          );
      }
      checkAbort(options.signal);
      checkEditableState();
    }
    await checkEditable();
    const revised = await prepare(context, JSON.stringify(source), options);
    const next = plans.get(revised);
    if (!next)
      throw new Error("Check the revised review before editing comments.");
    if (!sameRefs(next.refs, internal.refs)) {
      if (
        !source.comments.some(function (item) {
          return item.type === "reply";
        })
      )
        throw new Error(
          "The merge request changed after the preview. Check the review again before editing comments.",
        );
      warning(revised.warnings, replyNotice(true));
      revised.items.forEach(function (item) {
        if (item.type !== "reply" && item.status === "ready") {
          item.status = "invalid";
          item.message =
            "The merge request changed. Check this new finding again.";
        }
      });
    }
    if (next.userId !== internal.userId)
      throw new Error(
        "Your GitLab account changed. Check the review again before editing comments.",
      );
    await checkEditable();
    checkAbort(options.signal);
    checkEditableState();
    // Rechecking an edited body must not silently accept a discussion that
    // changed after the original preview. Keep the edit visible, but require
    // another explicit check of the updated conversation before it can send.
    revised.items.forEach(function (item) {
      if (
        item.type === "reply" &&
        item.status === "ready" &&
        typeof internal.replyFingerprints[item.id] === "string" &&
        next.replyFingerprints[item.id] !== internal.replyFingerprints[item.id]
      ) {
        item.status = "invalid";
        item.message =
          "This discussion changed after the preview. Review its updated comments and check the review again.";
        const fingerprint = internal.replyFingerprints[item.id];
        if (fingerprint !== undefined)
          next.replyFingerprints[item.id] = fingerprint;
      }
    });
    next.items = clone(revised.items);
    next.outcomes = Object.assign(emptyRecord(), internal.outcomes);
    return revised;
  }
  return { prepare, revise };
}
