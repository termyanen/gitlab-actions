/** Terminal handler for unexpected failures outside an interactive error flow. */
export function reportError(error: unknown): void {
  console.error("[GitLab Actions]", error);
}

export function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

export function errorStatus(error: unknown): number | undefined {
  return error &&
    typeof error === "object" &&
    "httpStatus" in error &&
    typeof error.httpStatus === "number"
    ? error.httpStatus
    : undefined;
}

export function errorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "errorCode" in error &&
    typeof error.errorCode === "string"
    ? error.errorCode
    : undefined;
}

/** Preserve the error metadata used for cancellation and write reconciliation. */
export function toError(
  value: unknown,
): Error & { httpStatus?: number; beforeSend?: boolean; errorCode?: string } {
  const error: Error & {
    httpStatus?: number;
    beforeSend?: boolean;
    errorCode?: string;
  } = new Error(errorMessage(value));
  if (value && typeof value === "object") {
    if ("name" in value && typeof value.name === "string")
      error.name = value.name;
    if ("stack" in value && typeof value.stack === "string")
      error.stack = value.stack;
    if ("beforeSend" in value && typeof value.beforeSend === "boolean")
      error.beforeSend = value.beforeSend;
  }
  const status = errorStatus(value);
  if (status !== undefined) error.httpStatus = status;
  const code = errorCode(value);
  if (code !== undefined) error.errorCode = code;
  return error;
}
