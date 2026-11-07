import { readJiraBaseUrl } from "../../../features/manage-settings";

/** Listeners belong to the form nodes; late replies ignore removed forms. */
export function bindJiraAccess(
  input: HTMLInputElement,
  button: HTMLButtonElement,
  status: HTMLElement,
  t: (key: string) => string,
) {
  let revision = 0;
  let requesting = false;
  function current(value: string, requestRevision: number) {
    return (
      input.isConnected && input.value === value && requestRevision === revision
    );
  }
  function show(key: string) {
    status.textContent = key ? t(key) : "";
  }
  function check() {
    const requestRevision = ++revision;
    const value = input.value;
    const jira = readJiraBaseUrl(value);
    button.disabled = requesting;
    if (!value.trim()) {
      show("");
      return;
    }
    if (!jira) {
      show("jiraUrlInvalid");
      return;
    }
    show("");
    chrome.permissions.contains(
      { origins: [jira.origin + "/*"] },
      (granted) => {
        const failed = !!chrome.runtime.lastError;
        if (current(value, requestRevision))
          show(
            !failed && granted ? "jiraAccessGranted" : "jiraErrorPermission",
          );
      },
    );
  }
  input.addEventListener("input", check);
  input.addEventListener("focus", check);
  button.addEventListener("click", () => {
    if (requesting) return;
    const value = input.value;
    const jira = readJiraBaseUrl(value);
    const requestRevision = ++revision;
    if (!jira) {
      show("jiraUrlInvalid");
      return;
    }
    requesting = true;
    button.disabled = true;
    show("");
    // Keep the request synchronous with the click, including an unchanged URL.
    chrome.permissions.request({ origins: [jira.origin + "/*"] }, (granted) => {
      const failed = !!chrome.runtime.lastError;
      requesting = false;
      if (!input.isConnected) return;
      button.disabled = false;
      if (current(value, requestRevision))
        show(!failed && granted ? "jiraAccessGranted" : "jiraErrorPermission");
      else check();
    });
  });
  // The page may be reopened after Chrome site access has been revoked.
  if (input.isConnected) check();
}
