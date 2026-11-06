import { createLifecycle } from "../../../shared/lib/lifecycle";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import type { JiraState, JiraStatus } from "../../../entities/jira-issue";
import { createJiraMatcher } from "../../../entities/jira-issue";
import {
  getJiraCategoryClass,
  sendJiraMessage,
} from "../../../entities/jira-issue/content";
import { msg } from "../../../shared/i18n";
import { escHtml } from "../../../shared/lib/html";
import { SEL } from "../../../shared/config/gitlab";
import { q, qAll, qUp, insertAfterSafe } from "../../../shared/lib/dom";
import { createSessionApi } from "../../../shared/api/gitlab";
interface ListSettings {
  dim_drafts: boolean;
  highlight_own_mrs: boolean;
  show_only_mine: boolean;
  show_needs_review: boolean;
  show_copy_mr: boolean;
  show_reviewer_badge: boolean;
  show_threads_badge: boolean;
  show_size_badge: boolean;
  show_conflicts_badge: boolean;
  show_approval_badge: boolean;
  show_branches: boolean;
  show_branches_links: boolean;
  show_jira_details: boolean;
  skip_confirmations: boolean;
  jira_url: string;
  jira_ticket_regex: string;
}
interface ItemTicket {
  item: HTMLElement;
  tickets: string[];
}
interface MrEntry {
  item: HTMLElement;
  href: string;
  projectPath: string;
  iid: string;
}
interface Approval {
  user?: { username?: string; name?: string };
  username?: string;
  name?: string;
}
interface MrMeta {
  threads: number;
  changesLines: number;
  changesFiles: number;
  conflicts: boolean;
  approvedBy: Approval[];
  sourceBranch: string;
  targetBranch: string;
  ts: number;
}
interface MrData {
  additions?: string;
  deletions?: string;
  changes_count?: string;
  has_conflicts?: boolean;
  source_branch?: string;
  target_branch?: string;
}
export function startMrList(
  jiraState: JiraState,
  openJiraSidebar: (ticket: string, url: string) => void,
  _isMrDetailPage: boolean,
  scope: Lifecycle = createLifecycle(),
) {
  const { setJiraTicketRegex, parseTickets } = createJiraMatcher(jiraState);
  const GITLAB_URL = window.location.origin;
  const JIRA_CACHE_TTL = 2 * 60 * 1000;

  const api = createSessionApi(() => GITLAB_URL, scope.signal);
  function isMrListPage() {
    return /\/-\/merge_requests\/?(\?|$)/.test(
      window.location.pathname + window.location.search,
    );
  }

  function getCurrentUsername() {
    const cacheKey = "_gl_mr_ext_username_" + GITLAB_URL;
    return new Promise<string | null>(function (resolve) {
      // Check cache first
      chrome.storage.local.get(
        cacheKey,
        scope.guard(function (data: Record<string, unknown>) {
          if (chrome.runtime.lastError) {
            /* ignore */
          }
          if (data && data[cacheKey]) {
            resolve(typeof data[cacheKey] === "string" ? data[cacheKey] : null);
            return;
          }
          // Fetch from API
          api<{ username: string }>("GET", "/user")
            .then(function (user) {
              if (user && user.username) {
                const toStore: Record<string, string> = {};
                toStore[cacheKey] = user.username;
                chrome.storage.local.set(toStore);
                resolve(user.username);
              } else {
                resolve(null);
              }
            })
            .catch(function () {
              resolve(null);
            });
        }),
      );
    });
  }

  function applyMrListEnhancements(
    settings: ListSettings,
    username: string | null,
  ) {
    if (scope.disposed) return;
    const mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    mrItems.forEach(function (item) {
      if (item.dataset.glMrEnhanced) return;
      item.dataset.glMrEnhanced = "1";

      // Dim drafts
      if (settings.dim_drafts) {
        const titleEl = q<HTMLAnchorElement>(item, SEL.titleLink);
        if (titleEl) {
          const title = titleEl.textContent.trim();
          if (/^(\[Draft\]|Draft:|WIP:)/i.test(title)) {
            item.classList.add("gl-mr-ext-dimmed");
          }
        }
      }

      // Highlight own MRs
      if (settings.highlight_own_mrs && username) {
        const authorLink = q(item, SEL.authorLink);
        if (authorLink) {
          const href = authorLink.getAttribute("href") || "";
          if (href.endsWith("/" + username)) {
            item.classList.add("gl-mr-ext-own");
          }
        }
      }

      // Copy MR button in controls bar
      if (settings.show_copy_mr) {
        const copyTitleEl = q<HTMLAnchorElement>(item, SEL.titleLink);
        const controlsUl = q(item, SEL.controls);
        if (copyTitleEl && controlsUl) {
          const li = document.createElement("li");
          li.className = "gl-block has-tooltip !gl-mr-0 gl-mr-ext-copy-li";
          li.title = msg("btnCopyMr");
          li.innerHTML =
            '<svg class="gl-align-middle gl-mr-ext-copy-icon" width="22" height="22" viewBox="0 0 16 16"><path fill="currentColor" d="M10.5 2H5.5A1.5 1.5 0 004 3.5V4H3.5A1.5 1.5 0 002 5.5v7A1.5 1.5 0 003.5 14h5a1.5 1.5 0 001.5-1.5V12h.5a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0010.5 2zM9 12.5a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5H4v5.5A1.5 1.5 0 005.5 12H9v.5zm2-2a.5.5 0 01-.5.5h-5a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5h5a.5.5 0 01.5.5v7z"/></svg>';
          li.style.cursor = "pointer";
          li.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const mrTitle = copyTitleEl.textContent.trim();
            const mrUrl = copyTitleEl.href;
            navigator.clipboard
              .writeText(mrTitle + "\n" + mrUrl)
              .then(function () {
                li.querySelector("svg")!.style.color = "#108548";
                scope.timeout(function () {
                  li.querySelector("svg")!.style.color = "";
                }, 1500);
              });
          });
          const lastLi = controlsUl.lastElementChild as HTMLElement | null;
          controlsUl.appendChild(li);
          if (lastLi) lastLi.style.marginRight = "0";
        }
      }
    });
  }

  // =========================================================================
  // MR list toolbar: "Only mine" toggle
  // =========================================================================

  function isFilteredBy(param: string, value: string) {
    return new URL(window.location.href).searchParams.get(param) === value;
  }

  function toggleUrlParam(param: string, value: string) {
    const url = new URL(window.location.href);
    if (url.searchParams.get(param) === value) {
      url.searchParams.delete(param);
    } else {
      url.searchParams.set(param, value);
      url.searchParams.delete("page");
    }
    window.location.href = url.toString();
  }

  function injectListToggles(username: string | null, settings: ListSettings) {
    if (scope.disposed) return;
    if (document.querySelector(".gl-mr-ext-toolbar")) return;

    let container = q(document, SEL.filterBar);
    if (!container) {
      // Vue may not have rendered the filter bar yet — look for any
      // toolbar-like area near the top of the MR list as a fallback
      container = q(document, ".top-area, .issues-filters, .nav-controls");
    }
    if (!container) return false; // signal caller to retry

    const toolbar = document.createElement("div");
    toolbar.className = "gl-mr-ext-toolbar";
    toolbar.style.cssText =
      "display:inline-flex;gap:6px;margin-left:8px;vertical-align:middle;";

    if (settings.show_only_mine && username) {
      const btnMine = document.createElement("button");
      btnMine.className = "gl-mr-ext-toggle btn btn-md btn-default gl-button";
      btnMine.textContent = msg("toggleOnlyMine");
      if (isFilteredBy("author_username", username)) {
        btnMine.classList.add("active");
      }
      btnMine.addEventListener("click", function () {
        toggleUrlParam("author_username", username);
      });
      toolbar.appendChild(btnMine);
    }

    if (settings.show_needs_review && username) {
      const btnReview = document.createElement("button");
      btnReview.className = "gl-mr-ext-toggle btn btn-md btn-default gl-button";
      btnReview.textContent = msg("toggleNeedsReview");
      if (isFilteredBy("reviewer_username", username)) {
        btnReview.classList.add("active");
      }
      btnReview.addEventListener("click", function () {
        toggleUrlParam("reviewer_username", username);
      });
      toolbar.appendChild(btnReview);
    }

    if (toolbar.childNodes.length) {
      container.appendChild(toolbar);
    }
    return true; // success
  }

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
  const _reviewerCache: Record<string, { isReviewer: boolean; ts: number }> =
    {}; // { mrUrl: { isReviewer: bool, ts: number } }
  const REVIEWER_CACHE_TTL = 5 * 60 * 1000;
  let _reviewerFetching = false;
  let _reviewerRefreshPending = false;

  function parseMrPath(href: string) {
    const m = href.match(/^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
    if (!m) return null;
    return { projectPath: m[1], iid: m[2] };
  }

  function fetchMrNotes(projectPath: string, iid: string) {
    const encodedProject = encodeURIComponent(projectPath);
    return api<{ body: string }[]>(
      "GET",
      "/projects/" +
        encodedProject +
        "/merge_requests/" +
        iid +
        "/notes?per_page=10&sort=asc",
    );
  }

  function checkReviewerInNotes(notes: { body: string }[], username: string) {
    for (let i = 0; i < notes.length; i++) {
      const body = notes[i].body || "";
      if (/reviewers?\s*:/i.test(body) && body.indexOf("@" + username) !== -1) {
        return true;
      }
    }
    return false;
  }

  function renderReviewerBadge(mrItem: HTMLElement, isReviewer: boolean) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-reviewer-badge")) return;
    if (!isReviewer) return;

    const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
    if (!titleEl) return;
    const titleContainer =
      qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;

    const badge = document.createElement("span");
    badge.className = "gl-reviewer-badge";
    badge.textContent = msg("badgeYourReview");
    badge.title = msg("badgeYourReviewHint");
    titleContainer.appendChild(badge);
  }

  function fetchAndRenderReviewerBadges(username: string) {
    if (_reviewerFetching) {
      _reviewerRefreshPending = true;
      return;
    }

    const mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    const toFetch: MrEntry[] = [];
    const now = Date.now();

    mrItems.forEach(function (item) {
      const titleEl = q<HTMLAnchorElement>(item, SEL.titleLink);
      if (!titleEl) return;
      const href = titleEl.href;
      const cached = _reviewerCache[href];
      if (cached && now - cached.ts < REVIEWER_CACHE_TTL) {
        renderReviewerBadge(item, cached.isReviewer);
        return;
      }
      const parsed = parseMrPath(href);
      if (parsed) {
        toFetch.push({
          item: item,
          href: href,
          projectPath: parsed.projectPath,
          iid: parsed.iid,
        });
      }
    });

    if (!toFetch.length) return;

    // Show loaders
    toFetch.forEach(function (entry) {
      if (entry.item.querySelector(".gl-reviewer-badge, .gl-reviewer-loader"))
        return;
      const titleEl = q<HTMLAnchorElement>(entry.item, SEL.titleLink);
      if (!titleEl) return;
      const titleContainer =
        qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;
      const loader = document.createElement("span");
      loader.className = "gl-reviewer-loader gl-jira-loader";
      titleContainer.appendChild(loader);
    });

    _reviewerFetching = true;

    function fetchOne(i: number) {
      if (i >= toFetch.length) {
        _reviewerFetching = false;
        const loaders = document.querySelectorAll(".gl-reviewer-loader");
        loaders.forEach(function (el) {
          el.remove();
        });
        if (_reviewerRefreshPending) {
          _reviewerRefreshPending = false;
          if (isMrListPage()) fetchAndRenderReviewerBadges(username);
        }
        return;
      }
      const entry = toFetch[i];
      fetchMrNotes(entry.projectPath, entry.iid)
        .then(function (notes) {
          const isReviewer = checkReviewerInNotes(notes || [], username);
          _reviewerCache[entry.href] = {
            isReviewer: isReviewer,
            ts: Date.now(),
          };
          renderReviewerBadge(entry.item, isReviewer);
        })
        .catch(function () {})
        .then(function () {
          fetchOne(i + 1);
        });
    }

    fetchOne(0);
  }

  // =========================================================================
  // Unresolved threads count (#26) + MR size labels (#27)
  // =========================================================================

  const _mrMetaCache: Record<string, MrMeta> = {}; // { href: { threads, changes, ts } }
  const MR_META_CACHE_TTL = 5 * 60 * 1000;
  let _mrMetaFetching = false;
  let _mrMetaRefreshPending = false;

  function renderThreadsBadge(mrItem: HTMLElement, count: number) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-threads-badge")) return;
    if (count === 0) return;

    const controlsUl = q(mrItem, SEL.controls);
    if (!controlsUl) return;

    const li = document.createElement("li");
    li.className = "gl-mr-ext-threads-badge";
    li.title = count + " unresolved thread" + (count === 1 ? "" : "s");
    li.innerHTML =
      '<svg viewBox="0 0 16 16" class="s16"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2.75 1.75h10.5c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1H8.56l-3.4 3.4a.25.25 0 0 1-.43-.18V10.75H2.75c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1Z"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="7.5" x2="9" y2="7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
      "<span>" +
      count +
      "</span>";

    // Insert after comments icon if found, otherwise prepend to controls
    const commentsEl = q(mrItem, SEL.comments);
    const commentsLi = commentsEl ? commentsEl.closest("li") : null;
    if (commentsLi && commentsLi.nextSibling) {
      controlsUl.insertBefore(li, commentsLi.nextSibling);
    } else if (commentsLi) {
      controlsUl.appendChild(li);
    } else {
      controlsUl.insertBefore(li, controlsUl.firstChild);
    }
  }

  function renderSizeBadge(
    mrItem: HTMLElement,
    changesLines: number,
    changesFiles: number,
  ) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-size-badge")) return;
    const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
    if (!titleEl) return;
    const titleContainer =
      qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;

    let label, cls, tooltip;
    if (changesLines > 0) {
      // Size by lines changed
      if (changesLines <= 50) {
        label = "S";
        cls = "size-s";
      } else if (changesLines <= 200) {
        label = "M";
        cls = "size-m";
      } else if (changesLines <= 500) {
        label = "L";
        cls = "size-l";
      } else {
        label = "XL";
        cls = "size-xl";
      }
      tooltip = changesLines + " lines, " + changesFiles + " files";
    } else {
      // Fallback: size by files changed
      if (changesFiles <= 5) {
        label = "S";
        cls = "size-s";
      } else if (changesFiles <= 15) {
        label = "M";
        cls = "size-m";
      } else if (changesFiles <= 30) {
        label = "L";
        cls = "size-l";
      } else {
        label = "XL";
        cls = "size-xl";
      }
      tooltip = changesFiles + " files changed";
    }

    const badge = document.createElement("span");
    badge.className = "gl-mr-ext-size-badge " + cls;
    badge.textContent = label;
    badge.title = tooltip;
    // Always insert right after the title link, before Jira badges
    insertAfterSafe(titleContainer, badge, titleEl);
  }

  function renderConflictBadge(mrItem: HTMLElement) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-conflict-badge")) return;
    const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
    if (!titleEl) return;
    const titleContainer =
      qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;
    const badge = document.createElement("span");
    badge.className = "gl-mr-ext-conflict-badge";
    badge.title =
      msg("conflictsBadgeHint") || "This merge request has conflicts";
    badge.textContent = msg("conflictsBadge") || "CONFLICTS";
    // Insert right after size badge, or after title link
    const sizeBadge = mrItem.querySelector(".gl-mr-ext-size-badge");
    insertAfterSafe(titleContainer, badge, sizeBadge || titleEl);
  }

  function renderBranchBadge(
    mrItem: HTMLElement,
    sourceBranch: string,
    targetBranch: string,
    clickable: boolean,
  ) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-branch-badge")) return;
    if (!sourceBranch) return;
    const loader = mrItem.querySelector(".gl-mr-ext-branch-loader");
    if (loader) loader.remove();
    const infoRow = q(mrItem, SEL.issuableInfo);
    if (!infoRow) return;

    let projectBase = "";
    if (clickable) {
      const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
      if (titleEl && titleEl.href) {
        const m = titleEl.href.match(
          /^(https?:\/\/[^/]+\/.+?)\/-\/merge_requests\//,
        );
        if (m) projectBase = m[1] + "/-/tree/";
      }
    }

    const wrap = document.createElement("div");
    wrap.className = "gl-mr-ext-branch-badge";

    function makeBranchEl(branch: string) {
      let el;
      if (projectBase) {
        el = document.createElement("a");
        el.href = projectBase + encodeURIComponent(branch);
        el.target = "_blank";
        el.rel = "noopener noreferrer";
        el.className = "ref-name";
      } else {
        el = document.createElement("span");
        el.className = "ref-name";
      }
      el.textContent = branch;
      el.title = branch;
      return el;
    }

    wrap.appendChild(makeBranchEl(sourceBranch));
    if (targetBranch) {
      const arrow = document.createElement("span");
      arrow.className = "gl-mr-ext-branch-arrow";
      arrow.innerHTML = "&#x2192;";
      wrap.appendChild(arrow);
      wrap.appendChild(makeBranchEl(targetBranch));
    }
    infoRow.parentNode!.insertBefore(wrap, infoRow.nextSibling);
  }

  function renderApprovalIndicator(
    mrItem: HTMLElement,
    approvedBy: Approval[],
    username: string | null,
  ) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-approval-done")) return;
    if (!approvedBy || !approvedBy.length) return;

    let myApproval = false;
    for (let i = 0; i < approvedBy.length; i++) {
      const u = approvedBy[i];
      const uname = (u.user && u.user.username) || u.username || "";
      if (uname === username) {
        myApproval = true;
        break;
      }
    }

    const names = approvedBy
      .map(function (a) {
        const u = a.user || a;
        return u.name || u.username || "";
      })
      .join(", ");

    // Try to find and enhance the existing GitLab approval badge
    let nativeBadge = mrItem.querySelector<HTMLElement>(
      '[data-testid="mr-appovals"], [data-testid="mr-approvals"]',
    );
    if (!nativeBadge) {
      // Fallback: look for badge with "Approved" text
      const badges = mrItem.querySelectorAll<HTMLElement>(
        ".gl-badge.badge-success, .gl-badge.badge-pill",
      );
      for (let b = 0; b < badges.length; b++) {
        const txt = (badges[b].textContent || "").trim();
        if (
          txt.indexOf("Approved") !== -1 ||
          txt.indexOf("approved") !== -1 ||
          txt.indexOf("approval") !== -1
        ) {
          nativeBadge = badges[b];
          break;
        }
      }
    }

    const youLabel = msg("approvalBadgeMineShort") || "You";
    const othersCount = approvedBy.length - (myApproval ? 1 : 0);

    const suffix = myApproval
      ? youLabel + (othersCount > 0 ? " +" + othersCount : "")
      : String(approvedBy.length);

    if (nativeBadge) {
      const originalTitle = nativeBadge.getAttribute("title");
      nativeBadge.classList.add("gl-mr-ext-approval-done");
      nativeBadge.title = names;
      const contentSpan = nativeBadge.querySelector(".gl-badge-content");
      const originalText = contentSpan?.textContent || "";
      const enhancedText = originalText.trim() + " \u00b7 " + suffix;
      if (contentSpan) {
        contentSpan.textContent = enhancedText;
      }
      scope.onCleanup(() => {
        nativeBadge.classList.remove("gl-mr-ext-approval-done");
        if (nativeBadge.title === names) {
          if (originalTitle === null) nativeBadge.removeAttribute("title");
          else nativeBadge.setAttribute("title", originalTitle);
        }
        if (contentSpan?.textContent === enhancedText)
          contentSpan.textContent = originalText;
      });
      return;
    }

    // Fallback: create our own badge in GitLab native style
    const controlsUl = q(mrItem, SEL.controls);
    if (!controlsUl) return;

    const li = document.createElement("li");
    li.style.cssText =
      "display:inline-flex;align-items:center;margin-right:0;margin-left:0";
    const badge = document.createElement("span");
    badge.className =
      "gl-badge badge badge-pill badge-success gl-mr-ext-approval-done";
    badge.title = names;
    badge.innerHTML =
      '<svg viewBox="0 0 16 16" class="gl-badge-icon gl-icon s16 gl-fill-current -gl-ml-2"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.03-8.47a.75.75 0 0 0-1.06-1.06L7 8.44 6.03 7.47a.75.75 0 0 0-1.06 1.06l1.5 1.5a.75.75 0 0 0 1.06 0l3.5-3.5Z" fill="currentColor"/></svg>' +
      ' <span class="gl-badge-content">Approved \u00b7 ' +
      escHtml(suffix) +
      "</span>";
    li.appendChild(badge);
    controlsUl.insertBefore(li, controlsUl.firstChild);
    scope.onCleanup(() => li.remove());
  }

  function fetchAndRenderMrMeta(
    showThreads: boolean,
    showSize: boolean,
    showConflicts: boolean,
    showApprovals: boolean,
    showBranches: boolean,
    showBranchesLinks: boolean,
    username: string | null,
  ) {
    if (_mrMetaFetching) {
      _mrMetaRefreshPending = true;
      return;
    }

    const mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    const toFetch: MrEntry[] = [];
    const now = Date.now();

    mrItems.forEach(function (item) {
      const titleEl = q<HTMLAnchorElement>(item, SEL.titleLink);
      if (!titleEl) return;
      const href = titleEl.href;
      const cached = _mrMetaCache[href];
      if (cached && now - cached.ts < MR_META_CACHE_TTL) {
        if (showThreads) renderThreadsBadge(item, cached.threads);
        if (showSize)
          renderSizeBadge(item, cached.changesLines, cached.changesFiles);
        if (showConflicts && cached.conflicts) renderConflictBadge(item);
        if (showApprovals && cached.approvedBy)
          renderApprovalIndicator(item, cached.approvedBy, username);
        if (showBranches)
          renderBranchBadge(
            item,
            cached.sourceBranch,
            cached.targetBranch,
            showBranchesLinks,
          );
        return;
      }
      const parsed = parseMrPath(href);
      if (parsed) {
        toFetch.push({
          item: item,
          href: href,
          projectPath: parsed.projectPath,
          iid: parsed.iid,
        });
      }
    });

    if (!toFetch.length) return;
    _mrMetaFetching = true;

    // Show branch skeleton loaders for items about to be fetched
    if (showBranches) {
      toFetch.forEach(function (entry) {
        if (
          entry.item.querySelector(
            ".gl-mr-ext-branch-badge, .gl-mr-ext-branch-loader",
          )
        )
          return;
        const infoRow = q(entry.item, SEL.issuableInfo);
        if (!infoRow) return;
        const loader = document.createElement("div");
        loader.className = "gl-mr-ext-branch-loader";
        const s1 = document.createElement("span");
        s1.className = "gl-jira-loader";
        s1.style.width = "100px";
        const arrow = document.createElement("span");
        arrow.className = "gl-mr-ext-branch-arrow";
        arrow.innerHTML = "&#x2192;";
        const s2 = document.createElement("span");
        s2.className = "gl-jira-loader";
        s2.style.width = "60px";
        loader.appendChild(s1);
        loader.appendChild(arrow);
        loader.appendChild(s2);
        infoRow.parentNode!.insertBefore(loader, infoRow.nextSibling);
      });
    }

    const BATCH_SIZE = 5;

    function fetchOneEntry(entry: MrEntry) {
      const encodedPath = encodeURIComponent(entry.projectPath);
      const mrPromise = api<MrData>(
        "GET",
        "/projects/" +
          encodedPath +
          "/merge_requests/" +
          entry.iid +
          "?include_rebase_in_progress=false",
      );
      const approvalsPromise = showApprovals
        ? api<{ approved_by: Approval[] }>(
            "GET",
            "/projects/" +
              encodedPath +
              "/merge_requests/" +
              entry.iid +
              "/approvals",
          ).catch(function () {
            return null;
          })
        : Promise.resolve(null);
      const threadsPromise = showThreads
        ? api<{ notes: { resolvable?: boolean; resolved?: boolean }[] }[]>(
            "GET",
            "/projects/" +
              encodedPath +
              "/merge_requests/" +
              entry.iid +
              "/discussions?per_page=100",
          ).catch(function () {
            return [];
          })
        : Promise.resolve(null);

      return Promise.all([mrPromise, approvalsPromise, threadsPromise])
        .then(function (results) {
          const mr = results[0];
          const approvalsData = results[1];
          const discussions = results[2];

          const changesLines =
            mr.additions !== undefined && mr.deletions !== undefined
              ? (parseInt(mr.additions) || 0) + (parseInt(mr.deletions) || 0)
              : 0;
          const changesFiles = mr.changes_count
            ? parseInt(mr.changes_count)
            : 0;
          const conflicts = !!mr.has_conflicts;
          const approvedBy = approvalsData
            ? approvalsData.approved_by || []
            : [];
          let unresolvedCount = 0;
          if (discussions) {
            (discussions || []).forEach(function (d) {
              if (
                d.notes &&
                d.notes.length &&
                d.notes[0].resolvable &&
                !d.notes[0].resolved
              ) {
                unresolvedCount++;
              }
            });
          }
          return {
            threads: unresolvedCount,
            changesLines: changesLines,
            changesFiles: changesFiles,
            conflicts: conflicts,
            approvedBy: approvedBy,
            sourceBranch: mr.source_branch || "",
            targetBranch: mr.target_branch || "",
          };
        })
        .then(function (meta) {
          _mrMetaCache[entry.href] = {
            threads: meta.threads,
            changesLines: meta.changesLines,
            changesFiles: meta.changesFiles,
            conflicts: meta.conflicts,
            approvedBy: meta.approvedBy,
            sourceBranch: meta.sourceBranch,
            targetBranch: meta.targetBranch,
            ts: Date.now(),
          };
          if (showThreads) renderThreadsBadge(entry.item, meta.threads);
          if (showSize)
            renderSizeBadge(entry.item, meta.changesLines, meta.changesFiles);
          if (showConflicts && meta.conflicts) renderConflictBadge(entry.item);
          if (showApprovals && meta.approvedBy)
            renderApprovalIndicator(entry.item, meta.approvedBy, username);
          if (showBranches)
            renderBranchBadge(
              entry.item,
              meta.sourceBranch,
              meta.targetBranch,
              showBranchesLinks,
            );
        })
        .catch(function () {});
    }

    function fetchBatch(start: number) {
      if (start >= toFetch.length) {
        _mrMetaFetching = false;
        if (_mrMetaRefreshPending) {
          _mrMetaRefreshPending = false;
          if (isMrListPage())
            fetchAndRenderMrMeta(
              showThreads,
              showSize,
              showConflicts,
              showApprovals,
              showBranches,
              showBranchesLinks,
              username,
            );
        }
        return;
      }
      const batch = toFetch.slice(start, start + BATCH_SIZE);
      Promise.all(batch.map(fetchOneEntry)).then(function () {
        fetchBatch(start + BATCH_SIZE);
      });
    }

    fetchBatch(0);
  }

  // =========================================================================
  // Init MR list features
  // =========================================================================

  if (isMrListPage()) {
    const listDefaults = {
      dim_drafts: false,
      highlight_own_mrs: false,
      show_only_mine: false,
      show_needs_review: false,
      show_copy_mr: false,
      show_reviewer_badge: false,
      show_threads_badge: false,
      show_size_badge: false,
      show_conflicts_badge: false,
      show_approval_badge: false,
      show_branches: true,
      show_branches_links: false,
      show_jira_details: false,
      skip_confirmations: false,
      jira_url: "",
      jira_ticket_regex: "",
    };
    try {
      chrome.storage.sync.get(
        listDefaults,
        scope.guard(function (s: ListSettings) {
          if (chrome.runtime.lastError) return;
          jiraState.skipConfirmations = !!s.skip_confirmations;

          const needsUsername =
            s.highlight_own_mrs ||
            s.show_only_mine ||
            s.show_needs_review ||
            s.show_reviewer_badge ||
            s.show_approval_badge;
          const usernamePromise = needsUsername
            ? getCurrentUsername()
            : Promise.resolve(null);

          usernamePromise.then(function (username) {
            function runAllListFeatures() {
              if (!isMrListPage()) return;
              if (s.dim_drafts || s.highlight_own_mrs || s.show_copy_mr) {
                applyMrListEnhancements(s, username);
              }
              if (s.show_reviewer_badge && username) {
                fetchAndRenderReviewerBadges(username);
              }
              if (
                s.show_threads_badge ||
                s.show_size_badge ||
                s.show_conflicts_badge ||
                s.show_approval_badge ||
                s.show_branches
              ) {
                fetchAndRenderMrMeta(
                  s.show_threads_badge,
                  s.show_size_badge,
                  s.show_conflicts_badge,
                  s.show_approval_badge,
                  s.show_branches,
                  s.show_branches_links,
                  username,
                );
              }
              if (s.jira_url) {
                setJiraTicketRegex(s.jira_ticket_regex);
                fetchAndRenderJiraStatuses(s.jira_url, s.show_jira_details);
              }
              if (s.show_only_mine || s.show_needs_review)
                injectListToggles(username, s);
            }

            // Watch a stable ancestor: pagination/filtering can replace the entire
            // list, leaving an observer attached to its old, detached container.
            // Filter actual records because MutationObserver runs asynchronously;
            // a synchronous "rendering" flag cannot suppress our own badge writes.
            const listContentSelector =
              SEL.mrItem +
              ", " +
              SEL.listContainer +
              ", " +
              SEL.titleLink +
              ", " +
              SEL.filterBar +
              ", .top-area, .issues-filters, .nav-controls";
            function isListMutation(mutation: MutationRecord) {
              const target =
                mutation.target.nodeType === 1
                  ? (mutation.target as Element)
                  : mutation.target.parentElement;
              if (qUp(target, SEL.titleLink)) return true;
              if (mutation.type !== "childList") return false;
              return (
                Array.prototype.some.call(mutation.addedNodes, isListContent) ||
                Array.prototype.some.call(mutation.removedNodes, isListContent)
              );
            }
            function isListContent(node: Node) {
              return (
                node.nodeType === 1 &&
                ((node as Element).matches(listContentSelector) ||
                  !!q(node as Element, listContentSelector))
              );
            }
            let _observerTimer: ReturnType<typeof setTimeout> | undefined;
            const listObserver = scope.observer(function (mutations) {
              if (!isMrListPage() || !mutations.some(isListMutation)) return;
              clearTimeout(_observerTimer);
              _observerTimer = scope.timeout(runAllListFeatures, 200);
            });
            listObserver.observe(document.body, {
              childList: true,
              subtree: true,
              characterData: true,
              attributes: true,
              attributeFilter: ["href"],
            });
            runAllListFeatures();
            scope.listen(window, "beforeunload", function () {
              listObserver.disconnect();
              clearTimeout(_observerTimer);
            });
          });
        }),
      );
    } catch {
      /* Extension may have been reloaded. */
    }
  }

  // =========================================================================
  // MR detail page: Jira badges in title
  // =========================================================================

  if (_isMrDetailPage) {
    try {
      chrome.storage.sync.get(
        {
          jira_url: "",
          jira_ticket_regex: "",
          show_jira_details: false,
          skip_confirmations: false,
        },
        scope.guard(function (s: {
          jira_url: string;
          jira_ticket_regex: string;
          show_jira_details: boolean;
          skip_confirmations: boolean;
        }) {
          if (chrome.runtime.lastError || !s.jira_url) return;
          jiraState.url = s.jira_url;
          jiraState.showDetails = !!s.show_jira_details;
          jiraState.skipConfirmations = !!s.skip_confirmations;
          setJiraTicketRegex(s.jira_ticket_regex);
          injectMrDetailJiraBadges(s.jira_url);
        }),
      );
    } catch {
      /* Extension may have been reloaded. */
    }
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
      }, 1000);
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

  // =========================================================================
}
