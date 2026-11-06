import { errorMessage } from "../../lib/errors";
const READ_TIMEOUT_MS = 20000;
const MUTATION_TIMEOUT_MS = 60000;
export interface ProxyTask {
  gitlabUrl: string;
  _tabId?: number | null;
  _cancelled?: boolean;
}
interface ProxyRequest {
  type: "api-proxy";
  method: string;
  path: string;
  body?: unknown;
}
function sendMessageWithTimeout(
  tabId: number,
  msg: ProxyRequest,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise<unknown>(function (resolve, reject) {
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error("api-proxy tab timeout"));
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, msg).then(
      function (resp: unknown) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(resp);
      },
      function (err: unknown) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
export function api(
  task: ProxyTask,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (task._cancelled) return Promise.reject(new Error("Cancelled by user"));
  const msg: ProxyRequest = {
    type: "api-proxy",
    method: method,
    path: path,
    body: body,
  };
  const isGet = method === "GET";

  // Try tabs one by one — content script only exists on MR pages
  return chrome.tabs
    .query({ url: task.gitlabUrl + "/*" })
    .then(function (tabs) {
      const tabIds = tabs
        .map(function (t) {
          return t.id;
        })
        .filter((id): id is number => id !== undefined);
      if (!tabIds.length)
        throw new Error(
          "No GitLab tab open — keep at least one GitLab tab open.",
        );
      // Prefer the tab that initiated the task — its content script is proven alive.
      // Only if it still matches the GitLab origin (the user may have navigated away).
      const initialTabId = task._tabId;
      const initIdx = initialTabId ? tabIds.indexOf(initialTabId) : -1;
      if (initIdx > 0 && initialTabId !== null && initialTabId !== undefined) {
        tabIds.splice(initIdx, 1);
        tabIds.unshift(initialTabId);
      }

      // Message provably never reached a content script — safe to retry on any method
      function isUndeliveredError(message: string) {
        return (
          message.indexOf("establish connection") !== -1 ||
          message.indexOf("No tab with id") !== -1
        );
      }
      // The content script may have received the message and started the request.
      // Retrying a mutating request (job play/retry) here could execute it twice,
      // so only idempotent GETs move on to the next tab.
      function isAmbiguousError(message: string) {
        return (
          message.indexOf("message port closed") !== -1 ||
          message.indexOf("api-proxy tab timeout") !== -1
        );
      }

      function tryTab(i: number): Promise<unknown> {
        if (task._cancelled) throw new Error("Cancelled by user");
        const tabId = tabIds[i];
        if (tabId === undefined)
          throw new Error(
            "No GitLab tab with content script found. Open any MR page.",
          );
        return sendMessageWithTimeout(
          tabId,
          msg,
          isGet ? READ_TIMEOUT_MS : MUTATION_TIMEOUT_MS,
        )
          .then(function (resp) {
            if (resp && typeof resp === "object" && "_error" in resp)
              throw new Error(String(resp._error));
            return resp;
          })
          .catch(function (err: unknown) {
            const emsg = errorMessage(err);
            if (isUndeliveredError(emsg) || (isGet && isAmbiguousError(emsg))) {
              return tryTab(i + 1);
            }
            throw err;
          });
      }

      return tryTab(0);
    });
}
