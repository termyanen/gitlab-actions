import * as workflow from "../../../entities/review";
import { VERSION_DEFAULTS } from "../../../entities/settings";
import {
  AI_REVIEW_FILTER_FIELDS,
  AI_REVIEW_PROMPTS,
  AI_REVIEW_PROMPT_MAX_LENGTH,
  AI_REVIEW_RULES,
} from "../../../features/manage-settings";
import { readDisplayPreferencesForm } from "./display-preferences";
import { inputById, valueControlById } from "./dom";
import type { SettingsFormContext } from "./form-context";
export function createSettingsPersistence(context: SettingsFormContext) {
  const { state, t, showSaveFailed, showSaved } = context;
  const { getButtonOrderFromUI } = context.order;
  const {
    getMrActionsFromUI,
    getJiraQuickActionsFromUI,
    getQuickCommentsFromUI,
    getCherryPickBranchesFromUI,
    getCustomJobsFromUI,
  } = context.editors;

  function saveDefaultTab(
    onSaved?: (() => void) | null,
    onFailed?: (() => void) | null,
  ) {
    let jiraQuickActions, mrActions, displayPreferences;
    try {
      jiraQuickActions = getJiraQuickActionsFromUI();
      mrActions = getMrActionsFromUI("mrActionsList", true);
      displayPreferences = readDisplayPreferencesForm(t);
    } catch (error) {
      showSaveFailed(error instanceof Error ? error.message : String(error));
      return false;
    }
    const prompts: Record<string, string> = {};
    // Validate every prompt before saving any setting, including escaped UTF-8 bytes.
    const invalidPrompt = AI_REVIEW_PROMPTS.some(function (prompt) {
      const value = valueControlById(prompt.key).value.trim() || prompt.value;
      prompts[prompt.key] = value;
      return (
        value.length > AI_REVIEW_PROMPT_MAX_LENGTH ||
        new TextEncoder().encode(JSON.stringify(value)).length +
          prompt.key.length >
          8192
      );
    });
    if (invalidPrompt) {
      showSaveFailed(t("aiReviewPromptTooLong"));
      return false;
    }
    const rules: Record<string, workflow.InstructionSetting> = {};
    try {
      AI_REVIEW_RULES.forEach(function (block) {
        const key = workflow.INSTRUCTION_PREFIX + block.id;
        rules[key] = workflow.normalizeInstruction(block, {
          enabled: inputById(key + "_enabled").checked,
          text: valueControlById(key).value,
        });
      });
    } catch {
      showSaveFailed(t("aiReviewPromptTooLong"));
      return false;
    }
    let fileFilter: workflow.FileFilter = {
      includeExtensions: "",
      includeFiles: "",
      ignoreFiles: "",
      ignoreDirs: "",
    };
    AI_REVIEW_FILTER_FIELDS.forEach(function (key) {
      fileFilter[key] = valueControlById(
        "ai_review_filter_" + key,
      ).value.trim();
    });
    try {
      fileFilter = workflow.normalizeFilter(fileFilter);
    } catch {
      showSaveFailed(t("aiReviewFilterInvalid"));
      return false;
    }
    const saveVersion = state.statusVersion;
    const items = getButtonOrderFromUI("buttonOrder");
    const settings: Record<string, unknown> = { ...displayPreferences };

    items.forEach(function (it) {
      if (!it.isCustom) settings[it.key] = it.enabled;
    });

    settings.buttonOrder = items.map(function (it) {
      return it.key;
    });
    settings.sound_enabled = inputById("sound_enabled").checked;
    settings.notifications_enabled = inputById("notifications_enabled").checked;
    settings.show_time_tracker = inputById("show_time_tracker").checked;
    settings.show_failed_job_view = inputById("show_failed_job_view").checked;
    settings.skip_confirmations = inputById("skip_confirmations").checked;
    settings.dim_drafts = inputById("dim_drafts").checked;
    settings.highlight_own_mrs = inputById("highlight_own_mrs").checked;
    settings.show_only_mine = inputById("show_only_mine").checked;
    settings.show_needs_review = inputById("show_needs_review").checked;
    settings.show_reviewer_badge = inputById("show_reviewer_badge").checked;
    settings.show_copy_mr = inputById("show_copy_mr").checked;
    settings.show_threads_badge = inputById("show_threads_badge").checked;
    settings.show_size_badge = inputById("show_size_badge").checked;
    settings.show_conflicts_badge = inputById("show_conflicts_badge").checked;
    settings.show_approval_badge = inputById("show_approval_badge").checked;
    settings.show_branches = inputById("show_branches").checked;
    settings.show_branches_links = inputById("show_branches_links").checked;
    settings.collapse_bars = inputById("collapse_bars").checked;
    settings.hide_right_sidebar = inputById("hide_right_sidebar").checked;
    settings.show_cmd_palette = inputById("show_cmd_palette").checked;
    settings.show_standup = inputById("show_standup").checked;
    settings.standup_jira_enrich = inputById("standup_jira_enrich").checked;
    settings.show_cherry_pick = inputById("show_cherry_pick").checked;
    settings.show_commit_version = inputById("show_commit_version").checked;
    settings.show_group_play = inputById("show_group_play").checked;
    settings.show_sensitive_warning = inputById(
      "show_sensitive_warning",
    ).checked;
    settings.show_git_commands = inputById("show_git_commands").checked;
    settings.show_ai_review_copy = inputById("show_ai_review_copy").checked;
    settings.ai_review_confirm_close = inputById(
      "ai_review_confirm_close",
    ).checked;
    settings.ai_review_response_language = workflow.normalizeResponseLanguage(
      valueControlById("ai_review_response_language").value,
    );
    Object.assign(settings, prompts);
    Object.assign(settings, rules);
    settings.ai_review_file_filter = fileFilter;
    settings.cherry_pick_create_mr = inputById("cherry_pick_create_mr").checked;
    settings.cherry_pick_smart_fallback = inputById(
      "cherry_pick_smart_fallback",
    ).checked;
    settings.cherry_pick_bump_version = inputById(
      "cherry_pick_bump_version",
    ).checked;
    settings.commits_jira_field =
      (valueControlById("commits_jira_field").value || "").trim() ||
      "fixVersions, status";
    settings.cherry_pick_branches = getCherryPickBranchesFromUI();
    const newJiraUrl = (valueControlById("jira_url").value || "")
      .trim()
      .replace(/\/+$/, "");
    if (newJiraUrl && newJiraUrl !== state.data.jira_url) {
      // Request host permission for Jira domain
      chrome.permissions.request(
        { origins: [newJiraUrl + "/"] },
        function (granted) {
          if (!granted) {
            valueControlById("jira_url").value = state.data.jira_url || "";
          }
        },
      );
    }
    settings.jira_url = newJiraUrl;
    settings.jira_ticket_regex = (
      valueControlById("jira_ticket_regex").value || ""
    ).trim();
    settings.show_jira_details = inputById("show_jira_details").checked;
    settings.jiraQuickActions = jiraQuickActions;
    settings.language = valueControlById("language").value || "auto";
    settings.quickComments = getQuickCommentsFromUI();
    settings.reviewersList = (
      valueControlById("reviewersList").value || ""
    ).trim();
    settings.reviewersJob = (
      valueControlById("reviewersJob").value || ""
    ).trim();
    settings.mrActions = mrActions;
    settings.customJobs = getCustomJobsFromUI("customJobsList").filter(
      function (j) {
        return j.label && j.jobName;
      },
    );
    settings.projectProfiles = state.data.projectProfiles || {};

    // Version bump settings
    const presetVal = valueControlById("versionFilePreset").value;
    if (presetVal === "custom") {
      settings.versionFile =
        (valueControlById("versionFile").value || "").trim() || "package.json";
    } else {
      settings.versionFile = presetVal;
    }
    settings.versionPath =
      (valueControlById("versionPath").value || "").trim() || "version";
    settings.versionStrategy =
      valueControlById("versionStrategy").value || "patch";
    settings.versionCommitTemplate =
      (valueControlById("versionCommitTemplate").value || "").trim() ||
      VERSION_DEFAULTS.versionCommitTemplate;
    settings.version_from_target = inputById("version_from_target").checked;

    Object.assign(state.data, settings);

    chrome.storage.sync.set(settings, function () {
      const failed = !!chrome.runtime.lastError;
      showSaved(saveVersion);
      if (!failed && onSaved) onSaved();
      if (failed && onFailed) onFailed();
    });
    return true;
  }

  function saveProfileTab(
    path: string,
    onSaved?: (() => void) | null,
    onFailed?: (() => void) | null,
  ) {
    const saveVersion = state.statusVersion;
    let mrActions;
    try {
      mrActions = getMrActionsFromUI("profileMrActionsList", true);
    } catch (error) {
      showSaveFailed(error instanceof Error ? error.message : String(error));
      return false;
    }
    const items = getButtonOrderFromUI("profileButtonOrder");
    const buttons: Record<string, boolean> = {};
    items.forEach(function (it) {
      if (!it.isCustom) buttons[it.key] = it.enabled;
    });

    // Version bump
    const pPresetVal = valueControlById("profileVersionFilePreset").value;
    let profileVersionFile = "";
    if (pPresetVal === "__custom__") {
      profileVersionFile = (
        valueControlById("profileVersionFile").value || ""
      ).trim();
    } else if (pPresetVal) {
      profileVersionFile = pPresetVal;
    }

    const profile = {
      buttons: buttons,
      mrActions: mrActions,
      buttonOrder: items.map(function (it) {
        return it.key;
      }),
      versionFile: profileVersionFile,
      versionPath: (valueControlById("profileVersionPath").value || "").trim(),
      versionStrategy: valueControlById("profileVersionStrategy").value || "",
      versionCommitTemplate: (
        valueControlById("profileVersionCommitTemplate").value || ""
      ).trim(),
      reviewersList: (
        valueControlById("profileReviewersList").value || ""
      ).trim(),
      reviewersJob: (
        valueControlById("profileReviewersJob").value || ""
      ).trim(),
      customJobs: getCustomJobsFromUI("profileCustomJobsList").filter(
        function (j) {
          return j.label && j.jobName;
        },
      ),
    };

    if (!state.data.projectProfiles) state.data.projectProfiles = {};
    state.data.projectProfiles[path] = profile;

    chrome.storage.sync.set(
      { projectProfiles: state.data.projectProfiles },
      function () {
        const failed = !!chrome.runtime.lastError;
        showSaved(saveVersion);
        if (!failed && onSaved) onSaved();
        if (failed && onFailed) onFailed();
      },
    );
    return true;
  }
  return { saveDefaultTab, saveProfileTab };
}
