import type { LIST_DEFAULTS } from "../../../entities/settings";
export type ListSettings = typeof LIST_DEFAULTS;
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
