import { createLifecycle } from "../../../shared/lib/lifecycle";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
interface CommitEntry {
  row: Element;
  group: Element;
  sha: string;
}
import { createSessionApi } from "../../../shared/api/gitlab";
import { SEL } from "../../../shared/config/gitlab";
import { q, qAll, qUp } from "../../../shared/lib/dom";
import { parseToml, getNestedValue } from "../../../shared/lib/version";

export function startCommitVersions(scope: Lifecycle = createLifecycle()) {
  const GITLAB_URL = window.location.origin;
  const api = createSessionApi(() => GITLAB_URL, scope.signal);
  function isCommitsPage() {
    return (
      /\/-\/commits\//.test(window.location.pathname) ||
      /\/-\/repository\/commits\//.test(window.location.pathname)
    );
  }
  // Version badge on commits page
  // Shows the version-file version at each commit. Muted everywhere; commits
  // where the version changed vs the previous (older) commit are highlighted.
  // SHA is immutable, so results are cached permanently in storage.local.
  // =========================================================================

  if (isCommitsPage()) {
    try {
      chrome.storage.sync.get(
        {
          show_commit_version: false,
          versionFile: "package.json",
          versionPath: "version",
        },
        scope.guard(function (s: {
          show_commit_version: boolean;
          versionFile: string;
          versionPath: string;
        }) {
          if (chrome.runtime.lastError || !s.show_commit_version) return;

          const projectPath = (function () {
            const m = window.location.pathname.match(
              /^\/([^/]+(?:\/[^/]+)*?)\/-\//,
            );
            return m ? m[1] : null;
          })();
          if (!projectPath) return;
          const encodedProject = encodeURIComponent(projectPath);

          const versionFile = s.versionFile || "package.json";
          const versionPath = s.versionPath || "version";
          const isToml = versionFile.indexOf(".toml") !== -1;
          const isPlainText = versionFile.indexOf(".txt") !== -1;

          // Cache keys are scoped by project + file + path so a settings change
          // never serves stale versions. SHA content is immutable — no TTL.
          const cacheScope =
            projectPath + "|" + versionFile + "|" + versionPath + "|";
          const _versionCache: Record<string, string> = {}; // sha -> version string ('' = file missing / unparsable)
          let _cvFetching = false;

          function parseVersionFromContent(content: string) {
            try {
              if (isPlainText) return content.trim();
              if (isToml)
                return String(
                  getNestedValue(parseToml(content), versionPath) || "",
                );
              return String(
                getNestedValue(JSON.parse(content), versionPath) || "",
              );
            } catch {
              return "";
            }
          }

          function collectCommitEntries() {
            const shaGroups: Element[] = Array.from(
              qAll(document, SEL.commitShaGroup),
            );
            if (!shaGroups.length) {
              const clipEls = qAll(document, "[data-clipboard-text]");
              for (let ci = 0; ci < clipEls.length; ci++) {
                const cv =
                  clipEls[ci].getAttribute("data-clipboard-text") || "";
                if (/^[0-9a-f]{7,40}$/.test(cv)) {
                  const g =
                    clipEls[ci].closest(
                      ".btn-group, .commit-sha-group, .gl-button-group",
                    ) || clipEls[ci].parentElement;
                  if (g && shaGroups.indexOf(g) === -1) shaGroups.push(g);
                }
              }
            }
            const entries: CommitEntry[] = [];
            const seenRows: Element[] = [];
            for (let i = 0; i < shaGroups.length; i++) {
              const shaEl = q(shaGroups[i], SEL.commitSha);
              const sha = shaEl
                ? shaEl.getAttribute("data-clipboard-text") ||
                  (shaEl.textContent || "").trim()
                : "";
              if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) continue;
              const row =
                qUp(shaGroups[i], SEL.commitRow) || shaGroups[i].parentElement;
              if (!row || seenRows.indexOf(row) !== -1) continue;
              seenRows.push(row);
              entries.push({ row: row, group: shaGroups[i], sha: sha });
            }
            return entries; // DOM order = newest first
          }

          function persistVersions(map: Record<string, string>) {
            chrome.storage.local.get(
              { gl_commit_versions: {} },
              scope.guard(function (res: {
                gl_commit_versions?: Record<string, { v: string; ts: number }>;
              }) {
                if (chrome.runtime.lastError) return;
                const store = res.gl_commit_versions || {};
                const now = Date.now();
                let sha;
                for (sha in map) {
                  store[cacheScope + sha] = { v: map[sha], ts: now };
                }
                // Cap the store; evict oldest entries first
                const keys = Object.keys(store);
                if (keys.length > 1000) {
                  keys.sort(function (a, b) {
                    return (store[a].ts || 0) - (store[b].ts || 0);
                  });
                  for (let i = 0; i < keys.length - 1000; i++)
                    delete store[keys[i]];
                }
                chrome.storage.local.set(
                  { gl_commit_versions: store },
                  function () {
                    if (chrome.runtime.lastError) {
                      /* quota exceeded — cache write skipped, feature still works */
                    }
                  },
                );
              }),
            );
          }

          function renderCommitVersionBadges(entries: CommitEntry[]) {
            if (scope.disposed) return;
            for (let i = 0; i < entries.length; i++) {
              const entry = entries[i];
              const loader = entry.row.querySelector(
                ".gl-commit-version-loader",
              );
              if (loader) loader.remove();
              if (entry.row.querySelector(".gl-commit-version-badge")) continue;
              const version = _versionCache[entry.sha];
              if (!version) continue; // unknown or file absent at this commit
              // Highlight when the version differs from the next older commit on the page
              let changed = false;
              if (i + 1 < entries.length) {
                const olderVersion = _versionCache[entries[i + 1].sha];
                changed = !!olderVersion && olderVersion !== version;
              }
              if (!entry.group.parentNode) continue; // detached by a Vue re-render
              const badge = document.createElement("span");
              badge.className =
                "gl-commit-version-badge" +
                (changed ? " gl-commit-version-changed" : "");
              badge.textContent = version;
              badge.title = versionFile;
              entry.group.parentNode.insertBefore(badge, entry.group);
            }
          }

          function injectCommitVersionBadges() {
            if (scope.disposed) return;
            if (_cvFetching) return;
            const entries = collectCommitEntries();
            if (!entries.length) return;

            const uncached: string[] = [];
            for (let i = 0; i < entries.length; i++) {
              if (
                _versionCache[entries[i].sha] === undefined &&
                uncached.indexOf(entries[i].sha) === -1
              ) {
                uncached.push(entries[i].sha);
              }
            }

            if (!uncached.length) {
              renderCommitVersionBadges(entries);
              return;
            }

            // Skeleton loaders while fetching (render happens once all versions
            // are known — highlight needs the older neighbour's version)
            entries.forEach(function (entry) {
              if (_versionCache[entry.sha] !== undefined) return;
              if (
                entry.row.querySelector(
                  ".gl-commit-version-badge, .gl-commit-version-loader",
                )
              )
                return;
              if (!entry.group.parentNode) return;
              const loader = document.createElement("span");
              loader.className = "gl-jira-loader gl-commit-version-loader";
              entry.group.parentNode.insertBefore(loader, entry.group);
            });

            _cvFetching = true;
            const fetched: Record<string, string> = {}; // only successfully resolved (incl. 404) — persisted
            let idx = 0;
            function fetchNextBatch() {
              if (idx >= uncached.length) {
                _cvFetching = false;
                persistVersions(fetched);
                renderCommitVersionBadges(collectCommitEntries());
                return;
              }
              const batch = uncached.slice(idx, idx + 5);
              idx += 5;
              Promise.all(
                batch.map(function (sha) {
                  return api<{ content: string }>(
                    "GET",
                    "/projects/" +
                      encodedProject +
                      "/repository/files/" +
                      encodeURIComponent(versionFile) +
                      "?ref=" +
                      sha,
                  )
                    .then(function (f) {
                      const version = parseVersionFromContent(
                        decodeURIComponent(escape(atob(f.content))),
                      );
                      _versionCache[sha] = version;
                      fetched[sha] = version;
                    })
                    .catch(function (err) {
                      // 404 = file absent at this commit — permanent, safe to persist.
                      // Other errors (network, auth) stay session-only to avoid poisoning the cache.
                      _versionCache[sha] = "";
                      if (err && /404|not found/i.test(err.message || ""))
                        fetched[sha] = "";
                    });
                }),
              ).then(fetchNextBatch);
            }
            fetchNextBatch();
          }

          chrome.storage.local.get(
            { gl_commit_versions: {} },
            scope.guard(function (res: {
              gl_commit_versions?: Record<string, { v: string; ts: number }>;
            }) {
              const store =
                (!chrome.runtime.lastError && res.gl_commit_versions) || {};
              for (const k in store) {
                if (k.indexOf(cacheScope) === 0)
                  _versionCache[k.substring(cacheScope.length)] = store[k].v;
              }

              injectCommitVersionBadges();

              let _cvTimer: ReturnType<typeof setTimeout> | undefined;
              const cvObserver = scope.observer(function () {
                clearTimeout(_cvTimer);
                _cvTimer = scope.timeout(injectCommitVersionBadges, 500);
              });
              cvObserver.observe(document.body, {
                childList: true,
                subtree: true,
              });
              scope.listen(window, "beforeunload", function () {
                cvObserver.disconnect();
              });
            }),
          );
        }),
      );
    } catch {
      /* Optional UI may be unavailable. */
    }
  }

  // =========================================================================
}
