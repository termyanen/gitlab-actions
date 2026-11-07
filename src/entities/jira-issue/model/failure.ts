import { errorMessage, errorStatus } from "../../../shared/lib/errors";
import {
  isNumber,
  isRecord,
  isString,
  objectOf,
  optional,
} from "../../../shared/lib/validation";

export type JiraFailureKind =
  | "auth"
  | "forbidden"
  | "permission"
  | "network"
  | "unavailable"
  | "not-found"
  | "invalid-response"
  | "unknown";

export interface JiraFailure {
  _error: string;
  _errorKind?: JiraFailureKind;
  _httpStatus?: number;
}

export function isJiraErrorKind(value: unknown): value is JiraFailureKind {
  return (
    value === "auth" ||
    value === "forbidden" ||
    value === "permission" ||
    value === "network" ||
    value === "unavailable" ||
    value === "not-found" ||
    value === "invalid-response" ||
    value === "unknown"
  );
}

export const isJiraFailure = objectOf<JiraFailure>({
  _error: isString,
  _errorKind: optional(isJiraErrorKind),
  _httpStatus: optional(isNumber),
});

export class JiraRequestError extends Error {
  readonly kind: JiraFailureKind;
  readonly httpStatus?: number;

  constructor(kind: JiraFailureKind, message: string, status?: number) {
    super(message);
    this.name = "JiraRequestError";
    this.kind = kind;
    if (status !== undefined) this.httpStatus = status;
  }
}

export function jiraFailure(error: unknown): JiraFailure {
  const status = errorStatus(error);
  const message = errorMessage(error);
  const kind =
    isRecord(error) && isJiraErrorKind(error.kind)
      ? error.kind
      : status === 401
        ? "auth"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not-found"
            : status === 429 || (status !== undefined && status >= 500)
              ? "unavailable"
              : /^Invalid .*response|^Invalid API/i.test(message)
                ? "invalid-response"
                : "unknown";
  return {
    _error: /<!doctype|<html|<body/i.test(message)
      ? "Jira returned an unexpected response"
      : message.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 240),
    _errorKind: kind,
    ...(status === undefined ? {} : { _httpStatus: status }),
  };
}

export function stopsJiraBatch(failure: JiraFailure): boolean {
  return (
    failure._errorKind === "auth" ||
    failure._errorKind === "permission" ||
    failure._errorKind === "network" ||
    failure._errorKind === "unavailable" ||
    failure._errorKind === "invalid-response"
  );
}
