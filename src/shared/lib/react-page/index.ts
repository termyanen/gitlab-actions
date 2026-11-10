import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { requireElement } from "../../ui/dom";

/** Each extension document owns its React root and tears down its subscriptions. */
export function mountReactPage(node: ReactNode, rootId: string) {
  const mount = () => {
    const root = createRoot(requireElement(document.getElementById(rootId)));
    root.render(node);
    window.addEventListener("pagehide", () => root.unmount(), { once: true });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
