import { sendJiraMessage } from "../../../entities/jira-issue/content";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
const ASSIGNEE_SEARCH_DEBOUNCE_MS = 300;

export function createJiraFieldEditors(scope: Lifecycle) {
  function initAssigneeEditor(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
  ) {
    const assigneeEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-assignee",
    )!;
    const searchBox = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-assignee-search",
    )!;
    const input = searchBox.querySelector<HTMLInputElement>(
      ".gl-jira-sidebar-assignee-input",
    )!;
    const resultsEl = searchBox.querySelector<HTMLElement>(
      ".gl-jira-sidebar-assignee-results",
    )!;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let searchRequest = 0;

    assigneeEl.addEventListener("click", function () {
      const isOpen = searchBox.style.display !== "none";
      searchBox.style.display = isOpen ? "none" : "block";
      if (!isOpen) {
        input.value = "";
        resultsEl.innerHTML = "";
        input.focus();
      }
    });

    // Unassign button
    searchBox
      .querySelector<HTMLElement>(".gl-jira-sidebar-unassign")!
      .addEventListener("click", function (e) {
        e.stopPropagation();
        sendJiraMessage(
          {
            type: "set-jira-assignee",
            jiraUrl: jiraUrl,
            ticket: ticket,
            username: null,
          },
          scope.once(function (result) {
            if (result && result.success) {
              assigneeEl.innerHTML =
                '<span style="opacity:0.5">' +
                escHtml(
                  chrome.i18n.getMessage("jiraSidebarUnassigned") ||
                    "Unassigned",
                ) +
                "</span>" +
                ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
              searchBox.style.display = "none";
            }
          }),
        );
      });

    input.addEventListener("input", function () {
      const request = ++searchRequest;
      const query = input.value.trim();
      scope.cancelTimeout(searchTimer);
      if (query.length < 2) {
        resultsEl.innerHTML = "";
        return;
      }
      searchTimer = scope.timeout(function () {
        resultsEl.innerHTML =
          '<div class="gl-jira-sidebar-assignee-loading">...</div>';
        sendJiraMessage(
          {
            type: "search-jira-assignable",
            jiraUrl: jiraUrl,
            ticket: ticket,
            query: query,
          },
          scope.once(function (resp) {
            if (request !== searchRequest) return;
            if (!resp || resp._error || !resp.users) {
              resultsEl.innerHTML = "";
              return;
            }
            if (!resp.users.length) {
              resultsEl.innerHTML =
                '<div class="gl-jira-sidebar-assignee-empty">' +
                escHtml(
                  chrome.i18n.getMessage("jiraSidebarNoUsers") ||
                    "No users found",
                ) +
                "</div>";
              return;
            }
            resultsEl.innerHTML = resp.users
              .map(function (u) {
                return (
                  '<div class="gl-jira-sidebar-assignee-item" data-key="' +
                  escHtml(u.key) +
                  '" data-name="' +
                  escHtml(u.name) +
                  '">' +
                  (u.avatar
                    ? '<img src="' +
                      escHtml(u.avatar) +
                      '" class="gl-jira-sidebar-assignee-avatar">'
                    : "") +
                  "<span>" +
                  escHtml(u.name) +
                  "</span>" +
                  "</div>"
                );
              })
              .join("");
          }),
        );
      }, ASSIGNEE_SEARCH_DEBOUNCE_MS);
    });

    // Prevent click inside search from closing it
    searchBox.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    resultsEl.addEventListener("click", function (e) {
      const item = (e.target as Element).closest<HTMLElement>(
        ".gl-jira-sidebar-assignee-item",
      );
      if (!item) return;

      const username = item.dataset.key!;
      const displayName = item.dataset.name!;

      input.disabled = true;
      resultsEl.innerHTML =
        '<div class="gl-jira-sidebar-assignee-loading">...</div>';

      sendJiraMessage(
        {
          type: "set-jira-assignee",
          jiraUrl: jiraUrl,
          ticket: ticket,
          username: username,
        },
        scope.once(function (result) {
          if (result && result.success) {
            assigneeEl.innerHTML =
              escHtml(displayName) +
              ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
            searchBox.style.display = "none";
          }
          input.disabled = false;
        }),
      );
    });
  }

  function initFixVersionsEditor(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
    currentVersions: string[],
  ) {
    const valueEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-fixversions",
    )!;
    const dropdown = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-fixversions-dropdown",
    )!;
    const listEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-fixversions-list",
    )!;
    const errorEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-fixversions-error",
    )!;
    const filterInput = sidebar.querySelector<HTMLInputElement>(
      "#gl-jira-sidebar-fixversions-filter",
    )!;
    let selected = currentVersions.slice();

    function filterList() {
      const query = filterInput.value.trim().toLowerCase();
      const items = listEl.querySelectorAll<HTMLElement>(
        ".gl-jira-sidebar-version-item",
      );
      for (let i = 0; i < items.length; i++) {
        const name = (items[i].textContent || "").trim().toLowerCase();
        items[i].style.display =
          !query || name.indexOf(query) !== -1 ? "" : "none";
      }
    }

    function renderTags() {
      const tagsHtml = selected
        .map(function (v) {
          return (
            '<span class="gl-jira-sidebar-label-tag">' + escHtml(v) + "</span>"
          );
        })
        .join(" ");
      valueEl.innerHTML =
        (tagsHtml ||
          '<span style="opacity:0.5">' +
            escHtml(
              chrome.i18n.getMessage("jiraSidebarNoFixVersions") || "None",
            ) +
            "</span>") +
        ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
    }

    function loadVersions() {
      listEl.innerHTML =
        '<div class="gl-jira-sidebar-assignee-loading">...</div>';
      sendJiraMessage(
        {
          type: "fetch-jira-versions",
          jiraUrl: jiraUrl,
          ticket: ticket,
        },
        scope.once(function (resp) {
          if (!resp || resp._error || !resp.versions) {
            listEl.innerHTML = "";
            return;
          }
          if (!resp.versions.length) {
            listEl.innerHTML =
              '<div class="gl-jira-sidebar-assignee-empty">' +
              escHtml(
                chrome.i18n.getMessage("jiraSidebarNoVersions") ||
                  "No versions found",
              ) +
              "</div>";
          } else {
            listEl.innerHTML = resp.versions
              .map(function (v) {
                const checked = selected.indexOf(v.name) !== -1;
                return (
                  '<label class="gl-jira-sidebar-version-item">' +
                  '<input type="checkbox" data-name="' +
                  escHtml(v.name) +
                  '"' +
                  (checked ? " checked" : "") +
                  ">" +
                  "<span>" +
                  escHtml(v.name) +
                  "</span>" +
                  "</label>"
                );
              })
              .join("");
            filterList();
          }
          listEl.dataset.loaded = "1";
        }),
      );
    }

    valueEl.addEventListener("click", function () {
      const isOpen = dropdown.style.display !== "none";
      dropdown.style.display = isOpen ? "none" : "block";
      if (!isOpen) {
        if (!listEl.dataset.loaded) {
          loadVersions();
        } else {
          filterInput.value = "";
          filterList();
        }
        filterInput.focus();
      }
    });

    dropdown.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    filterInput.addEventListener("input", filterList);

    listEl.addEventListener("change", function (e) {
      const cb = (e.target as Element).closest<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      if (!cb) return;
      const name = cb.dataset.name!;
      const newSelected = selected.slice();
      if (cb.checked) {
        if (newSelected.indexOf(name) === -1) newSelected.push(name);
      } else {
        const idx = newSelected.indexOf(name);
        if (idx !== -1) newSelected.splice(idx, 1);
      }
      cb.disabled = true;
      errorEl.style.display = "none";
      sendJiraMessage(
        {
          type: "set-jira-fix-versions",
          jiraUrl: jiraUrl,
          ticket: ticket,
          versions: newSelected,
        },
        scope.once(function (resp) {
          cb.disabled = false;
          if (!resp || resp._error) {
            cb.checked = !cb.checked;
            errorEl.textContent =
              chrome.i18n.getMessage("jiraSidebarFixVersionsError") ||
              "Failed to update fix versions";
            errorEl.style.display = "block";
            return;
          }
          selected = newSelected;
          renderTags();
        }),
      );
    });
  }
  return { initAssigneeEditor, initFixVersionsEditor };
}
export type JiraFieldEditors = ReturnType<typeof createJiraFieldEditors>;
