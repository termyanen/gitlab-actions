import { JIRA_API_PREFIX } from "../../../shared/config/jira";
import type { JiraQuickAction } from "../../../entities/jira-issue";
import type {
  JiraMessage,
  JiraNamed,
  JiraUser,
  RawJiraComment,
  RawJiraIssue,
} from "../../../entities/jira-issue/background";
import {
  buildJiraQuickActionEdit,
  fetchJiraStatuses,
  getFieldMap,
  jiraApi,
  jiraQuickActionWrite,
  mapJiraComment,
} from "../../../entities/jira-issue/background";
import type { JiraFieldValue } from "../../../entities/jira-issue/content";
export function handleJiraMessage(
  msg: JiraMessage,
  sendResponse: (response: unknown) => void,
) {
  if (msg.type === "execute-jira-quick-action") {
    const completed = { transition: false, fields: false };
    Promise.resolve()
      .then(function () {
        const action: Partial<JiraQuickAction> = msg.action || {};
        const edit = buildJiraQuickActionEdit(action);
        if (action.status && !msg.transitionId)
          throw new Error("Jira transition is unavailable");
        if (!msg.transitionId && !Object.keys(edit).length)
          throw new Error("Empty Jira action");
        const transition = msg.transitionId
          ? jiraQuickActionWrite(
              msg.jiraUrl,
              msg.ticket,
              "/transitions",
              "POST",
              { transition: { id: msg.transitionId } },
            ).then(function () {
              completed.transition = true;
            })
          : Promise.resolve();
        return transition.then(function () {
          if (!Object.keys(edit).length) return;
          return jiraQuickActionWrite(
            msg.jiraUrl,
            msg.ticket,
            "",
            "PUT",
            edit,
          ).then(function () {
            completed.fields = true;
          });
        });
      })
      .then(function () {
        sendResponse({ success: true, completed: completed });
      })
      .catch(function (error) {
        sendResponse({ _error: error.message, completed: completed });
      });
    return true;
  }
  if (msg.type === "fetch-jira-statuses") {
    fetchJiraStatuses(msg.jiraUrl, msg.tickets, msg.showDetails)
      .then(function (statuses) {
        sendResponse({ statuses: statuses });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "fetch-jira-issue") {
    getFieldMap(msg.jiraUrl)
      .then(function (fieldMap) {
        const extraFields = [fieldMap.epicField, fieldMap.sprintField]
          .filter(Boolean)
          .join(",");
        let fieldsParam =
          "summary,status,description,assignee,reporter,priority,issuetype,created,updated,labels,attachment,components,versions,fixVersions,resolution";
        if (extraFields) fieldsParam += "," + extraFields;
        return jiraApi<RawJiraIssue>(
          msg.jiraUrl,
          JIRA_API_PREFIX + "/issue/" + msg.ticket + "?fields=" + fieldsParam,
        ).then(function (data) {
          const f = data.fields;
          const attachments: Record<string, string> = {};
          const attachmentList: {
            filename: string;
            url: string;
            size: number;
            mimeType: string;
          }[] = [];
          if (f.attachment && f.attachment.length) {
            f.attachment.forEach(function (a) {
              attachments[a.filename] = a.content;
              attachmentList.push({
                filename: a.filename,
                url: a.content,
                size: a.size || 0,
                mimeType: a.mimeType || "",
              });
            });
          }
          // Epic link & Sprint via dynamic field IDs
          let epicLink = "";
          const epicVal = fieldMap.epicField ? f[fieldMap.epicField] : null;
          if (epicVal) {
            epicLink =
              typeof epicVal === "string"
                ? epicVal
                : typeof epicVal === "object"
                  ? String(
                      ("key" in epicVal && epicVal.key) ||
                        ("name" in epicVal && epicVal.name) ||
                        ("summary" in epicVal && epicVal.summary) ||
                        "",
                    )
                  : "";
          }
          let sprint = "";
          const sprintVal = fieldMap.sprintField
            ? f[fieldMap.sprintField]
            : null;
          if (sprintVal) {
            if (Array.isArray(sprintVal) && sprintVal.length) {
              const last = sprintVal[sprintVal.length - 1];
              if (typeof last === "object" && last.name) sprint = last.name;
              else if (typeof last === "string") {
                const sm = last.match(/name=([^,\]]+)/);
                if (sm) sprint = sm[1];
              }
            } else if (typeof sprintVal === "string") {
              sprint = sprintVal;
            }
          }
          sendResponse({
            key: data.key,
            summary: f.summary || "",
            status: f.status ? f.status.name : "",
            statusCategoryKey:
              f.status && f.status.statusCategory
                ? f.status.statusCategory.key
                : "",
            description: f.description || "",
            assignee: f.assignee ? f.assignee.displayName : "",
            reporter: f.reporter ? f.reporter.displayName : "",
            priority: f.priority ? f.priority.name : "",
            priorityIcon: f.priority ? f.priority.iconUrl : "",
            type: f.issuetype ? f.issuetype.name : "",
            typeIcon: f.issuetype ? f.issuetype.iconUrl : "",
            created: f.created || "",
            updated: f.updated || "",
            labels: f.labels || [],
            attachments: attachments,
            attachmentList: attachmentList,
            components: (f.components || []).map(function (c) {
              return c.name;
            }),
            versions: (f.versions || []).map(function (v) {
              return v.name;
            }),
            fixVersions: (f.fixVersions || []).map(function (v) {
              return v.name;
            }),
            resolution: f.resolution ? f.resolution.name : "",
            epicLink: epicLink,
            sprint: sprint,
          });
        });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "fetch-jira-field-values") {
    // msg.jiraUrl, msg.tickets (array), msg.field (string, e.g. 'fixVersions')
    const field = msg.field || "fixVersions";
    // For status field, also fetch statusCategory for color coding
    const apiFields = field === "status" ? "status" : field;
    const results: Record<string, JiraFieldValue | number> = {};
    let authFailed = false;
    const tickets = msg.tickets;
    function fetchField(i: number): Promise<typeof results> {
      if (i >= tickets.length || authFailed) return Promise.resolve(results);
      const ticket = tickets[i];
      return jiraApi<RawJiraIssue>(
        msg.jiraUrl,
        JIRA_API_PREFIX + "/issue/" + ticket + "?fields=" + apiFields,
      )
        .then(function (data) {
          const val = data && data.fields ? data.fields[field] : null;
          const values: string[] = [];
          let categoryKey = "";
          if (Array.isArray(val)) {
            val.forEach(function (v) {
              values.push(typeof v === "object" && v.name ? v.name : String(v));
            });
          } else if (
            val &&
            typeof val === "object" &&
            "name" in val &&
            typeof val.name === "string"
          ) {
            values.push(val.name);
            if (
              "statusCategory" in val &&
              val.statusCategory &&
              typeof val.statusCategory === "object" &&
              "key" in val.statusCategory
            )
              categoryKey = String(val.statusCategory.key || "");
          } else if (val) {
            values.push(String(val));
          }
          if (values.length) {
            results[ticket] = { values: values };
            if (categoryKey) results[ticket].categoryKey = categoryKey;
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
          return fetchField(i + 1);
        });
    }
    fetchField(0)
      .then(function () {
        sendResponse({ values: results });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "search-jira-assignable") {
    jiraApi<JiraUser[]>(
      msg.jiraUrl,
      JIRA_API_PREFIX +
        "/user/assignable/search?issueKey=" +
        encodeURIComponent(msg.ticket) +
        "&username=" +
        encodeURIComponent(msg.query) +
        "&maxResults=10",
    )
      .then(function (users) {
        sendResponse({
          users: users.map(function (u) {
            return {
              key: u.key || u.name,
              name: u.displayName,
              avatar: u.avatarUrls ? u.avatarUrls["24x24"] : "",
            };
          }),
        });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "fetch-jira-versions") {
    const projectKey = msg.ticket.replace(/-\d+$/, "");
    jiraApi<{ name: string; archived?: boolean; released?: boolean }[]>(
      msg.jiraUrl,
      JIRA_API_PREFIX + "/project/" + projectKey + "/versions",
    )
      .then(function (versions) {
        const list = (versions || [])
          .filter(function (v) {
            return !v.archived;
          })
          .map(function (v) {
            return { name: v.name, released: !!v.released };
          });
        sendResponse({ versions: list });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "set-jira-fix-versions") {
    const fvUrl = msg.jiraUrl + JIRA_API_PREFIX + "/issue/" + msg.ticket;
    chrome.cookies
      .getAll({ url: msg.jiraUrl })
      .then(function (cookies) {
        const cookieStr = cookies
          .map(function (c) {
            return c.name + "=" + c.value;
          })
          .join("; ");
        return fetch(fvUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookieStr },
          body: JSON.stringify({
            fields: {
              fixVersions: msg.versions.map(function (v) {
                return { name: v };
              }),
            },
          }),
        });
      })
      .then(function (r) {
        if (r.status === 204 || r.ok) {
          sendResponse({ success: true });
        } else {
          return r.text().then(function (text) {
            throw new Error(r.status + " " + text);
          });
        }
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "set-jira-assignee") {
    const url = msg.jiraUrl + JIRA_API_PREFIX + "/issue/" + msg.ticket;
    chrome.cookies
      .getAll({ url: msg.jiraUrl })
      .then(function (cookies) {
        const cookieStr = cookies
          .map(function (c) {
            return c.name + "=" + c.value;
          })
          .join("; ");
        return fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Cookie: cookieStr },
          body: JSON.stringify({
            fields: { assignee: msg.username ? { name: msg.username } : null },
          }),
        });
      })
      .then(function (r) {
        if (r.status === 204 || r.ok) {
          sendResponse({ success: true });
        } else {
          return r.text().then(function (text) {
            throw new Error(r.status + " " + text);
          });
        }
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "fetch-jira-transitions") {
    jiraApi<{ transitions: { id: string; name: string; to?: JiraNamed }[] }>(
      msg.jiraUrl,
      JIRA_API_PREFIX + "/issue/" + msg.ticket + "/transitions",
    )
      .then(function (data) {
        const transitions = (data.transitions || []).map(function (t) {
          return {
            id: t.id,
            name: t.name,
            statusName: t.to ? t.to.name : "",
            statusCategoryKey:
              t.to && t.to.statusCategory ? t.to.statusCategory.key : "",
          };
        });
        sendResponse({ transitions: transitions });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "fetch-jira-comments") {
    const startAt = msg.startAt || 0;
    const maxResults = msg.maxResults || 5;
    jiraApi<{ comments: RawJiraComment[]; total: number }>(
      msg.jiraUrl,
      JIRA_API_PREFIX +
        "/issue/" +
        msg.ticket +
        "/comment?orderBy=-created&startAt=" +
        startAt +
        "&maxResults=" +
        maxResults,
    )
      .then(function (data) {
        const comments = (data.comments || []).map(mapJiraComment);
        sendResponse({ comments: comments, total: data.total || 0 });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "fetch-jira-myself") {
    jiraApi<JiraUser>(msg.jiraUrl, JIRA_API_PREFIX + "/myself")
      .then(function (data) {
        sendResponse({ id: data.accountId || data.key || data.name || "" });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "delete-jira-comment") {
    const deleteUrl =
      msg.jiraUrl +
      JIRA_API_PREFIX +
      "/issue/" +
      msg.ticket +
      "/comment/" +
      msg.commentId;
    chrome.cookies
      .getAll({ url: msg.jiraUrl })
      .then(function (cookies) {
        const cookieStr = cookies
          .map(function (c) {
            return c.name + "=" + c.value;
          })
          .join("; ");
        return fetch(deleteUrl, {
          method: "DELETE",
          headers: { Cookie: cookieStr, "X-Atlassian-Token": "no-check" },
        });
      })
      .then(function (r) {
        if (r.status === 204 || r.ok) {
          sendResponse({ success: true });
        } else {
          return r.text().then(function (text) {
            throw new Error(r.status + " " + text);
          });
        }
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "post-jira-comment") {
    const commentUrl =
      msg.jiraUrl + JIRA_API_PREFIX + "/issue/" + msg.ticket + "/comment";
    chrome.cookies
      .getAll({ url: msg.jiraUrl })
      .then(function (cookies) {
        const cookieStr = cookies
          .map(function (c) {
            return c.name + "=" + c.value;
          })
          .join("; ");
        return fetch(commentUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieStr,
            "X-Atlassian-Token": "no-check",
          },
          body: JSON.stringify({ body: msg.text }),
        });
      })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (text) {
            throw new Error(r.status + " " + text);
          });
        }
        return r.json();
      })
      .then(function (c) {
        sendResponse({ comment: mapJiraComment(c) });
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
  if (msg.type === "do-jira-transition") {
    const url =
      msg.jiraUrl + JIRA_API_PREFIX + "/issue/" + msg.ticket + "/transitions";
    chrome.cookies
      .getAll({ url: msg.jiraUrl })
      .then(function (cookies) {
        const cookieStr = cookies
          .map(function (c) {
            return c.name + "=" + c.value;
          })
          .join("; ");
        return fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieStr },
          body: JSON.stringify({ transition: { id: msg.transitionId } }),
        });
      })
      .then(function (r) {
        if (r.status === 204 || r.ok) {
          sendResponse({ success: true });
        } else {
          return r.text().then(function (text) {
            throw new Error(r.status + " " + text);
          });
        }
      })
      .catch(function (err) {
        sendResponse({ _error: err.message });
      });
    return true;
  }
}
