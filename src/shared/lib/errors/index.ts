/** Terminal handler for unexpected failures outside an interactive error flow. */
export function reportError(error: unknown): void {
  console.error("[GitLab Actions]", error);
}
