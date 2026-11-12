import { mergeText, TextMergeError } from "./merge-text";
import {
  companionLockfile,
  mergeLockfile,
  bumpLockfile,
  mergeVersionJson,
} from "./lockfile";
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
  useTargetVersion = () => settings.cherry_pick_target_version === true,
) {
  const api = createSessionApi(() => origin);
  const shortSha = sha.substring(0, 8);
  async function writeCommit(operation: PickOperation, body: unknown) {
    operation.commitUncertain = true;
    try {
      const result = await api(
        "POST",
        "/projects/" + encodedProject + "/repository/commits",
        body,
      );
      operation.commitUncertain = false;
      return result;
    } catch (error) {
      const status = errorStatus(error);
      if (status !== undefined && status >= 400 && status < 500)
        operation.commitUncertain = false;
      if (operation.commitUncertain)
        throw new Error(msg("cherryPickWriteUncertain"));
      throw error;
    }
  }
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
  function doFallbackCommit(
    commitBranch: string,
    requireFileChanges: boolean,
    operation: PickOperation,
    alwaysBump = false,
  ) {
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
      const lockfile = companionLockfile(
        versionFile,
        settings.versionPath || "version",
      );
      const lockDiff = lockfile
        ? diffs.find((d) => d.new_path === lockfile || d.old_path === lockfile)
        : undefined;
      const bump = alwaysBump || shouldBump();

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
      if (!hasVersionFile && !lockDiff && !alwaysBump)
        throw new Error(
          msg("cherryPickFallbackNoVersionFile") ||
            "Smart fallback only handles version file conflicts. Conflict is in another file",
        );

      // A confirmed conflict can become a bump-only commit. Legacy
      // ambiguous errors also require verifiable non-version changes.
      const filtered = diffs.filter(function (d) {
        return (
          d.new_path !== versionFile &&
          d.old_path !== versionFile &&
          (!lockfile || (d.new_path !== lockfile && d.old_path !== lockfile))
        );
      });
      if (!filtered.length && !lockDiff && (requireFileChanges || !bump))
        throw new Error("No files left after excluding " + versionFile);

      const parentSha = commitInfo.parent_ids && commitInfo.parent_ids[0];
      if (!parentSha) throw new Error("Cannot determine parent commit");

      // Verify that the version file diff contains ONLY a version change.
      // If other fields were also modified (e.g. dependencies), dropping
      // the file would silently lose those changes.
      const vPath = settings.versionPath || "version";
      const isToml = versionFile.indexOf(".toml") !== -1;
      const isPlainText = versionFile.indexOf(".txt") !== -1;

      let targetLock: RepositoryFile | null | undefined;
      let mergedLockContent: string | undefined;
      const decodeContent = (file: RepositoryFile) =>
        decodeURIComponent(escape(atob(file.content)));
      const lockCheck =
        lockDiff && lockfile
          ? Promise.all([
              readOptionalFile(lockfile, parentSha),
              readOptionalFile(lockfile, sha),
              readOptionalFile(lockfile, commitBranch),
            ]).then(([before, after, target]) => {
              if (
                lockDiff.new_file ||
                lockDiff.deleted_file ||
                lockDiff.renamed_file ||
                !before ||
                !after ||
                !target
              )
                throw new Error(
                  msg("cherryPickFallbackVersionFileHasOtherChanges") +
                    ": " +
                    lockfile,
                );
              try {
                mergedLockContent = mergeLockfile(
                  decodeContent(before),
                  decodeContent(after),
                  decodeContent(target),
                );
              } catch {
                throw new Error(
                  msg("cherryPickFallbackVersionFileHasOtherChanges") +
                    ": " +
                    lockfile,
                );
              }
              targetLock = target;
            })
          : Promise.resolve();
      let mergedVersionFile: RepositoryFile | undefined;
      const versionOnlyCheck = !hasVersionFile
        ? Promise.resolve()
        : Promise.all([
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
          ]).then(async function (pair) {
            const parentVFile = pair[0];
            const commitVFile = pair[1];

            const parentContent = decodeURIComponent(
              escape(atob(parentVFile.content)),
            );
            const commitContent = decodeURIComponent(
              escape(atob(commitVFile.content)),
            );

            if (alwaysBump && !isToml && !isPlainText) {
              const target = await readOptionalFile(versionFile, commitBranch);
              if (!target) throw new Error("Missing target " + versionFile);
              try {
                const merged = mergeVersionJson(
                  parentContent,
                  commitContent,
                  decodeContent(target),
                  vPath,
                );
                mergedVersionFile = {
                  ...target,
                  content: btoa(unescape(encodeURIComponent(merged))),
                };
              } catch {
                throw new Error(
                  msg("cherryPickFallbackVersionFileHasOtherChanges") +
                    ": " +
                    versionFile,
                );
              }
              return;
            }
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
              const normalized = updateTomlVersion(
                commitContent,
                vPath,
                parentV,
              );
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

      return Promise.all([versionOnlyCheck, lockCheck]).then(function () {
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
            // elsewhere in the file, try the exact diff first. If only its
            // surrounding context differs, compare both sides with the actual
            // parent and merge disjoint line changes. Overlaps remain errors.
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
              if (!parentFile)
                throw new Error(divergedMsg + " [CP_PARENT_MISSING]");
              // File missing in target — it was deleted there independently
              if (!targetFile)
                throw new Error(divergedMsg + " [CP_TARGET_MISSING]");
              // Legacy GitLab cannot distinguish conflicts from empty
              // cherry-picks. Require a real, not-yet-applied file change.
              if (requireFileChanges) {
                if (parentFile.content === sourceFile.content)
                  throw new Error(divergedMsg + " [CP_UNCHANGED_SOURCE]");
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
              if (!d.diff) throw new Error(divergedMsg + " [CP_DIFF_MISSING]");
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
              } catch {
                throw new Error(divergedMsg + " [CP_TEXT_DECODE]");
              }
              try {
                patchedParent = applyUnifiedDiff(parentText, d.diff);
              } catch {
                throw new Error(divergedMsg + " [CP_PARENT_PATCH]");
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
                try {
                  patchedTarget = mergeText(parentText, sourceText, targetText);
                } catch (error) {
                  const code =
                    error instanceof TextMergeError
                      ? error.code
                      : "CP_MERGE_FAILED";
                  throw new Error(divergedMsg + " [" + code + "]");
                }
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
          if (
            lockfile &&
            targetLock &&
            mergedLockContent !== undefined &&
            mergedLockContent !== decodeContent(targetLock)
          ) {
            actions.push({
              action: "update",
              file_path: lockfile,
              content: btoa(unescape(encodeURIComponent(mergedLockContent))),
              encoding: "base64",
              ...(targetLock.last_commit_id === undefined
                ? {}
                : { last_commit_id: targetLock.last_commit_id }),
            });
          }
          if (!actions.length && (requireFileChanges || !bump))
            throw new Error("No applicable file changes for target branch");
          // Optionally bump version in the same commit
          if (!bump) {
            const commitMsg =
              (commitInfo.message || "") +
              "\n\n(cherry picked from commit " +
              sha +
              ")";
            return writeCommit(operation, {
              branch: commitBranch,
              commit_message: commitMsg,
              actions: actions,
              author_name: commitInfo.author_name,
              author_email: commitInfo.author_email,
            });
          }

          const vFile = settings.versionFile || "package.json";
          const vPath = settings.versionPath || "version";
          const strategy = settings.versionStrategy || "patch";

          return (
            mergedVersionFile
              ? Promise.resolve(mergedVersionFile)
              : readOptionalFile(vFile, commitBranch).then((file) => {
                  if (!file) throw new Error("Missing target " + vFile);
                  return file;
                })
          ).then(async function (file) {
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

            if (lockfile) {
              const lock =
                targetLock === undefined
                  ? await readOptionalFile(lockfile, commitBranch)
                  : targetLock;
              if (!lock && lockDiff)
                throw new Error("Missing target " + lockfile);
              if (lock) {
                if (typeof currentVersion !== "string")
                  throw new Error("Invalid package version");
                const content = bumpLockfile(
                  mergedLockContent ?? decodeContent(lock),
                  newVersion,
                );
                const existing = actions.findIndex(
                  (action) => action.file_path === lockfile,
                );
                if (existing !== -1) actions.splice(existing, 1);
                actions.push({
                  action: "update",
                  file_path: lockfile,
                  content: btoa(unescape(encodeURIComponent(content))),
                  encoding: "base64",
                  ...(lock.last_commit_id === undefined
                    ? {}
                    : { last_commit_id: lock.last_commit_id }),
                });
              }
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
            return writeCommit(operation, {
              branch: commitBranch,
              commit_message: commitMsg,
              actions: actions,
              author_name: commitInfo.author_name,
              author_email: commitInfo.author_email,
            });
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
        if (operation.commitUncertain)
          throw new Error(msg("cherryPickWriteUncertain"));
        if (useTargetVersion()) {
          return doFallbackCommit(commitBranch, false, operation, true).then(
            () => {
              operation.commitApplied = true;
            },
          );
        }
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
            return doFallbackCommit(commitBranch, legacyFailure, operation);
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
