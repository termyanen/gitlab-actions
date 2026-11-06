import type { JiraState, JiraStatus } from "../../../entities/jira-issue";
import {
  getJiraCategoryClass,
  sendJiraMessage,
} from "../../../entities/jira-issue/content";
import { SEL } from "../../../shared/config/gitlab";
import { q, qAll, qUp } from "../../../shared/lib/dom";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import type { ItemTicket } from "../model/types";
import { isMrListPage } from "./route";
export function createListJiraBadges(
  jiraState: JiraState,
  scope: Lifecycle,
  openJiraSidebar: (ticket: string, url: string) => void,
  parseTickets: (title: string) => string[],
) {
  const DETAIL_HEADER_RETRY_MS = 1000;

  const JIRA_CACHE_TTL = 2 * 60 * 1000;

  // =========================================================================
  // Jira ticket status badges on MR list
  // =========================================================================

  function renderJiraLoaders(itemTicketMap: ItemTicket[]) {
    if (scope.disposed) return;
    itemTicketMap.forEach(function (entry) {
      if (entry.item.querySelector(".gl-jira-badge")) return; // already has badges
      const titleEl = q<HTMLAnchorElement>(entry.item, SEL.titleLink);
      if (!titleEl) return;
      const titleContainer =
        qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;
      if (titleContainer.querySelector(".gl-jira-loader")) return; // already has loader
      const loader = document.createElement("span");
      loader.className = "gl-jira-loader";
      titleContainer.appendChild(loader);
    });
  }

  function removeJiraLoaders() {
    const loaders = document.querySelectorAll(".gl-jira-loader");
    loaders.forEach(function (el) {
      el.remove();
    });
  }

  function renderJiraBadges(
    mrItem: HTMLElement,
    statuses: Record<string, JiraStatus>,
  ) {
    if (scope.disposed) return;
    const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
    if (!titleEl) return;

    const title = titleEl.textContent.trim();
    const tickets = parseTickets(title);

    const titleContainer =
      qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;

    // Build expected badge key to avoid redundant re-renders
    const badgeKey = tickets
      .map(function (t) {
        const s = statuses[t];
        return s
          ? t +
              ":" +
              s.name +
              ":" +
              (s.type || "") +
              ":" +
              (s.priority || "") +
              ":" +
              (jiraState.showDetails ? "1" : "0")
          : "";
      })
      .join(",");

    // Vue can replace the title subtree while preserving the row and its data
    // attributes. Only skip a cached render if the badges are still present.
    const badgeCount = tickets.filter(function (t) {
      return !!statuses[t];
    }).length;
    if (
      mrItem.dataset.glJiraBadges === badgeKey &&
      titleContainer.querySelectorAll(".gl-jira-badge").length === badgeCount
    )
      return;
    mrItem.dataset.glJiraBadges = badgeKey;

    // Remove old badges and icons
    const old = mrItem.querySelectorAll(
      ".gl-jira-badge, .gl-jira-list-icon, .gl-jira-ticket-group, .gl-jira-ticket-sep",
    );
    old.forEach(function (el) {
      el.remove();
    });

    tickets.forEach(function (ticket, idx) {
      const status = statuses[ticket];
      if (!status) return;

      // Separator between ticket groups
      if (idx > 0) {
        const sep = document.createElement("span");
        sep.className = "gl-jira-ticket-sep";
        titleContainer.appendChild(sep);
      }

      // Group wrapper for this ticket
      const group = document.createElement("span");
      group.className = "gl-jira-ticket-group";

      // Type & priority icons (before status badge)
      if (jiraState.showDetails) {
        if (status.typeIcon) {
          const typeEl = document.createElement("img");
          typeEl.className = "gl-jira-list-icon";
          typeEl.src = status.typeIcon;
          typeEl.title = status.type || "";
          group.appendChild(typeEl);
        }
        if (status.priorityIcon) {
          const prioEl = document.createElement("img");
          prioEl.className = "gl-jira-list-icon";
          prioEl.src = status.priorityIcon;
          prioEl.title = status.priority || "";
          group.appendChild(prioEl);
        }
      }

      const badge = document.createElement("span");
      badge.className =
        "gl-jira-badge " +
        getJiraCategoryClass(status.categoryKey, status.name);
      badge.textContent = status.name;
      badge.title = ticket + ": " + status.name;
      badge.style.cursor = "pointer";
      badge.dataset.jiraTicket = ticket;
      badge.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openJiraSidebar(ticket, jiraState.url);
      });
      group.appendChild(badge);

      titleContainer.appendChild(group);
    });
  }

  function fetchAndRenderJiraStatuses(jiraUrl: string, showDetails: boolean) {
    jiraState.showDetails = !!showDetails;
    if (jiraState.authFailed) return;
    if (jiraState.fetching) {
      jiraState.refreshPending = true;
      return;
    }
    jiraState.url = jiraUrl;

    const mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    // Collect all tickets from all MR titles
    const allTickets: string[] = [];
    const itemTicketMap: ItemTicket[] = [];
    mrItems.forEach(function (item) {
      const titleEl = q<HTMLAnchorElement>(item, SEL.titleLink);
      if (!titleEl) return;
      const tickets = parseTickets(titleEl.textContent.trim());
      if (tickets.length) {
        itemTicketMap.push({ item: item, tickets: tickets });
        tickets.forEach(function (t) {
          if (allTickets.indexOf(t) === -1) allTickets.push(t);
        });
      } else {
        // A reused row may now represent an MR without a Jira ticket.
        renderJiraBadges(item, {});
      }
    });

    if (!allTickets.length) return;

    // Check cache, find tickets that need fetching
    const now = Date.now();
    const cachedStatuses: Record<string, JiraStatus> = {};
    const ticketsToFetch: string[] = [];

    allTickets.forEach(function (t) {
      if (jiraState.cache[t] && now - jiraState.cache[t].ts < JIRA_CACHE_TTL) {
        cachedStatuses[t] = jiraState.cache[t];
      } else {
        ticketsToFetch.push(t);
      }
    });

    // Render cached ones immediately
    if (Object.keys(cachedStatuses).length) {
      itemTicketMap.forEach(function (entry) {
        renderJiraBadges(entry.item, cachedStatuses);
      });
    }

    if (!ticketsToFetch.length) return;

    // Show loaders for items that don't have badges yet
    renderJiraLoaders(itemTicketMap);

    // Fetch remaining from Jira via background
    jiraState.fetching = true;
    sendJiraMessage(
      {
        type: "fetch-jira-statuses",
        jiraUrl: jiraUrl,
        tickets: ticketsToFetch,
        showDetails: jiraState.showDetails,
      },
      scope.guard(function (resp) {
        jiraState.fetching = false;
        try {
          removeJiraLoaders();
          if (chrome.runtime.lastError || !resp || resp._error) return;
          const statuses = resp.statuses || {};

          // Stop all Jira requests if auth failed (401/403)
          if (statuses._authError) {
            jiraState.authFailed = true;
            console.warn(
              "[GitLab Actions] Jira auth failed (" +
                statuses._authError +
                "), stopping Jira requests. Reload page after re-login.",
            );
            return;
          }

          // Update cache
          const fetchedNow = Date.now();
          for (const t in statuses) {
            jiraState.cache[t] = {
              name: statuses[t].name,
              categoryKey: statuses[t].categoryKey,
              priority: statuses[t].priority,
              priorityIcon: statuses[t].priorityIcon,
              type: statuses[t].type,
              typeIcon: statuses[t].typeIcon,
              ts: fetchedNow,
            };
          }

          // Merge with cached
          const merged: Record<string, JiraStatus> = {};
          for (const k in cachedStatuses) merged[k] = cachedStatuses[k];
          for (const k2 in statuses) merged[k2] = statuses[k2];

          itemTicketMap.forEach(function (entry) {
            if (entry.item.isConnected) renderJiraBadges(entry.item, merged);
          });
        } finally {
          // Pagination may have happened while this batch was in flight. Rescan
          // the current DOM, including after an error, instead of losing that run.
          if (jiraState.refreshPending) {
            jiraState.refreshPending = false;
            if (isMrListPage())
              fetchAndRenderJiraStatuses(jiraUrl, showDetails);
          }
        }
      }),
    );
  }

  function injectMrDetailJiraBadges(jiraUrl: string) {
    if (scope.disposed) return;
    if (jiraState.authFailed) return;
    const titleEl = document.querySelector<HTMLElement>(
      '.title-container .title, .detail-page-header .title, [data-testid="title-content"]',
    );
    if (!titleEl) {
      // SPA — retry after short delay
      scope.timeout(function () {
        injectMrDetailJiraBadges(jiraUrl);
      }, DETAIL_HEADER_RETRY_MS);
      return;
    }
    if (titleEl.querySelector(".gl-jira-badge")) return;

    const text = titleEl.textContent.trim();
    jiraState.ticketRegex.lastIndex = 0;
    const tickets = text.match(jiraState.ticketRegex);
    if (!tickets || !tickets.length) return;

    // Fetch statuses and render badges
    sendJiraMessage(
      {
        type: "fetch-jira-statuses",
        jiraUrl: jiraUrl,
        tickets: tickets,
        showDetails: jiraState.showDetails,
      },
      scope.guard(function (resp) {
        if (!resp || resp._error || !resp.statuses) return;
        const statuses = resp.statuses;
        if (statuses._authError) {
          jiraState.authFailed = true;
          console.warn(
            "[GitLab Actions] Jira auth failed (" +
              statuses._authError +
              "), stopping Jira requests. Reload page after re-login.",
          );
          return;
        }
        tickets.forEach(function (ticket) {
          const status = statuses[ticket];
          if (!status) return;

          if (jiraState.showDetails) {
            if (status.typeIcon) {
              const typeEl = document.createElement("img");
              typeEl.className = "gl-jira-list-icon";
              typeEl.src = status.typeIcon;
              typeEl.title = status.type || "";
              titleEl.appendChild(typeEl);
            }
            if (status.priorityIcon) {
              const prioEl = document.createElement("img");
              prioEl.className = "gl-jira-list-icon";
              prioEl.src = status.priorityIcon;
              prioEl.title = status.priority || "";
              titleEl.appendChild(prioEl);
            }
          }

          const badge = document.createElement("span");
          badge.className =
            "gl-jira-badge " +
            getJiraCategoryClass(status.categoryKey, status.name);
          badge.textContent = status.name;
          badge.title = ticket + ": " + status.name;
          badge.style.cursor = "pointer";
          badge.dataset.jiraTicket = ticket;
          badge.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            openJiraSidebar(ticket, jiraUrl);
          });
          titleEl.appendChild(badge);
        });
      }),
    );
  }
  return { fetchAndRenderJiraStatuses, injectMrDetailJiraBadges };
}
