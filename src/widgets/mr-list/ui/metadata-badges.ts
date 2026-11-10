import type { DisplayPreferences } from "../../../entities/settings";
import {
  DISPLAY_DEFAULTS,
  parseSizeThresholds,
} from "../../../entities/settings";
import { SEL } from "../../../shared/config/gitlab";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab-api";
import { msg } from "../../../shared/i18n";
import { insertAfterSafe, q, qUp } from "../../../shared/lib/dom";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import type { Approval } from "../model/types";

export function createMetadataBadges(scope: Lifecycle) {
  // GitLab replaces rows without changing the route (pagination/filtering).
  // Weak keys allow those detached rows to be collected before route disposal.
  const originals = new WeakMap<
    HTMLElement,
    {
      title: string | null;
      text: string;
      enhancedText: string;
      names: string;
    }
  >();
  scope.onCleanup(() => {
    document
      .querySelectorAll<HTMLElement>(".gl-mr-ext-approval-done")
      .forEach((badge) => {
        const original = originals.get(badge);
        if (!original) return;
        badge.classList.remove("gl-mr-ext-approval-done");
        if (badge.title === original.names) {
          if (original.title === null) badge.removeAttribute("title");
          else badge.setAttribute("title", original.title);
        }
        const content = badge.querySelector(".gl-badge-content");
        if (content?.textContent === original.enhancedText)
          content.textContent = original.text;
      });
    document
      .querySelectorAll(".gl-mr-ext-approval-item")
      .forEach((item) => item.remove());
  });
  function renderThreadsBadge(
    mrItem: HTMLElement,
    count: number,
    partial: boolean,
  ) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-threads-badge")) return;
    if (count === 0 && !partial) return;

    const controlsUl = q(mrItem, SEL.controls);
    if (!controlsUl) return;

    const li = document.createElement("li");
    li.className = "gl-mr-ext-threads-badge";
    li.title = partial
      ? msg("threadsIncompleteHint", [count, GITLAB_PAGE_SIZE])
      : msg("threadsCountHint", [count]);
    li.innerHTML =
      '<svg viewBox="0 0 16 16" class="s16"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2.75 1.75h10.5c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1H8.56l-3.4 3.4a.25.25 0 0 1-.43-.18V10.75H2.75c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1Z"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="7.5" x2="9" y2="7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' +
      "<span>" +
      (partial ? (count ? count + "+" : "?") : count) +
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
    settings: DisplayPreferences,
    filesTruncated: boolean,
  ) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-size-badge")) return;
    const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
    if (!titleEl) return;
    const titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentElement;
    if (!titleContainer) return;

    const key = changesLines > 0 ? "mr_size_lines" : "mr_size_files";
    const thresholds =
      parseSizeThresholds(settings[key]) ||
      parseSizeThresholds(DISPLAY_DEFAULTS[key]);
    if (!thresholds) return;
    const size = changesLines > 0 ? changesLines : changesFiles;
    const index = thresholds.findIndex((limit) => size <= limit);
    const label = index < 0 ? "XL" : ["S", "M", "L"][index] || "XL";
    const cls = "size-" + label.toLowerCase();
    const fileCount = String(changesFiles) + (filesTruncated ? "+" : "");
    const tooltip =
      changesLines > 0
        ? msg("mrSizeLinesTooltip", [changesLines, fileCount])
        : msg("mrSizeFilesTooltip", [fileCount]);

    const badge = document.createElement("span");
    badge.className = "gl-mr-ext-size-badge " + cls;
    badge.textContent =
      label + (filesTruncated && changesLines <= 0 && index >= 0 ? "+" : "");
    badge.title = tooltip;
    // Always insert right after the title link, before Jira badges
    insertAfterSafe(titleContainer, badge, titleEl);
  }

  function renderConflictBadge(mrItem: HTMLElement) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-mr-ext-conflict-badge")) return;
    const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
    if (!titleEl) return;
    const titleContainer = qUp(titleEl, SEL.titleWrap) || titleEl.parentElement;
    if (!titleContainer) return;
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
    infoRow.parentNode?.insertBefore(wrap, infoRow.nextSibling);
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
    for (const u of approvedBy) {
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
      for (const currentBadge of badges) {
        const txt = (currentBadge.textContent || "").trim();
        if (
          txt.indexOf("Approved") !== -1 ||
          txt.indexOf("approved") !== -1 ||
          txt.indexOf("approval") !== -1
        ) {
          nativeBadge = currentBadge;
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
      originals.set(nativeBadge, {
        title: originalTitle,
        text: originalText,
        enhancedText,
        names,
      });
      return;
    }

    // Fallback: create our own badge in GitLab native style
    const controlsUl = q(mrItem, SEL.controls);
    if (!controlsUl) return;

    const li = document.createElement("li");
    li.className = "gl-mr-ext-approval-item";
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
  }
  return {
    renderThreadsBadge,
    renderSizeBadge,
    renderConflictBadge,
    renderBranchBadge,
    renderApprovalIndicator,
  };
}
