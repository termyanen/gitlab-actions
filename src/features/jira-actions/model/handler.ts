import type { JiraQuickAction } from "../../../entities/jira-issue";
import type {
  JiraMessage,
  JiraNamed,
  JiraUser,
  RawJiraComment,
} from "../../../entities/jira-issue/background";
import {
  buildJiraQuickActionEdit,
  fetchJiraStatuses,
  getFieldMap,
  jiraApi,
  jiraQuickActionWrite,
  mapJiraComment,
  readJiraUser,
  readRawJiraComment,
  readRawJiraIssue,
} from "../../../entities/jira-issue/background";
import type { JiraFieldValue } from "../../../entities/jira-issue/content";
import { JIRA_API_PREFIX } from "../../../shared/config/jira";
import {
  jiraFailure,
  stopsJiraBatch,
  JiraRequestError,
  type JiraFailure,
} from "../../../entities/jira-issue/background";
import {
  arrayOf,
  decodeArray,
  decoder,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
  objectOf,
  optional,
  recordOf,
} from "../../../shared/lib/validation";
const readJiraVersions = decoder(
  arrayOf(
    objectOf<
      { name: string; archived?: boolean; released?: boolean }[][number]
    >({
      name: isString,
      archived: optional(isBoolean),
      released: optional(isBoolean),
    }),
  ),
  "GitLab/Jira response",
);
const readJiraTransitions = decoder(
  objectOf<{ transitions: { id: string; name: string; to?: JiraNamed }[] }>({
    transitions: arrayOf(
      objectOf<{ id: string; name: string; to?: JiraNamed }>({
        id: isString,
        name: isString,
        to: optional(
          objectOf<JiraNamed>({
            name: isString,
            iconUrl: optional(isString),
            statusCategory: optional(
              objectOf({
                key: isString,
              }),
            ),
          }),
        ),
      }),
    ),
  }),
  "GitLab/Jira response",
);
const readJiraComments = decoder(
  objectOf<{ comments: RawJiraComment[]; total: number }>({
    comments: arrayOf(
      objectOf<RawJiraComment>({
        id: isString,
        author: optional(
          objectOf<JiraUser>({
            accountId: optional(isString),
            key: optional(isString),
            name: optional(isString),
            displayName: isString,
            avatarUrls: optional(recordOf(isString)),
          }),
        ),
        body: optional(isString),
        created: optional(isString),
      }),
    ),
    total: isNumber,
  }),
  "GitLab/Jira response",
);
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
      .catch(function (error: unknown) {
        sendResponse({ ...jiraFailure(error), completed: completed });
      });
    return true;
  }
  if (msg.type === "fetch-jira-statuses") {
    fetchJiraStatuses(msg.jiraUrl, msg.tickets, msg.showDetails)
      .then(sendResponse)
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
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
        return jiraApi(
          msg.jiraUrl,
          JIRA_API_PREFIX + "/issue/" + msg.ticket + "?fields=" + fieldsParam,
        )
          .then(readRawJiraIssue)
          .then(function (data) {
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
              if (isUnknownArray(sprintVal) && sprintVal.length) {
                const last = sprintVal[sprintVal.length - 1];
                if (isRecord(last) && typeof last.name === "string")
                  sprint = last.name;
                else if (typeof last === "string") {
                  const sm = last.match(/name=([^,\]]+)/);
                  if (sm?.[1]) sprint = sm[1];
                }
              } else if (typeof sprintVal === "string") {
                sprint = sprintVal;
              }
            }
            sendResponse({
              key: data.key || msg.ticket,
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
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
      });
    return true;
  }
  if (msg.type === "fetch-jira-field-values") {
    // msg.jiraUrl, msg.tickets (array), msg.field (string, e.g. 'fixVersions')
    const field = msg.field || "fixVersions";
    // For status field, also fetch statusCategory for color coding
    const apiFields = field === "status" ? "status" : field;
    const results: Record<string, JiraFieldValue | number> = {};
    let failure: JiraFailure | undefined;
    let authFailed = false;
    const tickets = msg.tickets;
    function fetchField(i: number): Promise<typeof results> {
      if (i >= tickets.length || authFailed) return Promise.resolve(results);
      const ticket = tickets[i];
      if (ticket === undefined) return Promise.resolve(results);
      return jiraApi(
        msg.jiraUrl,
        JIRA_API_PREFIX + "/issue/" + ticket + "?fields=" + apiFields,
      )
        .then(readRawJiraIssue)
        .then(function (data) {
          const val = data && data.fields ? data.fields[field] : null;
          const values: string[] = [];
          let categoryKey = "";
          if (isUnknownArray(val)) {
            val.forEach(function (v) {
              values.push(
                isRecord(v) && typeof v.name === "string" ? v.name : String(v),
              );
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
            results[ticket] = {
              values,
              ...(categoryKey ? { categoryKey } : {}),
            };
          }
        })
        .catch(function (err: unknown) {
          const next = jiraFailure(err);
          if (!failure || stopsJiraBatch(next)) failure = next;
          authFailed = stopsJiraBatch(next);
          if (next._errorKind === "auth") results._authError = 401;
        })
        .then(function () {
          return fetchField(i + 1);
        });
    }
    fetchField(0)
      .then(function () {
        sendResponse({
          values: results,
          ...(failure ? { _failure: failure } : {}),
        });
      })
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
      });
    return true;
  }
  if (msg.type === "search-jira-assignable") {
    jiraApi(
      msg.jiraUrl,
      JIRA_API_PREFIX +
        "/user/assignable/search?issueKey=" +
        encodeURIComponent(msg.ticket) +
        "&username=" +
        encodeURIComponent(msg.query) +
        "&maxResults=10",
    )
      .then(decodeArray(readJiraUser))
      .then(function (users) {
        sendResponse({
          users: users.map(function (u) {
            if (!u.name)
              throw new JiraRequestError(
                "invalid-response",
                "Jira assignment requires a Server/Data Center username; accountId-only users are not supported",
              );
            return {
              key: u.name,
              name: u.displayName,
              avatar: u.avatarUrls?.["24x24"] || "",
            };
          }),
        });
      })
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
      });
    return true;
  }
  if (msg.type === "fetch-jira-versions") {
    const projectKey = msg.ticket.replace(/-\d+$/, "");
    jiraApi(
      msg.jiraUrl,
      JIRA_API_PREFIX + "/project/" + projectKey + "/versions",
    )
      .then(readJiraVersions)
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
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
      });
    return true;
  }
  if (msg.type === "set-jira-fix-versions") {
    jiraQuickActionWrite(msg.jiraUrl, msg.ticket, "", "PUT", {
      fields: { fixVersions: msg.versions.map((name) => ({ name })) },
    })
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) => sendResponse(jiraFailure(error)));
    return true;
  }
  if (msg.type === "set-jira-assignee") {
    jiraQuickActionWrite(msg.jiraUrl, msg.ticket, "", "PUT", {
      fields: { assignee: msg.username ? { name: msg.username } : null },
    })
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) => sendResponse(jiraFailure(error)));
    return true;
  }
  if (msg.type === "fetch-jira-transitions") {
    jiraApi(
      msg.jiraUrl,
      JIRA_API_PREFIX + "/issue/" + msg.ticket + "/transitions",
    )
      .then(readJiraTransitions)
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
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
      });
    return true;
  }
  if (msg.type === "fetch-jira-comments") {
    const startAt = msg.startAt || 0;
    const maxResults = msg.maxResults || 5;
    jiraApi(
      msg.jiraUrl,
      JIRA_API_PREFIX +
        "/issue/" +
        msg.ticket +
        "/comment?orderBy=-created&startAt=" +
        startAt +
        "&maxResults=" +
        maxResults,
    )
      .then(readJiraComments)
      .then(function (data) {
        const comments = (data.comments || []).map(mapJiraComment);
        sendResponse({ comments: comments, total: data.total || 0 });
      })
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
      });
    return true;
  }
  if (msg.type === "fetch-jira-myself") {
    jiraApi(msg.jiraUrl, JIRA_API_PREFIX + "/myself")
      .then(readJiraUser)
      .then(function (data) {
        const id = data.accountId || data.key || data.name;
        if (!id)
          throw new JiraRequestError(
            "invalid-response",
            "Jira did not return a user identity",
          );
        sendResponse({ id });
      })
      .catch(function (err: unknown) {
        sendResponse(jiraFailure(err));
      });
    return true;
  }
  if (msg.type === "delete-jira-comment") {
    jiraQuickActionWrite(
      msg.jiraUrl,
      msg.ticket,
      "/comment/" + encodeURIComponent(msg.commentId),
      "DELETE",
    )
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) => sendResponse(jiraFailure(error)));
    return true;
  }
  if (msg.type === "post-jira-comment") {
    jiraQuickActionWrite(msg.jiraUrl, msg.ticket, "/comment", "POST", {
      body: msg.text,
    })
      .then(readRawJiraComment)
      .then((comment) => sendResponse({ comment: mapJiraComment(comment) }))
      .catch((error: unknown) => sendResponse(jiraFailure(error)));
    return true;
  }
  if (msg.type === "do-jira-transition") {
    jiraQuickActionWrite(msg.jiraUrl, msg.ticket, "/transitions", "POST", {
      transition: { id: msg.transitionId },
    })
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) => sendResponse(jiraFailure(error)));
    return true;
  }
}
