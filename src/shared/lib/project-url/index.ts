const deploymentRoots = new WeakMap<Document, string>();

/** Read GitLab's deployment root from page data without executing page scripts. */
export function readGitLabRelativeRoot(): string {
  if (typeof document === "undefined") return "";
  const cached = deploymentRoots.get(document);
  if (cached !== undefined) return cached;
  let root =
    document
      .querySelector?.(
        'meta[name="gitlab-relative-url-root"], meta[name="relative-url-root"]',
      )
      ?.getAttribute("content") ??
    document.body?.dataset.relativeUrlRoot ??
    undefined;
  if (root === undefined) {
    for (const script of document.querySelectorAll?.("script:not([src])") ||
      []) {
      const match = script.textContent.match(
        /(?:gon\.)?"?relative_url_root"?\s*(?:=|:)\s*("(?:[^"\\]|\\.)*")/,
      );
      if (!match?.[1]) continue;
      try {
        const parsed: unknown = JSON.parse(match[1]);
        if (typeof parsed === "string") root = parsed;
      } catch {
        // Ignore malformed page metadata; never evaluate it as JavaScript.
      }
      if (root !== undefined) break;
    }
  }
  // A deployment root (including explicit "") is stable throughout SPA navigation.
  // Do not cache absence:
  // another consumer may run after GitLab adds its metadata to the document.
  if (root !== undefined) deploymentRoots.set(document, root);
  return root ?? "";
}

/** Profile keys are GitLab namespace/project paths, never object-prototype keys. */
export function isProjectPath(value: string | null): value is string {
  if (!value) return false;
  const segments = value.split("/");
  return (
    segments.length >= 2 &&
    segments.every(
      (segment) => !!segment && segment !== "." && segment !== "..",
    )
  );
}

export function projectPathFromUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    const path =
      url.pathname.match(
        /^\/(.+?)\/-\/(?:merge_requests|commit|commits|tree|pipelines|jobs|issues|work_items|repository)(?:\/|$)/,
      )?.[1] ||
      url.pathname.match(
        /^\/(.+?)\/(?:merge_requests|issues|commit)\/(?:\d+|[a-f0-9]{7,40})(?:\/|$)/,
      )?.[1];
    return isProjectPath(path ?? null) ? path : undefined;
  } catch {
    return undefined;
  }
}
