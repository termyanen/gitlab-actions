export type {
  ActiveMergeRequest,
  Commit,
  DiffRefs,
  FileDiff,
  LegacyChanges,
  MergeRequest,
  MergeRequestVersion,
  RevisionComparison,
} from "./model/types";

export {
  readActiveMergeRequest,
  readFileDiff,
  readMergeRequest,
} from "./model/validation";
