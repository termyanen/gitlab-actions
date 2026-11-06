import type { JiraIssue } from "../../../entities/jira-issue";
import {
  getJiraCategoryClass,
  getPriorityHtml,
} from "../../../entities/jira-issue/content";
import { escHtml } from "../../../shared/lib/html";
import type { createJiraComments } from "./comments";
import { formatJiraDate, formatJiraWikiText } from "./format";

export function createJiraSidebarContent(
  comments: ReturnType<typeof createJiraComments>,
) {
  const {
    fetchAndRenderJiraComments,
    wireJiraCommentForm,
    wireJiraCommentDelete,
  } = comments;
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
  return renderJiraSidebarContent;
}
