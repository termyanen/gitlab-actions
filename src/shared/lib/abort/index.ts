export function abortError(message = "Review cancelled."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
