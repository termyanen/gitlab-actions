import { JIRA_MYSELF_PATH } from "../../../shared/config/jira";
import {
  isRecord,
  isString,
  isUnknownArray,
} from "../../../shared/lib/validation";
import { JiraRequestError } from "../model/failure";

const JIRA_READ_TIMEOUT_MS = 15_000;
const MAX_ERROR_DETAIL_LENGTH = 180;

function errorDetail(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return "";
    const messages = isUnknownArray(value.errorMessages)
      ? value.errorMessages.filter(isString)
      : [];
    if (isRecord(value.errors))
      messages.push(...Object.values(value.errors).filter(isString));
    return messages
      .filter((message) => !/<[^>]*>/.test(message))
      .join("; ")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, MAX_ERROR_DETAIL_LENGTH);
  } catch {
    return "";
  }
}

async function readResponse(
  response: Response,
  json: boolean,
): Promise<unknown> {
  const status = response.status;
  const loginDenied =
    response.headers?.get("X-Seraph-LoginReason") === "AUTHENTICATION_DENIED";
  const loginRedirect =
    response.redirected &&
    /\/(?:login|signin|sign-in|sso|auth)(?:[/?#.]|$)/i.test(response.url);
  if (status === 401 || loginDenied || loginRedirect)
    throw new JiraRequestError("auth", "Sign in to Jira to continue", status);
  if (!response.ok) {
    const detail = errorDetail(await response.text());
    const kind =
      status === 403
        ? "forbidden"
        : status === 404
          ? "not-found"
          : status === 429 || status >= 500
            ? "unavailable"
            : "unknown";
    throw new JiraRequestError(
      kind,
      String(status) + (detail ? " " + detail : " Jira request failed"),
      status,
    );
  }
  if (status === 204) return {};
  const text = await response.text();
  if (
    /^\s*(?:<!doctype\s+html|<html|<body)/i.test(text) ||
    response.headers?.get("content-type")?.includes("text/html")
  ) {
    const login =
      /(?:j_username|os_username|login-form|sign\s*in|log\s*in)/i.test(text);
    throw new JiraRequestError(
      login ? "auth" : "invalid-response",
      login
        ? "Sign in to Jira to continue"
        : "Jira returned HTML instead of an API response",
      status,
    );
  }
  if (!json || !text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new JiraRequestError(
      "invalid-response",
      "Jira returned invalid JSON",
      status,
    );
  }
}

export async function jiraRequest(
  jiraUrl: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const origin = new URL(jiraUrl).origin;
  try {
    if (
      chrome.permissions?.contains &&
      !(await chrome.permissions.contains({ origins: [origin + "/*"] }))
    )
      throw new JiraRequestError(
        "permission",
        "Allow access to the configured Jira site in extension settings",
      );
  } catch {
    throw new JiraRequestError(
      "permission",
      "Allow access to the configured Jira site in extension settings",
    );
  }
  const controller = method === "GET" ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), JIRA_READ_TIMEOUT_MS)
    : undefined;
  try {
    let response: Response;
    try {
      response = await fetch(jiraUrl.replace(/\/+$/, "") + path, {
        method,
        credentials: "include",
        // An identity check must confirm the current session, not a cached user.
        ...(path === JIRA_MYSELF_PATH ? { cache: "no-store" as const } : {}),
        redirect: method === "GET" ? "follow" : "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(path.includes("/comment") && method !== "GET"
            ? { "X-Atlassian-Token": "no-check" }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      throw new JiraRequestError(
        "network",
        controller?.signal.aborted
          ? "Jira request timed out"
          : "Could not complete the Jira request",
      );
    }
    try {
      return await readResponse(
        response,
        method === "GET" || method === "POST",
      );
    } catch (error) {
      if (error instanceof JiraRequestError) throw error;
      throw new JiraRequestError(
        "network",
        controller?.signal.aborted
          ? "Jira request timed out"
          : "Could not read the Jira response",
      );
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
