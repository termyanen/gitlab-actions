import { escHtml } from "../../../shared/lib/html";
export function getPriorityHtml(name: string, iconUrl?: string) {
  if (!name) return "";
  const icon = iconUrl
    ? '<img class="gl-jira-priority-icon" src="' +
      escHtml(iconUrl) +
      '" alt="">'
    : "";
  return '<span class="gl-jira-priority">' + icon + escHtml(name) + "</span>";
}
export function getJiraCategoryClass(
  categoryKey: string | undefined,
  name: string,
) {
  const lower = name.toLowerCase();
  if (lower.includes("qa")) return "jira-qa";
  if (lower.includes("in review")) return "jira-default";
  if (categoryKey === "done") return "jira-done";
  if (categoryKey === "new") return "jira-new";
  if (categoryKey === "indeterminate" || lower.includes("in "))
    return "jira-progress";

  return "jira-new";
}
