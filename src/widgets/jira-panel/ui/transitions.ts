import type {
  JiraIssue,
  JiraQuickAction,
  JiraState,
  JiraTransition,
} from "../../../entities/jira-issue";
import {
  getJiraCategoryClass,
  sendJiraMessage,
} from "../../../entities/jira-issue/content";
import { msg } from "../../../shared/i18n";
import { escHtml } from "../../../shared/lib/html";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import { emptyRecord } from "../../../shared/lib/records";
import { eventElement, requireElement } from "../../../shared/ui/dom";
import type { JiraFieldEditors } from "./field-editors";
export function createJiraTransitions(
  jiraState: JiraState,
  scope: Lifecycle,
  renderJiraSidebarContent: (
    sidebar: HTMLElement,
    data: JiraIssue,
    jiraUrl: string,
  ) => void,
  { initAssigneeEditor, initFixVersionsEditor }: JiraFieldEditors,
) {
  function loadJiraTransitions(
    sidebar: HTMLElement,
    ticket: string,
    jiraUrl: string,
    quickActions: JiraQuickAction[],
  ) {
    const container = sidebar.querySelector<
      HTMLElement & { _jiraTransitionRequest?: object }
    >("#gl-jira-sidebar-transitions");
    if (!container || sidebar.dataset.ticket !== ticket) return;
    container.dataset.busy = "";
    const request = {};
    container._jiraTransitionRequest = request;

    const render = function (transitions: JiraTransition[]) {
      const transitionMap = emptyRecord<JiraTransition>();
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
    };

    // Field-only actions do not depend on transition permissions or availability.
    render([]);
    sendJiraMessage(
      { type: "fetch-jira-transitions", jiraUrl: jiraUrl, ticket: ticket },
      scope.once(function (resp) {
        if (
          sidebar.dataset.ticket !== ticket ||
          sidebar.querySelector<
            HTMLElement & { _jiraTransitionRequest?: object }
          >("#gl-jira-sidebar-transitions") !== container ||
          container.dataset.busy ||
          container._jiraTransitionRequest !== request
        )
          return;
        if (resp && resp._error === undefined) render(resp.transitions || []);
      }),
    );

    // Replace the handler when refreshing; repeated refreshes must not replay edits.
    container.onclick = function (e) {
      if (sidebar.dataset.ticket !== ticket || container.dataset.busy) return;
      const quickBtn = eventElement(e.target)?.closest<HTMLButtonElement>(
        ".gl-jira-sidebar-quick-action",
      );
      if (quickBtn && !quickBtn.disabled) {
        executeQuickAction(sidebar, quickBtn, ticket, jiraUrl, quickActions);
        return;
      }
      const btn = eventElement(e.target)?.closest<HTMLButtonElement>(
        ".gl-jira-sidebar-transition",
      );
      if (!btn || btn.disabled || !btn.dataset.id) return;
      if (!jiraState.skipConfirmations && !confirm(btn.dataset.name + "?"))
        return;
      disableAllTransitionBtns(container);
      btn.style.opacity = "1";
      btn.textContent = "...";
      doTransition(
        sidebar,
        ticket,
        jiraUrl,
        btn.dataset.id,
        btn.dataset.name || "",
        btn.dataset.category || "",
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
    );
    if (!scope.disposed && sidebar.dataset.ticket === ticket && statusBadge) {
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
      function (result) {
        if (result && result.success) {
          updateStatusAfterTransition(sidebar, ticket, statusName, categoryKey);
        }
        if (!scope.disposed && sidebar.dataset.ticket === ticket)
          loadJiraTransitions(sidebar, ticket, jiraUrl, quickActions);
      },
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
    const container = requireElement(
      sidebar.querySelector<HTMLElement & { _jiraTransitionRequest?: object }>(
        "#gl-jira-sidebar-transitions",
      ),
    );
    if (container.dataset.busy) return;
    container.dataset.busy = "true";
    disableAllTransitionBtns(container);
    btn.style.opacity = "1";
    btn.textContent = "...";
    const previousError = sidebar.querySelector<HTMLButtonElement>(
      ".gl-jira-quick-action-error",
    );
    if (previousError) previousError.remove();

    function isCurrent() {
      return (
        sidebar.dataset.ticket === ticket &&
        sidebar.querySelector<
          HTMLElement & { _jiraTransitionRequest?: object }
        >("#gl-jira-sidebar-transitions") === container
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
      function (result) {
        // An accepted mutation can finish after the issue panel closes. Keep
        // entity invalidation independent from the lifetime of its view.
        delete jiraState.cache[ticket];
        if (jiraState.invalidateCommitTicket)
          jiraState.invalidateCommitTicket(ticket);
        if (result && result.completed && result.completed.transition) {
          updateStatusAfterTransition(
            sidebar,
            ticket,
            btn.dataset.statusName || "",
            btn.dataset.statusCategory || "",
          );
        }
        if (scope.disposed || !isCurrent()) return;
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
          scope.once(function (data) {
            if (!isCurrent()) return;
            if (data && data._error === undefined) {
              const draft = sidebar.querySelector<HTMLTextAreaElement>(
                "#gl-jira-sidebar-comment-input",
              );
              const draftText = draft ? draft.value : "";
              renderJiraSidebarContent(sidebar, data, jiraUrl);
              const restoredDraft = sidebar.querySelector<HTMLTextAreaElement>(
                "#gl-jira-sidebar-comment-input",
              );
              if (restoredDraft) restoredDraft.value = draftText;
              const submitDraft = sidebar.querySelector<HTMLButtonElement>(
                "#gl-jira-sidebar-comment-submit",
              );
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
              requireElement(
                sidebar.querySelector<
                  HTMLElement & { _jiraTransitionRequest?: object }
                >("#gl-jira-sidebar-transitions"),
              ).after(notice);
            }
          }),
        );
      },
    );
  }
  return { loadJiraTransitions };
}
