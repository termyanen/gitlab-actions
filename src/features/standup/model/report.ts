import {
  jiraApi,
  readRawJiraIssue,
} from "../../../entities/jira-issue/background";
import { api } from "../../../shared/api/background-proxy";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab";
import { JIRA_API_PREFIX } from "../../../shared/config/jira";
import { msg as localize } from "../../../shared/i18n";
import { errorMessage } from "../../../shared/lib/errors";
import {
  arrayOf,
  decoder,
  isNumber,
  isString,
  objectOf,
  optional,
} from "../../../shared/lib/validation";
const readCurrentUser = decoder(
  objectOf<{ id: number; username: string }>({
    id: isNumber,
    username: isString,
  }),
  "GitLab/Jira response",
);
const readActivityEvent = decoder(
  arrayOf(
    objectOf<ActivityEvent>({
      project_id: isNumber,
      created_at: optional(isString),
      action_name: isString,
      note: optional(
        objectOf({
          id: isNumber,
          noteable_type: isString,
          noteable_iid: isNumber,
        }),
      ),
      target_type: optional(isString),
      target_iid: isNumber,
      target_title: optional(isString),
      push_data: optional(
        objectOf<{ ref: string; ref_type: string; commit_count?: number }>({
          ref: isString,
          ref_type: isString,
          commit_count: optional(isNumber),
        }),
      ),
    }),
  ),
  "GitLab/Jira response",
);
const readActivityMr = decoder(
  arrayOf(
    objectOf<ActivityMr>({
      id: isNumber,
      iid: isNumber,
      title: isString,
      created_at: optional(isString),
      merged_at: optional(isString),
      references: optional(
        objectOf<{ full?: string }>({
          full: optional(isString),
        }),
      ),
      pipeline: optional(
        objectOf({
          status: isString,
        }),
      ),
    }),
  ),
  "GitLab/Jira response",
);
const readProjectPath = decoder(
  objectOf<{ path_with_namespace: string }>({
    path_with_namespace: isString,
  }),
  "GitLab/Jira response",
);
const REPORT_TIMEOUT_MS = 180000;
const REPORT_EVENT_MAX_PAGES = 5;
const REPORT_MR_LIMIT = 50;
interface ActivityMr {
  id: number;
  iid: number;
  title: string;
  created_at?: string;
  merged_at?: string;
  references?: { full?: string };
  pipeline?: { status: string };
}
interface ActivityEvent {
  project_id: number;
  created_at?: string;
  action_name: string;
  note?: { id: number; noteable_type: string; noteable_iid: number };
  target_type?: string;
  target_iid: number;
  target_title?: string;
  push_data?: { ref: string; ref_type: string; commit_count?: number };
}
export interface StandupMessage {
  type: "generate-standup";
  gitlabUrl: string;
  date?: string;
}
export function generateStandup(
  msg: StandupMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: { text?: string; _error?: string }) => void,
) {
  const standupUrl = msg.gitlabUrl;
  const fakeTask = {
    gitlabUrl: standupUrl,
    _tabId: sender.tab?.id ?? null,
  };

  // Guarantee exactly one response so the modal never spins forever
  let standupDone = false;
  const standupWatchdog = setTimeout(function () {
    standupRespond({
      _error:
        "Timed out generating the report (180s). Check that GitLab is reachable and reload the tab.",
    });
  }, REPORT_TIMEOUT_MS);
  function standupRespond(payload: { text?: string; _error?: string }) {
    if (standupDone) return;
    standupDone = true;
    clearTimeout(standupWatchdog);
    try {
      sendResponse(payload);
    } catch {
      /* Response port may have closed. */
    }
  }

  // Get current user
  api(fakeTask, "GET", "/user")
    .then(readCurrentUser)
    .then(function (user) {
      if (!user || !user.id) throw new Error("Cannot get current user");
      const userId = user.id;

      // Use provided date or default to today (local dates, no UTC conversion)
      function localDateStr(d: Date) {
        return (
          d.getFullYear() +
          "-" +
          (d.getMonth() + 1 < 10 ? "0" : "") +
          (d.getMonth() + 1) +
          "-" +
          (d.getDate() < 10 ? "0" : "") +
          d.getDate()
        );
      }
      const targetDate = msg.date
        ? new Date(msg.date + "T12:00:00")
        : new Date();
      const todayStr = msg.date || localDateStr(targetDate);
      // Next day
      const nextDay = new Date(todayStr + "T12:00:00");
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = localDateStr(nextDay);
      // Day before (events API "after" is exclusive)
      const dayBefore = new Date(todayStr + "T12:00:00");
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayBeforeStr = localDateStr(dayBefore);
      let truncatedEvents = false;

      // Helper: fetch all event pages for the day (up to 5 pages)
      function fetchAllEvents(
        page: number,
        collected: ActivityEvent[],
      ): Promise<ActivityEvent[]> {
        if (page > REPORT_EVENT_MAX_PAGES) {
          truncatedEvents = true;
          return Promise.resolve(collected);
        }
        return api(
          fakeTask,
          "GET",
          "/users/" +
            userId +
            "/events?after=" +
            dayBeforeStr +
            "&before=" +
            nextDayStr +
            "&per_page=" +
            GITLAB_PAGE_SIZE +
            "&page=" +
            page,
        )
          .then(readActivityEvent)
          .then(function (events) {
            if (!events || !events.length) return collected;
            collected = collected.concat(events);
            if (events.length < GITLAB_PAGE_SIZE) return collected;
            return fetchAllEvents(page + 1, collected);
          });
      }

      // Fetch activity in parallel
      return Promise.all([
        // MRs created on target date
        api(
          fakeTask,
          "GET",
          "/merge_requests?scope=all&state=all&author_id=" +
            userId +
            "&created_after=" +
            todayStr +
            "T00:00:00Z&created_before=" +
            nextDayStr +
            "T00:00:00Z&per_page=" +
            REPORT_MR_LIMIT,
        ).then(readActivityMr),
        // MRs merged on target date
        api(
          fakeTask,
          "GET",
          "/merge_requests?scope=all&state=merged&author_id=" +
            userId +
            "&updated_after=" +
            todayStr +
            "T00:00:00Z&updated_before=" +
            nextDayStr +
            "T00:00:00Z&per_page=" +
            REPORT_MR_LIMIT,
        ).then(readActivityMr),
        // All events for target date (paginated)
        fetchAllEvents(1, []),
        // Open MRs updated on target date (for "in progress")
        api(
          fakeTask,
          "GET",
          "/merge_requests?scope=all&state=opened&author_id=" +
            userId +
            "&updated_after=" +
            todayStr +
            "T00:00:00Z&updated_before=" +
            nextDayStr +
            "T00:00:00Z&per_page=" +
            REPORT_MR_LIMIT,
        ).then(readActivityMr),
      ]).then(function (results) {
        let createdMrs = results[0] || [];
        let mergedMrs = results[1] || [];
        let events = results[2] || [];
        const activeMrs = results[3] || [];

        // Filter created on target date (double-check)
        createdMrs = createdMrs.filter(function (mr) {
          return mr.created_at && mr.created_at.indexOf(todayStr) === 0;
        });

        // Filter merged on target date (double-check merged_at)
        mergedMrs = mergedMrs.filter(function (mr) {
          return mr.merged_at && mr.merged_at.indexOf(todayStr) === 0;
        });

        // Filter events to target date only
        events = events.filter(function (ev) {
          return ev.created_at && ev.created_at.indexOf(todayStr) === 0;
        });

        // Collect created MR IDs to avoid duplicates
        const createdIids: Record<string, boolean> = {};
        createdMrs.forEach(function (mr) {
          createdIids[mr.id] = true;
        });
        const mergedIids: Record<string, boolean> = {};
        mergedMrs.forEach(function (mr) {
          mergedIids[mr.id] = true;
        });

        // Commented MRs (deduplicate by note.id to avoid double-counting)
        const commentedMap: Record<
          string,
          { iid: number; projectId: number; count: number; targetTitle: string }
        > = {};
        const seenNoteIds: Record<string, boolean> = {};
        events.forEach(function (ev) {
          if (
            ev.action_name === "commented on" &&
            ev.note &&
            ev.note.noteable_type === "MergeRequest"
          ) {
            if (seenNoteIds[ev.note.id]) return;
            seenNoteIds[ev.note.id] = true;
            const mrIid = ev.note.noteable_iid;
            const projId = ev.project_id;
            const key = projId + "!" + mrIid;
            if (!commentedMap[key]) {
              commentedMap[key] = {
                iid: mrIid,
                projectId: projId,
                count: 0,
                targetTitle: ev.target_title || "",
              };
            }
            commentedMap[key].count++;
          }
        });

        // Approved MRs
        const approvedMap: Record<string, { iid: number; title: string }> = {};
        events.forEach(function (ev) {
          if (
            ev.action_name === "approved" &&
            ev.target_type === "MergeRequest"
          ) {
            const key = ev.project_id + "!" + ev.target_iid;
            approvedMap[key] = {
              iid: ev.target_iid,
              title: ev.target_title || "",
            };
          }
        });

        // Collect unique project IDs from events and resolve names
        const projectIds: Record<string, string> = {};
        events.forEach(function (ev) {
          if (ev.project_id) projectIds[ev.project_id] = "";
        });

        // Fetch project names in parallel
        const pidList = Object.keys(projectIds);
        return (
          pidList.length
            ? Promise.all(
                pidList.map(function (pid) {
                  return api(
                    fakeTask,
                    "GET",
                    "/projects/" + pid + "?simple=true",
                  )
                    .then(readProjectPath)
                    .then(function (proj) {
                      if (proj && proj.path_with_namespace)
                        projectIds[pid] = proj.path_with_namespace;
                    })
                    .catch(function () {});
                }),
              )
            : Promise.resolve()
        ).then(function () {
          function projName(ev: ActivityEvent) {
            return projectIds[ev.project_id] || "";
          }

          // Pushes — group by project + branch
          const pushMap: Record<
            string,
            { ref: string; project: string; commits: number }
          > = {};
          events.forEach(function (ev) {
            if (
              ev.action_name === "pushed to" ||
              ev.action_name === "pushed new"
            ) {
              const ref = ev.push_data ? ev.push_data.ref : "";
              const refType = ev.push_data ? ev.push_data.ref_type : "branch";
              if (refType === "tag") return;
              const pName = projName(ev);
              const key = (pName || ev.project_id) + ":" + ref;
              if (!pushMap[key]) {
                pushMap[key] = { ref: ref, project: pName, commits: 0 };
              }
              const commitCount = ev.push_data
                ? ev.push_data.commit_count || 1
                : 1;
              pushMap[key].commits += commitCount;
            }
          });

          // Tags
          const tags: { tag: string; project: string }[] = [];
          events.forEach(function (ev) {
            if (ev.push_data && ev.push_data.ref_type === "tag") {
              tags.push({ tag: ev.push_data.ref, project: projName(ev) });
            }
          });

          // Build report
          const lines: string[] = [];
          if (
            truncatedEvents ||
            [results[0], results[1], results[3]].some(
              (items) => items?.length >= REPORT_MR_LIMIT,
            )
          ) {
            lines.push(
              localize("standupPartialWarning", [
                REPORT_MR_LIMIT,
                REPORT_EVENT_MAX_PAGES * GITLAB_PAGE_SIZE,
              ]),
              "",
            );
          }

          if (createdMrs.length) {
            lines.push("Created:");
            createdMrs.forEach(function (mr) {
              const proj =
                mr.references && mr.references.full
                  ? mr.references.full.split("!")[0]
                  : "";
              lines.push(
                "  - !" +
                  mr.iid +
                  " " +
                  mr.title +
                  (proj ? " (" + proj.replace(/\/$/, "") + ")" : ""),
              );
            });
            lines.push("");
          }

          if (mergedMrs.length) {
            lines.push("Merged:");
            mergedMrs.forEach(function (mr) {
              const proj =
                mr.references && mr.references.full
                  ? mr.references.full.split("!")[0]
                  : "";
              lines.push(
                "  - !" +
                  mr.iid +
                  " " +
                  mr.title +
                  (proj ? " (" + proj.replace(/\/$/, "") + ")" : ""),
              );
            });
            lines.push("");
          }

          const commentedKeys = Object.keys(commentedMap);
          if (commentedKeys.length) {
            lines.push("Commented:");
            commentedKeys.forEach(function (key) {
              const r = commentedMap[key];
              if (!r) return;
              lines.push(
                "  - !" +
                  r.iid +
                  " " +
                  (r.targetTitle || "") +
                  " \u2014 " +
                  r.count +
                  " comment" +
                  (r.count > 1 ? "s" : ""),
              );
            });
            lines.push("");
          }

          const approvedKeys = Object.keys(approvedMap);
          if (approvedKeys.length) {
            lines.push("Approved:");
            approvedKeys.forEach(function (key) {
              const a = approvedMap[key];
              if (!a) return;
              lines.push("  - !" + a.iid + " " + a.title);
            });
            lines.push("");
          }

          const pushKeys = Object.keys(pushMap);
          if (pushKeys.length) {
            lines.push("Pushed:");
            pushKeys.forEach(function (key) {
              const p = pushMap[key];
              if (!p) return;
              lines.push(
                "  - " +
                  (p.project ? p.project + " - " : "") +
                  p.ref +
                  " \u2014 " +
                  p.commits +
                  " commit" +
                  (p.commits > 1 ? "s" : ""),
              );
            });
            lines.push("");
          }

          if (tags.length) {
            lines.push("Tags:");
            tags.forEach(function (t) {
              lines.push(
                "  - " + t.tag + (t.project ? " (" + t.project + ")" : ""),
              );
            });
            lines.push("");
          }

          // In progress — open MRs updated on target date, excluding created/merged
          const inProgress = activeMrs.filter(function (mr) {
            return !createdIids[mr.id] && !mergedIids[mr.id];
          });
          if (inProgress.length) {
            lines.push("In progress:");
            inProgress.forEach(function (mr) {
              const proj =
                mr.references && mr.references.full
                  ? mr.references.full.split("!")[0]
                  : "";
              let status = "";
              if (mr.pipeline && mr.pipeline.status)
                status = " \u2014 pipeline " + mr.pipeline.status;
              lines.push(
                "  - !" +
                  mr.iid +
                  " " +
                  mr.title +
                  (proj ? " (" + proj.replace(/\/$/, "") + ")" : "") +
                  status,
              );
            });
          }

          if (!lines.length) {
            lines.push("No activity for this day.");
          }

          // Enrich lines with Jira ticket titles if configured.
          // Any failure here must degrade to the plain report, never to a hang.
          chrome.storage.sync.get(
            { jira_url: "", jira_ticket_regex: "", standup_jira_enrich: true },
            function (jiraSettings: {
              jira_url: string;
              jira_ticket_regex: string;
              standup_jira_enrich: boolean;
            }) {
              try {
                const jiraUrl = (jiraSettings.jira_url || "").replace(
                  /\/+$/,
                  "",
                );
                if (!jiraUrl || jiraSettings.standup_jira_enrich === false) {
                  standupRespond({ text: lines.join("\n") });
                  return;
                }
                let ticketPattern;
                try {
                  ticketPattern = jiraSettings.jira_ticket_regex
                    ? new RegExp(jiraSettings.jira_ticket_regex, "g")
                    : /[A-Z][A-Z0-9]+-\d+/g;
                } catch {
                  ticketPattern = /[A-Z][A-Z0-9]+-\d+/g;
                }
                // Collect unique tickets from all lines
                const allText = lines.join("\n");
                const ticketSet: Record<string, boolean> = {};
                let m;
                while ((m = ticketPattern.exec(allText)) !== null) {
                  if (m[0]) ticketSet[m[0]] = true;
                  // A custom regex matching the empty string would never advance lastIndex
                  if (m.index === ticketPattern.lastIndex)
                    ticketPattern.lastIndex++;
                }
                const tickets = Object.keys(ticketSet);
                if (!tickets.length) {
                  standupRespond({ text: lines.join("\n") });
                  return;
                }
                // Fetch Jira summaries (up to 5 concurrent)
                const ticketSummaries: Record<string, string> = {};
                const fetchQueue = tickets.slice();
                function fetchNextBatch(): Promise<void> {
                  if (!fetchQueue.length) return Promise.resolve();
                  const batch = fetchQueue.splice(0, 5);
                  return Promise.all(
                    batch.map(function (ticket) {
                      return jiraApi(
                        jiraUrl,
                        JIRA_API_PREFIX +
                          "/issue/" +
                          ticket +
                          "?fields=summary",
                      )
                        .then(readRawJiraIssue)
                        .then(function (data) {
                          if (data && data.fields && data.fields.summary) {
                            ticketSummaries[ticket] = data.fields.summary;
                          }
                        })
                        .catch(function () {});
                    }),
                  ).then(function () {
                    return fetchNextBatch();
                  });
                }
                fetchNextBatch()
                  .then(function () {
                    // Annotate lines: append Jira summary after ticket ID
                    if (Object.keys(ticketSummaries).length) {
                      try {
                        for (const [i, line] of lines.entries()) {
                          if (line.indexOf("  - ") !== 0) continue;
                          // Reset regex for each line
                          let lp;
                          try {
                            lp = jiraSettings.jira_ticket_regex
                              ? new RegExp(jiraSettings.jira_ticket_regex, "g")
                              : /[A-Z][A-Z0-9]+-\d+/g;
                          } catch {
                            lp = /[A-Z][A-Z0-9]+-\d+/g;
                          }
                          const lineTickets: string[] = [];
                          let lm;
                          while ((lm = lp.exec(line)) !== null) {
                            if (
                              ticketSummaries[lm[0]] &&
                              lineTickets.indexOf(lm[0]) === -1
                            ) {
                              lineTickets.push(lm[0]);
                            }
                            if (lm.index === lp.lastIndex) lp.lastIndex++;
                          }
                          if (lineTickets.length) {
                            const annotations = lineTickets.map(function (t) {
                              return "[" + t + ": " + ticketSummaries[t] + "]";
                            });
                            lines[i] = line + "\n    " + annotations.join(" ");
                          }
                        }
                      } catch {
                        /* keep un-annotated lines */
                      }
                    }
                    standupRespond({ text: lines.join("\n") });
                  })
                  .catch(function () {
                    standupRespond({ text: lines.join("\n") });
                  });
              } catch {
                // Jira enrichment is optional — fall back to the plain report
                standupRespond({ text: lines.join("\n") });
              }
            },
          );
        }); // end projectIds resolve
      }); // end main Promise.all
    })
    .catch(function (err: unknown) {
      standupRespond({ _error: errorMessage(err) || String(err) });
    });
  return true;
}
