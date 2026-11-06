export function parseMrPath(href: string) {
  const m = href.match(/^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!m) return null;
  return { projectPath: m[1], iid: m[2] };
}

export function isMrListPage() {
  return /\/-\/merge_requests\/?(\?|$)/.test(
    window.location.pathname + window.location.search,
  );
}
