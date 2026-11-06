export interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}

export interface MergeRequest {
  id?: number;
  iid?: string | number;
  title?: string;
  description?: string | null;
  sha?: string;
  diff_refs?: DiffRefs;
  project_id?: number;
  source_project_id?: number;
  target_project_id?: number;
  source_branch?: string;
  target_branch?: string;
  web_url?: string;
  changes_count?: string | number;
}

export interface Commit {
  id: string;
  title?: string;
  message?: string;
}

export interface FileDiff {
  old_path: string;
  new_path: string;
  diff?: string;
  deleted_file?: boolean;
  new_file?: boolean;
  renamed_file?: boolean;
  collapsed?: boolean;
  too_large?: boolean;
  generated_file?: boolean;
  binary?: boolean;
  is_binary?: boolean;
  a_mode?: string;
  b_mode?: string;
  truncated?: boolean;
  overflow?: boolean;
}

export interface LegacyChanges extends MergeRequest {
  changes: FileDiff[];
  overflow?: boolean;
}

export interface RevisionComparison {
  commit?: Commit;
  diffs: FileDiff[];
  compare_timeout?: boolean;
  overflow?: boolean;
}

export interface MergeRequestVersion {
  id: number | string;
  head_commit_sha: string;
  created_at?: string;
}

/** Full MR metadata returned by the actions API. */
export interface ActiveMergeRequest extends MergeRequest {
  title: string;
  source_branch: string;
  target_branch: string;
  web_url: string;
  state: string;
  created_at: string;
  rebase_in_progress?: boolean;
  merge_error?: string | null;
  merge_status?: string;
  has_conflicts?: boolean;
  blocking_discussions_resolved?: boolean;
  squash?: boolean;
  force_remove_source_branch?: boolean;
  should_remove_source_branch?: boolean;
  diff_head_sha?: string;
  head_pipeline?: {
    id: number;
    project_id?: number;
    sha?: string;
    ref?: string;
    status: string;
  } | null;
}
