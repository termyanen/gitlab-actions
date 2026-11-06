import type { JiraQuickAction } from "../../entities/jira-issue";
import type { JiraMessage } from "../../entities/jira-issue/background";
import type { ChainMessage } from "../../features/job-chains";
import type { StandupMessage } from "../../features/standup";
import {
  arrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isUnknown,
  nullable,
  objectOf,
  optional,
} from "../../shared/lib/validation";

type BackgroundMessage =
  ChainMessage | StandupMessage | JiraMessage | { type: "open-options" };
const strings = arrayOf(isString);
const maybeString = optional(isString);
const maybeNumber = optional(isNumber);
const quickAction = objectOf<Partial<JiraQuickAction>>({
  id: maybeString,
  label: maybeString,
  status: maybeString,
  assignee: maybeString,
  updates: optional(
    arrayOf(
      objectOf<NonNullable<JiraQuickAction["updates"]>[number]>({
        field: isString,
        operation: maybeString,
        value: isUnknown,
      }),
    ),
  ),
});
function origin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function validBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!isRecord(value)) return false;
  if (value.type === "open-options" || value.type === "get-active-tasks")
    return true;
  if (value.type === "get-task-status" || value.type === "cancel-task")
    return isString(value.taskId);
  if (value.type === "start-job-chain")
    return (
      origin(value.gitlabUrl) &&
      isNumber(value.projectId) &&
      isNumber(value.mrIid) &&
      strings(value.jobs) &&
      maybeString(value.mrTitle)
    );
  if (value.type === "generate-standup")
    return origin(value.gitlabUrl) && maybeString(value.date);
  if (!origin(value.jiraUrl)) return false;
  switch (value.type) {
    case "fetch-jira-myself":
      return true;
    case "fetch-jira-statuses":
      return strings(value.tickets) && optional(isBoolean)(value.showDetails);
    case "fetch-jira-field-values":
      return strings(value.tickets) && maybeString(value.field);
  }
  if (!isString(value.ticket)) return false;
  switch (value.type) {
    case "fetch-jira-issue":
    case "fetch-jira-versions":
    case "fetch-jira-transitions":
      return true;
    case "set-jira-fix-versions":
      return strings(value.versions);
    case "search-jira-assignable":
      return isString(value.query);
    case "post-jira-comment":
      return isString(value.text);
    case "delete-jira-comment":
      return isString(value.commentId);
    case "do-jira-transition":
      return isString(value.transitionId);
    case "set-jira-assignee":
      return optional(nullable(isString))(value.username);
    case "fetch-jira-comments":
      return maybeNumber(value.startAt) && maybeNumber(value.maxResults);
    case "execute-jira-quick-action":
      return (
        maybeString(value.transitionId) && optional(quickAction)(value.action)
      );
    default:
      return false;
  }
}
export function parseBackgroundMessage(
  value: unknown,
): BackgroundMessage | null {
  return validBackgroundMessage(value) ? value : null;
}
export function isJiraMessage(
  message: BackgroundMessage,
): message is JiraMessage {
  // Extra payload fields must not change routing: only the discriminant matters.
  return (
    message.type !== "open-options" &&
    message.type !== "generate-standup" &&
    message.type !== "start-job-chain" &&
    message.type !== "get-task-status" &&
    message.type !== "cancel-task" &&
    message.type !== "get-active-tasks"
  );
}
