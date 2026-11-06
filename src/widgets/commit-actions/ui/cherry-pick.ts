import { createLifecycle } from "../../../shared/lib/lifecycle";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import type { CherryPickSettings } from "../../../features/cherry-pick";
import { msg } from "../../../shared/i18n";
import { escHtml } from "../../../shared/lib/html";
import { SEL } from "../../../shared/config/gitlab";
import { q, qAll, qUp } from "../../../shared/lib/dom";

export function startCommitCherryPick(
  createCherryPickDialog: (
    origin: string,
    project: string,
    msg: (key: string) => string,
    toast: (message: string, type: "success" | "error") => void,
  ) => {
    open: (sha: string, message: string, settings: CherryPickSettings) => void;
  },
  scope: Lifecycle = createLifecycle(),
) {
  const GITLAB_URL = window.location.origin;
  function isCommitsPage() {
    return (
      /\/-\/commits\//.test(window.location.pathname) ||
      /\/-\/repository\/commits\//.test(window.location.pathname)
    );
  }

  function isCommitDetailPage() {
    // Matches /-/commit/<sha> (modern) and /commit/<sha> (legacy GitLab < 12.x)
    return (
      /\/commit\/[0-9a-f]{7,40}\b/.test(window.location.pathname) &&
      !/\/commits\//.test(window.location.pathname)
    );
  }

  if (isCommitsPage() || isCommitDetailPage()) {
    try {
      chrome.storage.sync.get(
        {
          show_cherry_pick: true,
          cherry_pick_branches: [],
          cherry_pick_create_mr: true,
          cherry_pick_smart_fallback: true,
          cherry_pick_bump_version: false,
          versionFile: "package.json",
          versionPath: "version",
          versionStrategy: "patch",
          versionCommitTemplate: "fix: bump version to {version}",
        },
        scope.guard(function (
          s: CherryPickSettings & { show_cherry_pick: boolean },
        ) {
          if (chrome.runtime.lastError || s.show_cherry_pick === false) return;

          const projectPath = (function () {
            const m = window.location.pathname.match(
              /^\/([^/]+(?:\/[^/]+)*?)\/-\//,
            );
            return m ? m[1] : null;
          })();
          if (!projectPath) return;
          const encodedProject = encodeURIComponent(projectPath);

          const { open: openCherryPickModal } = createCherryPickDialog(
            GITLAB_URL,
            encodedProject,
            msg,
            showToast,
          );
          function findCommitShaGroups() {
            // Strategy 1: known CSS classes / data-testid (old + new GitLab)
            const groups = qAll(document, SEL.commitShaGroup);
            if (groups.length) return Array.from(groups);

            // Strategy 2: find clipboard buttons with 40-char hex SHA,
            // then return their parent group (works even if classes change)
            const result: Element[] = [];
            const seen: Element[] = [];
            const clipboardEls = qAll(document, "[data-clipboard-text]");
            for (let i = 0; i < clipboardEls.length; i++) {
              const text =
                clipboardEls[i].getAttribute("data-clipboard-text") || "";
              if (/^[0-9a-f]{7,40}$/.test(text)) {
                const group =
                  clipboardEls[i].closest(
                    ".btn-group, .commit-sha-group, .gl-button-group",
                  ) || clipboardEls[i].parentElement;
                if (group && seen.indexOf(group) === -1) {
                  seen.push(group);
                  result.push(group);
                }
              }
            }
            return result;
          }

          function injectCherryPickButtons() {
            if (scope.disposed) return;
            const shaGroups = findCommitShaGroups();
            if (!shaGroups.length) return;

            shaGroups.forEach(function (group) {
              if (group.querySelector(".gl-cherry-pick-btn")) return;

              const shaEl = q(group, SEL.commitSha);
              const sha = shaEl
                ? shaEl.getAttribute("data-clipboard-text") ||
                  (shaEl.textContent || "").trim()
                : "";
              if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return;

              const row = qUp(group, SEL.commitRow) || group.parentElement;
              let commitMsg = "";
              if (row) {
                const msgEls = qAll(row, SEL.commitMsg);
                if (msgEls.length > 1) {
                  // GitLab splits message into multiple <a> when it contains issue references
                  for (let mi = 0; mi < msgEls.length; mi++) {
                    commitMsg += msgEls[mi].textContent || "";
                  }
                  commitMsg = commitMsg.trim();
                } else if (msgEls.length === 1) {
                  commitMsg = (
                    msgEls[0].textContent ||
                    msgEls[0].getAttribute("title") ||
                    ""
                  ).trim();
                }
              }

              const btn = document.createElement("button");
              btn.className =
                "gl-cherry-pick-btn gl-button btn btn-icon btn-md btn-default";
              btn.title = msg("cherryPickTitle");
              btn.setAttribute("aria-label", msg("cherryPickTitle"));
              btn.type = "button";
              btn.innerHTML =
                '<svg class="s16 gl-icon gl-button-icon" viewBox="0 0 16 16"><circle cx="8" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 6v4"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4 8h8"/></svg>';
              btn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                openCherryPickModal(sha, commitMsg, s);
              });
              group.appendChild(btn);
            });
          }

          function showToast(message: string, type: "success" | "error") {
            const existing = document.querySelectorAll(".gl-mr-actions-toast");
            existing.forEach(function (el) {
              el.remove();
            });
            const toast = document.createElement("div");
            toast.className = "gl-mr-actions-toast " + type;
            toast.textContent = message;
            document.body.appendChild(toast);
            scope.timeout(function () {
              try {
                toast.remove();
              } catch {
                /* Optional UI may be unavailable. */
              }
            }, 5000);
          }

          if (isCommitDetailPage()) {
            // Single commit page — inject button in page header next to Options dropdown

            function findCommitHeaderContainer() {
              // Strategy 1: page-content-header (modern GitLab 15+)
              const header = document.querySelector(".page-content-header");
              if (header) return header;

              // Strategy 2: tree-controls (GitLab 13-14, holds Browse files + Options)
              const treeControls = document.querySelector(".tree-controls");
              if (treeControls) return treeControls;

              // Strategy 3: commit-actions area
              const commitActions = document.querySelector(".commit-actions");
              if (commitActions) return commitActions;

              // Strategy 4: detail-page-header actions (generic GitLab header)
              const detailHeader = document.querySelector(
                ".detail-page-header .detail-page-header-actions, .detail-page-header",
              );
              if (detailHeader) return detailHeader;

              // Strategy 5: find the Options dropdown button and use its parent
              const optionsBtn = document.querySelector(
                '.dropdown-toggle[data-toggle="dropdown"], ' +
                  ".gl-new-dropdown-toggle, " +
                  "button.dropdown-toggle",
              );
              if (optionsBtn) {
                const group = optionsBtn.closest(
                  ".btn-group, .gl-button-group, .dropdown",
                );
                return group && group.parentElement
                  ? group.parentElement
                  : null;
              }

              return null;
            }

            function injectCherryPickHeaderBtn() {
              if (scope.disposed) return;
              if (document.querySelector(".gl-cherry-pick-detail-btn")) return;

              const container = findCommitHeaderContainer();
              if (!container) return;

              // Extract SHA from URL (supports /-/commit/ and legacy /commit/)
              const shaMatch = window.location.pathname.match(
                /\/commit\/([0-9a-f]{7,40})\b/,
              );
              const sha = shaMatch ? shaMatch[1] : "";
              if (!sha) return;

              // Extract commit message from page
              const commitMsgEl = document.querySelector(
                '.commit-title, [data-testid="commit-title"], .page-title, ' +
                  ".commit-box .commit-title, .page-title-holder .title",
              );
              const commitMsg = commitMsgEl
                ? (
                    commitMsgEl.textContent ||
                    commitMsgEl.getAttribute("title") ||
                    ""
                  ).trim()
                : "";

              const btn = document.createElement("button");
              btn.className =
                "gl-cherry-pick-detail-btn gl-button btn btn-default btn-md";
              btn.type = "button";
              btn.title = msg("cherryPickToBranches");
              btn.innerHTML =
                '<svg class="s16 gl-icon gl-button-icon" viewBox="0 0 16 16">' +
                '<circle cx="8" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
                '<circle cx="8" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
                '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 6v4"/>' +
                '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M4 8h8"/>' +
                "</svg>" +
                '<span class="gl-button-text">' +
                escHtml(msg("cherryPickToBranches")) +
                "</span>";
              btn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                openCherryPickModal(sha, commitMsg, s);
              });

              container.appendChild(btn);
            }

            // Header may be rendered by Vue, observe + retry
            let _cpDetailTimer: ReturnType<typeof setTimeout> | undefined;
            let _cpDetailAttempts = 0;
            const cpDetailObserver = scope.observer(function () {
              if (document.querySelector(".gl-cherry-pick-detail-btn")) return;
              clearTimeout(_cpDetailTimer);
              _cpDetailTimer = scope.timeout(injectCherryPickHeaderBtn, 200);
            });
            cpDetailObserver.observe(document.body, {
              childList: true,
              subtree: true,
            });
            scope.listen(window, "beforeunload", function () {
              cpDetailObserver.disconnect();
            });

            // Retry polling for slow-rendering pages (up to 3s)
            (function pollHeader() {
              if (
                document.querySelector(".gl-cherry-pick-detail-btn") ||
                _cpDetailAttempts > 6
              )
                return;
              _cpDetailAttempts++;
              if (!findCommitHeaderContainer()) {
                scope.timeout(pollHeader, 500);
              } else {
                injectCherryPickHeaderBtn();
              }
            })();
          } else {
            // Commits list page — inject buttons next to each commit SHA
            injectCherryPickButtons();

            let _cpTimer: ReturnType<typeof setTimeout> | undefined;
            const cpObserver = scope.observer(function () {
              clearTimeout(_cpTimer);
              _cpTimer = scope.timeout(injectCherryPickButtons, 300);
            });
            cpObserver.observe(document.body, {
              childList: true,
              subtree: true,
            });
            scope.listen(window, "beforeunload", function () {
              cpObserver.disconnect();
            });
          }
        }),
      );
    } catch {
      /* Optional UI may be unavailable. */
    }
  }

  // =========================================================================
}
