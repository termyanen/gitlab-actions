import { getProjectSettings } from "../../../shared/api/project-settings";
import { createSessionApi } from "../../../shared/api/gitlab";
import { msg } from "../../../shared/i18n";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { createLifecycle } from "../../../shared/lib/lifecycle";
import {
  arrayOf,
  decoder,
  isBoolean,
  isString,
  objectOf,
  optional,
  recordOf,
} from "../../../shared/lib/validation";
import { eventElement, requireElement } from "../../../shared/ui/dom";
import type { Command } from "../model/types";
import { createPaletteCommands } from "./commands";
const readDefaultBranch = decoder(
  objectOf<{ default_branch?: string }>({
    default_branch: optional(isString),
  }),
  "GitLab/Jira response",
);
const readRepositoryEntries = decoder(
  arrayOf(
    objectOf<{ filename?: string }[][number]>({
      filename: optional(isString),
    }),
  ),
  "GitLab/Jira response",
);
const FILE_SEARCH_DEBOUNCE_MS = 300;

export function startCommandPalette(
  openStandupModal: () => void,
  scope: Lifecycle = createLifecycle(),
  openImmediately = false,
  mrCommands: {
    actions: () => { id: string; label: string; icon: string }[];
    run: (id: string) => void;
  } = { actions: () => [], run: () => {} },
) {
  const GITLAB_URL = window.location.origin;
  const api = createSessionApi(() => GITLAB_URL, scope.signal);
  try {
    getProjectSettings(
      { show_cmd_palette: true, show_standup: true },
      scope.guard(function (s: {
        show_cmd_palette: boolean;
        show_standup: boolean;
      }) {
        if (chrome.runtime.lastError || !s.show_cmd_palette) return;

        let _paletteOpen = false;
        const _paletteCollapsed: Record<string, boolean> = (function () {
          try {
            const data: unknown = JSON.parse(
              sessionStorage.getItem("gl-cmd-palette-collapsed") || "null",
            );
            return recordOf(isBoolean)(data) ? data : {};
          } catch {
            return {};
          }
        })();
        const _standupEnabled = !!s.show_standup;
        const { buildCommands, getProjectPath } = createPaletteCommands(
          openStandupModal,
          _standupEnabled,
          mrCommands,
        );

        // File search
        let _defaultBranch = "";
        let _branchProject = "";
        let _fileSearchReqId = 0;

        function fetchDefaultBranch(projectPath: string) {
          if (_branchProject === projectPath && _defaultBranch) return;
          _branchProject = projectPath;
          _defaultBranch = "";
          api("GET", "/projects/" + encodeURIComponent(projectPath))
            .then(readDefaultBranch)
            .then(function (proj) {
              if (_branchProject === projectPath)
                _defaultBranch = proj.default_branch || "main";
            })
            .catch(function () {
              if (_branchProject === projectPath) _defaultBranch = "main";
            });
        }

        function searchFiles(
          projectPath: string,
          query: string,
          cb: (files: string[]) => void,
        ) {
          const reqId = ++_fileSearchReqId;
          const encodedPath = encodeURIComponent(projectPath);
          api(
            "GET",
            "/projects/" +
              encodedPath +
              "/search?scope=blobs&search=" +
              encodeURIComponent(query) +
              "&per_page=20",
          )
            .then(readRepositoryEntries)
            .then(function (results) {
              if (reqId !== _fileSearchReqId) return;
              // Deduplicate by file path
              const seen: Record<string, boolean> = {};
              const files: string[] = [];
              results.forEach(function (item) {
                if (item.filename && !seen[item.filename]) {
                  seen[item.filename] = true;
                  files.push(item.filename);
                }
              });
              cb(files);
            })
            .catch(function () {
              if (reqId !== _fileSearchReqId) return;
              cb([]);
            });
        }

        function getIconSvg(icon: string) {
          const icons: Record<string, string> = {
            mr: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5 3v10M11 3v10M5 8h6"/>',
            issue:
              '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 5v3.5l2.5 1.5"/>',
            pipe: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M2 8h4M10 8h4"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
            branch:
              '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5 3v6c0 2 2 3 4 3h2M11 9v4M11 9l-2-2M11 9l2-2"/>',
            repo: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 12V4a1 1 0 011-1h8a1 1 0 011 1v8M3 12h10a1 1 0 001-1V4M3 12a1 1 0 001 1h9"/>',
            copy: '<rect x="5" y="5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" d="M11 5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v6a1 1 0 001 1h1"/>',
            action:
              '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M13 3L6.5 9.5M13 3h-4M13 3v4M6 4H4a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-2"/>',
            settings:
              '<circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4"/>',
            standup:
              '<rect x="3" y="2" width="10" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6 5h4M6 8h4M6 11h2"/>',
            tag: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M2 8.5V3.5a1 1 0 011-1h5l5.5 5.5-5 5z"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>',
            commit:
              '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M8 2v3M8 11v3"/>',
            wiki: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M3 13V3h4l1 2h5v8z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6 7h4M6 9.5h3"/>',
            snippet:
              '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M5 4l-3 4 3 4M11 4l3 4-3 4M9 3L7 13"/>',
            pin: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" d="M5 3l1 5H4l4 6V9.5h1L11 3z"/>',
            nav: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M5 4l4 4-4 4"/>',
            file: '<path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M9 2v4h4"/>',
          };
          return (
            '<svg viewBox="0 0 16 16" class="gl-cmd-palette-item-icon">' +
            (icons[icon] || icons.action) +
            "</svg>"
          );
        }

        function openPalette() {
          if (_paletteOpen) return;
          _paletteOpen = true;
          const openedPath = window.location.pathname;

          const projectPath = getProjectPath();
          if (projectPath) fetchDefaultBranch(projectPath);

          const cmds = buildCommands();
          let selectedIdx = 0;
          let filtered = cmds.slice();

          const overlay = document.createElement("div");
          overlay.className = "gl-cmd-palette-overlay";

          const modal = document.createElement("div");
          modal.className = "gl-cmd-palette";

          modal.innerHTML =
            '<div class="gl-cmd-palette-input-wrap">' +
            '<svg viewBox="0 0 16 16" class="gl-cmd-palette-icon"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M10.5 10.5l3 3"/></svg>' +
            '<input type="text" class="gl-cmd-palette-input" placeholder="' +
            escHtml(msg("cmdPlaceholder")) +
            '">' +
            "</div>" +
            '<div class="gl-cmd-palette-list"></div>' +
            '<div class="gl-cmd-palette-footer">' +
            "<span><kbd>&uarr;&darr;</kbd> " +
            escHtml(msg("cmdFooterNavigate")) +
            "</span>" +
            "<span><kbd>Enter</kbd> " +
            escHtml(msg("cmdFooterSelect")) +
            "</span>" +
            "<span><kbd>Esc</kbd> " +
            escHtml(msg("cmdFooterClose")) +
            "</span>" +
            "</div>";

          overlay.appendChild(modal);

          const input = requireElement(
            modal.querySelector<HTMLInputElement>(".gl-cmd-palette-input"),
          );
          const listEl = requireElement(
            modal.querySelector<HTMLDivElement>(".gl-cmd-palette-list"),
          );

          let isSearching = false;

          function renderList() {
            let html = "";
            const groupItems: Record<string, { cmd: Command; idx: number }[]> =
              {};
            // Group items
            filtered.forEach(function (cmd, i) {
              const g = cmd.group || "";
              if (!groupItems[g]) groupItems[g] = [];
              groupItems[g].push({ cmd: cmd, idx: i });
            });
            // Render groups in order
            const renderedGroups: string[] = [];
            filtered.forEach(function (cmd) {
              const g = cmd.group || "";
              if (renderedGroups.indexOf(g) !== -1) return;
              renderedGroups.push(g);
              const items = groupItems[g] || [];
              const collapsed = !isSearching && _paletteCollapsed[g];
              html +=
                '<div class="gl-cmd-palette-group' +
                (collapsed ? " collapsed" : "") +
                '" data-group="' +
                escHtml(g) +
                '">' +
                '<svg viewBox="0 0 16 16" class="gl-cmd-palette-group-chevron"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M4 6l4 4 4-4"/></svg>' +
                escHtml(g) +
                '<span class="gl-cmd-palette-group-count">' +
                items.length +
                "</span>" +
                "</div>";
              if (!collapsed) {
                items.forEach(function (entry) {
                  html +=
                    '<div class="gl-cmd-palette-item' +
                    (entry.idx === selectedIdx ? " selected" : "") +
                    '" data-idx="' +
                    entry.idx +
                    '">' +
                    getIconSvg(entry.cmd.icon) +
                    '<span class="gl-cmd-palette-item-label">' +
                    escHtml(entry.cmd.label) +
                    "</span>" +
                    (entry.cmd.hint
                      ? '<span class="gl-cmd-palette-item-hint">' +
                        escHtml(entry.cmd.hint) +
                        "</span>"
                      : "") +
                    "</div>";
                });
              }
            });
            if (!filtered.length) {
              html =
                '<div class="gl-cmd-palette-empty">' +
                escHtml(msg("cmdEmpty")) +
                "</div>";
            }
            listEl.innerHTML = html;
          }

          function getVisibleIndices() {
            const indices: number[] = [];
            const els = listEl.querySelectorAll<HTMLElement>(
              ".gl-cmd-palette-item",
            );
            els.forEach(function (el) {
              const index = Number(el.dataset.idx);
              if (Number.isSafeInteger(index) && index >= 0)
                indices.push(index);
            });
            return indices;
          }

          function scrollToSelected() {
            const sel = listEl.querySelector(".gl-cmd-palette-item.selected");
            if (sel) sel.scrollIntoView({ block: "nearest" });
          }

          function execSelected() {
            const command = filtered[selectedIdx];
            if (command) {
              closePalette();
              if (scope.disposed || window.location.pathname !== openedPath)
                return;
              command.action();
            }
          }

          let removeKey = () => {};
          const closePalette = scope.onCleanup(() => {
            _paletteOpen = false;
            overlay.remove();
            removeKey();
          });

          function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closePalette();
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const vis = getVisibleIndices();
              if (!vis.length) return;
              const curPos = vis.indexOf(selectedIdx);
              if (e.key === "ArrowDown") {
                selectedIdx =
                  curPos < vis.length - 1
                    ? (vis[curPos + 1] ?? selectedIdx)
                    : (vis[vis.length - 1] ?? selectedIdx);
              } else {
                selectedIdx =
                  (curPos > 0 ? vis[curPos - 1] : vis[0]) ?? selectedIdx;
              }
              renderList();
              scrollToSelected();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              execSelected();
              return;
            }
          }

          listEl.addEventListener("click", function (e) {
            const groupEl = eventElement(e.target)?.closest<HTMLElement>(
              ".gl-cmd-palette-group",
            );
            if (groupEl && !isSearching) {
              const groupName = groupEl.dataset.group;
              if (!groupName) return;
              _paletteCollapsed[groupName] = !_paletteCollapsed[groupName];
              try {
                sessionStorage.setItem(
                  "gl-cmd-palette-collapsed",
                  JSON.stringify(_paletteCollapsed),
                );
              } catch {
                /* Optional UI may be unavailable. */
              }
              renderList();
              const vis = getVisibleIndices();
              if (vis.length && vis.indexOf(selectedIdx) === -1) {
                selectedIdx = vis[0] ?? selectedIdx;
                renderList();
              }
              return;
            }
            const item = eventElement(e.target)?.closest<HTMLElement>(
              ".gl-cmd-palette-item",
            );
            if (item) {
              selectedIdx = Number(item.dataset.idx);
              execSelected();
            }
          });

          let _fileSearchTimer: ReturnType<typeof setTimeout> | undefined;
          let _lastFileQuery = "";

          input.addEventListener("input", function () {
            const q = input.value.toLowerCase().trim();
            isSearching = !!q;
            if (!q) {
              filtered = cmds.slice();
              _lastFileQuery = "";
              renderList();
              const vis = getVisibleIndices();
              selectedIdx = vis[0] ?? 0;
              renderList();
              return;
            }

            // Filter commands
            const cmdResults = cmds.filter(function (cmd) {
              return (
                cmd.label.toLowerCase().indexOf(q) !== -1 ||
                (cmd.hint && cmd.hint.toLowerCase().indexOf(q) !== -1) ||
                (cmd.group && cmd.group.toLowerCase().indexOf(q) !== -1)
              );
            });
            filtered = cmdResults;
            renderList();
            const vis = getVisibleIndices();
            selectedIdx = vis[0] ?? 0;
            renderList();

            // File search with debounce (min 2 chars)
            if (q.length >= 2 && projectPath) {
              scope.cancelTimeout(_fileSearchTimer);
              _fileSearchTimer = scope.timeout(function () {
                if (!_paletteOpen) return;
                _lastFileQuery = q;
                searchFiles(projectPath, q, function (files) {
                  if (
                    !_paletteOpen ||
                    input.value.toLowerCase().trim() !== _lastFileQuery
                  )
                    return;
                  if (!files.length) return;

                  const fileGroup = msg("cmdGroupFiles");
                  const defaultBranch = _defaultBranch || "main";
                  const fileCmds = files.map(function (filePath) {
                    const fileName = filePath.split("/").pop() || filePath;
                    return {
                      id: "file-" + filePath,
                      label: fileName,
                      hint: filePath,
                      group: fileGroup,
                      icon: "file",
                      action: function () {
                        window.location.href =
                          "/" +
                          projectPath +
                          "/-/blob/" +
                          encodeURIComponent(defaultBranch) +
                          "/" +
                          filePath;
                      },
                    };
                  });

                  // Re-filter commands with current query (may have changed)
                  const currentQ = input.value.toLowerCase().trim();
                  const currentCmdResults = cmds.filter(function (cmd) {
                    return (
                      cmd.label.toLowerCase().indexOf(currentQ) !== -1 ||
                      (cmd.hint &&
                        cmd.hint.toLowerCase().indexOf(currentQ) !== -1) ||
                      (cmd.group &&
                        cmd.group.toLowerCase().indexOf(currentQ) !== -1)
                    );
                  });

                  filtered = currentCmdResults.concat(fileCmds);
                  selectedIdx = 0;
                  renderList();
                });
              }, FILE_SEARCH_DEBOUNCE_MS);
            }
          });

          listEl.addEventListener("mousemove", function (e) {
            const item = eventElement(e.target)?.closest<HTMLElement>(
              ".gl-cmd-palette-item",
            );
            if (item) {
              const idx = Number(item.dataset.idx);
              if (idx !== selectedIdx) {
                selectedIdx = idx;
                renderList();
              }
            }
          });

          overlay.addEventListener("click", function (e) {
            if (e.target === overlay) closePalette();
          });

          removeKey = scope.listen(document, "keydown", onKey, true);

          document.body.appendChild(overlay);
          input.focus();
          renderList();
        }

        scope.listen(
          document,
          "keydown",
          function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
              e.preventDefault();
              e.stopPropagation();
              if (_paletteOpen) return;
              openPalette();
            }
          },
          true,
        );

        if (openImmediately) openPalette();

        // ── Standup Modal ──────────────────────────────────────────────
      }),
    );
  } catch {
    /* Optional UI may be unavailable. */
  }
}
