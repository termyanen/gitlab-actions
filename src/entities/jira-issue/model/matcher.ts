import type { JiraState } from "./types";
export function createJiraMatcher(jiraState: JiraState) {
  function setJiraTicketRegex(pattern: string) {
    if (pattern) {
      try {
        jiraState.ticketRegex = new RegExp(pattern, "g");
      } catch {
        /* keep default */
      }
    }
  }
  function parseTickets(title: string) {
    jiraState.ticketRegex.lastIndex = 0;
    const m = title.match(jiraState.ticketRegex);
    return m ? m : [];
  }
  return { setJiraTicketRegex, parseTickets };
}
