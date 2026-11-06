import type { JiraQuickAction, JiraState } from "../../../entities/jira-issue";
import { sendJiraMessage } from "../../../entities/jira-issue/content";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import {
  createChildLifecycle,
  createLifecycle,
} from "../../../shared/lib/lifecycle";
import { createJiraComments } from "./comments";
import { createJiraFieldEditors } from "./field-editors";
import { createJiraSidebarContent } from "./content";
import { createJiraTransitions } from "./transitions";
const CLOSE_ANIMATION_TIMEOUT_MS = 400;

export function createJiraPanel(
  jiraState: JiraState,
  scope: Lifecycle = createLifecycle(),
) {
  let active: Lifecycle | undefined;
  let closeActive = () => {};
  scope.onCleanup(() => {
    document.querySelector(".gl-jira-sidebar")?.remove();
    document.querySelector(".gl-jira-lightbox")?.remove();
  });
  function openJiraSidebar(ticket: string, jiraUrl: string) {
    if (scope.disposed) return;
    const current = document.querySelector<HTMLElement>(".gl-jira-sidebar");
    if (
      current?.dataset.ticket === ticket &&
      !current.classList.contains("gl-jira-sidebar-closing")
    ) {
      closeActive();
      return;
    }
    active?.dispose();
    if (current?.classList.contains("gl-jira-sidebar-closing"))
      current.remove();
    const session = createChildLifecycle(scope);
    active = session;
    const comments = createJiraComments(jiraState, session);
    const renderJiraSidebarContent = createJiraSidebarContent(comments);
    const editors = createJiraFieldEditors(session);
    const { initAssigneeEditor, initFixVersionsEditor } = editors;
    const { loadJiraTransitions } = createJiraTransitions(
      jiraState,
      session,
      renderJiraSidebarContent,
      editors,
    );
    // Remove existing sidebar
    const existing = document.querySelector<HTMLElement>(".gl-jira-sidebar");
    let reuse = false;
    if (existing) {
      // Reuse existing sidebar — just swap content, no animation
      reuse = true;
      existing.dataset.ticket = ticket;
      const ticketLink = existing.querySelector<HTMLAnchorElement>(
        ".gl-jira-sidebar-header .gfm-issue",
      )!;
      if (ticketLink) {
        ticketLink.textContent = ticket;
        ticketLink.href = jiraUrl + "/browse/" + ticket;
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
      session.dispose();
      animateRemoval(sidebar, "gl-jira-sidebar-closing");
      document.querySelector(".gl-jira-lightbox")?.remove();
    }
    closeActive = closeSidebar;
    session.listen(
      sidebar.querySelector<HTMLElement>(".gl-jira-sidebar-close")!,
      "click",
      closeSidebar,
    );

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
    session.listen(document, "keydown", onEsc);

    // Delegate click on images to open lightbox
    session.listen(sidebar, "click", function (e) {
      if (!(e.target instanceof Element)) return;
      const img = e.target.closest<HTMLImageElement>(".gl-jira-sidebar-img");
      if (img) {
        openJiraLightbox(img.src, "image");
        return;
      }
      const media = e.target.closest<HTMLElement>(
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
      session.once(function (resp) {
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
          session.once(function (s: { jiraQuickActions: JiraQuickAction[] }) {
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

  function animateRemoval(el: Element, className: string) {
    const animation = createChildLifecycle(scope);
    animation.onCleanup(() => el.remove());
    animation.listen(el, "animationend", (event) => {
      if (event.target === el) animation.dispose();
    });
    // Also finish when animations are disabled or the node was detached.
    animation.timeout(animation.dispose, CLOSE_ANIMATION_TIMEOUT_MS);
    el.classList.add(className);
  }

  function closeLightbox(el: Element) {
    animateRemoval(el, "gl-jira-lightbox-closing");
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

  // ── End Jira sidebar ────────────────────────────────────────────

  return { openJiraSidebar };
}
