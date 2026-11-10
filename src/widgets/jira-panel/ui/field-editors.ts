import {
  jiraResponseFailure,
  renderJiraFailure,
  renderJiraMutationFailure,
  sendJiraMessage,
} from "../../../entities/jira-issue/content";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { eventElement, requireElement } from "../../../shared/ui/dom";
const ASSIGNEE_SEARCH_DEBOUNCE_MS = 300;

export function createJiraFieldEditors(scope: Lifecycle) {
  function initAssigneeEditor(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
  ) {
    const assigneeEl = requireElement(
      sidebar.querySelector<HTMLElement>("#gl-jira-sidebar-assignee"),
    );
    const searchBox = requireElement(
      sidebar.querySelector<HTMLElement>("#gl-jira-sidebar-assignee-search"),
    );
    const input = requireElement(
      searchBox.querySelector<HTMLInputElement>(
        ".gl-jira-sidebar-assignee-input",
      ),
    );
    const resultsEl = requireElement(
      searchBox.querySelector<HTMLElement>(".gl-jira-sidebar-assignee-results"),
    );
    const unassign = requireElement(
      searchBox.querySelector<HTMLButtonElement>(".gl-jira-sidebar-unassign"),
    );
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let searchRequest = 0;
    let updating = false;

    assigneeEl.addEventListener("click", function () {
      if (updating) return;
      ++searchRequest;
      scope.cancelTimeout(searchTimer);
      const isOpen = searchBox.style.display !== "none";
      searchBox.style.display = isOpen ? "none" : "block";
      if (!isOpen) {
        input.value = "";
        resultsEl.innerHTML = "";
        input.focus();
      }
    });

    function setAssignee(username: string | null, displayName: string) {
      if (updating || scope.disposed) return;
      updating = true;
      ++searchRequest;
      scope.cancelTimeout(searchTimer);
      input.disabled = true;
      unassign.disabled = true;
      resultsEl.innerHTML =
        '<div class="gl-jira-sidebar-assignee-loading">...</div>';
      sendJiraMessage(
        {
          type: "set-jira-assignee",
          jiraUrl: jiraUrl,
          ticket: ticket,
          username,
        },
        scope.once(function (result) {
          updating = false;
          input.disabled = false;
          unassign.disabled = false;
          if (result.success) {
            assigneeEl.innerHTML =
              (username === null
                ? '<span style="opacity:0.5">' +
                  escHtml(
                    chrome.i18n.getMessage("jiraSidebarUnassigned") ||
                      "Unassigned",
                  ) +
                  "</span>"
                : escHtml(displayName)) +
              ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>';
            searchBox.style.display = "none";
          } else {
            resultsEl.replaceChildren(
              renderJiraMutationFailure(
                jiraResponseFailure(result) || {
                  _error: "Jira did not confirm the assignee update",
                },
                jiraUrl,
              ),
            );
          }
        }),
      );
    }

    unassign.addEventListener("click", function (e) {
      e.stopPropagation();
      setAssignee(null, "");
    });

    function searchUsers(query: string, request: number) {
      if (scope.disposed || updating || request !== searchRequest) return;
      resultsEl.innerHTML =
        '<div class="gl-jira-sidebar-assignee-loading">...</div>';
      sendJiraMessage(
        { type: "search-jira-assignable", jiraUrl, ticket, query },
        scope.once(function (resp) {
          if (request !== searchRequest || updating) return;
          if (resp._error !== undefined) {
            resultsEl.replaceChildren(
              renderJiraFailure(resp, jiraUrl, () =>
                searchUsers(query, request),
              ),
            );
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
                "</span></div>"
              );
            })
            .join("");
        }),
      );
    }

    input.addEventListener("input", function () {
      const request = ++searchRequest;
      const query = input.value.trim();
      scope.cancelTimeout(searchTimer);
      if (query.length < 2) {
        resultsEl.innerHTML = "";
        return;
      }
      searchTimer = scope.timeout(
        () => searchUsers(query, request),
        ASSIGNEE_SEARCH_DEBOUNCE_MS,
      );
    });

    // Prevent click inside search from closing it
    searchBox.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    resultsEl.addEventListener("click", function (e) {
      const item = eventElement(e.target)?.closest<HTMLElement>(
        ".gl-jira-sidebar-assignee-item",
      );
      if (!item || updating) return;

      const username = item.dataset.key;
      const displayName = item.dataset.name;
      if (!username) return;
      setAssignee(username, displayName || username);
    });
  }

  function initFixVersionsEditor(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
    currentVersions: string[],
  ) {
    const valueEl = requireElement(
      sidebar.querySelector<HTMLElement>("#gl-jira-sidebar-fixversions"),
    );
    const dropdown = requireElement(
      sidebar.querySelector<HTMLElement>(
        "#gl-jira-sidebar-fixversions-dropdown",
      ),
    );
    const listEl = requireElement(
      sidebar.querySelector<HTMLElement>("#gl-jira-sidebar-fixversions-list"),
    );
    const errorEl = requireElement(
      sidebar.querySelector<HTMLElement>("#gl-jira-sidebar-fixversions-error"),
    );
    const filterInput = requireElement(
      sidebar.querySelector<HTMLInputElement>(
        "#gl-jira-sidebar-fixversions-filter",
      ),
    );
    let selected = currentVersions.slice();
    let loading = false;
    let updating = false;

    function filterList() {
      const query = filterInput.value.trim().toLowerCase();
      const items = listEl.querySelectorAll<HTMLElement>(
        ".gl-jira-sidebar-version-item",
      );
      for (const versionItem of items) {
        const name = (versionItem.textContent || "").trim().toLowerCase();
        versionItem.style.display =
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
      if (scope.disposed || loading || updating) return;
      loading = true;
      listEl.innerHTML =
        '<div class="gl-jira-sidebar-assignee-loading">...</div>';
      sendJiraMessage(
        {
          type: "fetch-jira-versions",
          jiraUrl: jiraUrl,
          ticket: ticket,
        },
        scope.once(function (resp) {
          loading = false;
          if (resp._error !== undefined) {
            listEl.replaceChildren(
              renderJiraFailure(resp, jiraUrl, loadVersions),
            );
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
      const cb = eventElement(e.target)?.closest<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      if (!cb || scope.disposed) return;
      const name = cb.dataset.name;
      if (name === undefined) return;
      if (updating) {
        cb.checked = selected.includes(name);
        return;
      }
      const newSelected = selected.slice();
      if (cb.checked) {
        if (newSelected.indexOf(name) === -1) newSelected.push(name);
      } else {
        const idx = newSelected.indexOf(name);
        if (idx !== -1) newSelected.splice(idx, 1);
      }
      updating = true;
      const checkboxes = listEl.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      checkboxes.forEach((checkbox) => {
        checkbox.disabled = true;
      });
      errorEl.style.display = "none";
      sendJiraMessage(
        {
          type: "set-jira-fix-versions",
          jiraUrl: jiraUrl,
          ticket: ticket,
          versions: newSelected,
        },
        scope.once(function (resp) {
          updating = false;
          checkboxes.forEach((checkbox) => {
            checkbox.disabled = false;
          });
          if (!resp.success) {
            cb.checked = selected.includes(name);
            errorEl.replaceChildren(
              renderJiraMutationFailure(
                jiraResponseFailure(resp) || {
                  _error: "Jira did not confirm the version update",
                },
                jiraUrl,
              ),
            );
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
