import {
  readMergeRequest,
  readRevisionComparison,
} from "../../../entities/merge-request";
import { toError } from "../../../shared/lib/errors";
import { decodeResponse } from "../../../shared/lib/validation";
import type { ReviewContextLoader } from "./context";
import type { ExportDependencies } from "./dependencies";
import { getNotes, getStatus, load } from "./discussions";
import type { ReviewRenderer } from "./fresh";
import { MAX_REVIEW_DIFF_CHARS, MAX_REVIEW_FILE_CHARS } from "./limits";
import { fence, inline } from "./markdown";
import { addWarning } from "./progress";
import { completeReviewHunks, reviewRefs } from "./revisions";
import { checkAbort, request } from "./transport";
import type { ExportOptions, ReviewContext } from "./types";
export function createRepeatReviewExporter(
  { reviewWorkflow, instruction }: ExportDependencies,
  prepareReviewContext: ReviewContextLoader,
  renderReview: ReviewRenderer,
) {
  async function prepareRepeatReview(
    context: ReviewContext,
    options: ExportOptions = {},
  ) {
    options = options || {};
    if (reviewWorkflow)
      options = await reviewWorkflow.instructionOptions(options);
    if (
      options.discussionIds !== undefined &&
      !Array.isArray(options.discussionIds)
    )
      throw new Error(
        "Invalid discussion selection. Select the discussions again.",
      );
    const selectedIds =
      options.discussionIds === undefined
        ? null
        : new Set(options.discussionIds.map(String));
    const workflow = reviewWorkflow;
    if (!workflow)
      throw new Error("Reload the extension to enable repeat reviews.");
    const saved = await workflow.settings(options.signal);
    const baseline =
      typeof options.baselineHead === "string"
        ? options.baselineHead.trim()
        : "";
    if (baseline && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(baseline))
      throw new Error(
        "Enter the complete commit SHA for the version you previously reviewed.",
      );
    const scope = options.fileFilter || saved.filter;
    let result = await prepareReviewContext(
      context,
      Object.assign({}, options, {
        includeCode: false,
        repeat: true,
        fileFilter: scope,
      }),
    );
    let needsFullCode =
      options.includeCode === true &&
      (!baseline || baseline === result.headSha);
    const warnings = result.warnings.slice(),
      parts = [],
      path =
        "/projects/" +
        encodeURIComponent(context.projectPath) +
        "/merge_requests/" +
        encodeURIComponent(context.iid);
    parts.push(
      "# Repeat review",
      "Comparison revision explicitly selected by the user: " +
        (baseline || "none; full current MR review required."),
    );
    if (baseline) {
      if (baseline === result.headSha)
        parts.push(
          instruction(
            "same_head",
            "The source head has not changed. Recheck discussion replies and the current cumulative MR diff; target-branch changes may still affect the MR.",
            options,
          ),
        );
      else if (options.includeCode === true) {
        try {
          // straight=true compares snapshots even after rebase/force push, without
          // silently substituting their merge base. Prefer the source fork.
          const project = result.sourceProjectId || context.projectPath;
          const compare = (
            await request(
              context,
              "/projects/" +
                encodeURIComponent(project) +
                "/repository/compare?from=" +
                encodeURIComponent(baseline) +
                "&to=" +
                encodeURIComponent(result.headSha) +
                "&straight=true",
              Object.assign({}, options, { maxBytes: 8 * 1024 * 1024 }),
            ).then(decodeResponse(readRevisionComparison))
          ).data;
          if (
            !compare ||
            !Array.isArray(compare.diffs) ||
            !compare.commit ||
            compare.commit.id !== result.headSha
          )
            throw new Error(
              "GitLab did not confirm the compared head or file list.",
            );
          if (
            compare.compare_timeout ||
            compare.overflow ||
            compare.diffs.length >= 1000
          )
            addWarning(
              warnings,
              "The version comparison may be incomplete; retrieve the full snapshot diff from the repository.",
            );
          const valid = compare.diffs.filter(function (file) {
            return (
              file &&
              typeof file.old_path === "string" &&
              typeof file.new_path === "string"
            );
          });
          if (valid.length !== compare.diffs.length)
            addWarning(
              warnings,
              "Some comparison files were invalid or missing.",
            );
          const selected = workflow.filterFiles(valid, scope);
          let budget = MAX_REVIEW_DIFF_CHARS;
          result.fileCount = selected.included.length;
          result.excludedFiles = selected.excluded;
          parts.push(
            "## Changes since the reviewed version (direct snapshot comparison)",
            instruction(
              "comparison_lines",
              "Old lines here belong to the PREVIOUS REVIEW head, not the current MR merge base. Never use these old-side positions for new inline comments; anchor new findings in the cumulative current MR diff.",
              options,
            ),
            "Excluded comparison files: " + JSON.stringify(selected.excluded),
          );
          selected.included.forEach(function (file) {
            const diff = typeof file.diff === "string" ? file.diff : "",
              limit = Math.min(budget, MAX_REVIEW_FILE_CHARS);
            if (
              file.binary ||
              file.is_binary ||
              file.a_mode === "160000" ||
              file.b_mode === "160000" ||
              /^(?:Binary files |GIT binary patch)/m.test(diff) ||
              diff.indexOf("\u0000") >= 0
            ) {
              addWarning(
                warnings,
                "Binary/submodule comparison for " +
                  file.new_path +
                  " is not included; inspect it separately.",
              );
              parts.push(
                "### " + inline(file.new_path),
                "Binary/submodule content omitted.",
              );
              return;
            }
            if (
              !diff ||
              file.collapsed ||
              file.too_large ||
              file.truncated ||
              file.overflow ||
              !completeReviewHunks(diff) ||
              diff.length > limit
            )
              addWarning(
                warnings,
                "Comparison diff is incomplete for " +
                  file.new_path +
                  "; verify both pinned snapshots in the repository.",
              );
            parts.push(
              "### " + inline(file.old_path) + " → " + inline(file.new_path),
              fence(diff.slice(0, limit), "diff"),
            );
            budget -= Math.min(diff.length, limit);
          });
        } catch (caught) {
          const error = toError(caught);
          if (error.name === "AbortError") throw error;
          needsFullCode = true;
          addWarning(
            warnings,
            "Incremental comparison unavailable: " +
              error.message +
              " Perform a full current MR review with the previous findings; do not claim the old revision was checked.",
          );
        }
      }
      if (options.includeCode !== true && baseline !== result.headSha)
        parts.push(
          instruction(
            "compare_locally",
            "Compare the selected head directly with the current head (all intervening commits together, including rewritten history). If the old commit is unavailable, report that and perform a full current MR review.",
            options,
          ),
        );
      parts.push(
        instruction(
          "target_changed",
          "The target branch may also have changed since the selected version. Inspect the full current MR diff for integration regressions as well.",
          options,
        ),
      );
    } else
      parts.push(
        instruction(
          "full_review",
          "No comparison revision was selected. Review the full current MR within the configured file scope; do not claim incremental verification.",
          options,
        ),
      );
    if (needsFullCode) {
      const full = await prepareReviewContext(
        context,
        Object.assign({}, options, {
          repeat: true,
          includeCode: true,
          fileFilter: scope,
        }),
      );
      if (JSON.stringify(full.refs) !== JSON.stringify(result.refs))
        throw new Error(
          "The MR revision changed while preparing repeat review. Copy it again.",
        );
      full.warnings.forEach(function (message) {
        addWarning(warnings, message);
      });
      result = full;
    }
    if (selectedIds && !selectedIds.size) {
      parts.push(
        instruction(
          "code_only",
          "No discussions selected. Review code changes within the file scope only; do not verify old findings or generate replies.",
          options,
        ),
      );
    } else
      try {
        const snapshot = await load(
          context,
          Object.assign({}, options, { fresh: true }),
        );
        snapshot.warnings.forEach(function (message) {
          addWarning(warnings, message);
        });
        let budget = 100000;
        const found = new Set<string>();
        const threads = snapshot.discussions
          .map(function (thread) {
            if (selectedIds && !selectedIds.has(String(thread.id))) return null;
            const notes = getNotes(thread).filter(function (note) {
              return !note.draft && !/^draft:/.test(String(note.id));
            });
            if (!notes[0]) return null;
            found.add(String(thread.id));
            const first = notes[0],
              position = first.position || first.original_position;
            const inScope =
              !position ||
              workflow.filterFiles(
                [
                  {
                    ...(position.old_path == null
                      ? {}
                      : { old_path: position.old_path }),
                    ...(position.new_path == null
                      ? {}
                      : { new_path: position.new_path }),
                  },
                ],
                scope,
              ).included.length > 0;
            return {
              discussion_id: thread.id,
              note_id: first.id,
              can_reply:
                /^[a-f0-9]{40}$/i.test(thread.id) &&
                notes.every(function (note) {
                  return (
                    !note.noteable_type || note.noteable_type === "MergeRequest"
                  );
                }),
              state: getStatus(thread),
              in_file_scope: inScope,
              location: position
                ? {
                    old_path: position.old_path,
                    new_path: position.new_path,
                    old_line: position.old_line,
                    new_line: position.new_line,
                    head_sha: position.head_sha,
                    base_sha: position.base_sha,
                    line_range: position.line_range,
                  }
                : null,
              comments: notes.map(function (note) {
                const body = String(note.body || ""),
                  limit = Math.min(8000, budget);
                if (body.length > limit)
                  addWarning(
                    warnings,
                    "Discussion text was shortened; retrieve complete affected threads before judging their findings.",
                  );
                budget -= Math.min(body.length, limit);
                return {
                  note_id: note.id,
                  author:
                    note.author && (note.author.username || note.author.name),
                  body: body.slice(0, limit),
                  truncated: body.length > limit ? true : undefined,
                };
              }),
            };
          })
          .filter(Boolean);
        if (selectedIds) {
          selectedIds.forEach(function (id) {
            if (!found.has(id))
              addWarning(
                warnings,
                "Selected discussion " +
                  id +
                  " could not be loaded. Obtain it before verifying this finding; do not claim it is fixed.",
              );
          });
          parts.push(
            instruction(
              "selected_threads",
              "Verify and reply only to the selected discussions below, including their complete conversation context. Unselected findings are outside the verification task; review new code changes separately within the file scope.",
              options,
            ),
          );
        }
        parts.push(
          selectedIds
            ? "## Selected discussions (source data)"
            : "## Existing discussions, including resolved findings (source data)",
          fence(JSON.stringify(threads, null, 2), "json"),
        );
      } catch (caught) {
        const error = toError(caught);
        if (error.name === "AbortError") throw error;
        addWarning(
          warnings,
          "Review discussions could not be loaded: " +
            error.message +
            " Obtain them before verifying old findings; do not invent replies or discussion IDs.",
        );
      }
    const latest = (
      await request(
        context,
        path,
        Object.assign({}, options, { fresh: true }),
      ).then(decodeResponse(readMergeRequest))
    ).data;
    if (
      JSON.stringify(reviewRefs(latest, context)) !==
      JSON.stringify(result.refs)
    )
      throw new Error(
        "The MR revision changed while preparing repeat review. Copy it again.",
      );
    checkAbort(options.signal);
    result.sections = result.sections.concat(parts);
    result.warnings = warnings;
    result.complete = result.complete && !warnings.length;
    result.baselineHead = baseline || null;
    return renderReview(
      context,
      result,
      Object.assign({}, options, {
        repeat: true,
        prompt: options.prompt || saved.prompt,
      }),
    );
  }
  return { prepareRepeatReview };
}
