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

export { readLegacyChanges, readRevisionComparison } from "./model/validation";

export { isCommit, isFileDiff } from "./model/validation";

export { readCommit } from "./model/validation";

export { isMergeRequest } from "./model/validation";
