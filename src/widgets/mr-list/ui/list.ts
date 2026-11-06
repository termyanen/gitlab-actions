import type { JiraState } from "../../../entities/jira-issue";
import { createJiraMatcher } from "../../../entities/jira-issue";
import {
  LIST_DEFAULTS,
  readDisplayPreferences,
} from "../../../entities/settings";
import { createSessionApi } from "../../../shared/api/gitlab";
import { reportRuntimeError } from "../../../shared/api/runtime";
import { SEL } from "../../../shared/config/gitlab";
import { msg } from "../../../shared/i18n";
import { q, qAll, qUp } from "../../../shared/lib/dom";
import { reportError } from "../../../shared/lib/errors";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { createLifecycle } from "../../../shared/lib/lifecycle";
import { decoder, isString, objectOf } from "../../../shared/lib/validation";
import { isElement, requireElement } from "../../../shared/ui/dom";
import type { ListSettings } from "../model/types";
import { createListJiraBadges } from "./jira-badges";
import { createMrMetadata } from "./metadata";
import { createReviewerBadges } from "./reviewers";
import { isMrListPage } from "./route";
const readUsername = decoder(
  objectOf<{ username: string }>({
    username: isString,
  }),
  "GitLab/Jira response",
);
const COPIED_FEEDBACK_DURATION_MS = 1500;
const LIST_REFRESH_DEBOUNCE_MS = 200;
export function startMrList(
  jiraState: JiraState,
  openJiraSidebar: (ticket: string, url: string) => void,
  _isMrDetailPage: boolean,
  scope: Lifecycle = createLifecycle(),
) {
  const { setJiraTicketRegex, parseTickets } = createJiraMatcher(jiraState);
  const GITLAB_URL = window.location.origin;

  const api = createSessionApi(() => GITLAB_URL, scope.signal);
  const { fetchAndRenderJiraStatuses, injectMrDetailJiraBadges } =
    createListJiraBadges(jiraState, scope, openJiraSidebar, parseTickets);
  const { fetchAndRenderReviewerBadges } = createReviewerBadges(api, scope);
  const { fetchAndRenderMrMeta } = createMrMetadata(api, scope);

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
          api("GET", "/user")
            .then(readUsername)
            .then(function (user) {
              if (user && user.username) {
                const toStore: Record<string, string> = {};
                toStore[cacheKey] = user.username;
                chrome.storage.local.set(toStore, reportRuntimeError);
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
                requireElement(li.querySelector("svg")).style.color = "#108548";
                scope.timeout(function () {
                  requireElement(li.querySelector("svg")).style.color = "";
                }, COPIED_FEEDBACK_DURATION_MS);
              })
              .catch(reportError);
          });
          const lastLi = controlsUl.lastElementChild;
          controlsUl.appendChild(li);
          if (lastLi instanceof HTMLElement) lastLi.style.marginRight = "0";
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
  // Init MR list features
  // =========================================================================

  if (isMrListPage()) {
    try {
      chrome.storage.sync.get(
        LIST_DEFAULTS,
        scope.guard(function (s: ListSettings) {
          if (chrome.runtime.lastError) return;
          Object.assign(s, readDisplayPreferences(s));
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

          usernamePromise
            .then(function (username) {
              function runAllListFeatures() {
                if (!isMrListPage()) return;
                if (s.dim_drafts || s.highlight_own_mrs || s.show_copy_mr) {
                  applyMrListEnhancements(s, username);
                }
                if (s.show_reviewer_badge && username) {
                  fetchAndRenderReviewerBadges(
                    username,
                    s.reviewer_notes_limit,
                  );
                }
                if (
                  s.show_threads_badge ||
                  s.show_size_badge ||
                  s.show_conflicts_badge ||
                  s.show_approval_badge ||
                  s.show_branches
                ) {
                  fetchAndRenderMrMeta(s, username);
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
                const target = isElement(mutation.target)
                  ? mutation.target
                  : mutation.target.parentElement;
                if (qUp(target, SEL.titleLink)) return true;
                if (mutation.type !== "childList") return false;
                return (
                  Array.prototype.some.call(
                    mutation.addedNodes,
                    isListContent,
                  ) ||
                  Array.prototype.some.call(
                    mutation.removedNodes,
                    isListContent,
                  )
                );
              }
              function isListContent(node: Node) {
                return (
                  isElement(node) &&
                  (node.matches(listContentSelector) ||
                    !!q(node, listContentSelector))
                );
              }
              let _observerTimer: ReturnType<typeof setTimeout> | undefined;
              const listObserver = scope.observer(function (mutations) {
                if (!isMrListPage() || !mutations.some(isListMutation)) return;
                scope.cancelTimeout(_observerTimer);
                _observerTimer = scope.timeout(
                  runAllListFeatures,
                  LIST_REFRESH_DEBOUNCE_MS,
                );
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
                scope.cancelTimeout(_observerTimer);
              });
            })
            .catch(reportError);
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

  // =========================================================================
}
