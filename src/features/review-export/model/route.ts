import type { ReviewContext, ReviewLocation } from "./types";

export function parsePage(
  location: ReviewLocation | null | undefined,
): ReviewContext | null {
  if (!location || !/^https?:\/\//.test(location.origin || "")) return null;
  let path = location.pathname || "";
  const root = String(location.relativeUrlRoot || "").replace(/\/$/, "");
  if (root && (root.charAt(0) !== "/" || path.indexOf(root + "/") !== 0))
    return null;
  if (root) path = path.slice(root.length);
  let match = path.match(
    /^\/(.+)\/-\/(merge_requests|issues|work_items)\/(\d+)(?:\/.*)?$/,
  );
  const modern = !!match;
  if (!match)
    match = path.match(
      /^\/(.+)\/(merge_requests|issues|work_items)\/(\d+)(?:\/.*)?$/,
    );
  if (!match || !match[1] || match[1].indexOf("/") < 0) return null;
  let projectPath;
  try {
    projectPath = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (
    /^(groups|users|admin)\//.test(projectPath) ||
    projectPath.split("/").some(function (part) {
      return !part || part === "." || part === "..";
    })
  )
    return null;
  const suffix =
    "/" + match[1] + "/" + (modern ? "-/" : "") + match[2] + "/" + match[3];
  return {
    origin: location.origin,
    projectPath: projectPath,
    kind: match[2] === "merge_requests" ? "merge_requests" : "issues",
    iid: match[3],
    projectUrl: location.origin + root + "/" + match[1],
    webUrl: location.origin + root + suffix,
    apiRoot: location.origin + root + "/api/v4",
  };
}
