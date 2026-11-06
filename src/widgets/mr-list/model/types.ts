import type { DisplayPreferences } from "../../../entities/settings";
export interface ListSettings extends DisplayPreferences {
  dim_drafts: boolean;
  highlight_own_mrs: boolean;
  show_only_mine: boolean;
  show_needs_review: boolean;
  show_copy_mr: boolean;
  show_reviewer_badge: boolean;
  show_threads_badge: boolean;
  show_size_badge: boolean;
  show_conflicts_badge: boolean;
  show_approval_badge: boolean;
  show_branches: boolean;
  show_branches_links: boolean;
  show_jira_details: boolean;
  skip_confirmations: boolean;
  jira_url: string;
  jira_ticket_regex: string;
}
export interface ItemTicket {
  item: HTMLElement;
  tickets: string[];
}
export interface MrEntry {
  item: HTMLElement;
  href: string;
  projectPath: string;
  iid: string;
}
export interface Approval {
  user?: { username?: string; name?: string };
  username?: string;
  name?: string;
}
export interface MrMeta {
  threads: number;
  threadsPartial: boolean;
  changesLines: number;
  changesFiles: number;
  changesFilesTruncated: boolean;
  conflicts: boolean;
  approvedBy: Approval[];
  sourceBranch: string;
  targetBranch: string;
  ts: number;
}
export interface MrData {
  additions?: string;
  deletions?: string;
  changes_count?: string;
  has_conflicts?: boolean;
  source_branch?: string;
  target_branch?: string;
}
