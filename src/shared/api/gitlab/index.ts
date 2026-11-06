export interface ApiError extends Error {
  httpStatus?: number;
}
export type SessionApi = <T = unknown>(
  method: string,
  path: string,
  body?: unknown,
) => Promise<T>;
export function createSessionApi(origin: () => string): SessionApi {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  // GitLab API helper — uses session cookies + CSRF token, no personal token needed
  function api<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = origin() + "/api/v4" + path;
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
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
      if (r.status === 204) return {} as T;
      return r.text().then(function (text) {
        let data: { message?: unknown; error?: unknown } | null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        if (!r.ok) {
          let msg =
            (data && (data.message || data.error)) ||
            r.status + " " + r.statusText;
          if (typeof msg === "object") msg = JSON.stringify(msg);
          const err: ApiError = new Error(String(msg));
          err.httpStatus = r.status;
          throw err;
        }
        return (data || {}) as T;
      });
    });
  }
  return api;
}
