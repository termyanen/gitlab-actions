import type { Commit, FileDiff } from "../../../entities/merge-request";
import {
  readCommit,
  readFileDiff,
  readLegacyChanges,
} from "../../../entities/merge-request";
import { toError } from "../../../shared/lib/errors";
import { decodeResponse } from "../../../shared/lib/validation";
import type { ExportDependencies } from "./dependencies";
import {
  MAX_REVIEW_DIFF_CHARS,
  MAX_REVIEW_FILE_CHARS,
  MAX_REVIEW_MESSAGE_CHARS,
} from "./limits";
import { fence, inline } from "./markdown";
import { addWarning, progress } from "./progress";
import {
  completeReviewHunks,
  readReviewEntity,
  reviewPages,
  reviewRefs,
} from "./revisions";
import { checkAbort, request } from "./transport";
import type { ExportOptions, ReviewContext, ReviewResult } from "./types";
export function createReviewContextLoader({
  reviewWorkflow,
  instruction,
}: ExportDependencies) {
  async function prepareReviewContext(
    context: ReviewContext,
    options: ExportOptions = {},
  ): Promise<ReviewResult & { sections: string[] }> {
    options = Object.assign({}, options || {}, { fresh: true });
    checkAbort(options.signal);
    if (!context || context.kind !== "merge_requests")
      throw new Error(
        "A fresh code review is available only for merge requests.",
      );
    const workflow = reviewWorkflow;
    const scope = workflow
      ? options.fileFilter ||
        (await workflow.settings(options.signal, context.projectPath)).filter
      : null;
    const warnings: string[] = [];
    const path =
      "/projects/" +
      encodeURIComponent(context.projectPath) +
      "/merge_requests/" +
      encodeURIComponent(context.iid);
    progress(options, { phase: "metadata", loaded: 0 });
    const entity = (
      await request(context, path, options).then(
        decodeResponse(readReviewEntity),
      )
    ).data;
    const refs = reviewRefs(entity, context);
    const results =
      options.includeCode === true
        ? await Promise.allSettled([
            reviewPages<Commit>(
              context,
              path + "/commits",
              "commits",
              options,
              warnings,
              readCommit,
            ),
            (async function () {
              try {
                return await reviewPages<FileDiff>(
                  context,
                  path + "/diffs",
                  "diffs",
                  options,
                  warnings,
                  readFileDiff,
                );
              } catch (caught) {
                const error = toError(caught);
                if (
                  error.name === "AbortError" ||
                  [404, 405].indexOf(error.httpStatus || 0) < 0
                )
                  throw error;
                const legacy = (
                  await request(
                    context,
                    path + "/changes",
                    Object.assign({}, options, { maxBytes: 8 * 1024 * 1024 }),
                  ).then(decodeResponse(readLegacyChanges))
                ).data;
                if (!legacy || !Array.isArray(legacy.changes))
                  throw new Error("GitLab did not return MR changes.");
                if (
                  legacy.diff_refs &&
                  JSON.stringify(reviewRefs(legacy, context)) !==
                    JSON.stringify(refs)
                )
                  throw new Error(
                    "The MR revision changed while loading its changes. Copy the fresh review again.",
                  );
                if (legacy.sha && legacy.sha !== refs.head_sha)
                  throw new Error(
                    "The MR revision changed while loading its changes. Copy the fresh review again.",
                  );
                if (legacy.overflow === true)
                  addWarning(
                    warnings,
                    "GitLab truncated the legacy MR changes response (overflow); some files or hunks are missing.",
                  );
                const valid = legacy.changes.filter(function (item) {
                  return (
                    item &&
                    typeof item.old_path === "string" &&
                    item.old_path &&
                    typeof item.new_path === "string" &&
                    item.new_path
                  );
                });
                if (valid.length !== legacy.changes.length)
                  addWarning(
                    warnings,
                    "GitLab returned an incomplete MR diffs record; some context is missing.",
                  );
                progress(options, {
                  phase: "diffs",
                  page: 1,
                  loaded: valid.length,
                });
                return {
                  items: valid,
                  complete:
                    legacy.overflow !== true &&
                    valid.length === legacy.changes.length,
                };
              }
            })(),
          ])
        : undefined;
    checkAbort(options.signal);
    function loaded<T>(
      result:
        PromiseSettledResult<{ items: T[]; complete: boolean }> | undefined,
      kind: string,
    ) {
      if (!result) return { items: [], complete: true };
      if (result.status === "fulfilled") return result.value;
      const error = toError(result.reason);
      if (
        error.name === "AbortError" ||
        /MR revision changed/.test(error.message)
      )
        throw error;
      addWarning(
        warnings,
        "MR " + kind + " could not be loaded: " + error.message,
      );
      return { items: [], complete: false };
    }
    const commitList = loaded(results?.[0], "commits");
    const diffList = loaded(results?.[1], "diffs");
    const lists = [commitList, diffList];
    const commits = commitList.items;
    let diffs = diffList.items;
    if (options.includeCode === true) {
      if (
        !commits.some(function (commit) {
          return commit.id === refs.head_sha;
        })
      )
        addWarning(
          warnings,
          "The current head commit is missing from the loaded commit list; retrieve the full MR history before finishing the review.",
        );
      const changeCount = String(
        entity.changes_count == null ? "" : entity.changes_count,
      );
      if (/^\d+\+$/.test(changeCount))
        addWarning(
          warnings,
          "GitLab reports at least " +
            changeCount.slice(0, -1) +
            " changed files and may have limited the file list; verify the complete cumulative diff in the repository.",
        );
      else if (
        /^\d+$/.test(changeCount) &&
        Number(changeCount) !== diffs.length
      )
        addWarning(
          warnings,
          "GitLab reports " +
            changeCount +
            " changed files, but " +
            diffs.length +
            " were loaded; retrieve the full cumulative diff.",
        );
    }
    const metadata = [
      (options.repeat
        ? "# Current MR for repeat review: !"
        : "# Fresh review: merge request !") +
        context.iid +
        (entity.title ? ": " + inline(entity.title) : ""),
      context.webUrl,
      "Repository: " + inline(context.projectPath),
      "Branches: " +
        inline(entity.source_branch || "?") +
        " → " +
        inline(entity.target_branch || "?"),
      "Projects: source " +
        inline(entity.source_project_id || "?") +
        ", target " +
        inline(entity.target_project_id || entity.project_id || "?"),
      "Head SHA: " + inline(refs.head_sha),
      "Merge-base SHA: " + inline(refs.base_sha),
      "Target start SHA: " + inline(refs.start_sha),
    ];
    if (options.includeCode === true)
      metadata.push(
        "Loaded context: " +
          commits.length +
          " commits; " +
          diffs.length +
          " changed files.",
      );
    const sections = [metadata.join("\n")];
    const filtered = workflow
      ? workflow.filterFiles(diffs, scope)
      : { included: diffs, excluded: [] };
    diffs = filtered.included;
    const scopeText = workflow ? workflow.scopeText(scope, options) : "";
    if (scopeText) sections.push(scopeText);
    if (options.includeCode === true)
      sections.push(
        "## File selection",
        JSON.stringify(
          {
            included: diffs.map(function (file) {
              return file.deleted_file ? file.old_path : file.new_path;
            }),
            excluded: filtered.excluded,
          },
          null,
          2,
        ),
      );
    function bounded(input: unknown, limit: number, warning: string) {
      const value = String(input == null ? "" : input);
      if (value.length <= limit) return value;
      addWarning(warnings, warning);
      return value.slice(0, limit) + "\n[Remaining content omitted.]";
    }
    if (options.includeDescription !== false) {
      if (typeof entity.description !== "string")
        addWarning(warnings, "MR description is unavailable.");
      sections.push(
        "## MR description (background)",
        fence(
          bounded(
            entity.description || "(empty)",
            24000,
            "MR description was truncated at 24000 characters.",
          ),
          "markdown",
        ),
      );
      if (/!\[[^\]]*\]\(|\/uploads\//.test(entity.description || ""))
        addWarning(
          warnings,
          "Description attachment/image contents are not included; consult the MR for them.",
        );
    }
    if (options.includeCode === true) {
      sections.push("## Commits in this MR");
      let messageBudget = MAX_REVIEW_MESSAGE_CHARS;
      commits.forEach(function (commit) {
        let message =
          typeof commit.message === "string" && commit.message
            ? commit.message
            : commit.title;
        if (typeof message !== "string")
          addWarning(
            warnings,
            "Commit " + commit.id + " has no available message.",
          );
        message = String(message || "");
        const title =
          typeof commit.title === "string" && commit.title
            ? commit.title
            : message.split(/\r?\n/)[0] || "";
        sections.push(
          "### " +
            inline(commit.id) +
            (title
              ? " — " +
                inline(
                  bounded(
                    title,
                    500,
                    "Commit titles longer than 500 characters were shortened.",
                  ),
                )
              : ""),
        );
        // Keep every commit identity/title even after the optional message-body
        // budget is exhausted, without repeating the title as its entire body.
        if (message === title) message = "";
        else if (
          message.indexOf(title + "\n") === 0 ||
          message.indexOf(title + "\r\n") === 0
        )
          message = message.slice(title.length).replace(/^\r?\n/, "");
        const limit = Math.min(4000, messageBudget);
        if (message)
          sections.push(
            fence(
              bounded(
                message,
                limit,
                "Commit messages were shortened (4000 characters per commit, 60000 total); retrieve full messages where relevant.",
              ),
              "text",
            ),
          );
        messageBudget -= Math.min(message.length, limit);
      });
      if (!commits.length)
        sections.push(
          "Commit list unavailable or empty; consult the limitations.",
        );
      sections.push(
        "## Cumulative MR diff (all commits together)",
        instruction(
          "cumulative_diff",
          "Hunk line numbers refer to the pinned revisions above: old = merge base; new = MR head. Read full files and relevant dependencies/tests in the repository before concluding the review.",
          options,
        ),
      );
      let diffBudget = MAX_REVIEW_DIFF_CHARS;
      diffs.forEach(function (file) {
        const status = file.deleted_file
          ? "deleted"
          : file.new_file
            ? "added"
            : file.renamed_file || file.old_path !== file.new_path
              ? "renamed"
              : "modified";
        const label =
          file.old_path === file.new_path
            ? inline(file.new_path)
            : inline(file.old_path) + " → " + inline(file.new_path);
        sections.push(
          "### " +
            label +
            " — " +
            status +
            (file.generated_file ? " · generated" : "") +
            (file.a_mode !== file.b_mode
              ? " · mode " +
                inline(file.a_mode || "?") +
                " → " +
                inline(file.b_mode || "?")
              : ""),
        );
        const diff = typeof file.diff === "string" ? file.diff : "";
        const binary =
          file.binary === true ||
          file.is_binary === true ||
          diff.indexOf("\u0000") >= 0 ||
          /^(?:Binary files |GIT binary patch)/m.test(diff);
        const missing =
          file.collapsed === true ||
          file.too_large === true ||
          file.truncated === true ||
          file.overflow === true;
        if (missing)
          addWarning(
            warnings,
            "Diff for " +
              file.new_path +
              " was collapsed, truncated, or excluded by GitLab; fetch it from the pinned repository revision.",
          );
        if (binary || file.a_mode === "160000" || file.b_mode === "160000")
          addWarning(
            warnings,
            "Binary/submodule contents for " +
              file.new_path +
              " are not included; inspect them separately.",
          );
        if (binary) {
          sections.push("Binary contents omitted.");
          return;
        }
        if (!diff) {
          // Empty diffs can mean a pure rename/mode change, but older servers also
          // omit binary and over-limit content without flags. Do not guess which.
          addWarning(
            warnings,
            "No text diff was supplied for " +
              file.new_path +
              "; verify whether this is only a rename/mode change or unavailable content.",
          );
          sections.push("No text diff supplied.");
          return;
        }
        if (!completeReviewHunks(diff))
          addWarning(
            warnings,
            "Diff hunks for " +
              file.new_path +
              " appear incomplete or unsupported; retrieve the complete diff before reviewing this file.",
          );
        const limit = Math.min(MAX_REVIEW_FILE_CHARS, diffBudget);
        if (diff.length > limit)
          addWarning(
            warnings,
            "Cumulative text diffs were shortened (24000 characters per file, 120000 total); omitted hunks must be retrieved from the pinned repository revisions.",
          );
        if (limit) sections.push(fence(diff.slice(0, limit), "diff"));
        if (diff.length > limit)
          sections.push("Remaining diff omitted by the copy limit.");
        diffBudget -= Math.min(diff.length, limit);
      });
      if (!diffs.length)
        sections.push(
          "No changed-file diffs were loaded; verify the MR against the pinned revisions.",
        );
    }
    progress(options, { phase: "finalizing", loaded: 0 });
    const latest = (
      await request(context, path, options).then(
        decodeResponse(readReviewEntity),
      )
    ).data;
    if (JSON.stringify(reviewRefs(latest, context)) !== JSON.stringify(refs))
      throw new Error(
        "The MR revision changed while preparing the review. Copy the fresh review again.",
      );
    checkAbort(options.signal);
    return {
      sections: sections,
      warnings: warnings,
      complete:
        lists.every(function (list) {
          return list.complete;
        }) && !warnings.length,
      headSha: refs.head_sha,
      refs: refs,
      ...(entity.source_project_id === undefined
        ? {}
        : { sourceProjectId: entity.source_project_id }),
      commitCount: options.includeCode === true ? commits.length : null,
      fileCount: options.includeCode === true ? diffs.length : null,
      excludedFiles: filtered.excluded,
    };
  }
  return { prepareReviewContext };
}
export type ReviewContextLoader = ReturnType<
  typeof createReviewContextLoader
>["prepareReviewContext"];
