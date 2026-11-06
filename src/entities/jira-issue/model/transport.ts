import type {
  JiraStatus,
  JiraTransition,
  JiraComment,
  JiraIssue,
} from "./types";
export interface JiraFieldValue {
  values: string[];
  categoryKey?: string;
}
interface JiraResponses {
  "fetch-jira-statuses": {
    statuses: Record<string, JiraStatus> & { _authError?: number };
  };
  "fetch-jira-issue": JiraIssue;
  "fetch-jira-field-values": {
    values: Record<string, JiraFieldValue> & { _authError?: number };
  };
  "search-jira-assignable": {
    users: { key: string; name: string; avatar: string }[];
  };
  "fetch-jira-versions": { versions: { name: string; released: boolean }[] };
  "set-jira-fix-versions": { success: boolean };
  "set-jira-assignee": { success: boolean };
  "do-jira-transition": { success: boolean };
  "delete-jira-comment": { success: boolean };
  "fetch-jira-transitions": { transitions: JiraTransition[] };
  "fetch-jira-comments": { comments: JiraComment[]; total: number };
  "fetch-jira-myself": { id: string };
  "post-jira-comment": { comment: JiraComment };
  "execute-jira-quick-action": {
    success: boolean;
    completed?: { transition?: boolean; fields?: boolean };
  };
}
export function sendJiraMessage<K extends keyof JiraResponses>(
  message: { type: K; [key: string]: unknown },
  callback: (response: JiraResponses[K] & { _error?: string }) => void,
) {
  chrome.runtime.sendMessage(message, callback);
}
