import { isExtensionValid } from "../../../shared/api/runtime";
import { MR_DEFAULTS } from "./defaults";
import { readDisplayPreferences } from "./display-preferences";
import type { MrSettings, ProjectProfile } from "./types";
function findProjectProfile(
  profiles: Record<string, ProjectProfile> | undefined,
  projectPath: string | null,
) {
  if (!profiles || !projectPath) return null;
  // Exact match first
  if (profiles[projectPath]) return profiles[projectPath];
  for (const pattern in profiles) {
    if (projectPath.indexOf(pattern) !== -1) return profiles[pattern];
  }
  return null;
}
export function createMrSettingsReader(projectPath: () => string | null) {
  function getSettings(): Promise<MrSettings> {
    if (!isExtensionValid()) return Promise.resolve(MR_DEFAULTS);
    return new Promise<MrSettings>(function (resolve) {
      try {
        chrome.storage.sync.get(MR_DEFAULTS, function (data: MrSettings) {
          if (!isExtensionValid()) {
            resolve(MR_DEFAULTS);
            return;
          }
          Object.assign(data, readDisplayPreferences(data));
          // Merge project-specific profile over defaults
          const profile = findProjectProfile(
            data.projectProfiles,
            projectPath(),
          );
          if (profile) {
            const merged: MrSettings = { ...data };
            if (profile.versionFile) merged.versionFile = profile.versionFile;
            if (profile.versionPath) merged.versionPath = profile.versionPath;
            if (profile.versionStrategy)
              merged.versionStrategy = profile.versionStrategy;
            if (profile.versionCommitTemplate)
              merged.versionCommitTemplate = profile.versionCommitTemplate;
            if (profile.reviewersList)
              merged.reviewersList = profile.reviewersList;
            if (profile.reviewersJob)
              merged.reviewersJob = profile.reviewersJob;
            if (Array.isArray(profile.mrActions))
              merged.mrActions = profile.mrActions;
            if (profile.customJobs) merged.customJobs = profile.customJobs;
            if (profile.buttonOrder) merged.buttonOrder = profile.buttonOrder;
            if (profile.buttons) {
              for (const bk in profile.buttons)
                merged[bk] = profile.buttons[bk];
            }
            resolve(merged);
          } else {
            resolve(data);
          }
        });
      } catch {
        resolve(MR_DEFAULTS);
      }
    });
  }
  return getSettings;
}
