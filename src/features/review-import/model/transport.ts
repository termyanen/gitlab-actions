import { readMergeRequest } from "../../../entities/merge-request";
import type { ReviewContext } from "../../../entities/review";
import { GITLAB_PAGE_SIZE } from "../../../shared/config/gitlab";
import {
  decodeArray,
  decodeResponse,
  type Decoder,
} from "../../../shared/lib/validation";
import { MAX_PAGES, TIMEOUT } from "./limits";
import type { ImportError, ImportOptions } from "./types";
import { abortError, checkAbort } from "./utils";
import {
  assertCurrentPage,
  currentOrigin,
  endpoint,
  readRefs,
} from "./validation";
function header(response: Response, name: string) {
  return response.headers && response.headers.get
    ? response.headers.get(name)
    : null;
}

async function boundedDiffText(response: Response, maxBytes: number) {
  function tooLarge() {
    return new Error(
      (typeof chrome !== "undefined" &&
        chrome.i18n &&
        chrome.i18n.getMessage("aiReviewImportDiffResponseTooLarge")) ||
        "The additional diff exceeds the 16 MiB import limit. Only comments on verified lines can be imported.",
    );
  }
  if (Number(header(response, "Content-Length")) > maxBytes) {
    if (response.body && response.body.cancel) {
      try {
        await response.body.cancel();
      } catch {
        /* The request may already be closed. */
      }
    }
    throw tooLarge();
  }
  if (
    response.body &&
    response.body.getReader &&
    typeof TextDecoder !== "undefined"
  ) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunks: string[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes) throw tooLarge();
        chunks.push(decoder.decode(next.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* The request may already be closed. */
      }
    }
  }
  const text = await response.text();
  if (
    text.length > maxBytes ||
    new TextEncoder().encode(text).length > maxBytes
  )
    throw tooLarge();
  return text;
}

export async function request(
  context: ReviewContext,
  path: string,
  options: ImportOptions = {},
  payload?: unknown,
  method?: string,
) {
  options = options || {};
  checkAbort(options.signal);
  if (
    context.origin !== currentOrigin() ||
    new URL(context.apiRoot).origin !== currentOrigin()
  )
    throw new Error("The current GitLab site has changed. Reopen the import.");
  assertCurrentPage(context);
  const write = payload !== undefined;
  const controller = new AbortController();
  let cancel: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>(function (_resolve, reject) {
    cancel = function () {
      controller.abort();
      reject(abortError());
    };
    if (options.signal)
      options.signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(function () {
      controller.abort();
      reject(new Error("GitLab did not respond in time."));
    }, TIMEOUT);
  });
  try {
    return await Promise.race([
      timeout,
      (async function () {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (write) {
          if (!options.csrfToken || typeof options.csrfToken !== "string")
            throw new Error("Reload the GitLab page before sending comments.");
          headers["Content-Type"] = "application/json";
          headers["X-CSRF-Token"] = options.csrfToken;
          headers["X-Requested-With"] = "XMLHttpRequest";
        }
        const response = await fetch(context.apiRoot + path, {
          method: write ? method || "POST" : "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: headers,
          ...(write ? { body: JSON.stringify(payload) } : {}),
        });
        if (!response.ok) {
          const error: ImportError = new Error(
            response.status === 401 || response.status === 403
              ? "Sign in to GitLab and check your permission to comment."
              : "GitLab returned HTTP " + response.status + ".",
          );
          error.httpStatus = response.status;
          throw error;
        }
        if (response.redirected)
          throw new Error(
            "GitLab redirected the request. Reload the page and sign in again.",
          );
        const text = options.maxBytes
          ? await boundedDiffText(response, options.maxBytes)
          : await response.text();
        let result: unknown;
        try {
          result = JSON.parse(text);
        } catch {
          throw new Error("GitLab returned an unreadable response.");
        }
        return { data: result, response: response };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", cancel);
  }
}

export async function paginate<T>(
  context: ReviewContext,
  path: string,
  options: ImportOptions,
  key: (item: T) => string | number | null | undefined,
  read: Decoder<T>,
) {
  const result: T[] = [];
  const seen = new Set<string>();
  const pages = new Set<number>();
  let page = 1;
  for (let count = 0; count < MAX_PAGES; count++) {
    checkAbort(options.signal);
    if (pages.has(page))
      throw new Error(
        "GitLab repeated a page of results. Reload and try again.",
      );
    pages.add(page);
    const fetched = await request(
      context,
      path + "?per_page=" + GITLAB_PAGE_SIZE + "&page=" + page,
      options,
    ).then(decodeResponse(decodeArray(read)));
    if (!Array.isArray(fetched.data))
      throw new Error("GitLab returned an incomplete list.");
    let added = 0;
    fetched.data.forEach(function (item) {
      const id = item && key(item);
      if (id == null)
        throw new Error("GitLab returned an incomplete list entry.");
      if (!seen.has(String(id))) {
        seen.add(String(id));
        result.push(item);
        added++;
      }
    });
    const next = header(fetched.response, "X-Next-Page");
    const total = header(fetched.response, "X-Total");
    if (!fetched.data.length || next === "") {
      if (total != null && /^\d+$/.test(total) && result.length < Number(total))
        throw new Error("Some GitLab results could not be loaded.");
      return result;
    }
    if (!added)
      throw new Error(
        "GitLab repeated results instead of loading the next page.",
      );
    if (next != null) {
      if (!/^\d+$/.test(next) || Number(next) <= page)
        throw new Error("GitLab returned an invalid page number.");
      page = Number(next);
    } else {
      const link = header(fetched.response, "Link");
      const match = link && link.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i);
      if (match?.[1]) {
        const url = new URL(match[1], context.apiRoot + path);
        const expected = new URL(context.apiRoot + path);
        const number = url.searchParams.get("page");
        if (
          url.origin !== expected.origin ||
          url.pathname !== expected.pathname ||
          !/^\d+$/.test(number || "") ||
          Number(number) <= page
        )
          throw new Error("GitLab returned an invalid next page.");
        page = Number(number);
      } else if (
        total != null &&
        /^\d+$/.test(total) &&
        result.length >= Number(total)
      )
        return result;
      else page++;
    }
  }
  throw new Error("The GitLab results are too large to verify completely.");
}

export async function metadata(context: ReviewContext, options: ImportOptions) {
  const entity = (
    await request(context, endpoint(context), options).then(
      decodeResponse(readMergeRequest),
    )
  ).data;
  return { entity: entity, refs: readRefs(entity, context) };
}
