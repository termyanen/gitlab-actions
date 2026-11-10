import type { DisplayPreferences } from "./display-preferences";
export interface MrAction {
  enabled?: boolean;
  id: string;
  label: string;
  type: string;
  labels?: string;
}
export interface CustomJob {
  enabled?: boolean;
  label: string;
  jobName: string;
}
export interface QuickComment {
  label: string;
  text: string;
}
export interface ProjectProfile {
  overrides?: Record<string, unknown>;
  cherry_pick_branches?: string[];
  versionFile?: string;
  versionPath?: string;
  versionStrategy?: string;
  versionCommitTemplate?: string;
  reviewersList?: string;
  reviewersJob?: string;
  mrActions?: MrAction[];
  customJobs?: CustomJob[];
  buttonOrder?: string[];
  buttons?: Record<string, boolean>;
}
export interface MrSettings extends DisplayPreferences {
  [key: string]: unknown;
  btn_version: boolean;
  btn_rebase: boolean;
  btn_rebase_version: boolean;
  btn_rebase_automerge: boolean;
  btn_rebase_force: boolean;
  btn_ship: boolean;
  btn_force_ship: boolean;
  btn_reviewers: boolean;
  btn_pipeline_restart: boolean;
  btn_pipeline_cancel: boolean;
  btn_draft_toggle: boolean;
  btn_retry_failed: boolean;
  btn_copy_mr: boolean;
  sound_enabled: boolean;
  notifications_enabled: boolean;
  show_time_tracker: boolean;
  show_failed_job_view: boolean;
  skip_confirmations: boolean;
  dim_drafts: boolean;
  highlight_own_mrs: boolean;
  show_sensitive_warning: boolean;
  show_git_commands: boolean;
  reviewersList: string;
  reviewersJob: string;
  quickComments: QuickComment[];
  customJobs: CustomJob[];
  mrActions: MrAction[];
  buttonOrder: string[];
  projectProfiles: Record<string, ProjectProfile>;
  versionFile: string;
  versionPath: string;
  versionStrategy: string;
  versionCommitTemplate: string;
  version_from_target: boolean;
}
