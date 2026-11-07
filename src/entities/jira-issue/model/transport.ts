import {
  arrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  objectOf,
  optional,
  recordOf,
  type Guard,
} from "../../../shared/lib/validation";
import type {
  JiraComment,
  JiraIssue,
  JiraStatus,
  JiraTransition,
} from "./types";
import { isJiraErrorKind, isJiraFailure, type JiraFailure } from "./failure";
export interface JiraFieldValue {
  values: string[];
  categoryKey?: string;
}
interface JiraResponses {
  "fetch-jira-statuses": {
    statuses: Record<string, JiraStatus>;
    _authError?: number;
    _failure?: JiraFailure;
  };
  "fetch-jira-issue": JiraIssue;
  "fetch-jira-field-values": {
    values: Record<string, JiraFieldValue>;
    _authError?: number;
    _failure?: JiraFailure;
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

const status = objectOf<JiraStatus>({
  name: isString,
  categoryKey: isString,
  priority: optional(isString),
  priorityIcon: optional(isString),
  type: optional(isString),
  typeIcon: optional(isString),
});
const comment = objectOf<JiraComment>({
  id: isString,
  author: isString,
  authorId: isString,
  avatarUrl: optional(isString),
  body: isString,
  created: isString,
});
const success = objectOf({ success: isBoolean });
const issue = objectOf<JiraIssue>({
  key: isString,
  summary: isString,
  status: isString,
  statusCategoryKey: isString,
  description: isString,
  assignee: isString,
  reporter: isString,
  priority: isString,
  priorityIcon: optional(isString),
  type: isString,
  typeIcon: optional(isString),
  created: isString,
  updated: isString,
  labels: arrayOf(isString),
  attachments: recordOf(isString),
  attachmentList: arrayOf(
    objectOf({
      filename: isString,
      url: isString,
      size: isNumber,
      mimeType: isString,
    }),
  ),
  components: arrayOf(isString),
  versions: arrayOf(isString),
  fixVersions: arrayOf(isString),
  resolution: isString,
  epicLink: isString,
  sprint: isString,
});
const responses: { [K in keyof JiraResponses]: Guard<JiraResponses[K]> } = {
  "fetch-jira-statuses": objectOf<JiraResponses["fetch-jira-statuses"]>({
    statuses: recordOf(status),
    _authError: optional(isNumber),
    _failure: optional(isJiraFailure),
  }),
  "fetch-jira-field-values": objectOf<JiraResponses["fetch-jira-field-values"]>(
    {
      values: recordOf(
        objectOf<JiraFieldValue>({
          values: arrayOf(isString),
          categoryKey: optional(isString),
        }),
      ),
      _authError: optional(isNumber),
      _failure: optional(isJiraFailure),
    },
  ),
  "fetch-jira-issue": issue,
  "search-jira-assignable": objectOf({
    users: arrayOf(
      objectOf({ key: isString, name: isString, avatar: isString }),
    ),
  }),
  "fetch-jira-versions": objectOf({
    versions: arrayOf(objectOf({ name: isString, released: isBoolean })),
  }),
  "set-jira-fix-versions": success,
  "set-jira-assignee": success,
  "do-jira-transition": success,
  "delete-jira-comment": success,
  "fetch-jira-transitions": objectOf({
    transitions: arrayOf(
      objectOf<JiraTransition>({
        id: isString,
        name: isString,
        statusName: isString,
        statusCategoryKey: isString,
      }),
    ),
  }),
  "fetch-jira-comments": objectOf({
    comments: arrayOf(comment),
    total: isNumber,
  }),
  "fetch-jira-myself": objectOf({ id: isString }),
  "post-jira-comment": objectOf({ comment }),
  "execute-jira-quick-action": objectOf<
    JiraResponses["execute-jira-quick-action"]
  >({
    success: isBoolean,
    completed: optional(
      objectOf<{ transition?: boolean; fields?: boolean }>({
        transition: optional(isBoolean),
        fields: optional(isBoolean),
      }),
    ),
  }),
};
type JiraMessageFailure = JiraFailure & {
  completed?: { transition?: boolean; fields?: boolean };
};
const completedAction = objectOf<NonNullable<JiraMessageFailure["completed"]>>({
  transition: optional(isBoolean),
  fields: optional(isBoolean),
});
type JiraResponse<T> =
  | (T & { _error?: never })
  | (JiraMessageFailure & { [K in Exclude<keyof T, "completed">]?: never });
export function sendJiraMessage<K extends keyof JiraResponses>(
  message: { type: K; [key: string]: unknown },
  callback: (response: JiraResponse<JiraResponses[K]>) => void,
) {
  chrome.runtime.sendMessage(message, (raw: unknown) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      const failure: JiraMessageFailure = {
        _error: runtimeError.message || "No response from extension",
        _errorKind: "network",
      };
      callback(failure);
      return;
    }
    if (isRecord(raw) && raw._error !== undefined) {
      callback({
        _error:
          typeof raw._error === "string"
            ? raw._error || "Jira request failed"
            : "Invalid Jira response",
        ...(completedAction(raw.completed) ? { completed: raw.completed } : {}),
        ...(isJiraErrorKind(raw._errorKind)
          ? { _errorKind: raw._errorKind }
          : {}),
        ...(isNumber(raw._httpStatus) ? { _httpStatus: raw._httpStatus } : {}),
      });
      return;
    }
    // Older worker responses keep authentication metadata inside a ticket map.
    // Extract it before validating tickets, without changing that wire format.
    if (
      isRecord(raw) &&
      (message.type === "fetch-jira-statuses" ||
        message.type === "fetch-jira-field-values")
    ) {
      const key =
        message.type === "fetch-jira-statuses" ? "statuses" : "values";
      const values = raw[key];
      if (isRecord(values)) {
        const { _authError, ...tickets } = values;
        raw = {
          ...raw,
          [key]: tickets,
          ...(_authError === undefined ? {} : { _authError }),
        };
      }
    }
    const valid = responses[message.type];
    if (!valid(raw)) {
      const failure: JiraMessageFailure = {
        _error: "Invalid Jira response",
        _errorKind: "invalid-response",
      };
      callback(failure);
      return;
    }
    callback(raw);
  });
}

export function jiraResponseFailure(response: {
  _error?: string;
  _errorKind?: JiraFailure["_errorKind"];
  _httpStatus?: number;
  _failure?: JiraFailure;
  _authError?: number;
}): JiraFailure | undefined {
  if (isJiraFailure(response)) {
    if (response._errorKind) return response;
    const status =
      response._httpStatus || Number(response._error.match(/^(\d{3})\b/)?.[1]);
    if (status === 401 || status === 403)
      return {
        ...response,
        _errorKind: status === 401 ? "auth" : "forbidden",
        _httpStatus: status,
      };
    return response;
  }
  if (response._failure) return response._failure;
  if (response._authError)
    return {
      _error: String(response._authError),
      _errorKind: response._authError === 401 ? "auth" : "forbidden",
      _httpStatus: response._authError,
    };
  return undefined;
}
