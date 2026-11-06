import { checkAbort } from "../../lib/abort";

/** Reading storage does not make the stored values trusted. Validate at use. */
export function readStorage(
  area: "sync" | "local" | "session",
  defaults: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  checkAbort(signal);
  const storage = typeof chrome !== "undefined" && chrome.storage?.[area];
  if (!storage || typeof storage.get !== "function") {
    return Promise.reject(new Error("Review settings storage is unavailable."));
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error: unknown, value: Record<string, unknown> = {}) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => {
      try {
        checkAbort(signal);
      } catch (error) {
        finish(error);
      }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      storage.get(defaults, (value: Record<string, unknown>) => {
        finish(
          chrome.runtime?.lastError
            ? new Error("Could not load review settings.")
            : null,
          value,
        );
      });
    } catch (error) {
      finish(error);
    }
  });
}
