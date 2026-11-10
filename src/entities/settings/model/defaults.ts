import { QUICK_SETTINGS_DEFAULTS } from "./quick-preferences";
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
  ...QUICK_SETTINGS_DEFAULTS,
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

export const LIST_DEFAULTS = {
  ...DISPLAY_DEFAULTS,
  dim_drafts: MR_DEFAULTS.dim_drafts,
  highlight_own_mrs: MR_DEFAULTS.highlight_own_mrs,
  show_only_mine: false,
  show_needs_review: false,
  show_copy_mr: false,
  show_reviewer_badge: false,
  show_threads_badge: false,
  show_size_badge: false,
  show_conflicts_badge: false,
  show_approval_badge: false,
  show_branches: true,
  show_branches_links: false,
  show_jira_details: false,
  skip_confirmations: MR_DEFAULTS.skip_confirmations,
  jira_url: "",
  jira_ticket_regex: "",
};
