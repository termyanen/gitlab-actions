import {
  projectPathFromUrl,
  readGitLabRelativeRoot,
} from "../../lib/project-url";
import { isRecord } from "../../lib/validation";

export function currentProjectPath(): string | null {
  if (typeof location === "undefined") return null;
  const path = projectPathFromUrl(location.href);
  const root = readGitLabRelativeRoot().replace(/^\/+|\/+$/g, "");
  // A suffix match against projectFullPath can select the previous SPA project
  // when its namespace is also a suffix of the destination. Only strip a known
  // deployment root; the route always owns the current project identity.
  return root && path?.startsWith(root + "/")
    ? path.slice(root.length + 1)
    : path || null;
}
export function findSettingsProfile(
  profiles: unknown,
  project: string | null,
): Record<string, unknown> | null {
  if (!isRecord(profiles) || !project) return null;
  if (Object.hasOwn(profiles, project) && isRecord(profiles[project]))
    return profiles[project];
  for (const [pattern, profile] of Object.entries(profiles))
    if (pattern && project.includes(pattern) && isRecord(profile))
      return profile;
  return null;
}
/** Only requested keys can cross this boundary; domain consumers still validate values. */
export function applyProjectSettings<T extends Record<string, unknown>>(
  values: T,
  profiles: unknown,
  project: string | null,
): T {
  const profile = findSettingsProfile(profiles, project);
  if (!profile) return { ...values };
  const result = { ...values };
  function assign(key: string, value: unknown) {
    if (Object.hasOwn(values, key)) Object.assign(result, { [key]: value });
  }
  if (isRecord(profile.overrides))
    for (const [key, value] of Object.entries(profile.overrides))
      if (
        ![
          "language",
          "sound_enabled",
          "notifications_enabled",
          "standup_jira_enrich",
          "ai_review_fresh_existing",
          "ai_review_include_description",
          "projectProfiles",
        ].includes(key)
      )
        assign(key, value);
  return result;
}
/** Capture the project before asynchronous storage reads, so navigation cannot retarget them. */
export function getProjectSettings<T extends Record<string, unknown>>(
  defaults: T,
  callback: (settings: T) => void,
  project: string | null = currentProjectPath(),
): void {
  chrome.storage.sync.get(
    { ...defaults, projectProfiles: {} },
    (saved: unknown) => {
      if (!isRecord(saved)) {
        callback({ ...defaults });
        return;
      }
      callback(
        applyProjectSettings(
          { ...defaults, ...saved },
          saved.projectProfiles,
          project,
        ),
      );
    },
  );
}
