export function readJiraBaseUrl(value: string) {
  const text = value.trim();
  if (!/^https:\/\/[^/]/i.test(text) || /[\s\\?#]/.test(text)) return undefined;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      // Chromium encodes '*' in hostnames; Jira must identify a single host.
      /\*|%2a/i.test(url.hostname)
    )
      return undefined;
    return { url: url.href.replace(/\/+$/, ""), origin: url.origin };
  } catch {
    return undefined;
  }
}
