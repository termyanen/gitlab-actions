import { msg } from "../../../shared/i18n";
import type { Command, MrCommands, SidebarLink } from "../model/types";
export function createPaletteCommands(
  openStandupModal: () => void,
  _standupEnabled: boolean,
  mrCommands: MrCommands,
) {
  function getProjectPath() {
    // Try /-/ pattern first (most GitLab pages)
    const m = window.location.pathname.match(/^\/([^/]+(?:\/[^/]+)*?)\/-\//);
    if (m) return m[1];
    // Fallback: detect from GitLab sidebar or body data
    const projectLink = document.querySelector(
      '[data-testid="sidebar-menu-link"][href*="/-/"]',
    );
    if (projectLink) {
      const hm = (projectLink.getAttribute("href") || "").match(
        /^\/([^/]+(?:\/[^/]+)*?)\/-\//,
      );
      if (hm) return hm[1];
    }
    // Fallback: body data-project-full-path
    const body = document.body;
    if (body && body.dataset.projectFullPath)
      return body.dataset.projectFullPath;
    // Fallback: breadcrumbs / header meta
    const breadcrumb = document.querySelector(
      '[data-testid="breadcrumb-links"] a[href*="/-/"], .breadcrumbs-list a[href*="/-/"]',
    );
    if (breadcrumb) {
      const bm = (breadcrumb.getAttribute("href") || "").match(
        /^\/([^/]+(?:\/[^/]+)*?)\/-\//,
      );
      if (bm) return bm[1];
    }
    // Last resort: 2-segment path like /namespace/project
    const pm = window.location.pathname.match(/^\/([^/]+\/[^/]+)\/?$/);
    if (pm) return pm[1];
    return "";
  }

  function parseSidebarLink(a: Element) {
    const href = a.getAttribute("href");
    if (!href) return null;
    const clone = a.cloneNode(true) as Element;
    // Remove badges, counts, avatars
    const junk = clone.querySelectorAll(
      '[class*="badge"], [class*="count"], .badge, .count, span[aria-label], [class*="avatar"], img, .gl-avatar',
    );
    junk.forEach(function (b) {
      b.remove();
    });
    const text = (clone.textContent || "").trim();
    if (!text) return null;
    // Find parent section name by walking up the DOM
    let section = "";
    let el = a.parentElement;
    while (
      el &&
      !el.matches(
        '[data-testid="super-sidebar"], .sidebar-top-level-items, body',
      )
    ) {
      // Super Sidebar: sections are li/div with a direct child <button> (expander)
      const sBtn = el.querySelector(":scope > button");
      if (sBtn && sBtn !== a) {
        const sClone = sBtn.cloneNode(true) as Element;
        const sJunk = sClone.querySelectorAll(
          '[class*="badge"], [class*="count"], [class*="avatar"], img, svg, .gl-avatar',
        );
        sJunk.forEach(function (b) {
          b.remove();
        });
        const sTxt = (sClone.textContent || "").trim();
        if (sTxt && sTxt !== text) {
          section = sTxt;
          break;
        }
      }
      // Old sidebar: top-level li > a is section header
      const sLink = el.querySelector(":scope > a");
      if (
        sLink &&
        sLink !== a &&
        el.querySelector(".sidebar-sub-level-items")
      ) {
        const lClone = sLink.cloneNode(true) as Element;
        const lJunk = lClone.querySelectorAll(
          '[class*="badge"], [class*="count"], [class*="avatar"], img, svg',
        );
        lJunk.forEach(function (b) {
          b.remove();
        });
        const lTxt = (lClone.textContent || "").trim();
        if (lTxt && lTxt !== text) {
          section = lTxt;
          break;
        }
      }
      el = el.parentElement;
    }
    const label = section && section !== text ? section + " - " + text : text;
    return { label: label, href: href };
  }

  function getSidebarLinks() {
    const pinned: SidebarLink[] = [];
    const nav: SidebarLink[] = [];
    const seenHrefs: Record<string, boolean> = {};

    // Pinned items
    const pinEls = document.querySelectorAll(
      '[data-testid="pinned-nav-items"] a[href]',
    );
    pinEls.forEach(function (a) {
      const item = parseSidebarLink(a);
      if (item) {
        pinned.push(item);
        seenHrefs[item.href.split("?")[0]] = true;
      }
    });

    // All other sidebar links (skip pinned duplicates)
    const navEls = document.querySelectorAll(
      '[data-testid="super-sidebar"] nav a[href], [data-testid="super-sidebar"] [data-testid="nav-item"] a[href], .sidebar-top-level-items > li > a[href], .sidebar-sub-level-items a[href]',
    );
    navEls.forEach(function (a) {
      const item = parseSidebarLink(a);
      if (!item) return;
      const cleanHref = item.href.split("?")[0];
      if (seenHrefs[cleanHref]) return;
      seenHrefs[cleanHref] = true;
      nav.push(item);
    });

    return { pinned: pinned, nav: nav };
  }

  function isCurrentPath(path: string) {
    const current = window.location.pathname.replace(/\/$/, "");
    const target = path.replace(/\/$/, "");
    return current === target;
  }

  function buildCommands() {
    const cmds: Command[] = [];
    const projectPath = getProjectPath();
    const currentPath = window.location.pathname;
    const isMrDetail = /\/-\/merge_requests\/\d+/.test(currentPath);

    // Read all sidebar links
    const sidebar = getSidebarLinks();
    const hasSidebar = sidebar.pinned.length > 0 || sidebar.nav.length > 0;

    // Pinned items first
    sidebar.pinned.forEach(function (pin, i) {
      const pinPath = pin.href.split("?")[0];
      if (!isCurrentPath(pinPath)) {
        cmds.push({
          id: "pin-" + i,
          label: pin.label,
          group: msg("cmdGroupPinned"),
          icon: "pin",
          action: function () {
            window.location.href = pin.href;
          },
        });
      }
    });

    // All other sidebar navigation
    sidebar.nav.forEach(function (item, i) {
      const itemPath = item.href.split("?")[0];
      if (!isCurrentPath(itemPath)) {
        cmds.push({
          id: "nav-" + i,
          label: item.label,
          group: msg("cmdGroupNav"),
          icon: "nav",
          action: function () {
            window.location.href = item.href;
          },
        });
      }
    });

    // Fallback navigation if sidebar not found (old GitLab versions)
    if (!hasSidebar && projectPath) {
      const fallbackNav = [
        { label: msg("cmdNavRepo"), path: "/" + projectPath },
        {
          label: msg("cmdNavMrs"),
          path: "/" + projectPath + "/-/merge_requests",
        },
        {
          label: msg("cmdNavIssues"),
          path: "/" + projectPath + "/-/issues",
        },
        {
          label: msg("cmdNavPipelines"),
          path: "/" + projectPath + "/-/pipelines",
        },
        {
          label: msg("cmdNavBranches"),
          path: "/" + projectPath + "/-/branches",
        },
        { label: msg("cmdNavTags"), path: "/" + projectPath + "/-/tags" },
        {
          label: msg("cmdNavCommits"),
          path: "/" + projectPath + "/-/commits",
        },
        {
          label: msg("cmdNavWiki"),
          path: "/" + projectPath + "/-/wikis",
        },
        {
          label: msg("cmdNavSnippets"),
          path: "/" + projectPath + "/-/snippets",
        },
        {
          label: msg("cmdNavSettings"),
          path: "/" + projectPath + "/-/settings",
        },
      ];
      fallbackNav.forEach(function (item, i) {
        if (!isCurrentPath(item.path)) {
          cmds.push({
            id: "nav-" + i,
            label: item.label,
            group: msg("cmdGroupNav"),
            icon: "nav",
            action: function () {
              window.location.href = item.path;
            },
          });
        }
      });
    }

    // Copy project path
    if (projectPath) {
      cmds.push({
        id: "copy-path",
        label: msg("cmdCopyPath"),
        hint: projectPath,
        group: msg("cmdGroupNav"),
        icon: "copy",
        action: function () {
          navigator.clipboard.writeText(projectPath);
        },
      });
    }

    // MR actions (only on MR detail page — read available actions from content.js)
    if (isMrDetail && mrCommands.actions().length) {
      mrCommands.actions().forEach(function (a) {
        cmds.push({
          id: a.id,
          label: a.label,
          group: msg("cmdGroupMr"),
          icon: a.icon || "action",
          action: function () {
            mrCommands.run(a.id);
          },
        });
      });
    }

    // Extension commands
    cmds.push({
      id: "ext-settings",
      label: msg("cmdExtSettings"),
      group: msg("cmdGroupExt"),
      icon: "settings",
      action: function () {
        chrome.runtime.sendMessage({ type: "open-options" });
      },
    });

    // Standup
    if (_standupEnabled) {
      cmds.push({
        id: "ext-standup",
        label: msg("cmdExtStandup"),
        group: msg("cmdGroupExt"),
        icon: "standup",
        action: function () {
          openStandupModal();
        },
      });
    }

    return cmds;
  }
  return { buildCommands, getProjectPath };
}
