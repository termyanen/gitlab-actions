import type { JiraComment, JiraState } from "../../../entities/jira-issue";
import { sendJiraMessage } from "../../../entities/jira-issue/content";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { eventElement, requireElement } from "../../../shared/ui/dom";
import { formatJiraDate, formatJiraWikiText } from "./format";
export function createJiraComments(jiraState: JiraState, scope: Lifecycle) {
  // Cache of current Jira user id per Jira instance, used to detect "own" comments

  function getJiraMyself(jiraUrl: string, cb: (id: string) => void) {
    if (jiraState.myselfCache[jiraUrl] !== undefined) {
      cb(jiraState.myselfCache[jiraUrl]);
      return;
    }
    sendJiraMessage(
      { type: "fetch-jira-myself", jiraUrl: jiraUrl },
      scope.once(function (resp) {
        const id = resp && resp._error === undefined ? resp.id : "";
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
    );
    if (!listEl) return;
    const lm = listEl.querySelector<HTMLButtonElement>(
      ".gl-jira-sidebar-load-more",
    );
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
        scope.once(function (resp) {
          if (!resp || resp._error !== undefined) {
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
          );
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
    );
    const submitBtn = sidebar.querySelector<HTMLButtonElement>(
      "#gl-jira-sidebar-comment-submit",
    );
    const errorEl = requireElement(
      sidebar.querySelector<HTMLElement>("#gl-jira-sidebar-comment-error"),
    );
    if (!input || !submitBtn) return;

    input.addEventListener("input", function () {
      submitBtn.disabled = !input.value.trim();
      errorEl.style.display = "none";
    });

    const submitComment = function () {
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
        scope.once(function (resp) {
          if (!resp || resp._error !== undefined) {
            errorEl.textContent =
              chrome.i18n.getMessage("jiraSidebarCommentError") ||
              "Failed to post comment";
            errorEl.style.display = "block";
            submitBtn.disabled = false;
            return;
          }
          const listEl = requireElement(
            sidebar.querySelector<HTMLElement>(
              "#gl-jira-sidebar-comments-list",
            ),
          );
          const empty = listEl.querySelector<HTMLElement>(
            ".gl-jira-sidebar-comments-empty",
          );
          if (empty) empty.remove();
          // A freshly posted comment is always our own — force the delete button to show
          listEl.insertAdjacentHTML(
            "afterbegin",
            renderJiraComment(resp.comment, resp.comment.authorId),
          );
          const headerEl = sidebar.querySelector<HTMLElement>(
            "#gl-jira-sidebar-comments-header",
          );
          if (headerEl) {
            const m = (headerEl.textContent || "").match(/\((\d+)\)/);
            const newTotal = (m?.[1] ? parseInt(m[1], 10) : 0) + 1;
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
    };

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
    );
    const errorEl = sidebar.querySelector<HTMLElement>(
      "#gl-jira-sidebar-comment-error",
    );
    if (!listEl) return;

    listEl.addEventListener("click", function (e) {
      const btn = eventElement(e.target)?.closest<HTMLButtonElement>(
        ".gl-jira-sidebar-comment-delete",
      );
      if (!btn || btn.disabled) return;
      const commentEl = btn.closest<HTMLElement>(".gl-jira-sidebar-comment");
      const commentId = commentEl?.dataset.commentId;
      if (!commentEl || !commentId) return;

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
        scope.once(function (resp) {
          if (!resp || resp._error !== undefined) {
            btn.disabled = false;
            if (errorEl) {
              errorEl.textContent =
                chrome.i18n.getMessage("jiraSidebarCommentDeleteError") ||
                "Failed to delete comment";
              errorEl.style.display = "block";
            }
            return;
          }
          commentEl.remove();
          const headerEl = sidebar.querySelector<HTMLElement>(
            "#gl-jira-sidebar-comments-header",
          );
          if (headerEl) {
            const m = (headerEl.textContent || "").match(/\((\d+)\)/);
            const newTotal = Math.max(0, (m?.[1] ? parseInt(m[1], 10) : 1) - 1);
            headerEl.textContent =
              (chrome.i18n.getMessage("jiraSidebarComments") || "Comments") +
              " (" +
              newTotal +
              ")";
            if (
              !newTotal &&
              !listEl.querySelector<HTMLElement>(".gl-jira-sidebar-comment")
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
  return {
    fetchAndRenderJiraComments,
    wireJiraCommentForm,
    wireJiraCommentDelete,
  };
}
