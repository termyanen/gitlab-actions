import type { JiraFailure } from "./failure";
export interface JiraStatus {
  name: string;
  categoryKey: string;
  priority?: string;
  priorityIcon?: string;
  type?: string;
  typeIcon?: string;
}
export interface JiraState {
  invalidateCommitTicket: ((ticket: string) => void) | null;
  cache: Record<string, JiraStatus & { ts: number }>;
  fetching: boolean;
  refreshPending: boolean;
  url: string;
  authFailed: boolean;
  failure?: JiraFailure;
  skipConfirmations: boolean;
  ticketRegex: RegExp;
  myselfCache: Record<string, string>;
  showDetails: boolean;
}
export interface JiraTransition {
  id: string;
  name: string;
  statusName: string;
  statusCategoryKey: string;
}
export interface JiraQuickAction {
  id?: string;
  label: string;
  status?: string;
  assignee?: string;
  updates?: JiraFieldUpdate[];
}
export interface JiraComment {
  id: string;
  author: string;
  authorId: string;
  avatarUrl?: string;
  body: string;
  created: string;
}
export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategoryKey: string;
  description: string;
  assignee: string;
  reporter: string;
  priority: string;
  priorityIcon?: string;
  type: string;
  typeIcon?: string;
  created: string;
  updated: string;
  labels: string[];
  attachments: Record<string, string>;
  attachmentList: {
    filename: string;
    url: string;
    size: number;
    mimeType: string;
  }[];
  components: string[];
  versions: string[];
  fixVersions: string[];
  resolution: string;
  epicLink: string;
  sprint: string;
}

export interface JiraFieldUpdate {
  field: string;
  operation?: string;
  value: unknown;
}
