import { DISPLAY_DEFAULTS } from "./display-preferences";
import type {
  CustomJob,
  MrAction,
  ProjectProfile,
  QuickComment,
} from "./types";
export const BUTTON_DEFAULTS = {
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
};
export const VERSION_DEFAULTS = {
  versionFile: "package.json",
  versionPath: "version",
  versionStrategy: "patch",
  versionCommitTemplate: "fix: bump version to {version}",
  version_from_target: false,
};

export const MR_DEFAULTS = {
  ...DISPLAY_DEFAULTS,
  ...BUTTON_DEFAULTS,
  ...VERSION_DEFAULTS,
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
  quickComments: [] as QuickComment[],
  customJobs: [] as CustomJob[],
  mrActions: [] as MrAction[],
  buttonOrder: [] as string[],
  projectProfiles: {} as Record<string, ProjectProfile>,
};
