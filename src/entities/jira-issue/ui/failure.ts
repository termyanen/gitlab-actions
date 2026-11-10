import { msg } from "../../../shared/i18n";
import type { Lifecycle } from "../../../shared/lib/lifecycle";
import type { JiraFailure } from "../model/failure";

export function jiraFailureMessage(
  failure: JiraFailure,
  translate: (key: string) => string = msg,
): string {
  const status =
    failure._httpStatus || Number(failure._error.match(/^(\d{3})\b/)?.[1]);
  const kind =
    failure._errorKind ||
    (status === 401 ? "auth" : status === 403 ? "forbidden" : "unknown");
  switch (kind) {
    case "auth":
      return translate("jiraErrorAuth");
    case "forbidden":
      return translate("jiraErrorForbidden");
    case "permission":
      return translate("jiraErrorPermission");
    case "network":
      return translate("jiraErrorNetwork");
    case "unavailable":
      return translate("jiraErrorUnavailable");
    case "not-found":
      return translate("jiraErrorNotFound");
    case "invalid-response":
      return translate("jiraErrorResponse");
    case "unknown":
      return translate("jiraErrorUnknown");
  }
}

/** The optional retry callback must only repeat a read, never a mutation. */
export function renderJiraFailure(
  failure: JiraFailure,
  jiraUrl: string,
  retry?: () => void,
): HTMLDivElement {
  const notice = document.createElement("div");
  notice.className = "gl-alert gl-alert-danger gl-jira-error-notice";
  notice.setAttribute("role", "alert");
  const text = document.createElement("p");
  text.textContent = jiraFailureMessage(failure);
  notice.appendChild(text);
  // Validation/conflict responses can name an instance-specific required field.
  // The worker extracts short JSON error messages; render them only as text.
  if (
    failure._errorKind === "unknown" &&
    failure._httpStatus !== undefined &&
    failure._httpStatus >= 400 &&
    failure._httpStatus < 500
  ) {
    const detail = document.createElement("p");
    detail.textContent = failure._error;
    notice.appendChild(detail);
  }
  const actions = document.createElement("div");
  actions.className = "gl-jira-error-actions";
  try {
    const url = new URL(jiraUrl);
    if (url.protocol === "https:" && !url.username && !url.password) {
      const link = document.createElement("a");
      link.className = "gl-button btn btn-default btn-sm";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = msg("jiraOpenSite");
      actions.appendChild(link);
    }
  } catch {
    /* Invalid settings must not create an unsafe link. */
  }
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gl-button btn btn-default btn-sm";
    button.textContent = msg("jiraRetryRead");
    button.addEventListener("click", () => {
      button.disabled = true;
      retry();
    });
    actions.appendChild(button);
  }
  notice.appendChild(actions);
  return notice;
}

export function renderJiraMutationFailure(
  failure: JiraFailure,
  jiraUrl: string,
): HTMLDivElement {
  const notice = renderJiraFailure(failure, jiraUrl);
  if (
    failure._errorKind === "network" ||
    failure._errorKind === "invalid-response"
  ) {
    const warning = document.createElement("p");
    warning.textContent = msg("jiraErrorWriteUncertain");
    notice.appendChild(warning);
  }
  return notice;
}

/** One passive integration notice per owner; route disposal releases its controls. */
export function createJiraFailureNotice(scope: Lifecycle, retry: () => void) {
  let notice: HTMLDivElement | undefined;
  let currentKey = "";
  let dismissedKey = "";
  function clear() {
    notice?.remove();
    notice = undefined;
    currentKey = "";
    dismissedKey = "";
  }
  scope.onCleanup(clear);
  return {
    clear,
    show(failure: JiraFailure, jiraUrl: string) {
      if (scope.disposed) return;
      const key = jiraUrl + "|" + jiraFailureMessage(failure);
      if (dismissedKey === key || (notice?.isConnected && currentKey === key))
        return;
      clear();
      currentKey = key;
      notice = renderJiraFailure(failure, jiraUrl, () => {
        clear();
        retry();
      });
      notice.classList.add("gl-jira-connection-notice");
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "gl-button btn btn-default btn-sm";
      dismiss.textContent = msg("jiraDismissError");
      dismiss.addEventListener("click", () => {
        dismissedKey = currentKey;
        notice?.remove();
        notice = undefined;
      });
      notice.appendChild(dismiss);
      document.body.appendChild(notice);
    },
  };
}
