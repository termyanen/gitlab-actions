import type {
  JiraFieldUpdate,
  JiraQuickAction,
} from "../../../entities/jira-issue";

export interface JiraFieldDraft {
  id: string;
  field: string;
  custom: string;
  operation: string;
  value: string;
}

export interface JiraActionDraft {
  id: string;
  label: string;
  fields: JiraFieldDraft[];
}

const listFields = new Set(["labels", "fixVersions", "versions", "components"]);
let nextDraftId = 0;
function draftId() {
  return `jira-draft-${++nextDraftId}`;
}

export function isJiraListField(field: string) {
  return listFields.has(field);
}

export function createJiraFieldDraft(
  update: JiraFieldUpdate = { field: "status", value: "" },
): JiraFieldDraft {
  const custom = /^customfield_\d+$/.test(update.field);
  return {
    id: draftId(),
    field: custom ? "custom" : update.field,
    custom: custom ? update.field : "",
    operation: update.operation || "set",
    value: custom
      ? (JSON.stringify(update.value) ?? "")
      : Array.isArray(update.value)
        ? update.value.join(", ")
        : String(update.value || ""),
  };
}

export function createJiraActionDraft(
  action: Partial<JiraQuickAction> = {},
): JiraActionDraft {
  const fields: JiraFieldDraft[] = [];
  if (action.status)
    fields.push(
      createJiraFieldDraft({ field: "status", value: action.status }),
    );
  if (action.assignee)
    fields.push(
      createJiraFieldDraft({ field: "assignee", value: action.assignee }),
    );
  fields.push(...(action.updates || []).map(createJiraFieldDraft));
  if (!fields.length) fields.push(createJiraFieldDraft());
  return { id: draftId(), label: action.label || "", fields };
}

export function jiraActionsToDraft(actions: JiraQuickAction[]) {
  return actions.map(createJiraActionDraft);
}

/** Convert text drafts only at the save boundary; invalid JSON stays editable. */
export function serializeJiraActions(
  drafts: JiraActionDraft[],
  t: (key: string) => string,
): JiraQuickAction[] {
  const actions: JiraQuickAction[] = [];
  for (const draft of drafts) {
    const action: Required<
      Pick<JiraQuickAction, "label" | "status" | "assignee" | "updates">
    > = { label: draft.label.trim(), status: "", assignee: "", updates: [] };
    const seen = new Set<string>();
    for (const change of draft.fields) {
      const raw = change.value.trim();
      if (!raw) continue;
      let field = change.field;
      let value: unknown = raw;
      let operation = "set";
      if (field === "custom") {
        field = change.custom.trim();
        if (!/^customfield_\d+$/.test(field))
          throw new Error(t("jiraQuickActionInvalid"));
        try {
          value = JSON.parse(raw);
        } catch {
          throw new Error(t("jiraQuickActionInvalid"));
        }
      } else if (isJiraListField(field)) {
        const items = Array.from(
          new Set(
            raw
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean),
          ),
        );
        if (!items.length) continue;
        value = items;
        operation = change.operation;
      } else if (
        field === "duedate" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
          Number.isNaN(Date.parse(raw)) ||
          new Date(raw).toISOString().slice(0, 10) !== raw)
      ) {
        throw new Error(t("jiraQuickActionInvalid"));
      }
      if (seen.has(field)) throw new Error(t("jiraQuickActionDuplicate"));
      seen.add(field);
      if (field === "status" || field === "assignee")
        action[field] = String(value);
      else action.updates.push({ field, operation, value });
    }
    if (
      action.label &&
      (action.status || action.assignee || action.updates.length)
    )
      actions.push(action);
  }
  return actions;
}
