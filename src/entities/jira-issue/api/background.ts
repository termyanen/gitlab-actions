import type { JiraQuickAction, JiraStatus } from "../model/types";
import type { RawJiraIssue, RawJiraComment } from "./types";
export function jiraApi<T = unknown>(
  jiraUrl: string,
  path: string,
): Promise<T> {
  const url = jiraUrl + path;
  return chrome.cookies
    .getAll({ url: jiraUrl })
    .then(function (cookies) {
      const cookieStr = cookies
        .map(function (c) {
          return c.name + "=" + c.value;
        })
        .join("; ");
      return fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieStr,
        },
      });
    })
    .then(function (r) {
      if (!r.ok) {
        const err = Object.assign(new Error(r.status + " " + r.statusText), {
          httpStatus: r.status,
        });
        throw err;
      }
      return r.json();
    });
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
  const seen = new Set();
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
        !Array.isArray(value) ||
        !value.length ||
        value.some(function (v) {
          return typeof v !== "string" || !v.trim();
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
  body: unknown,
) {
  return chrome.cookies
    .getAll({ url: jiraUrl })
    .then(function (cookies) {
      return fetch(
        jiraUrl + "/rest/api/2/issue/" + encodeURIComponent(ticket) + suffix,
        {
          method: method,
          headers: {
            "Content-Type": "application/json",
            Cookie: cookies
              .map(function (c) {
                return c.name + "=" + c.value;
              })
              .join("; "),
          },
          body: JSON.stringify(body),
        },
      );
    })
    .then(function (response) {
      if (!response.ok)
        return response.text().then(function (text) {
          throw new Error(response.status + " " + text);
        });
    });
}
export function fetchJiraStatuses(
  jiraUrl: string,
  tickets: string[],
  showDetails?: boolean,
) {
  const results: Record<string, JiraStatus | number> = {};
  const fields = showDetails ? "status,priority,issuetype" : "status";
  let authFailed = false;

  function fetchOne(i: number): Promise<typeof results> {
    if (i >= tickets.length || authFailed) return Promise.resolve(results);
    const ticket = tickets[i];
    return jiraApi<RawJiraIssue>(
      jiraUrl,
      "/rest/api/2/issue/" + ticket + "?fields=" + fields,
    )
      .then(function (data) {
        if (data && data.fields && data.fields.status) {
          const r: JiraStatus = {
            name: data.fields.status.name,
            categoryKey: data.fields.status.statusCategory
              ? data.fields.status.statusCategory.key
              : "undefined",
          };
          if (showDetails) {
            r.priority = data.fields.priority ? data.fields.priority.name : "";
            r.priorityIcon = data.fields.priority
              ? data.fields.priority.iconUrl
              : "";
            r.type = data.fields.issuetype ? data.fields.issuetype.name : "";
            r.typeIcon = data.fields.issuetype
              ? data.fields.issuetype.iconUrl
              : "";
          }
          results[ticket] = r;
        }
      })
      .catch(function (err) {
        const status = err.httpStatus || 0;
        if (status === 401 || status === 403) {
          authFailed = true;
          results._authError = status;
        }
      })
      .then(function () {
        return fetchOne(i + 1);
      });
  }

  return fetchOne(0);
}
export function getFieldMap(jiraUrl: string) {
  if (_fieldMapCache[jiraUrl]) return Promise.resolve(_fieldMapCache[jiraUrl]);
  return jiraApi<{ id: string; name: string }[]>(jiraUrl, "/rest/api/2/field")
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
    .catch(function () {
      return { epicField: "", sprintField: "" };
    });
}
const _fieldMapCache: Record<
  string,
  { epicField: string; sprintField: string }
> = {};
