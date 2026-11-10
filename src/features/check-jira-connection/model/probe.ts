import { readJiraBaseUrl } from "../../../shared/config/jira";

// Slightly longer than the worker's bounded read, including worker startup.
export const CONNECTION_REPLY_TIMEOUT_MS = 20_000;
export interface ConnectionResult {
  key: string;
  ok: boolean;
  auth: boolean;
}

/** Read-only, user-triggered probe. Release its view even if the worker stalls. */
export function probeConnection(
  url: string,
  receive: (result: ConnectionResult) => void,
) {
  let listener: typeof receive | undefined = receive;
  const cancel = () => {
    listener = undefined;
    clearTimeout(timeout);
  };
  const finish = (result: ConnectionResult) => {
    const callback = listener;
    cancel();
    callback?.(result);
  };
  const fail = () =>
    finish({ key: "jiraErrorNetwork", ok: false, auth: false });
  const timeout = setTimeout(fail, CONNECTION_REPLY_TIMEOUT_MS);
  const site = readJiraBaseUrl(url);
  if (!site) {
    finish({ key: "jiraUrlInvalid", ok: false, auth: false });
    return cancel;
  }
  // The response decoders are needed only when the user requests diagnostics.
  import("../../../entities/jira-issue/content")
    .then(({ sendJiraMessage, jiraResponseFailure, jiraFailureMessage }) => {
      if (!listener) return;
      sendJiraMessage(
        { type: "fetch-jira-myself", jiraUrl: site.url },
        (reply) => {
          const failure = jiraResponseFailure(reply);
          if (failure) {
            finish({
              key:
                failure._errorKind === "not-found"
                  ? "jiraErrorResponse"
                  : jiraFailureMessage(failure, (key) => key),
              ok: false,
              auth:
                failure._errorKind === "auth" || failure._httpStatus === 401,
            });
          } else {
            const ok = typeof reply.id === "string" && !!reply.id.trim();
            finish({
              key: ok ? "jiraConnectionConnected" : "jiraErrorResponse",
              ok,
              auth: false,
            });
          }
        },
      );
    })
    .catch(fail);
  return cancel;
}
