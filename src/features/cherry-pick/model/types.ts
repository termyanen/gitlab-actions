export interface CherryPickSettings {
  cherry_pick_branches?: string[];
  cherry_pick_create_mr?: boolean;
  cherry_pick_smart_fallback?: boolean;
  cherry_pick_bump_version?: boolean;
  versionFile?: string;
  versionPath?: string;
  versionStrategy?: string;
  versionCommitTemplate?: string;
}
export interface PickOperation {
  createMr: boolean;
  commitBranch: string;
  branchCreated: boolean;
  commitApplied: boolean;
  mrAttempted: boolean;
}
export interface BranchState {
  name: string;
  status: "pending" | "in_progress" | "success" | "error";
  error: string;
  mrUrl?: string;
  operation?: PickOperation;
}
export interface CommitInfo {
  parent_ids: string[];
  message?: string;
  author_name?: string;
  author_email?: string;
}
export interface RepositoryFile {
  content: string;
  last_commit_id?: string;
}
export interface FileAction {
  action: "create" | "update" | "delete";
  file_path: string;
  content?: string;
  encoding?: string;
  last_commit_id?: string;
}
