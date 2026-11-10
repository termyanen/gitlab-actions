import {
  findSettingsProfile,
  getProjectSettings,
  currentProjectPath,
} from "../../../shared/api/project-settings";
import { LEGACY_PROJECT_FIELDS } from "../../../shared/config/project-settings";
import { isRecord } from "../../../shared/lib/validation";

/** Preserve legacy profile field semantics without loading domain settings in bootstrap. */
export function getRepositorySettings<T extends Record<string, unknown>>(
  defaults: T,
  callback: (settings: T) => void,
  project = currentProjectPath(),
) {
  getProjectSettings(
    { ...defaults, projectProfiles: {} },
    (saved) => {
      const profile = findSettingsProfile(saved.projectProfiles, project);
      const result = { ...saved };
      const assign = (key: string, value: unknown) => {
        if (Object.hasOwn(defaults, key))
          Object.assign(result, { [key]: value });
      };
      if (profile) {
        for (const key of LEGACY_PROJECT_FIELDS) {
          const value = profile[key];
          if (typeof value === "string" ? !!value : Array.isArray(value))
            assign(key, value);
        }
        if (isRecord(profile.buttons))
          for (const [key, value] of Object.entries(profile.buttons))
            if (key.startsWith("btn_") && typeof value === "boolean")
              assign(key, value);
        const branches = normalizeCherryPickBranches(
          profile.cherry_pick_branches,
        );
        if (branches.length) assign("cherry_pick_branches", branches);
      }
      callback(result);
    },
    project,
  );
}

export function normalizeCherryPickBranches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((branch): branch is string => typeof branch === "string")
        .map((branch) => branch.trim())
        .filter(Boolean),
    ),
  ];
}
