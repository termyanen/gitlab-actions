import { createLifecycle } from "../../../shared/lib/lifecycle";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import type {
  JiraState,
  JiraIssue,
  JiraTransition,
  JiraQuickAction,
  JiraComment,
} from "../../../entities/jira-issue";
import {
  getJiraCategoryClass,
  getPriorityHtml,
  sendJiraMessage,
} from "../../../entities/jira-issue/content";
import { msg } from "../../../shared/i18n";
import { escHtml } from "../../../shared/lib/html";
export function createJiraPanel(
  jiraState: JiraState,
  scope: Lifecycle = createLifecycle(),
) {
  let removeEscape = () => {};
  function openJiraSidebar(ticket: string, jiraUrl: string) {
    removeEscape();
    // Remove existing sidebar
    const existing = document.querySelector<HTMLElement>(".gl-jira-sidebar");
    let reuse = false;
    if (existing) {
      if (existing.dataset.ticket === ticket) {
        existing.classList.add("gl-jira-sidebar-closing");
        existing.addEventListener("animationend", function () {
          existing!.remove();
        });
        return;
      }
      // Reuse existing sidebar — just swap content, no animation
      reuse = true;
      existing.dataset.ticket = ticket;
      const ticketLink = existing.querySelector<HTMLAnchorElement>(
        ".gl-jira-sidebar-header .gfm-issue",
      )!;
      if (ticketLink) {
        ticketLink.textContent = ticket;
        ticketLink.href = jiraState.url + "/browse/" + ticket;
      }
      existing.querySelector<HTMLElement>(".gl-jira-sidebar-body")!.innerHTML =
        '<div class="gl-jira-sidebar-loading"><div class="gl-jira-sidebar-spinner"></div></div>';
    }

    const sidebar = reuse ? existing! : document.createElement("div");
    if (!reuse) {
      sidebar.className = "gl-jira-sidebar";
      sidebar.dataset.ticket = ticket;
      sidebar.innerHTML =
        '<div class="gl-jira-sidebar-header">' +
        '<a href="' +
        escHtml(jiraUrl + "/browse/" + ticket) +
        '" target="_blank" class="gfm gfm-issue">' +
        escHtml(ticket) +
        "</a>" +
        '<button class="gl-jira-sidebar-close" title="Close">&times;</button>' +
        "</div>" +
        '<div class="gl-jira-sidebar-body">' +
        '<div class="gl-jira-sidebar-loading"><div class="gl-jira-sidebar-spinner"></div></div>' +
        "</div>";
      document.body.appendChild(sidebar);
    }

    function closeSidebar() {
      sidebar.classList.add("gl-jira-sidebar-closing");
      sidebar.addEventListener("animationend", function () {
        sidebar.remove();
      });
      removeEscape();
    }

    // Close button
    sidebar
      .querySelector<HTMLElement>(".gl-jira-sidebar-close")!
      .addEventListener("click", closeSidebar);

    // Close on Escape — lightbox first, then sidebar
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const lightbox =
          document.querySelector<HTMLElement>(".gl-jira-lightbox");
        if (lightbox) {
          closeLightbox(lightbox);
          return;
        }
        closeSidebar();
      }
    }
    removeEscape = scope.listen(document, "keydown", onEsc);

    // Delegate click on images to open lightbox
    sidebar.addEventListener("click", function (e) {
      const img = (e.target as Element).closest<HTMLImageElement>(
        ".gl-jira-sidebar-img",
      );
      if (img) {
        openJiraLightbox(img.src, "image");
        return;
      }
      const media = (e.target as Element).closest<HTMLElement>(
        ".gl-jira-sidebar-attach-media",
      );
      if (media) {
        e.preventDefault();
        openJiraLightbox(media.dataset.url!, media.dataset.type!);
      }
    });

    // Fetch full issue data
    sendJiraMessage(
      {
        type: "fetch-jira-issue",
        jiraUrl: jiraUrl,
        ticket: ticket,
      },
      scope.guard(function (resp) {
        if (sidebar.dataset.ticket !== ticket) return;
        if (!resp || resp._error) {
          const errMsg = resp ? resp._error : "No response";
          if (resp && resp._error && /^(401|403)\s/.test(resp._error)) {
            jiraState.authFailed = true;
          }
          sidebar.querySelector<HTMLElement>(
            ".gl-jira-sidebar-body",
          )!.innerHTML =
            '<div class="gl-jira-sidebar-error">' + escHtml(errMsg) + "</div>";
          return;
        }
        renderJiraSidebarContent(sidebar, resp, jiraUrl);
        chrome.storage.sync.get(
          { jiraQuickActions: [] },
          scope.guard(function (s: { jiraQuickActions: JiraQuickAction[] }) {
            loadJiraTransitions(
              sidebar,
              resp.key,
              jiraUrl,
              s.jiraQuickActions || [],
            );
          }),
        );
        initAssigneeEditor(sidebar, resp.key, jiraUrl);
        initFixVersionsEditor(
          sidebar,
          resp.key,
          jiraUrl,
          resp.fixVersions || [],
        );
      }),
    );
  }

  function loadJiraTransitions(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
    quickActions: JiraQuickAction[],
  ) {
    const container = sidebar.querySelector<
      HTMLElement & { _jiraTransitionRequest?: object }
    >("#gl-jira-sidebar-transitions")!;
    if (!container || sidebar.dataset.ticket !== ticket) return;
    container.dataset.busy = "";
    const request = {};
    container._jiraTransitionRequest = request;

    function render(transitions: JiraTransition[]) {
      const transitionMap: Record<string, JiraTransition> = Object.create(null);
      transitions.forEach(function (t) {
        if (t.name) transitionMap[t.name.toLowerCase()] = t;
        if (t.statusName && !transitionMap[t.statusName.toLowerCase()])
          transitionMap[t.statusName.toLowerCase()] = t;
      });
      const html = transitions
        .map(function (t) {
          const cls = getJiraCategoryClass(
            t.statusCategoryKey,
            t.statusName || t.name,
          );
          return (
            '<button class="gl-jira-sidebar-transition gl-jira-badge ' +
            cls +
            '" data-id="' +
            escHtml(t.id) +
            '" data-name="' +
            escHtml(t.statusName || t.name) +
            '" data-category="' +
            escHtml(t.statusCategoryKey) +
            '">' +
            "&#8594; " +
            escHtml(t.statusName || t.name) +
            "</button>"
          );
        })
        .join("");
      let qaHtml = "";
      (quickActions || []).forEach(function (qa, index) {
        const matched = qa.status
          ? transitionMap[qa.status.toLowerCase()]
          : null;
        if (
          qa.label &&
          (matched ||
            (!qa.status && (qa.assignee || (qa.updates || []).length)))
        ) {
          qaHtml +=
            '<button class="gl-jira-sidebar-quick-action" data-action-index="' +
            index +
            '" ' +
            'data-transition-id="' +
            (matched ? escHtml(matched.id) : "") +
            '" ' +
            'data-status-name="' +
            (matched ? escHtml(matched.statusName || matched.name) : "") +
            '" ' +
            'data-status-category="' +
            (matched ? escHtml(matched.statusCategoryKey) : "") +
            '">' +
            "&#9889; " +
            escHtml(qa.label) +
            "</button>";
        }
      });
      container.innerHTML =
        html +
        (qaHtml ? '<div class="gl-jira-sidebar-qa-sep"></div>' + qaHtml : "");
    }

    // Field-only actions do not depend on transition permissions or availability.
    render([]);
    sendJiraMessage(
      { type: "fetch-jira-transitions", jiraUrl: jiraUrl, ticket: ticket },
      scope.guard(function (resp) {
        if (
          sidebar.dataset.ticket !== ticket ||
          sidebar.querySelector<
            HTMLElement & { _jiraTransitionRequest?: object }
          >("#gl-jira-sidebar-transitions")! !== container ||
          container.dataset.busy ||
          container._jiraTransitionRequest !== request
        )
          return;
        if (resp && !resp._error) render(resp.transitions || []);
      }),
    );

    // Replace the handler when refreshing; repeated refreshes must not replay edits.
    container.onclick = function (e) {
      if (sidebar.dataset.ticket !== ticket || container.dataset.busy) return;
      const quickBtn = (e.target as Element).closest<HTMLButtonElement>(
        ".gl-jira-sidebar-quick-action",
      );
      if (quickBtn && !quickBtn.disabled) {
        executeQuickAction(sidebar, quickBtn, ticket, jiraUrl, quickActions);
        return;
      }
      const btn = (e.target as Element).closest<HTMLButtonElement>(
        ".gl-jira-sidebar-transition",
      );
      if (!btn || btn.disabled) return;
      if (!jiraState.skipConfirmations && !confirm(btn.dataset.name! + "?"))
        return;
      disableAllTransitionBtns(container);
      btn.style.opacity = "1";
      btn.textContent = "...";
      doTransition(
        sidebar,
        ticket,
        jiraUrl,
        btn.dataset.id!,
        btn.dataset.name!,
        btn.dataset.category!,
        quickActions,
      );
    };
  }

  function disableAllTransitionBtns(container: HTMLElement) {
    container.dataset.busy = "true";
    container.querySelectorAll("button").forEach(function (b) {
      b.disabled = true;
      b.style.opacity = "0.5";
    });
  }

  function updateStatusAfterTransition(
    sidebar: HTMLElement,
    ticket: string,
    statusName: string,
    categoryKey: string,
  ) {
    const statusBadge = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-status",
    )!;
    if (statusBadge) {
      const cls = getJiraCategoryClass(categoryKey, statusName);
      statusBadge.className = "gl-jira-badge " + cls;
      statusBadge.textContent = statusName;
    }
    delete jiraState.cache[ticket];
    const cls2 = getJiraCategoryClass(categoryKey, statusName);
    document
      .querySelectorAll<HTMLElement>(
        '.gl-jira-badge[data-jira-ticket="' + ticket + '"]',
      )
      .forEach(function (b) {
        b.className = "gl-jira-badge " + cls2;
        b.textContent = statusName;
        b.title = ticket + ": " + statusName;
      });
  }

  function doTransition(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
    transitionId: string,
    statusName: string,
    categoryKey: string,
    quickActions: JiraQuickAction[],
  ) {
    sendJiraMessage(
      {
        type: "do-jira-transition",
        jiraUrl: jiraUrl,
        ticket: ticket,
        transitionId: transitionId,
      },
      scope.guard(function (result) {
        if (sidebar.dataset.ticket !== ticket) return;
        if (result && result.success) {
          updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey);
          loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
        } else {
          const container = sidebar.querySelector<
            HTMLElement & { _jiraTransitionRequest?: object }
          >("#gl-jira-sidebar-transitions")!;
          if (container)
            loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
        }
      }),
    );
  }

  function executeQuickAction(
    sidebar: HTMLElement,
    btn: HTMLButtonElement,
    ticket: string,
    jiraUrl: string,
    quickActions: JiraQuickAction[],
  ) {
    const action = quickActions[Number(btn.dataset.actionIndex)];
    if (!action) return;
    const container = sidebar.querySelector<
      HTMLElement & { _jiraTransitionRequest?: object }
    >("#gl-jira-sidebar-transitions")!;
    if (container.dataset.busy) return;
    container.dataset.busy = "true";
    disableAllTransitionBtns(container);
    btn.style.opacity = "1";
    btn.textContent = "...";
    const previousError = sidebar.querySelector<HTMLButtonElement>(
      ".gl-jira-quick-action-error",
    )!;
    if (previousError) previousError.remove();

    function isCurrent() {
      return (
        sidebar.dataset.ticket === ticket &&
        sidebar.querySelector<
          HTMLElement & { _jiraTransitionRequest?: object }
        >("#gl-jira-sidebar-transitions")! === container
      );
    }
    sendJiraMessage(
      {
        type: "execute-jira-quick-action",
        jiraUrl: jiraUrl,
        ticket: ticket,
        transitionId: btn.dataset.transitionId,
        action: action,
      },
      scope.guard(function (result) {
        delete jiraState.cache[ticket];
        if (jiraState.invalidateCommitTicket)
          jiraState.invalidateCommitTicket(ticket);
        if (!isCurrent()) return;
        if (result && result.completed && result.completed.transition) {
          updateStatusAfterTransition(
            sidebar,
            ticket,
            btn.dataset.statusName!,
            btn.dataset.statusCategory!,
          );
        }
        let error =
          result && result.success
            ? ""
            : msg(
                result && result.completed && result.completed.transition
                  ? "jiraQuickActionPartial"
                  : "jiraQuickActionFailed",
              ) +
              " " +
              ((result && result._error) || "");
        // Reload actual values after success AND partial failure; a transition may
        // have succeeded even when the following field edit was rejected by Jira.
        sendJiraMessage(
          { type: "fetch-jira-issue", jiraUrl: jiraUrl, ticket: ticket },
          scope.guard(function (data) {
            if (!isCurrent()) return;
            if (data && !data._error) {
              const draft = sidebar.querySelector<HTMLTextAreaElement>(
                "#gl-jira-sidebar-comment-input",
              )!;
              const draftText = draft ? draft.value : "";
              renderJiraSidebarContent(sidebar, data, jiraUrl);
              const restoredDraft = sidebar.querySelector<HTMLTextAreaElement>(
                "#gl-jira-sidebar-comment-input",
              )!;
              if (restoredDraft) restoredDraft.value = draftText;
              const submitDraft = sidebar.querySelector<HTMLButtonElement>(
                "#gl-jira-sidebar-comment-submit",
              )!;
              if (submitDraft) submitDraft.disabled = !draftText.trim();
              initAssigneeEditor(sidebar, ticket, jiraUrl);
              initFixVersionsEditor(
                sidebar,
                ticket,
                jiraUrl,
                data.fixVersions || [],
              );
            } else {
              error += (error ? " " : "") + msg("jiraQuickActionRefreshFailed");
            }
            loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
            if (error) {
              const notice = document.createElement("div");
              notice.className =
                "gl-jira-sidebar-error gl-jira-quick-action-error";
              notice.setAttribute("role", "alert");
              notice.textContent = error;
              sidebar
                .querySelector<
                  HTMLElement & { _jiraTransitionRequest?: object }
                >("#gl-jira-sidebar-transitions")!
                .after(notice);
            }
          }),
        );
      }),
    );
  }

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
          scope.guard(function (result) {
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
      const query = input.value.trim();
      clearTimeout(searchTimer);
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
          scope.guard(function (resp) {
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
      }, 300);
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
        scope.guard(function (result) {
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
        scope.guard(function (resp) {
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
        scope.guard(function (resp) {
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

  function closeLightbox(el: Element) {
    el.classList.add("gl-jira-lightbox-closing");
    el.addEventListener("animationend", function () {
      el.remove();
    });
  }

  function openJiraLightbox(src: string, type: string) {
    const existing = document.querySelector<HTMLElement>(".gl-jira-lightbox");
    if (existing) existing!.remove();

    const overlay = document.createElement("div");
    overlay.className = "gl-jira-lightbox";
    if (type === "video") {
      overlay.innerHTML =
        '<video src="' +
        escHtml(src) +
        '" controls autoplay class="gl-jira-lightbox-video"></video>';
    } else {
      overlay.innerHTML =
        '<img src="' + escHtml(src) + '" class="gl-jira-lightbox-img">';
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeLightbox(overlay);
    });
    document.body.appendChild(overlay);
  }

  function formatJiraDate(dateStr: string) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 60) return mins + "m ago";
    if (hours < 24) return hours + "h ago";
    if (days < 30) return days + "d ago";
    return d.toLocaleDateString();
  }

  // Render Jira wiki markup (images, videos, links, bare URLs) as HTML.
  // `attachments` maps filename -> URL, used to resolve !file! image/video markup.
  function formatJiraWikiText(
    text: string,
    attachments: Record<string, string>,
  ) {
    attachments = attachments || {};
    // Simple formatting: escape HTML first, then replace wiki markup
    let html = escHtml(text).replace(/\n/g, "<br>");
    // Replace Jira wiki image markup: !filename|params! or !filename!
    html = html.replace(/!([^|!]+?)(?:\|[^!]*)?!/g, function (match, filename) {
      const url = attachments[filename];
      if (!url) return match;
      const ext = filename.split(".").pop()!.toLowerCase();
      if (ext === "mp4" || ext === "webm" || ext === "ogg" || ext === "mov") {
        return (
          '<video src="' +
          escHtml(url) +
          '" controls class="gl-jira-sidebar-video"></video>'
        );
      }
      return (
        '<img src="' +
        escHtml(url) +
        '" alt="' +
        escHtml(filename) +
        '" class="gl-jira-sidebar-img">'
      );
    });
    // Replace Jira wiki links: [text|url] or [url]
    html = html.replace(
      /\[([^|\]\n]+)\|([^\]\n]+?)(?:\|[^\]\n]*)?\]/g,
      function (m, text, url) {
        return (
          '<a href="' +
          escHtml(url) +
          '" target="_blank" class="gl-jira-sidebar-inline-link">' +
          text +
          "</a>"
        );
      },
    );
    html = html.replace(/\[(https?:\/\/[^\]\n]+)\]/g, function (m, url) {
      return (
        '<a href="' +
        escHtml(url) +
        '" target="_blank" class="gl-jira-sidebar-inline-link">' +
        url +
        "</a>"
      );
    });
    // Auto-link bare URLs not already inside href or <a> tags
    html = html.replace(
      /(^|[^"=])(https?:\/\/[^\s<]+)/g,
      function (m, prefix, url) {
        return (
          prefix +
          '<a href="' +
          url +
          '" target="_blank" class="gl-jira-sidebar-inline-link">' +
          url +
          "</a>"
        );
      },
    );
    return html;
  }

  // Cache of current Jira user id per Jira instance, used to detect "own" comments

  function getJiraMyself(jiraUrl: string, cb: (id: string) => void) {
    if (jiraState.myselfCache[jiraUrl] !== undefined) {
      cb(jiraState.myselfCache[jiraUrl]);
      return;
    }
    sendJiraMessage(
      { type: "fetch-jira-myself", jiraUrl: jiraUrl },
      scope.guard(function (resp) {
        const id = resp && !resp._error ? resp.id : "";
        jiraState.myselfCache[jiraUrl] = id;
        cb(id);
      }),
    );
  }

  function renderJiraComment(c: JiraComment, currentUserId: string) {
    let body = c.body || "";
    if (body.length > 3000) body = body.substring(0, 3000) + "...";
    const bodyHtml = formatJiraWikiText(body, {});
    const canDelete = !!(
      currentUserId &&
      c.authorId &&
      c.authorId === currentUserId
    );
    return (
      '<div class="gl-jira-sidebar-comment" data-comment-id="' +
      escHtml(String(c.id)) +
      '">' +
      (c.avatarUrl
        ? '<img class="gl-jira-sidebar-comment-avatar" src="' +
          escHtml(c.avatarUrl) +
          '" alt="">'
        : '<div class="gl-jira-sidebar-comment-avatar"></div>') +
      '<div class="gl-jira-sidebar-comment-main">' +
      '<div class="gl-jira-sidebar-comment-header">' +
      '<span class="gl-jira-sidebar-comment-author">' +
      escHtml(c.author) +
      "</span>" +
      '<span class="gl-jira-sidebar-comment-date" title="' +
      escHtml(c.created ? new Date(c.created).toLocaleString() : "") +
      '">' +
      escHtml(formatJiraDate(c.created)) +
      "</span>" +
      (canDelete
        ? '<button type="button" class="gl-jira-sidebar-comment-delete" title="' +
          escHtml(
            chrome.i18n.getMessage("jiraSidebarCommentDelete") || "Delete",
          ) +
          '">&times;</button>'
        : "") +
      "</div>" +
      '<div class="gl-jira-sidebar-comment-body">' +
      bodyHtml +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function fetchAndRenderJiraComments(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
    startAt: number,
  ) {
    const listEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-comments-list",
    )!;
    if (!listEl) return;
    const lm = listEl.querySelector<HTMLButtonElement>(
      ".gl-jira-sidebar-load-more",
    )!;
    if (startAt === 0) {
      listEl.innerHTML =
        '<div class="gl-jira-sidebar-comments-loading"><div class="gl-jira-sidebar-spinner"></div></div>';
    } else if (lm) {
      lm.disabled = true;
      lm.classList.add("is-loading");
      lm.innerHTML = '<span class="gl-jira-sidebar-spinner-sm"></span>';
    }
    getJiraMyself(jiraUrl, function (currentUserId) {
      sendJiraMessage(
        {
          type: "fetch-jira-comments",
          jiraUrl: jiraUrl,
          ticket: ticket,
          startAt: startAt,
          maxResults: 5,
        },
        scope.guard(function (resp) {
          if (!resp || resp._error) {
            if (startAt === 0) {
              listEl.innerHTML =
                '<div class="gl-jira-sidebar-comments-empty">' +
                escHtml(
                  chrome.i18n.getMessage("jiraSidebarCommentError") ||
                    "Failed to load comments",
                ) +
                "</div>";
            } else if (lm) {
              lm.disabled = false;
              lm.classList.remove("is-loading");
              lm.textContent =
                chrome.i18n.getMessage("jiraSidebarLoadMoreComments") ||
                "Show more comments";
            }
            return;
          }
          const headerEl = sidebar.querySelector<HTMLElement>(
            "#gl-jira-sidebar-comments-header",
          )!;
          if (headerEl) {
            headerEl.textContent =
              (chrome.i18n.getMessage("jiraSidebarComments") || "Comments") +
              " (" +
              resp.total +
              ")";
          }
          if (startAt === 0) {
            listEl.innerHTML = "";
            if (!resp.total) {
              listEl.innerHTML =
                '<div class="gl-jira-sidebar-comments-empty">' +
                escHtml(
                  chrome.i18n.getMessage("jiraSidebarNoComments") ||
                    "No comments yet",
                ) +
                "</div>";
            }
          } else if (lm) {
            lm.remove();
          }
          resp.comments.forEach(function (c) {
            listEl.insertAdjacentHTML(
              "beforeend",
              renderJiraComment(c, currentUserId),
            );
          });
          const loaded = startAt + resp.comments.length;
          if (loaded < resp.total) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "gl-jira-sidebar-load-more";
            btn.textContent =
              chrome.i18n.getMessage("jiraSidebarLoadMoreComments") ||
              "Show more comments";
            btn.addEventListener("click", function () {
              fetchAndRenderJiraComments(sidebar, ticket, jiraUrl, loaded);
            });
            listEl.appendChild(btn);
          }
        }),
      );
    });
  }

  function wireJiraCommentForm(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
  ) {
    const input = sidebar.querySelector<HTMLTextAreaElement>(
      "#gl-jira-sidebar-comment-input",
    )!;
    const submitBtn = sidebar.querySelector<HTMLButtonElement>(
      "#gl-jira-sidebar-comment-submit",
    )!;
    const errorEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-comment-error",
    )!;
    if (!input || !submitBtn) return;

    input.addEventListener("input", function () {
      submitBtn.disabled = !input.value.trim();
      errorEl.style.display = "none";
    });

    function submitComment() {
      const text = input.value.trim();
      if (!text) return;
      submitBtn.disabled = true;
      errorEl.style.display = "none";
      sendJiraMessage(
        {
          type: "post-jira-comment",
          jiraUrl: jiraUrl,
          ticket: ticket,
          text: text,
        },
        scope.guard(function (resp) {
          if (!resp || resp._error) {
            errorEl.textContent =
              chrome.i18n.getMessage("jiraSidebarCommentError") ||
              "Failed to post comment";
            errorEl.style.display = "block";
            submitBtn.disabled = false;
            return;
          }
          const listEl = sidebar.querySelector<HTMLElement>(
            "#gl-jira-sidebar-comments-list",
          )!;
          const empty = listEl.querySelector<HTMLElement>(
            ".gl-jira-sidebar-comments-empty",
          )!;
          if (empty) empty.remove();
          // A freshly posted comment is always our own — force the delete button to show
          listEl.insertAdjacentHTML(
            "afterbegin",
            renderJiraComment(resp.comment, resp.comment.authorId),
          );
          const headerEl = sidebar.querySelector<HTMLElement>(
            "#gl-jira-sidebar-comments-header",
          )!;
          if (headerEl) {
            const m = (headerEl.textContent || "").match(/\((\d+)\)/);
            const newTotal = (m ? parseInt(m[1], 10) : 0) + 1;
            headerEl.textContent =
              (chrome.i18n.getMessage("jiraSidebarComments") || "Comments") +
              " (" +
              newTotal +
              ")";
          }
          input.value = "";
          submitBtn.disabled = true;
        }),
      );
    }

    submitBtn.addEventListener("click", submitComment);
    input.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submitComment();
      }
    });
  }

  function wireJiraCommentDelete(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
  ) {
    const listEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-comments-list",
    )!;
    const errorEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-comment-error",
    )!;
    if (!listEl) return;

    listEl.addEventListener("click", function (e) {
      const btn = (e.target as Element).closest<HTMLButtonElement>(
        ".gl-jira-sidebar-comment-delete",
      );
      if (!btn || btn.disabled) return;
      const commentEl = btn.closest<HTMLElement>(".gl-jira-sidebar-comment");
      const commentId = commentEl!.dataset.commentId;

      if (
        !jiraState.skipConfirmations &&
        !confirm(
          chrome.i18n.getMessage("jiraSidebarCommentDeleteConfirm") ||
            "Delete this comment?",
        )
      )
        return;

      btn.disabled = true;
      if (errorEl) errorEl.style.display = "none";
      sendJiraMessage(
        {
          type: "delete-jira-comment",
          jiraUrl: jiraUrl,
          ticket: ticket,
          commentId: commentId,
        },
        scope.guard(function (resp) {
          if (!resp || resp._error) {
            btn.disabled = false;
            if (errorEl) {
              errorEl.textContent =
                chrome.i18n.getMessage("jiraSidebarCommentDeleteError") ||
                "Failed to delete comment";
              errorEl.style.display = "block";
            }
            return;
          }
          commentEl!.remove();
          const headerEl = sidebar.querySelector<HTMLElement>(
            "#gl-jira-sidebar-comments-header",
          )!;
          if (headerEl) {
            const m = (headerEl.textContent || "").match(/\((\d+)\)/);
            const newTotal = Math.max(0, (m ? parseInt(m[1], 10) : 1) - 1);
            headerEl.textContent =
              (chrome.i18n.getMessage("jiraSidebarComments") || "Comments") +
              " (" +
              newTotal +
              ")";
            if (
              !newTotal &&
              !listEl.querySelector<HTMLElement>(".gl-jira-sidebar-comment")!
            ) {
              listEl.innerHTML =
                '<div class="gl-jira-sidebar-comments-empty">' +
                escHtml(
                  chrome.i18n.getMessage("jiraSidebarNoComments") ||
                    "No comments yet",
                ) +
                "</div>";
            }
          }
        }),
      );
    });
  }

  function renderJiraSidebarContent(
    sidebar: HTMLElement,
    data: JiraIssue,
    jiraUrl: string,
  ) {
    const statusClass = getJiraCategoryClass(
      data.statusCategoryKey,
      data.status,
    );
    let desc = data.description || "";
    const attachments = data.attachments || {};
    // Truncate long descriptions (but keep image markup intact)
    if (desc.length > 3000) desc = desc.substring(0, 3000) + "...";
    const descHtml = formatJiraWikiText(desc, attachments);

    let rows = "";

    // Status
    rows +=
      '<div class="gl-jira-sidebar-row">' +
      '<span class="gl-jira-sidebar-label">' +
      escHtml(chrome.i18n.getMessage("jiraSidebarStatus") || "Status") +
      "</span>" +
      '<span class="gl-jira-badge ' +
      statusClass +
      '" id="gl-jira-sidebar-status">' +
      escHtml(data.status) +
      "</span>" +
      "</div>" +
      '<div class="gl-jira-sidebar-transitions" id="gl-jira-sidebar-transitions"></div>';

    // Resolution
    if (data.resolution) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(
          chrome.i18n.getMessage("jiraSidebarResolution") || "Resolution",
        ) +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        escHtml(data.resolution) +
        "</span>" +
        "</div>";
    }

    // Type
    if (data.type) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarType") || "Type") +
        "</span>" +
        '<span class="gl-jira-sidebar-value"><span class="gl-jira-priority">' +
        (data.typeIcon
          ? '<img class="gl-jira-priority-icon" src="' +
            escHtml(data.typeIcon) +
            '" alt="">'
          : "") +
        escHtml(data.type) +
        "</span></span>" +
        "</div>";
    }

    // Priority
    if (data.priority) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarPriority") || "Priority") +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        getPriorityHtml(data.priority, data.priorityIcon) +
        "</span>" +
        "</div>";
    }

    // Assignee (editable)
    rows +=
      '<div class="gl-jira-sidebar-row">' +
      '<span class="gl-jira-sidebar-label">' +
      escHtml(chrome.i18n.getMessage("jiraSidebarAssignee") || "Assignee") +
      "</span>" +
      '<span class="gl-jira-sidebar-value gl-jira-sidebar-assignee" id="gl-jira-sidebar-assignee" data-ticket="' +
      escHtml(data.key) +
      '">' +
      (data.assignee
        ? escHtml(data.assignee)
        : '<span style="opacity:0.5">' +
          escHtml(
            chrome.i18n.getMessage("jiraSidebarUnassigned") || "Unassigned",
          ) +
          "</span>") +
      ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>' +
      "</span>" +
      "</div>" +
      '<div class="gl-jira-sidebar-assignee-search" id="gl-jira-sidebar-assignee-search" style="display:none">' +
      '<div style="display:flex;gap:6px">' +
      '<input type="text" class="gl-jira-sidebar-assignee-input" placeholder="' +
      escHtml(
        chrome.i18n.getMessage("jiraSidebarSearchUser") || "Search user...",
      ) +
      '" style="flex:1">' +
      '<button class="gl-jira-sidebar-unassign" title="' +
      escHtml(chrome.i18n.getMessage("jiraSidebarUnassign") || "Unassign") +
      '">&times;</button>' +
      "</div>" +
      '<div class="gl-jira-sidebar-assignee-results"></div>' +
      "</div>";

    // Reporter
    if (data.reporter) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarReporter") || "Reporter") +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        escHtml(data.reporter) +
        "</span>" +
        "</div>";
    }

    // Labels
    if (data.labels && data.labels.length) {
      const labelsHtml = data.labels
        .map(function (l) {
          return (
            '<span class="gl-jira-sidebar-label-tag">' + escHtml(l) + "</span>"
          );
        })
        .join(" ");
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarLabels") || "Labels") +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        labelsHtml +
        "</span>" +
        "</div>";
    }

    // Epic Link
    if (data.epicLink) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarEpic") || "Epic") +
        "</span>" +
        '<span class="gl-jira-sidebar-value"><a href="' +
        escHtml(jiraUrl) +
        "/browse/" +
        escHtml(data.epicLink) +
        '" target="_blank" class="gl-jira-sidebar-inline-link">' +
        escHtml(data.epicLink) +
        "</a></span>" +
        "</div>";
    }

    // Sprint
    if (data.sprint) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarSprint") || "Sprint") +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        escHtml(data.sprint) +
        "</span>" +
        "</div>";
    }

    // Components
    if (data.components && data.components.length) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(
          chrome.i18n.getMessage("jiraSidebarComponents") || "Components",
        ) +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        data.components
          .map(function (c) {
            return (
              '<span class="gl-jira-sidebar-label-tag">' +
              escHtml(c) +
              "</span>"
            );
          })
          .join(" ") +
        "</span>" +
        "</div>";
    }

    // Affects Versions
    if (data.versions && data.versions.length) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(
          chrome.i18n.getMessage("jiraSidebarAffectsVersions") || "Affects",
        ) +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        data.versions
          .map(function (v) {
            return (
              '<span class="gl-jira-sidebar-label-tag">' +
              escHtml(v) +
              "</span>"
            );
          })
          .join(" ") +
        "</span>" +
        "</div>";
    }

    // Fix Versions (editable)
    const fixVersionsTags = (data.fixVersions || [])
      .map(function (v) {
        return (
          '<span class="gl-jira-sidebar-label-tag">' + escHtml(v) + "</span>"
        );
      })
      .join(" ");
    rows +=
      '<div class="gl-jira-sidebar-row">' +
      '<span class="gl-jira-sidebar-label">' +
      escHtml(chrome.i18n.getMessage("jiraSidebarFixVersions") || "Fix ver.") +
      "</span>" +
      '<span class="gl-jira-sidebar-value gl-jira-sidebar-fixversions" id="gl-jira-sidebar-fixversions">' +
      (fixVersionsTags ||
        '<span style="opacity:0.5">' +
          escHtml(
            chrome.i18n.getMessage("jiraSidebarNoFixVersions") || "None",
          ) +
          "</span>") +
      ' <span class="gl-jira-sidebar-edit-icon">&#9998;</span>' +
      "</span>" +
      "</div>" +
      '<div class="gl-jira-sidebar-fixversions-dropdown" id="gl-jira-sidebar-fixversions-dropdown" style="display:none">' +
      '<input type="text" class="gl-jira-sidebar-fixversions-filter" id="gl-jira-sidebar-fixversions-filter" placeholder="' +
      escHtml(
        chrome.i18n.getMessage("jiraSidebarSearchVersions") ||
          "Search versions...",
      ) +
      '">' +
      '<div class="gl-jira-sidebar-fixversions-list" id="gl-jira-sidebar-fixversions-list"></div>' +
      '<div class="gl-jira-sidebar-fixversions-error" id="gl-jira-sidebar-fixversions-error" style="display:none"></div>' +
      "</div>";

    // Created / Updated
    if (data.created) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarCreated") || "Created") +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        escHtml(formatJiraDate(data.created)) +
        "</span>" +
        "</div>";
    }
    if (data.updated) {
      rows +=
        '<div class="gl-jira-sidebar-row">' +
        '<span class="gl-jira-sidebar-label">' +
        escHtml(chrome.i18n.getMessage("jiraSidebarUpdated") || "Updated") +
        "</span>" +
        '<span class="gl-jira-sidebar-value">' +
        escHtml(formatJiraDate(data.updated)) +
        "</span>" +
        "</div>";
    }

    let bodyHtml =
      '<h3 class="gl-jira-sidebar-title">' +
      escHtml(data.summary) +
      "</h3>" +
      '<div class="gl-jira-sidebar-fields">' +
      rows +
      "</div>";

    // Description
    if (desc) {
      bodyHtml +=
        '<div class="gl-jira-sidebar-sep"></div>' +
        '<div class="gl-jira-sidebar-desc-label">' +
        escHtml(
          chrome.i18n.getMessage("jiraSidebarDescription") || "Description",
        ) +
        "</div>" +
        '<div class="gl-jira-sidebar-desc">' +
        descHtml +
        "</div>";
    }

    // Attachments list
    if (data.attachmentList && data.attachmentList.length) {
      bodyHtml +=
        '<div class="gl-jira-sidebar-sep"></div>' +
        '<div class="gl-jira-sidebar-desc-label">' +
        escHtml(
          chrome.i18n.getMessage("jiraSidebarAttachments") || "Attachments",
        ) +
        " (" +
        data.attachmentList.length +
        ")</div>" +
        '<div class="gl-jira-sidebar-attachments">';
      data.attachmentList.forEach(function (a) {
        const ext = a.filename.split(".").pop()!.toLowerCase();
        const isImage =
          ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"].indexOf(ext) !==
          -1;
        const isVideo = ["mp4", "webm", "ogg", "mov"].indexOf(ext) !== -1;
        const sizeStr =
          a.size < 1024
            ? a.size + " B"
            : a.size < 1048576
              ? Math.round(a.size / 1024) + " KB"
              : (a.size / 1048576).toFixed(1) + " MB";
        if (isImage) {
          bodyHtml +=
            '<div class="gl-jira-sidebar-attach-item gl-jira-sidebar-attach-media" data-url="' +
            escHtml(a.url) +
            '" data-type="image">' +
            '<img src="' +
            escHtml(a.url) +
            '" class="gl-jira-sidebar-attach-thumb">' +
            '<span class="gl-jira-sidebar-attach-name">' +
            escHtml(a.filename) +
            "</span>" +
            '<span class="gl-jira-sidebar-attach-size">' +
            sizeStr +
            "</span>" +
            "</div>";
        } else if (isVideo) {
          bodyHtml +=
            '<div class="gl-jira-sidebar-attach-item gl-jira-sidebar-attach-media" data-url="' +
            escHtml(a.url) +
            '" data-type="video">' +
            '<span class="gl-jira-sidebar-attach-icon">&#9654;</span>' +
            '<span class="gl-jira-sidebar-attach-name">' +
            escHtml(a.filename) +
            "</span>" +
            '<span class="gl-jira-sidebar-attach-size">' +
            sizeStr +
            "</span>" +
            "</div>";
        } else {
          bodyHtml +=
            '<a href="' +
            escHtml(a.url) +
            '" target="_blank" class="gl-jira-sidebar-attach-item">' +
            '<span class="gl-jira-sidebar-attach-icon">&#128196;</span>' +
            '<span class="gl-jira-sidebar-attach-name">' +
            escHtml(a.filename) +
            "</span>" +
            '<span class="gl-jira-sidebar-attach-size">' +
            sizeStr +
            "</span>" +
            "</a>";
        }
      });
      bodyHtml += "</div>";
    }

    // Comments
    bodyHtml +=
      '<div class="gl-jira-sidebar-sep"></div>' +
      '<div class="gl-jira-sidebar-desc-label" id="gl-jira-sidebar-comments-header">' +
      escHtml(chrome.i18n.getMessage("jiraSidebarComments") || "Comments") +
      "</div>" +
      '<div class="gl-jira-sidebar-comments-list" id="gl-jira-sidebar-comments-list">' +
      '<div class="gl-jira-sidebar-comments-loading"><div class="gl-jira-sidebar-spinner"></div></div>' +
      "</div>" +
      '<div class="gl-jira-sidebar-comment-form">' +
      '<textarea class="gl-jira-sidebar-comment-input" id="gl-jira-sidebar-comment-input" placeholder="' +
      escHtml(
        chrome.i18n.getMessage("jiraSidebarCommentPlaceholder") ||
          "Add a comment...",
      ) +
      '"></textarea>' +
      '<div class="gl-jira-sidebar-comment-error" id="gl-jira-sidebar-comment-error" style="display:none"></div>' +
      '<div class="gl-jira-sidebar-comment-actions">' +
      '<button type="button" class="gl-jira-sidebar-comment-submit" id="gl-jira-sidebar-comment-submit" disabled>' +
      escHtml(chrome.i18n.getMessage("jiraSidebarCommentSubmit") || "Comment") +
      "</button>" +
      "</div>" +
      "</div>";

    sidebar.querySelector<HTMLElement>(".gl-jira-sidebar-body")!.innerHTML =
      bodyHtml;

    fetchAndRenderJiraComments(sidebar, data.key, jiraUrl, 0);
    wireJiraCommentForm(sidebar, data.key, jiraUrl);
    wireJiraCommentDelete(sidebar, data.key, jiraUrl);
  }
  // ── End Jira sidebar ────────────────────────────────────────────

  return { openJiraSidebar };
}
