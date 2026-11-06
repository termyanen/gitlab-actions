import type { ChainMessage } from "../../features/job-chains";
import type { StandupMessage } from "../../features/standup";
import type { JiraMessage } from "../../entities/jira-issue/background";
export type BackgroundMessage =
  ChainMessage | StandupMessage | JiraMessage | { type: "open-options" };
const jiraTypes = new Set([
  "execute-jira-quick-action",
  "fetch-jira-statuses",
  "fetch-jira-issue",
  "fetch-jira-field-values",
  "search-jira-assignable",
  "fetch-jira-versions",
  "set-jira-fix-versions",
  "set-jira-assignee",
  "fetch-jira-transitions",
  "fetch-jira-comments",
  "fetch-jira-myself",
  "delete-jira-comment",
  "post-jira-comment",
  "do-jira-transition",
]);
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function origin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function parseBackgroundMessage(
  value: unknown,
): BackgroundMessage | null {
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  const data = value as Record<string, unknown>;
  if (data.type === "open-options" || data.type === "get-active-tasks")
    return data as BackgroundMessage;
  if (data.type === "get-task-status" || data.type === "cancel-task")
    return typeof data.taskId === "string" ? (data as BackgroundMessage) : null;
  if (data.type === "start-job-chain")
    return origin(data.gitlabUrl) &&
      typeof data.projectId === "number" &&
      typeof data.mrIid === "number" &&
      strings(data.jobs)
      ? (data as BackgroundMessage)
      : null;
  if (data.type === "generate-standup")
    return origin(data.gitlabUrl) &&
      (data.date === undefined || typeof data.date === "string")
      ? (data as BackgroundMessage)
      : null;
  if (
    typeof data.type !== "string" ||
    !jiraTypes.has(data.type) ||
    !origin(data.jiraUrl)
  )
    return null;
  if (data.type === "fetch-jira-myself") return data as BackgroundMessage;
  if (
    data.type === "fetch-jira-statuses" ||
    data.type === "fetch-jira-field-values"
  )
    return strings(data.tickets) ? (data as BackgroundMessage) : null;
  if (typeof data.ticket !== "string") return null;
  if (data.type === "set-jira-fix-versions" && !strings(data.versions))
    return null;
  if (data.type === "search-jira-assignable" && typeof data.query !== "string")
    return null;
  if (data.type === "post-jira-comment" && typeof data.text !== "string")
    return null;
  if (data.type === "delete-jira-comment" && typeof data.commentId !== "string")
    return null;
  if (
    data.type === "do-jira-transition" &&
    typeof data.transitionId !== "string"
  )
    return null;
  return data as BackgroundMessage;
}
export function isJiraMessage(
  message: BackgroundMessage,
): message is JiraMessage {
  return jiraTypes.has(message.type);
}
