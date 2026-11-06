import type { JiraState } from "./types";
export function createJiraState(): JiraState {
  return {
    invalidateCommitTicket: null,
    cache: {},
    fetching: false,
    refreshPending: false,
    url: "",
    authFailed: false,
    skipConfirmations: false,
    ticketRegex: /[A-Z][A-Z0-9]+-\d+/g,
    myselfCache: {},
    showDetails: false,
  };
}
