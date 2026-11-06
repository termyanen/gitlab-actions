import type { SessionApi } from "../../../shared/api/gitlab";
import { SEL } from "../../../shared/config/gitlab";
import { msg } from "../../../shared/i18n";
import { q, qAll, qUp } from "../../../shared/lib/dom";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import type { MrEntry } from "../model/types";
import { isMrListPage, parseMrPath } from "./route";
export function createReviewerBadges(api: SessionApi, scope: Lifecycle) {
  const _reviewerCache: Record<string, { isReviewer: boolean; ts: number }> =
    {};
  // { mrUrl: { isReviewer: bool, ts: number } }
  const REVIEWER_CACHE_TTL = 5 * 60 * 1000;

  let _reviewerFetching = false;

  let _reviewerRefreshPending = false;

  function fetchMrNotes(projectPath: string, iid: string) {
    const encodedProject = encodeURIComponent(projectPath);
    return api<{ body: string }[]>(
      "GET",
      "/projects/" +
        encodedProject +
        "/merge_requests/" +
        iid +
        "/notes?per_page=10&sort=asc",
    );
  }

  function checkReviewerInNotes(notes: { body: string }[], username: string) {
    for (let i = 0; i < notes.length; i++) {
      const body = notes[i].body || "";
      if (/reviewers?\s*:/i.test(body) && body.indexOf("@" + username) !== -1) {
        return true;
      }
    }
    return false;
  }

  function renderReviewerBadge(mrItem: HTMLElement, isReviewer: boolean) {
    if (scope.disposed) return;
    if (mrItem.querySelector(".gl-reviewer-badge")) return;
    if (!isReviewer) return;

    const titleEl = q<HTMLAnchorElement>(mrItem, SEL.titleLink);
    if (!titleEl) return;
    const titleContainer =
      qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;

    const badge = document.createElement("span");
    badge.className = "gl-reviewer-badge";
    badge.textContent = msg("badgeYourReview");
    badge.title = msg("badgeYourReviewHint");
    titleContainer.appendChild(badge);
  }

  function fetchAndRenderReviewerBadges(username: string) {
    if (_reviewerFetching) {
      _reviewerRefreshPending = true;
      return;
    }

    const mrItems = qAll(document, SEL.mrItem);
    if (!mrItems.length) return;

    const toFetch: MrEntry[] = [];
    const now = Date.now();

    mrItems.forEach(function (item) {
      const titleEl = q<HTMLAnchorElement>(item, SEL.titleLink);
      if (!titleEl) return;
      const href = titleEl.href;
      const cached = _reviewerCache[href];
      if (cached && now - cached.ts < REVIEWER_CACHE_TTL) {
        renderReviewerBadge(item, cached.isReviewer);
        return;
      }
      const parsed = parseMrPath(href);
      if (parsed) {
        toFetch.push({
          item: item,
          href: href,
          projectPath: parsed.projectPath,
          iid: parsed.iid,
        });
      }
    });

    if (!toFetch.length) return;

    // Show loaders
    toFetch.forEach(function (entry) {
      if (entry.item.querySelector(".gl-reviewer-badge, .gl-reviewer-loader"))
        return;
      const titleEl = q<HTMLAnchorElement>(entry.item, SEL.titleLink);
      if (!titleEl) return;
      const titleContainer =
        qUp(titleEl, SEL.titleWrap) || titleEl.parentElement!;
      const loader = document.createElement("span");
      loader.className = "gl-reviewer-loader gl-jira-loader";
      titleContainer.appendChild(loader);
    });

    _reviewerFetching = true;

    function fetchOne(i: number) {
      if (i >= toFetch.length) {
        _reviewerFetching = false;
        const loaders = document.querySelectorAll(".gl-reviewer-loader");
        loaders.forEach(function (el) {
          el.remove();
        });
        if (_reviewerRefreshPending) {
          _reviewerRefreshPending = false;
          if (isMrListPage()) fetchAndRenderReviewerBadges(username);
        }
        return;
      }
      const entry = toFetch[i];
      fetchMrNotes(entry.projectPath, entry.iid)
        .then(function (notes) {
          const isReviewer = checkReviewerInNotes(notes || [], username);
          _reviewerCache[entry.href] = {
            isReviewer: isReviewer,
            ts: Date.now(),
          };
          renderReviewerBadge(entry.item, isReviewer);
        })
        .catch(function () {})
        .then(function () {
          fetchOne(i + 1);
        });
    }

    fetchOne(0);
  }
  return { fetchAndRenderReviewerBadges };
}
