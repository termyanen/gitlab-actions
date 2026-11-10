import { GITLAB_API_PREFIX } from "../../../shared/config/gitlab-api";
import { REQUEST_TIMEOUT } from "./limits";
import type {
  ExportOptions,
  RequestResult,
  ReviewContext,
  ReviewError,
} from "./types";
function abortError() {
  const error = new Error("Review export cancelled.");
  error.name = "AbortError";
  return error;
}

export function checkAbort(signal?: AbortSignal) {
  if (signal && signal.aborted) throw abortError();
}

export function header(response: Response, name: string) {
  return response.headers && response.headers.get
    ? response.headers.get(name)
    : null;
}

export function apiUrl(context: ReviewContext, path: string) {
  const root = new URL(context.apiRoot || GITLAB_API_PREFIX, context.origin);
  if (root.origin !== context.origin || !/^https?:$/.test(root.protocol))
    throw new Error("GitLab API must use the current site.");
  return root.href.replace(/\/$/, "") + path;
}

async function boundedText(response: Response, maxBytes?: number) {
  if (!maxBytes) return response.text();
  const length = Number(header(response, "Content-Length"));
  if (length > maxBytes)
    throw new Error(
      "File exceeds the " + Math.round(maxBytes / 1024) + " KiB context limit.",
    );
  if (
    response.body &&
    response.body.getReader &&
    typeof TextDecoder !== "undefined"
  ) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes)
          throw new Error(
            "File exceeds the " +
              Math.round(maxBytes / 1024) +
              " KiB context limit.",
          );
        chunks.push(decoder.decode(next.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* The stream may already be closed. */
      }
    }
  }
  const text = await response.text();
  if (
    text.length > maxBytes ||
    (typeof TextEncoder !== "undefined" &&
      new TextEncoder().encode(text).length > maxBytes)
  ) {
    throw new Error(
      "File exceeds the " + Math.round(maxBytes / 1024) + " KiB context limit.",
    );
  }
  return text;
}

export async function request(
  context: ReviewContext,
  path: string,
  options: ExportOptions = {},
): Promise<RequestResult<unknown>> {
  options = options || {};
  checkAbort(options.signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const timeout = new Promise<never>(function (_resolve, reject) {
    cancel = function () {
      controller.abort();
      reject(abortError());
    };
    if (options.signal)
      options.signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(function () {
      controller.abort();
      reject(new Error("GitLab request timed out after 20 seconds."));
    }, REQUEST_TIMEOUT);
  });
  try {
    return await Promise.race([
      timeout,
      (async function () {
        const response = await fetch(apiUrl(context, path), {
          method: "GET",
          credentials: "same-origin",
          redirect: "error",
          signal: controller.signal,
          cache: options.fresh ? "no-store" : "default",
          headers: { Accept: options.raw ? "text/plain" : "application/json" },
        });
        if (!response.ok) {
          const error: ReviewError = new Error(
            "GitLab returned HTTP " +
              response.status +
              (response.status === 401 || response.status === 403
                ? " (sign-in or access required)."
                : "."),
          );
          error.httpStatus = response.status;
          throw error;
        }
        if (response.redirected)
          throw new Error(
            "GitLab redirected the request. Reload the page and sign in again.",
          );
        const text = await boundedText(response, options.maxBytes);
        if (options.raw) {
          if (
            (header(response, "Content-Type") || "").indexOf("text/html") >=
              0 &&
            /^\s*(?:<!doctype html|<html)/i.test(text)
          )
            throw new Error(
              "GitLab returned an HTML page instead of repository content.",
            );
          return { data: text, response: response };
        }
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(
            "GitLab returned invalid JSON; the session may have expired.",
          );
        }
        return { data: data, response: response };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    if (options.signal && cancel)
      options.signal.removeEventListener("abort", cancel);
  }
}
