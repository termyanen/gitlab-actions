import type { SessionApi } from "../../../shared/api/gitlab";
import { SEL } from "../../../shared/config/gitlab";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab-api";
import { q, qAll } from "../../../shared/lib/dom";
import { reportError } from "../../../shared/lib/errors";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import {
  arrayOf,
  decoder,
  isBoolean,
  isString,
  objectOf,
  optional,
} from "../../../shared/lib/validation";
import type {
  Approval,
  ListSettings,
  MrData,
  MrEntry,
  MrMeta,
} from "../model/types";
import { createMetadataBadges } from "./metadata-badges";
import { isMrListPage, parseMrPath } from "./route";
const readMrData = decoder(
  objectOf<MrData>({
    additions: optional(isString),
    deletions: optional(isString),
    changes_count: optional(isString),
    has_conflicts: optional(isBoolean),
    source_branch: optional(isString),
    target_branch: optional(isString),
  }),
  "GitLab/Jira response",
);
const readApprovals = decoder(
  objectOf<{ approved_by: Approval[] }>({
    approved_by: arrayOf(
      objectOf<Approval>({
        user: optional(
          objectOf<NonNullable<Approval["user"]>>({
            username: optional(isString),
            name: optional(isString),
          }),
        ),
        username: optional(isString),
        name: optional(isString),
      }),
    ),
  }),
  "GitLab/Jira response",
);
const readDiscussionStates = decoder(
  arrayOf(
    objectOf<
      { notes: { resolvable?: boolean; resolved?: boolean }[] }[][number]
    >({
      notes: arrayOf(
        objectOf<{ resolvable?: boolean; resolved?: boolean }>({
          resolvable: optional(isBoolean),
          resolved: optional(isBoolean),
        }),
      ),
    }),
  ),
  "GitLab/Jira response",
);
export function createMrMetadata(api: SessionApi, scope: Lifecycle) {
  // =========================================================================
  // Unresolved threads count (#26) + MR size labels (#27)
  // =========================================================================

  const _mrMetaCache: Record<string, MrMeta> = {};
  // { href: { threads, changes, ts } }
  const MR_META_CACHE_TTL = 5 * 60 * 1000;

  let _mrMetaFetching = false;

  let _mrMetaRefreshPending = false;
  const {
    renderThreadsBadge,
    renderSizeBadge,
    renderConflictBadge,
    renderApprovalIndicator,
    renderBranchBadge,
  } = createMetadataBadges(scope);

  function fetchAndRenderMrMeta(
    settings: ListSettings,
    username: string | null,
  ) {
    const {
      show_threads_badge: showThreads,
      show_size_badge: showSize,
      show_conflicts_badge: showConflicts,
      show_approval_badge: showApprovals,
      show_branches: showBranches,
      show_branches_links: showBranchesLinks,
    } = settings;
    if (_mrMetaFetching) {
      _mrMetaRefreshPending = true;
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
      const cached = _mrMetaCache[href];
      if (cached && now - cached.ts < MR_META_CACHE_TTL) {
        if (showThreads)
          renderThreadsBadge(item, cached.threads, cached.threadsPartial);
        if (showSize)
          renderSizeBadge(
            item,
            cached.changesLines,
            cached.changesFiles,
            settings,
            cached.changesFilesTruncated,
          );
        if (showConflicts && cached.conflicts) renderConflictBadge(item);
        if (showApprovals && cached.approvedBy)
          renderApprovalIndicator(item, cached.approvedBy, username);
        if (showBranches)
          renderBranchBadge(
            item,
            cached.sourceBranch,
            cached.targetBranch,
            showBranchesLinks,
          );
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
    _mrMetaFetching = true;

    // Show branch skeleton loaders for items about to be fetched
    if (showBranches) {
      toFetch.forEach(function (entry) {
        if (
          entry.item.querySelector(
            ".gl-mr-ext-branch-badge, .gl-mr-ext-branch-loader",
          )
        )
          return;
        const infoRow = q(entry.item, SEL.issuableInfo);
        if (!infoRow) return;
        const loader = document.createElement("div");
        loader.className = "gl-mr-ext-branch-loader";
        const s1 = document.createElement("span");
        s1.className = "gl-jira-loader";
        s1.style.width = "100px";
        const arrow = document.createElement("span");
        arrow.className = "gl-mr-ext-branch-arrow";
        arrow.innerHTML = "&#x2192;";
        const s2 = document.createElement("span");
        s2.className = "gl-jira-loader";
        s2.style.width = "60px";
        loader.appendChild(s1);
        loader.appendChild(arrow);
        loader.appendChild(s2);
        infoRow.parentNode?.insertBefore(loader, infoRow.nextSibling);
      });
    }

    const BATCH_SIZE = 5;

    function fetchOneEntry(entry: MrEntry) {
      const encodedPath = encodeURIComponent(entry.projectPath);
      const mrPromise = api(
        "GET",
        "/projects/" +
          encodedPath +
          "/merge_requests/" +
          entry.iid +
          "?include_rebase_in_progress=false",
      ).then(readMrData);
      const approvalsPromise = showApprovals
        ? api(
            "GET",
            "/projects/" +
              encodedPath +
              "/merge_requests/" +
              entry.iid +
              "/approvals",
          )
            .then(readApprovals)
            .catch(function () {
              return null;
            })
        : Promise.resolve(null);
      const threadsPromise = showThreads
        ? api(
            "GET",
            "/projects/" +
              encodedPath +
              "/merge_requests/" +
              entry.iid +
              "/discussions?per_page=" +
              GITLAB_PAGE_SIZE,
          )
            .then(readDiscussionStates)
            .catch(function () {
              return null;
            })
        : Promise.resolve(null);

      return Promise.all([mrPromise, approvalsPromise, threadsPromise])
        .then(function (results) {
          const mr = results[0];
          const approvalsData = results[1];
          const discussions = results[2];

          const changesLines =
            mr.additions !== undefined && mr.deletions !== undefined
              ? (parseInt(mr.additions) || 0) + (parseInt(mr.deletions) || 0)
              : 0;
          const changesFiles = mr.changes_count
            ? parseInt(mr.changes_count)
            : 0;
          const conflicts = !!mr.has_conflicts;
          const approvedBy = approvalsData
            ? approvalsData.approved_by || []
            : [];
          let unresolvedCount = 0;
          if (discussions) {
            (discussions || []).forEach(function (d) {
              if (
                d.notes &&
                d.notes[0] &&
                d.notes[0].resolvable &&
                !d.notes[0].resolved
              ) {
                unresolvedCount++;
              }
            });
          }
          return {
            threads: unresolvedCount,
            threadsPartial:
              showThreads &&
              (discussions === null || discussions.length >= GITLAB_PAGE_SIZE),
            changesLines: changesLines,
            changesFiles: changesFiles,
            changesFilesTruncated: !!mr.changes_count?.endsWith("+"),
            conflicts: conflicts,
            approvedBy: approvedBy,
            sourceBranch: mr.source_branch || "",
            targetBranch: mr.target_branch || "",
          };
        })
        .then(function (meta) {
          _mrMetaCache[entry.href] = { ...meta, ts: Date.now() };
          if (showThreads)
            renderThreadsBadge(entry.item, meta.threads, meta.threadsPartial);
          if (showSize)
            renderSizeBadge(
              entry.item,
              meta.changesLines,
              meta.changesFiles,
              settings,
              meta.changesFilesTruncated,
            );
          if (showConflicts && meta.conflicts) renderConflictBadge(entry.item);
          if (showApprovals && meta.approvedBy)
            renderApprovalIndicator(entry.item, meta.approvedBy, username);
          if (showBranches)
            renderBranchBadge(
              entry.item,
              meta.sourceBranch,
              meta.targetBranch,
              showBranchesLinks,
            );
        })
        .catch(function () {});
    }

    function fetchBatch(start: number) {
      if (start >= toFetch.length) {
        _mrMetaFetching = false;
        if (_mrMetaRefreshPending) {
          _mrMetaRefreshPending = false;
          if (isMrListPage()) fetchAndRenderMrMeta(settings, username);
        }
        return;
      }
      const batch = toFetch.slice(start, start + BATCH_SIZE);
      Promise.all(batch.map(fetchOneEntry))
        .then(function () {
          fetchBatch(start + BATCH_SIZE);
        })
        .catch(reportError);
    }

    fetchBatch(0);
  }
  return { fetchAndRenderMrMeta };
}
