import { GITLAB_API_PREFIX } from "../../config/gitlab-api";
import { isRecord } from "../../lib/validation";
export interface ApiError extends Error {
  httpStatus?: number;
  errorCode?: string;
}
export type SessionApi = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<unknown>;
export function createSessionApi(
  origin: () => string,
  signal?: AbortSignal,
): SessionApi {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  // GitLab API helper — uses session cookies + CSRF token, no personal token needed
  function api(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = origin() + GITLAB_API_PREFIX + path;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (method !== "GET") {
      headers["X-CSRF-Token"] = getCsrfToken();
    }
    const opts: RequestInit = {
      method: method,
      headers: headers,
      credentials: "same-origin",
      ...(method === "GET" && signal ? { signal } : {}),
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
      if (r.status === 204) return {};
      return r.text().then(function (text) {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        if (!r.ok) {
          let msg =
            (isRecord(data) && (data.message || data.error)) ||
            r.status + " " + r.statusText;
          if (typeof msg === "object") msg = JSON.stringify(msg);
          const err: ApiError = new Error(String(msg));
          err.httpStatus = r.status;
          if (isRecord(data) && typeof data.error_code === "string")
            err.errorCode = data.error_code;
          throw err;
        }
        if (data === null && text.trim())
          throw new Error("Invalid GitLab JSON response");
        return data ?? {};
      });
    });
  }
  return api;
}
