import type { JiraQuickAction } from "../model/types";
export interface JiraUser {
  accountId?: string;
  key?: string;
  name?: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}
export interface RawJiraComment {
  id: string;
  author?: JiraUser;
  body?: string;
  created?: string;
}
export interface JiraNamed {
  name: string;
  iconUrl?: string;
  statusCategory?: { key: string };
}
interface JiraFields {
  [key: string]: unknown;
  summary?: string;
  status?: JiraNamed;
  description?: string | null;
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  priority?: JiraNamed | null;
  issuetype?: JiraNamed;
  created?: string;
  updated?: string;
  labels?: string[];
  attachment?: {
    filename: string;
    content: string;
    size?: number;
    mimeType?: string;
  }[];
  components?: JiraNamed[];
  versions?: JiraNamed[];
  fixVersions?: JiraNamed[];
  resolution?: JiraNamed | null;
}
export interface RawJiraIssue {
  key?: string;
  fields: JiraFields;
}
export type JiraMessage =
  | {
      type: "execute-jira-quick-action";
      jiraUrl: string;
      ticket: string;
      transitionId?: string;
      action?: JiraQuickAction;
    }
  | {
      type: "fetch-jira-statuses";
      jiraUrl: string;
      tickets: string[];
      showDetails?: boolean;
    }
  | {
      type:
        "fetch-jira-issue" | "fetch-jira-versions" | "fetch-jira-transitions";
      jiraUrl: string;
      ticket: string;
    }
  | {
      type: "fetch-jira-field-values";
      jiraUrl: string;
      tickets: string[];
      field?: string;
    }
  | {
      type: "search-jira-assignable";
      jiraUrl: string;
      ticket: string;
      query: string;
    }
  | {
      type: "set-jira-fix-versions";
      jiraUrl: string;
      ticket: string;
      versions: string[];
    }
  | {
      type: "set-jira-assignee";
      jiraUrl: string;
      ticket: string;
      username?: string | null;
    }
  | {
      type: "fetch-jira-comments";
      jiraUrl: string;
      ticket: string;
      startAt?: number;
      maxResults?: number;
    }
  | { type: "fetch-jira-myself"; jiraUrl: string }
  | {
      type: "delete-jira-comment";
      jiraUrl: string;
      ticket: string;
      commentId: string;
    }
  | { type: "post-jira-comment"; jiraUrl: string; ticket: string; text: string }
  | {
      type: "do-jira-transition";
      jiraUrl: string;
      ticket: string;
      transitionId: string;
    };
