import {
  arrayOf,
  decoder,
  either,
  isBoolean,
  isNumber,
  isString,
  nullable,
  objectOf,
  optional,
} from "../../../shared/lib/validation";
import type {
  ActiveMergeRequest,
  Commit,
  DiffRefs,
  FileDiff,
  LegacyChanges,
  MergeRequest,
  RevisionComparison,
} from "./types";

const refs = objectOf<DiffRefs>({
  base_sha: isString,
  start_sha: isString,
  head_sha: isString,
});
const mergeRequestFields = {
  id: optional(isNumber),
  iid: optional(either(isString, isNumber)),
  title: optional(isString),
  description: optional(nullable(isString)),
  sha: optional(isString),
  diff_refs: optional(refs),
  project_id: optional(isNumber),
  source_project_id: optional(isNumber),
  target_project_id: optional(isNumber),
  source_branch: optional(isString),
  target_branch: optional(isString),
  web_url: optional(isString),
  changes_count: optional(either(isString, isNumber)),
};
export const isMergeRequest = objectOf<MergeRequest>(mergeRequestFields);
export const readMergeRequest = decoder(
  isMergeRequest,
  "MergeRequest response",
);
export const readActiveMergeRequest = decoder(
  objectOf<ActiveMergeRequest>({
    ...mergeRequestFields,
    state: optional(isString),
    created_at: optional(isString),
    rebase_in_progress: optional(isBoolean),
    merge_error: optional(nullable(isString)),
    merge_status: optional(isString),
    has_conflicts: optional(isBoolean),
    blocking_discussions_resolved: optional(isBoolean),
    squash: optional(isBoolean),
    force_remove_source_branch: optional(isBoolean),
    should_remove_source_branch: optional(isBoolean),
    diff_head_sha: optional(isString),
    head_pipeline: optional(
      nullable(
        objectOf<NonNullable<ActiveMergeRequest["head_pipeline"]>>({
          id: optional(isNumber),
          project_id: optional(isNumber),
          sha: optional(isString),
          ref: optional(isString),
          status: optional(isString),
        }),
      ),
    ),
  }),
  "ActiveMergeRequest response",
);
export const isFileDiff = objectOf<FileDiff>({
  old_path: isString,
  new_path: isString,
  diff: optional(isString),
  deleted_file: optional(isBoolean),
  new_file: optional(isBoolean),
  renamed_file: optional(isBoolean),
  collapsed: optional(isBoolean),
  too_large: optional(isBoolean),
  generated_file: optional(isBoolean),
  binary: optional(isBoolean),
  is_binary: optional(isBoolean),
  a_mode: optional(isString),
  b_mode: optional(isString),
  truncated: optional(isBoolean),
  overflow: optional(isBoolean),
});
export const readFileDiff = decoder(isFileDiff, "FileDiff response");
export const isCommit = objectOf<Commit>({
  id: isString,
  title: optional(isString),
  message: optional(isString),
});
export const readCommit = decoder(isCommit, "Commit response");
export const readLegacyChanges = decoder(
  objectOf<LegacyChanges>({
    ...mergeRequestFields,
    changes: arrayOf(isFileDiff),
    overflow: optional(isBoolean),
  }),
  "MR changes response",
);
export const readRevisionComparison = decoder(
  objectOf<RevisionComparison>({
    commit: optional(isCommit),
    diffs: arrayOf(isFileDiff),
    compare_timeout: optional(isBoolean),
    overflow: optional(isBoolean),
  }),
  "revision comparison response",
);
