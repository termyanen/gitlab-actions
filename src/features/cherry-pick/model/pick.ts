import type { FileDiff } from "../../../entities/merge-request";
import {
  readFileDiff,
  readMergeRequest,
} from "../../../entities/merge-request";
import { createSessionApi } from "../../../shared/api/gitlab";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab-api";
import { applyUnifiedDiff } from "../../../shared/lib/diff";
import {
  errorCode,
  errorMessage,
  errorStatus,
} from "../../../shared/lib/errors";
import {
  arrayOf,
  decodeArray,
  decoder,
  isString,
  objectOf,
  optional,
} from "../../../shared/lib/validation";
import {
  bumpVersion,
  getNestedValue,
  parseToml,
  setNestedValue,
  updateTomlVersion,
} from "../../../shared/lib/version";
import type {
  CherryPickSettings,
  CommitInfo,
  FileAction,
  PickOperation,
  RepositoryFile,
} from "./types";
const readRepositoryFile = decoder(
  objectOf<RepositoryFile>({
    content: isString,
    last_commit_id: optional(isString),
  }),
  "GitLab/Jira response",
);
const readCommitInfo = decoder(
  objectOf<CommitInfo>({
    parent_ids: arrayOf(isString),
    message: optional(isString),
    author_name: optional(isString),
    author_email: optional(isString),
  }),
  "GitLab/Jira response",
);
export function createCherryPicker(
  origin: string,
  encodedProject: string,
  sha: string,
  settings: CherryPickSettings,
  shouldBump: () => boolean,
  msg: (key: string) => string,
) {
  const api = createSessionApi(() => origin);
  const shortSha = sha.substring(0, 8);
  function readOptionalFile(filePath: string, ref: string) {
    return api(
      "GET",
      "/projects/" +
        encodedProject +
        "/repository/files/" +
        encodeURIComponent(filePath) +
        "?ref=" +
        encodeURIComponent(ref),
    )
      .then(readRepositoryFile)
      .catch(function (err: unknown) {
        if (errorStatus(err) === 404) return null;
        throw err;
      });
  }
  function fetchCommitDiffs(
    page: number,
    acc: FileDiff[],
  ): Promise<FileDiff[]> {
    return api(
      "GET",
      "/projects/" +
        encodedProject +
        "/repository/commits/" +
        sha +
        "/diff?per_page=" +
        GITLAB_PAGE_SIZE +
        "&page=" +
        page,
    )
      .then(decodeArray(readFileDiff))
      .then(function (chunk) {
        const all = acc.concat(chunk);
        if (chunk.length < GITLAB_PAGE_SIZE) return all;
        if (page >= 10)
          throw new Error("Commit has too many files for smart fallback");
        return fetchCommitDiffs(page + 1, all);
      });
  }
  function doFallbackCommit(commitBranch: string, requireFileChanges: boolean) {
    return Promise.all([
      api(
        "GET",
        "/projects/" + encodedProject + "/repository/commits/" + sha,
      ).then(readCommitInfo),
      fetchCommitDiffs(1, []),
    ]).then(function (results) {
      const commitInfo = results[0];
      const diffs = results[1];
      const versionFile = settings.versionFile || "package.json";

      // A server that mishandles per_page/page params could return
      // overlapping pages; duplicate actions must never reach the
      // Commits API, so refuse on any repeated path
      const seenPaths: Record<string, boolean> = {};
      for (const currentDiff of diffs) {
        const dupKey = currentDiff.new_path || currentDiff.old_path;
        if (seenPaths[dupKey])
          throw new Error("Duplicate diff entries for: " + dupKey);
        seenPaths[dupKey] = true;
      }

      // Verify the version file is actually in the diff — if not,
      // the conflict is in another file and fallback cannot help
      const hasVersionFile = diffs.some(function (d) {
        return d.new_path === versionFile || d.old_path === versionFile;
      });
      if (!hasVersionFile)
        throw new Error(
          msg("cherryPickFallbackNoVersionFile") ||
            "Smart fallback only handles version file conflicts. Conflict is in another file",
        );

      // A confirmed conflict can become a bump-only commit. Legacy
      // ambiguous errors also require verifiable non-version changes.
      const filtered = diffs.filter(function (d) {
        return d.new_path !== versionFile && d.old_path !== versionFile;
      });
      if (!filtered.length && (requireFileChanges || !shouldBump()))
        throw new Error("No files left after excluding " + versionFile);

      const parentSha = commitInfo.parent_ids && commitInfo.parent_ids[0];
      if (!parentSha) throw new Error("Cannot determine parent commit");

      // Verify that the version file diff contains ONLY a version change.
      // If other fields were also modified (e.g. dependencies), dropping
      // the file would silently lose those changes.
      const vPath = settings.versionPath || "version";
      const isToml = versionFile.indexOf(".toml") !== -1;
      const isPlainText = versionFile.indexOf(".txt") !== -1;

      const versionOnlyCheck = Promise.all([
        api(
          "GET",
          "/projects/" +
            encodedProject +
            "/repository/files/" +
            encodeURIComponent(versionFile) +
            "?ref=" +
            parentSha,
        ).then(readRepositoryFile),
        api(
          "GET",
          "/projects/" +
            encodedProject +
            "/repository/files/" +
            encodeURIComponent(versionFile) +
            "?ref=" +
            sha,
        ).then(readRepositoryFile),
      ]).then(function (pair) {
        const parentVFile = pair[0];
        const commitVFile = pair[1];

        const parentContent = decodeURIComponent(
          escape(atob(parentVFile.content)),
        );
        const commitContent = decodeURIComponent(
          escape(atob(commitVFile.content)),
        );

        if (isPlainText) {
          // Plain text version files contain only the version — always safe
          return;
        }
        if (isToml) {
          const parentParsed = parseToml(parentContent);
          const parentV = getNestedValue(parentParsed, vPath);
          if (typeof parentV !== "string")
            throw new Error("Version not found at " + vPath);
          // Replace version in commit content with parent version and compare
          const normalized = updateTomlVersion(commitContent, vPath, parentV);
          if (normalized !== parentContent) {
            throw new Error(
              msg("cherryPickFallbackVersionFileHasOtherChanges") ||
                "Version file contains changes beyond version — cannot safely skip it",
            );
          }
        } else {
          // JSON — compare parsed objects to avoid formatting sensitivity
          const parentJson: unknown = JSON.parse(parentContent);
          const commitJson: unknown = JSON.parse(commitContent);
          const parentVersion = getNestedValue(parentJson, vPath);
          // Set version in commit JSON to parent's version, then compare objects
          setNestedValue(commitJson, vPath, parentVersion);
          if (JSON.stringify(parentJson) !== JSON.stringify(commitJson)) {
            throw new Error(
              msg("cherryPickFallbackVersionFileHasOtherChanges") ||
                "Version file contains changes beyond version — cannot safely skip it",
            );
          }
        }
      });

      return versionOnlyCheck.then(function () {
        // Build actions from diffs, verifying target branch safety
        const filePromises = filtered.map(
          function (d): Promise<FileAction | null> {
            if (d.deleted_file) {
              // For deletes, verify the file in target matches the parent
              // (i.e. target hasn't modified the file independently)
              return Promise.all([
                readOptionalFile(d.old_path, parentSha),
                readOptionalFile(d.old_path, commitBranch),
              ]).then(function (pair) {
                const parentFile = pair[0];
                const targetFile = pair[1];
                // File already absent in target — nothing to delete, skip
                if (!targetFile) return null;
                if (!parentFile || parentFile.content !== targetFile.content) {
                  throw new Error(
                    (msg("cherryPickFallbackDiverged") ||
                      "File was modified in target branch — cannot safely cherry-pick") +
                      ": " +
                      d.old_path,
                  );
                }
                return {
                  action: "delete",
                  file_path: d.old_path,
                  ...(targetFile.last_commit_id === undefined
                    ? {}
                    : { last_commit_id: targetFile.last_commit_id }),
                };
              });
            }
            if (d.new_file) {
              // New file — verify it doesn't already exist in target branch
              return Promise.all([
                api(
                  "GET",
                  "/projects/" +
                    encodedProject +
                    "/repository/files/" +
                    encodeURIComponent(d.new_path) +
                    "?ref=" +
                    sha,
                ).then(readRepositoryFile),
                readOptionalFile(d.new_path, commitBranch),
              ]).then(function (pair) {
                const sourceFile = pair[0];
                const targetFile = pair[1];
                if (targetFile) {
                  throw new Error(
                    (msg("cherryPickFallbackDiverged") ||
                      "File already exists in target branch — cannot safely cherry-pick") +
                      ": " +
                      d.new_path,
                  );
                }
                return {
                  action: "create",
                  file_path: d.new_path,
                  content: sourceFile.content,
                  encoding: "base64",
                };
              });
            }
            // Modified files: if the file in target is identical to the
            // commit's parent, copy the source content verbatim (exact
            // replay, works for any file type). If target diverged
            // elsewhere in the file, strictly re-apply the commit's own
            // hunks onto the target content — any context mismatch or
            // ambiguity means a real divergence at the changed lines,
            // so we refuse rather than guess
            return Promise.all([
              readOptionalFile(d.new_path, parentSha),
              readOptionalFile(d.new_path, commitBranch),
              api(
                "GET",
                "/projects/" +
                  encodedProject +
                  "/repository/files/" +
                  encodeURIComponent(d.new_path) +
                  "?ref=" +
                  sha,
              ).then(readRepositoryFile),
            ]).then(function (triple) {
              const parentFile = triple[0];
              const targetFile = triple[1];
              const sourceFile = triple[2];
              const divergedMsg =
                (msg("cherryPickFallbackDiverged") ||
                  "File was modified in target branch — cannot safely cherry-pick") +
                ": " +
                d.new_path;
              // Cannot verify safety without a baseline from parent
              // (also covers renames — parent has no file at new_path)
              if (!parentFile) throw new Error(divergedMsg);
              // File missing in target — it was deleted there independently
              if (!targetFile) throw new Error(divergedMsg);
              // Legacy GitLab cannot distinguish conflicts from empty
              // cherry-picks. Require a real, not-yet-applied file change.
              if (requireFileChanges) {
                if (parentFile.content === sourceFile.content)
                  throw new Error(divergedMsg);
                if (targetFile.content === sourceFile.content) return null;
              }
              if (parentFile.content === targetFile.content) {
                return {
                  action: "update",
                  file_path: d.new_path,
                  content: sourceFile.content,
                  encoding: "base64",
                  ...(targetFile.last_commit_id === undefined
                    ? {}
                    : { last_commit_id: targetFile.last_commit_id }),
                };
              }
              // Binary or mode-only changes carry no text diff — with a
              // diverged target there is nothing safe to apply
              if (!d.diff) throw new Error(divergedMsg);
              let parentText,
                targetText,
                sourceText,
                patchedParent,
                patchedTarget;
              try {
                parentText = decodeURIComponent(
                  escape(atob(parentFile.content)),
                );
                targetText = decodeURIComponent(
                  escape(atob(targetFile.content)),
                );
                sourceText = decodeURIComponent(
                  escape(atob(sourceFile.content)),
                );
                patchedParent = applyUnifiedDiff(parentText, d.diff);
              } catch {
                throw new Error(divergedMsg);
              }
              // Self-check: the diff applied to the commit's parent must
              // reproduce the commit's file byte-for-byte. If not, our
              // applier does not fully understand this diff — refuse
              if (patchedParent !== sourceText) {
                throw new Error("Cannot verify commit diff for: " + d.new_path);
              }
              try {
                patchedTarget = applyUnifiedDiff(targetText, d.diff);
              } catch {
                throw new Error(divergedMsg);
              }
              return {
                action: "update",
                file_path: d.new_path,
                content: btoa(unescape(encodeURIComponent(patchedTarget))),
                encoding: "base64",
                ...(targetFile.last_commit_id === undefined
                  ? {}
                  : { last_commit_id: targetFile.last_commit_id }),
              };
            });
          },
        );

        return Promise.all(filePromises).then(function (rawActions) {
          // Filter out nulls (e.g. files already deleted in target)
          const actions = rawActions.filter(function (a) {
            return a !== null;
          });
          if (!actions.length && (requireFileChanges || !shouldBump()))
            throw new Error("No applicable file changes for target branch");
          // Optionally bump version in the same commit
          if (!shouldBump()) {
            const commitMsg =
              (commitInfo.message || "") +
              "\n\n(cherry picked from commit " +
              sha +
              ")";
            return api(
              "POST",
              "/projects/" + encodedProject + "/repository/commits",
              {
                branch: commitBranch,
                commit_message: commitMsg,
                actions: actions,
                author_name: commitInfo.author_name,
                author_email: commitInfo.author_email,
              },
            );
          }

          const vFile = settings.versionFile || "package.json";
          const vPath = settings.versionPath || "version";
          const strategy = settings.versionStrategy || "patch";

          return api(
            "GET",
            "/projects/" +
              encodedProject +
              "/repository/files/" +
              encodeURIComponent(vFile) +
              "?ref=" +
              encodeURIComponent(commitBranch),
          )
            .then(readRepositoryFile)
            .then(function (file) {
              const rawContent = decodeURIComponent(escape(atob(file.content)));
              let currentVersion: unknown;
              let newContent: string;
              let newVersion: string;
              const isToml = vFile.indexOf(".toml") !== -1;
              const isPlainText = vFile.indexOf(".txt") !== -1;

              if (isPlainText) {
                newVersion = bumpVersion(rawContent.trim(), strategy);
                newContent = newVersion + "\n";
              } else if (isToml) {
                const parsed = parseToml(rawContent);
                currentVersion = getNestedValue(parsed, vPath);
                if (typeof currentVersion !== "string" || !currentVersion)
                  throw new Error("Version not found at " + vPath);
                newVersion = bumpVersion(currentVersion, strategy);
                newContent = updateTomlVersion(rawContent, vPath, newVersion);
              } else {
                const json: unknown = JSON.parse(rawContent);
                currentVersion = getNestedValue(json, vPath);
                if (typeof currentVersion !== "string" || !currentVersion)
                  throw new Error("Version not found at " + vPath);
                newVersion = bumpVersion(currentVersion, strategy);
                setNestedValue(json, vPath, newVersion);
                newContent = JSON.stringify(json, null, 2) + "\n";
              }

              // Add version file update to the same actions array
              actions.push({
                action: "update",
                file_path: vFile,
                content: btoa(unescape(encodeURIComponent(newContent))),
                encoding: "base64",
                ...(file.last_commit_id === undefined
                  ? {}
                  : { last_commit_id: file.last_commit_id }),
              });

              const commitMsg =
                (commitInfo.message || "") +
                "\n\n(cherry picked from commit " +
                sha +
                ")";
              return api(
                "POST",
                "/projects/" + encodedProject + "/repository/commits",
                {
                  branch: commitBranch,
                  commit_message: commitMsg,
                  actions: actions,
                  author_name: commitInfo.author_name,
                  author_email: commitInfo.author_email,
                },
              );
            });
        });
      }); // versionOnlyCheck.then
    });
  }
  function pick(
    operation: PickOperation,
    targetBranch: string,
    useFallback: boolean,
  ) {
    const createMr = operation.createMr;
    const commitBranch = operation.commitBranch;
    const branchPromise =
      createMr && !operation.branchCreated
        ? api("POST", "/projects/" + encodedProject + "/repository/branches", {
            branch: commitBranch,
            ref: targetBranch,
          }).then(function () {
            operation.branchCreated = true;
          })
        : Promise.resolve();

    return branchPromise
      .then(function () {
        if (operation.commitApplied) return;
        // Step 2: try cherry-pick
        return api(
          "POST",
          "/projects/" +
            encodedProject +
            "/repository/commits/" +
            sha +
            "/cherry_pick",
          {
            branch: commitBranch,
          },
        )
          .catch(function (cherryPickErr: unknown) {
            // GitLab 10.x used this same message for conflicts and empty
            // picks, without error_code. In that case verify actual file
            // changes before allowing a commit (never a bump-only replay).
            const legacyFailure =
              errorStatus(cherryPickErr) === 400 &&
              !errorCode(cherryPickErr) &&
              (errorMessage(cherryPickErr) || "")
                .replace(/\s+/g, " ")
                .trim() ===
                "Sorry, we cannot cherry-pick this commit automatically. This commit may already have been cherry-picked, or a more recent commit may have updated some of its content.";
            // Network/unknown failures may follow an applied commit;
            // explicit "empty" means there is nothing to replay.
            if (
              !useFallback ||
              (errorCode(cherryPickErr) !== "conflict" && !legacyFailure)
            )
              throw cherryPickErr;
            return doFallbackCommit(commitBranch, legacyFailure);
          })
          .then(function () {
            operation.commitApplied = true;
          });
      })
      .then(function () {
        // Step 3: create MR if requested
        if (!createMr) return;
        // A previous MR response may have been lost after creation.
        const existingMr = operation.mrAttempted
          ? api(
              "GET",
              "/projects/" +
                encodedProject +
                "/merge_requests?state=opened&source_branch=" +
                encodeURIComponent(commitBranch) +
                "&target_branch=" +
                encodeURIComponent(targetBranch),
            )
              .then(decodeArray(readMergeRequest))
              .then(function (mrs) {
                for (const mr of mrs) {
                  // Project MR lists can also contain requests from forks.
                  if (
                    mr.source_branch === commitBranch &&
                    mr.target_branch === targetBranch &&
                    mr.source_project_id != null &&
                    mr.source_project_id === mr.target_project_id
                  )
                    return mr;
                }
                return null;
              })
          : Promise.resolve(null);
        return existingMr.then(function (mr) {
          if (mr) return mr;
          operation.mrAttempted = true;
          return api(
            "POST",
            "/projects/" + encodedProject + "/merge_requests",
            {
              source_branch: commitBranch,
              target_branch: targetBranch,
              title: "Cherry-pick " + shortSha + " into " + targetBranch,
              remove_source_branch: true,
            },
          ).then(readMergeRequest);
        });
      });
  }
  return { pick };
}
