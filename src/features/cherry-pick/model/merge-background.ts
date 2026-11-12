import { TextMergeError } from "./merge-contract";
import type { TextMergeRequest } from "./merge-contract";
import { mergeWithModule } from "./merge-wasm";

let compiled: Promise<WebAssembly.Module> | undefined;
function loadModule() {
  compiled ??= fetch(chrome.runtime.getURL("wasm/xdiff.wasm"))
    .then(async (response) => {
      if (!response.ok)
        throw new Error("Packaged text merge module unavailable");
      return WebAssembly.compile(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      compiled = undefined;
      throw error;
    });
  return compiled;
}
export function handleTextMerge(
  message: TextMergeRequest,
  sendResponse: (response: unknown) => void,
) {
  loadModule()
    .then((module) => {
      const content = mergeWithModule(
        module,
        message.parent,
        message.source,
        message.target,
      );
      sendResponse({ content });
    })
    .catch((error: unknown) => {
      sendResponse({
        code: error instanceof TextMergeError ? error.code : "CP_MERGE_FAILED",
      });
    });
  return true;
}
