import type { JiraState } from "../../../entities/jira-issue";
import { createJiraMatcher } from "../../../entities/jira-issue";
import {
  getJiraCategoryClass,
  sendJiraMessage,
} from "../../../entities/jira-issue/content";
import { SEL } from "../../../shared/config/gitlab";
import { qAll, qUp } from "../../../shared/lib/dom";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { createLifecycle } from "../../../shared/lib/lifecycle";
const BADGE_MOUNT_DEBOUNCE_MS = 500;
interface CommitTicketEntry {
  row: HTMLElement;
  lastMsgEl: HTMLElement;
  tickets: string[];
}
export function startCommitJira(
  jiraState: JiraState,
  openJiraSidebar: (ticket: string, url: string) => void,
  scope: Lifecycle = createLifecycle(),
) {
  const { setJiraTicketRegex, parseTickets } = createJiraMatcher(jiraState);

  function isCommitsPage() {
    return (
      /\/-\/commits\//.test(window.location.pathname) ||
      /\/-\/repository\/commits\//.test(window.location.pathname)
    );
  }
  // Jira field badges on commits page
  // =========================================================================

  if (isCommitsPage()) {
    try {
      chrome.storage.sync.get(
        {
          jira_url: "",
          jira_ticket_regex: "",
          commits_jira_field: "fixVersions, status",
        },
        scope.guard(function (s: {
          jira_url: string;
          jira_ticket_regex: string;
          commits_jira_field: string;
        }) {
          if (chrome.runtime.lastError || !s.jira_url || !s.commits_jira_field)
            return;
          setJiraTicketRegex(s.jira_ticket_regex);
          const jiraUrl = s.jira_url;
          const jiraFields = s.commits_jira_field
            .split(",")
            .map(function (f) {
              return f.trim();
            })
            .filter(Boolean);
          if (!jiraFields.length) return;
          const _commitJiraCache: Record<
            string,
            {
              ts: number;
              fields: Record<string, string[]>;
              _categoryKey?: string;
            }
          > = {};
          let _commitJiraFetching = false;
          const _commitJiraInvalidated = new Set<string>();
          jiraState.invalidateCommitTicket = function (ticket) {
            delete _commitJiraCache[ticket];
            if (_commitJiraFetching) _commitJiraInvalidated.add(ticket);
            else injectCommitJiraBadges();
          };

          function injectCommitJiraBadges() {
            if (scope.disposed) return;
            if (_commitJiraFetching) return;

            // Find commit rows via SHA groups (same reliable strategy as cherry-pick buttons)
            const shaGroups = Array.from(qAll(document, SEL.commitShaGroup));
            if (!shaGroups.length) {
              // Fallback: clipboard buttons with SHA pattern
              const clipEls = qAll(document, "[data-clipboard-text]");
              for (let ci = 0; ci < clipEls.length; ci++) {
                const cv =
                  clipEls[ci].getAttribute("data-clipboard-text") || "";
                if (/^[0-9a-f]{7,40}$/.test(cv)) {
                  const g =
                    clipEls[ci].closest<HTMLElement>(
                      ".btn-group, .commit-sha-group, .gl-button-group",
                    ) || clipEls[ci].parentElement;
                  if (g && shaGroups.indexOf(g) === -1) shaGroups.push(g);
                }
              }
            }
            if (!shaGroups.length) return;

            const ticketMap: CommitTicketEntry[] = [];
            const allTickets: string[] = [];
            const seen: HTMLElement[] = [];

            for (let i = 0; i < shaGroups.length; i++) {
              const row =
                qUp(shaGroups[i], SEL.commitRow) || shaGroups[i].parentElement;
              if (!row || seen.indexOf(row) !== -1) continue;
              seen.push(row);
              // Rows with badges are still collected: a row may have rendered
              // only its cached tickets while others were not fetched yet
              const msgEls = qAll(row, SEL.commitMsg);
              if (!msgEls.length) continue;
              let text = "";
              for (let j = 0; j < msgEls.length; j++) {
                text += msgEls[j].textContent || "";
              }
              text = text.trim();
              const tickets = parseTickets(text);
              if (!tickets.length) continue;
              // Find last commit message element for badge insertion
              const lastMsgEl = msgEls[msgEls.length - 1];
              ticketMap.push({
                row: row,
                lastMsgEl: lastMsgEl,
                tickets: tickets,
              });
              tickets.forEach(function (t) {
                if (allTickets.indexOf(t) === -1) allTickets.push(t);
              });
            }

            if (!allTickets.length) return;

            // Render from cache first
            const uncached: string[] = [];
            allTickets.forEach(function (t) {
              if (
                _commitJiraCache[t] &&
                Date.now() - _commitJiraCache[t].ts < 5 * 60 * 1000
              )
                return;
              uncached.push(t);
            });

            // Render cached badges immediately
            ticketMap.forEach(function (entry) {
              renderCommitJiraBadges(entry);
            });

            if (!uncached.length || jiraState.authFailed) return;

            // Show skeleton loaders for rows pending Jira data
            ticketMap.forEach(function (entry) {
              const needsFetch = entry.tickets.some(function (t) {
                return uncached.indexOf(t) !== -1;
              });
              if (needsFetch) renderCommitJiraLoader(entry);
            });

            // Fetch uncached — one request per field, batches of 5 tickets
            _commitJiraFetching = true;
            let fieldIdx = 0;
            function fetchNextField() {
              if (fieldIdx >= jiraFields.length) {
                _commitJiraFetching = false;
                if (_commitJiraInvalidated.size) {
                  _commitJiraInvalidated.forEach(function (ticket) {
                    delete _commitJiraCache[ticket];
                  });
                  _commitJiraInvalidated.clear();
                  injectCommitJiraBadges();
                  return;
                }
                ticketMap.forEach(function (entry) {
                  renderCommitJiraBadges(entry);
                });
                return;
              }
              const field = jiraFields[fieldIdx];
              const batch = uncached.slice(0, 5);
              sendJiraMessage(
                {
                  type: "fetch-jira-field-values",
                  jiraUrl: jiraUrl,
                  tickets: batch,
                  field: field,
                },
                scope.guard(function (resp) {
                  if (resp && !resp._error) {
                    const data = resp.values || {};
                    if (data._authError) {
                      jiraState.authFailed = true;
                      _commitJiraFetching = false;
                      ticketMap.forEach(function (entry) {
                        removeCommitJiraLoader(entry);
                      });
                      console.warn(
                        "[GitLab Actions] Jira auth failed (" +
                          data._authError +
                          "), stopping Jira requests. Reload page after re-login.",
                      );
                      return;
                    }
                    const now = Date.now();
                    for (const t in data) {
                      if (!_commitJiraCache[t])
                        _commitJiraCache[t] = { ts: now, fields: {} };
                      _commitJiraCache[t].fields[field] = data[t].values || [];
                      if (data[t].categoryKey)
                        _commitJiraCache[t]._categoryKey = data[t].categoryKey;
                      _commitJiraCache[t].ts = now;
                    }
                    batch.forEach(function (t) {
                      if (!_commitJiraCache[t])
                        _commitJiraCache[t] = { ts: now, fields: {} };
                      if (!_commitJiraCache[t].fields[field])
                        _commitJiraCache[t].fields[field] = [];
                    });
                  }
                  fieldIdx++;
                  fetchNextField();
                }),
              );
            }
            fetchNextField();
          }

          function renderCommitJiraLoader(entry: CommitTicketEntry) {
            if (scope.disposed) return;
            if (
              entry.row.querySelector(
                ".gl-commit-jira-badge, .gl-commit-jira-loader",
              )
            )
              return;
            const anchor = entry.lastMsgEl;
            const loader = document.createElement("span");
            loader.className = "gl-jira-loader gl-commit-jira-loader";
            anchor.parentNode!.insertBefore(loader, anchor.nextSibling);
          }

          function removeCommitJiraLoader(entry: CommitTicketEntry) {
            const loader = entry.row.querySelector(".gl-commit-jira-loader");
            if (loader) loader.remove();
          }

          function renderCommitJiraBadges(entry: CommitTicketEntry) {
            if (scope.disposed) return;
            removeCommitJiraLoader(entry);
            // One group per ticket (like the MR list), values deduped within a
            // ticket only — two tickets with the same status both keep their badge
            const groups: {
              ticket: string;
              categoryKey: string;
              badges: { val: string; field: string }[];
            }[] = [];
            entry.tickets.forEach(function (t) {
              const cached = _commitJiraCache[t];
              if (!cached) return;
              const vals: { val: string; field: string }[] = [];
              jiraFields.forEach(function (field) {
                const fieldVals = cached.fields[field];
                if (!fieldVals || !fieldVals.length) return;
                fieldVals.forEach(function (v) {
                  const existing = vals.some(function (b) {
                    return b.val === v;
                  });
                  if (!existing) vals.push({ val: v, field: field });
                });
              });
              if (vals.length)
                groups.push({
                  ticket: t,
                  categoryKey: cached._categoryKey || "",
                  badges: vals,
                });
            });
            // Idempotent re-render: skip when this exact badge set is already in
            // the DOM; rebuild when more tickets resolved (partial render before)
            const key = groups
              .map(function (g) {
                return (
                  g.ticket +
                  ":" +
                  g.badges
                    .map(function (b) {
                      return b.field + "=" + b.val;
                    })
                    .join("|")
                );
              })
              .join(",");
            if (
              entry.row.dataset.glCommitJiraBadges === key &&
              entry.row.querySelector(".gl-commit-jira-badge")
            )
              return;
            entry.row.dataset.glCommitJiraBadges = key;
            const stale = entry.row.querySelectorAll(
              ".gl-commit-jira-badge, .gl-jira-ticket-group, .gl-jira-ticket-sep",
            );
            for (let si = 0; si < stale.length; si++) stale[si].remove();

            const anchor = entry.lastMsgEl;
            const wrap = anchor.parentNode!;
            const ref = anchor.nextSibling;
            groups.forEach(function (g, idx) {
              if (idx > 0) {
                const sep = document.createElement("span");
                sep.className = "gl-jira-ticket-sep";
                wrap.insertBefore(sep, ref);
              }
              const groupEl = document.createElement("span");
              groupEl.className = "gl-jira-ticket-group";
              g.badges.forEach(function (b) {
                const badge = document.createElement("span");
                badge.className =
                  "gl-jira-badge gl-commit-jira-badge " +
                  (b.field === "status"
                    ? getJiraCategoryClass(g.categoryKey, b.val)
                    : "jira-new");
                badge.textContent = b.val;
                badge.title = g.ticket;
                badge.addEventListener("click", function (e) {
                  e.preventDefault();
                  e.stopPropagation();
                  openJiraSidebar(g.ticket, jiraUrl);
                });
                groupEl.appendChild(badge);
              });
              wrap.insertBefore(groupEl, ref);
            });
          }

          injectCommitJiraBadges();

          let _cjTimer: ReturnType<typeof setTimeout> | undefined;
          const cjObserver = scope.observer(function () {
            scope.cancelTimeout(_cjTimer);
            _cjTimer = scope.timeout(
              injectCommitJiraBadges,
              BADGE_MOUNT_DEBOUNCE_MS,
            );
          });
          cjObserver.observe(document.body, { childList: true, subtree: true });
          scope.listen(window, "beforeunload", function () {
            cjObserver.disconnect();
          });
        }),
      );
    } catch {
      /* Extension may have been reloaded. */
    }
  }

  // =========================================================================
}
