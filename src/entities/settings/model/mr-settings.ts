import { isExtensionValid } from "../../../shared/api/runtime";
import type { MrSettings, ProjectProfile } from "./types";

const SETTINGS_DEFAULTS: MrSettings = {
  btn_version: false,
  btn_rebase: false,
  btn_rebase_version: false,
  btn_rebase_automerge: false,
  btn_rebase_force: false,
  btn_ship: false,
  btn_force_ship: false,
  btn_reviewers: false,
  btn_pipeline_restart: false,
  btn_pipeline_cancel: false,
  btn_draft_toggle: false,
  btn_retry_failed: false,
  btn_copy_mr: false,
  sound_enabled: false,
  notifications_enabled: true,
  show_time_tracker: true,
  show_failed_job_view: true,
  skip_confirmations: false,
  dim_drafts: false,
  highlight_own_mrs: false,
  show_sensitive_warning: false,
  show_git_commands: false,
  reviewersList: "",
  reviewersJob: "get-reviewers",
  quickComments: [],
  customJobs: [],
  mrActions: [],
  buttonOrder: [],
  projectProfiles: {},
  versionFile: "package.json",
  versionPath: "version",
  versionStrategy: "patch",
  versionCommitTemplate: "fix: bump version to {version}",
  version_from_target: false,
};

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
  function getSettings() {
    if (!isExtensionValid()) return Promise.resolve(SETTINGS_DEFAULTS);
    return new Promise<MrSettings>(function (resolve) {
      try {
        chrome.storage.sync.get(SETTINGS_DEFAULTS, function (data: MrSettings) {
          if (!isExtensionValid()) {
            resolve(SETTINGS_DEFAULTS);
            return;
          }
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
        resolve(SETTINGS_DEFAULTS);
      }
    });
  }
  return getSettings;
}
