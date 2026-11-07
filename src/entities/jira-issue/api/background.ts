import { JIRA_API_PREFIX } from "../../../shared/config/jira";
import {
  JiraRequestError,
  jiraFailure,
  stopsJiraBatch,
  type JiraFailure,
} from "../model/failure";
import { jiraRequest } from "./request";
import {
  arrayOf,
  decoder,
  isString,
  objectOf,
} from "../../../shared/lib/validation";
import type { JiraQuickAction, JiraStatus } from "../model/types";
import type { RawJiraComment } from "./types";
import { readRawJiraIssue } from "./validation";
const readJiraFields = decoder(
  arrayOf(
    objectOf<{ id: string; name: string }[][number]>({
      id: isString,
      name: isString,
    }),
  ),
  "GitLab/Jira response",
);
export function jiraApi(jiraUrl: string, path: string): Promise<unknown> {
  return jiraRequest(jiraUrl, path);
}
export function mapJiraComment(c: RawJiraComment) {
  return {
    id: c.id,
    author: c.author ? c.author.displayName : "",
    authorId: c.author
      ? c.author.accountId || c.author.key || c.author.name || ""
      : "",
    avatarUrl:
      c.author && c.author.avatarUrls ? c.author.avatarUrls["24x24"] : "",
    body: c.body || "",
    created: c.created || "",
  };
}
export function buildJiraQuickActionEdit(action: Partial<JiraQuickAction>) {
  const fields: Record<string, unknown> = {};
  const update: Record<string, unknown> = {};
  const seen = new Set<string>();
  if (action.assignee) fields.assignee = { name: action.assignee };
  (action.updates || []).forEach(function (change) {
    const field = change.field;
    const operation = change.operation || "set";
    const value = change.value;
    if (seen.has(field)) throw new Error("Duplicate Jira field: " + field);
    seen.add(field);
    if (["labels", "fixVersions", "versions", "components"].includes(field)) {
      if (
        !["set", "add", "remove"].includes(operation) ||
        !arrayOf(isString)(value) ||
        !value.length ||
        value.some(function (v) {
          return !v.trim();
        })
      ) {
        throw new Error("Invalid Jira field: " + field);
      }
      let values: unknown[] = Array.from(new Set(value));
      if (field !== "labels")
        values = values.map(function (name) {
          return { name: name };
        });
      if (operation === "set") fields[field] = values;
      else
        update[field] = values.map(function (v) {
          const op: Record<string, unknown> = {};
          op[operation] = v;
          return op;
        });
    } else if (field === "priority" || field === "duedate") {
      if (
        operation !== "set" ||
        typeof value !== "string" ||
        !value.trim() ||
        (field === "duedate" &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            isNaN(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value))
      ) {
        throw new Error("Invalid Jira field: " + field);
      }
      fields[field] = field === "priority" ? { name: value } : value;
    } else if (
      /^customfield_\d+$/.test(field) &&
      operation === "set" &&
      value !== undefined
    ) {
      fields[field] = value;
    } else {
      throw new Error("Unsupported Jira field: " + field);
    }
  });
  const body: {
    fields?: Record<string, unknown>;
    update?: Record<string, unknown>;
  } = {};
  if (Object.keys(fields).length) body.fields = fields;
  if (Object.keys(update).length) body.update = update;
  return body;
}
export function jiraQuickActionWrite(
  jiraUrl: string,
  ticket: string,
  suffix: string,
  method: string,
  body?: unknown,
) {
  return jiraRequest(
    jiraUrl,
    JIRA_API_PREFIX + "/issue/" + encodeURIComponent(ticket) + suffix,
    method,
    body,
  );
}
export function fetchJiraStatuses(
  jiraUrl: string,
  tickets: string[],
  showDetails?: boolean,
) {
  const results: Record<string, JiraStatus | number> = {};
  let failure: JiraFailure | undefined;
  const fields = showDetails ? "status,priority,issuetype" : "status";
  let authFailed = false;

  function fetchOne(
    i: number,
  ): Promise<{ statuses: typeof results; _failure?: JiraFailure }> {
    if (i >= tickets.length || authFailed)
      return Promise.resolve({
        statuses: results,
        ...(failure ? { _failure: failure } : {}),
      });
    const ticket = tickets[i];
    if (ticket === undefined)
      return Promise.resolve({
        statuses: results,
        ...(failure ? { _failure: failure } : {}),
      });
    return jiraApi(
      jiraUrl,
      JIRA_API_PREFIX + "/issue/" + ticket + "?fields=" + fields,
    )
      .then(readRawJiraIssue)
      .then(function (data) {
        if (!data.fields.status)
          throw new JiraRequestError(
            "invalid-response",
            "Jira did not return the requested issue status",
          );
        const r: JiraStatus = {
          name: data.fields.status.name,
          categoryKey: data.fields.status.statusCategory
            ? data.fields.status.statusCategory.key
            : "undefined",
        };
        if (showDetails) {
          r.priority = data.fields.priority ? data.fields.priority.name : "";
          r.priorityIcon = data.fields.priority
            ? data.fields.priority.iconUrl || ""
            : "";
          r.type = data.fields.issuetype ? data.fields.issuetype.name : "";
          r.typeIcon = data.fields.issuetype
            ? data.fields.issuetype.iconUrl || ""
            : "";
        }
        results[ticket] = r;
      })
      .catch(function (err: unknown) {
        const next = jiraFailure(err);
        if (!failure || stopsJiraBatch(next)) failure = next;
        authFailed = stopsJiraBatch(next);
        if (next._errorKind === "auth") results._authError = 401;
      })
      .then(function () {
        return fetchOne(i + 1);
      });
  }

  return fetchOne(0);
}
export function getFieldMap(jiraUrl: string) {
  if (_fieldMapCache[jiraUrl]) return Promise.resolve(_fieldMapCache[jiraUrl]);
  return jiraApi(jiraUrl, JIRA_API_PREFIX + "/field")
    .then(readJiraFields)
    .then(function (fields) {
      const map = { epicField: "", sprintField: "" };
      if (Array.isArray(fields)) {
        fields.forEach(function (f) {
          const n = (f.name || "").toLowerCase();
          const id = (f.id || "").toLowerCase();
          if (
            n === "epic link" ||
            n === "epic name" ||
            n.indexOf("epic") !== -1 ||
            id === "customfield_10014" ||
            id === "customfield_10008"
          ) {
            if (!map.epicField) map.epicField = f.id;
          }
          if (n === "sprint" || id === "customfield_10007") {
            if (!map.sprintField) map.sprintField = f.id;
          }
        });
      }
      _fieldMapCache[jiraUrl] = map;
      return map;
    })
    .catch(function (error: unknown) {
      if (stopsJiraBatch(jiraFailure(error))) throw error;
      return { epicField: "", sprintField: "" };
    });
}
const _fieldMapCache: Record<
  string,
  { epicField: string; sprintField: string }
> = {};
