import * as workflow from "../../../entities/review";
import type { FileFilter } from "../../../entities/review";
import type {
  CustomJob,
  QuickComment,
  MrAction,
  ProjectProfile,
} from "../../../entities/settings";
import type { JiraQuickAction } from "../../../entities/jira-issue";
export const BUILTIN_BUTTONS = [
  { key: "btn_version", labelKey: "btnVersion", hintKey: "hintVersion" },
  { key: "btn_rebase", labelKey: "btnRebase", hintKey: "hintRebase" },
  {
    key: "btn_rebase_version",
    labelKey: "btnRebaseVersion",
    hintKey: "hintRebaseVersion",
  },
  {
    key: "btn_rebase_automerge",
    labelKey: "btnRebaseAutomerge",
    hintKey: "hintRebaseAutomerge",
  },
  {
    key: "btn_rebase_force",
    labelKey: "btnRebaseForce",
    hintKey: "hintRebaseForce",
  },
  { key: "btn_ship", labelKey: "btnShip", hintKey: "hintShip" },
  { key: "btn_force_ship", labelKey: "btnForceShip", hintKey: "hintForceShip" },
  { key: "btn_reviewers", labelKey: "btnReviewers", hintKey: "hintReviewers" },
  {
    key: "btn_pipeline_restart",
    labelKey: "btnPipelineRestart",
    hintKey: "hintPipelineRestart",
  },
  {
    key: "btn_pipeline_cancel",
    labelKey: "btnPipelineCancel",
    hintKey: "hintPipelineCancel",
  },
  {
    key: "btn_draft_toggle",
    labelKey: "btnDraftToggle",
    hintKey: "hintDraftToggle",
  },
  {
    key: "btn_retry_failed",
    labelKey: "btnRetryFailed",
    hintKey: "hintRetryFailed",
  },
  { key: "btn_copy_mr", labelKey: "btnCopyMr", hintKey: "hintCopyMr" },
];
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
export const AI_REVIEW_PROMPT_MAX_LENGTH = 1500;
export const AI_REVIEW_DEFAULT_PROMPT = workflow.DEFAULT_PROMPT;
export const AI_REVIEW_DEFAULT_FRESH_PROMPT =
  workflow.DEFAULT_FRESH_REVIEW_PROMPT;
export const AI_REVIEW_DEFAULT_IMPORT_PROMPT = workflow.DEFAULT_REVIEW_PROMPT;
export const AI_REVIEW_DEFAULT_REPLY_PROMPT = workflow.DEFAULT_REPLY_PROMPT;
export const AI_REVIEW_DEFAULT_REPEAT_PROMPT = workflow.DEFAULT_REPEAT_PROMPT;
export const AI_REVIEW_FILTER_FIELDS: (keyof FileFilter)[] = [
  "includeExtensions",
  "includeFiles",
  "ignoreFiles",
  "ignoreDirs",
];
export const AI_REVIEW_FILTER_LABELS = [
  "aiReviewIncludeExtensions",
  "aiReviewIncludeFiles",
  "aiReviewIgnoreFiles",
  "aiReviewIgnoreDirs",
];
export const AI_REVIEW_PROMPTS = [
  {
    key: "ai_review_prompt",
    value: AI_REVIEW_DEFAULT_PROMPT,
    label: "aiReviewFeedbackPrompt",
    hint: "aiReviewPromptHint",
    reset: "resetAiReviewPrompt",
  },
  {
    key: "ai_review_fresh_prompt",
    value: AI_REVIEW_DEFAULT_FRESH_PROMPT,
    label: "aiReviewFreshPrompt",
    hint: "aiReviewFreshPromptHint",
    reset: "resetAiReviewFreshPrompt",
  },
  {
    key: "ai_review_import_prompt",
    value: AI_REVIEW_DEFAULT_IMPORT_PROMPT,
    label: "aiReviewImportPromptSetting",
    hint: "aiReviewImportPromptSettingHint",
    reset: "resetAiReviewImportPrompt",
  },
  {
    key: "ai_review_reply_prompt",
    value: AI_REVIEW_DEFAULT_REPLY_PROMPT,
    label: "aiReviewReplyPromptSetting",
    hint: "aiReviewReplyPromptSettingHint",
    reset: "resetAiReviewReplyPrompt",
  },
  {
    key: "ai_review_repeat_prompt",
    value: AI_REVIEW_DEFAULT_REPEAT_PROMPT,
    label: "aiReviewRepeatPrompt",
    hint: "aiReviewPromptHint",
    reset: "resetAiReviewRepeatPrompt",
  },
];
export const AI_REVIEW_RULES = workflow.INSTRUCTION_BLOCKS;
const BASE_DEFAULTS = {
  ...BUTTON_DEFAULTS,
  language: "auto",
  sound_enabled: false,
  notifications_enabled: true,
  show_time_tracker: true,
  show_failed_job_view: true,
  skip_confirmations: false,
  dim_drafts: false,
  highlight_own_mrs: false,
  show_only_mine: false,
  show_needs_review: false,
  show_reviewer_badge: false,
  show_jira_details: false,
  show_copy_mr: false,
  show_threads_badge: false,
  show_size_badge: false,
  show_conflicts_badge: false,
  show_approval_badge: false,
  show_branches: true,
  show_branches_links: false,
  // show_group_by_author: false,
  collapse_bars: false,
  hide_right_sidebar: false,
  show_cmd_palette: true,
  show_standup: true,
  standup_jira_enrich: true,
  show_sensitive_warning: false,
  show_git_commands: false,
  show_ai_review_copy: true,
  ai_review_prompt: AI_REVIEW_DEFAULT_PROMPT,
  ai_review_fresh_prompt: AI_REVIEW_DEFAULT_FRESH_PROMPT,
  ai_review_import_prompt: AI_REVIEW_DEFAULT_IMPORT_PROMPT,
  ai_review_reply_prompt: AI_REVIEW_DEFAULT_REPLY_PROMPT,
  ai_review_repeat_prompt: AI_REVIEW_DEFAULT_REPEAT_PROMPT,
  ai_review_file_filter: {
    includeExtensions: "",
    includeFiles: "",
    ignoreFiles: "",
    ignoreDirs: "",
  },
  ai_review_response_language: "auto",
  ai_review_confirm_close: false,
  ai_review_fresh_existing: false,
  show_cherry_pick: true,
  show_commit_version: false,
  show_group_play: true,
  cherry_pick_branches: [] as string[],
  cherry_pick_create_mr: true,
  cherry_pick_smart_fallback: true,
  cherry_pick_bump_version: false,
  commits_jira_field: "fixVersions, status",
  jira_url: "",
  jira_ticket_regex: "",
  quickComments: [] as QuickComment[],
  jiraQuickActions: [] as JiraQuickAction[],
  reviewersList: "",
  reviewersJob: "get-reviewers",
  customJobs: [] as CustomJob[],
  mrActions: [] as MrAction[],
  buttonOrder: [] as string[],
  projectProfiles: {} as Record<string, ProjectProfile>,
  // Version bump settings
  versionFile: "package.json",
  versionPath: "version",
  versionStrategy: "patch",
  versionCommitTemplate: "fix: bump version to {version}",
  version_from_target: false,
};
export const MR_ACTION_TYPES = [
  "remove_labels",
  "clear_labels",
  "add_labels",
  "set_labels",
  "clear_assignees",
  "clear_reviewers",
  "clear_milestone",
];
export const JIRA_ACTION_FIELDS = [
  ["status", "jiraQuickActionStatus"],
  ["assignee", "jiraQuickActionAssignee"],
  ["labels", "jiraSidebarLabels"],
  ["fixVersions", "jiraSidebarFixVersions"],
  ["versions", "jiraSidebarAffectsVersions"],
  ["components", "jiraSidebarComponents"],
  ["priority", "jiraSidebarPriority"],
  ["duedate", "jiraQuickActionDueDate"],
  ["custom", "jiraQuickActionCustom"],
];
export const SETTINGS_FILE_MAX_BYTES = 1024 * 1024;
export type Settings = typeof BASE_DEFAULTS & Record<string, unknown>;
export const DEFAULTS: Settings = Object.assign(
  {},
  BASE_DEFAULTS,
  workflow.instructionDefaults(),
);
