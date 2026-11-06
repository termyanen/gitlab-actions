import * as workflow from "../../../entities/review";
import { REVIEW_GUIDE_URL } from "../../../shared/config/extension";
import { MR_DEFAULTS, VERSION_DEFAULTS } from "../../../entities/settings";
import {
  AI_REVIEW_FILTER_FIELDS,
  AI_REVIEW_FILTER_LABELS,
  AI_REVIEW_PROMPT_MAX_LENGTH,
  AI_REVIEW_PROMPTS,
  AI_REVIEW_RULES,
  BUILTIN_BUTTONS,
  BUTTON_DEFAULTS,
} from "../../../features/manage-settings";
import { byId, escHtml } from "./dom";
import type { SettingsFormContext } from "./form-context";
export function createDefaultSettingsForm(context: SettingsFormContext) {
  const {
    state,
    t,
    scheduleAutoSave,
    loadLanguage,
    localizeHeader,
    renderTabs,
    renderActiveTab,
    saveDefaultTab,
  } = context;
  const { buildOrderedList, renderButtonOrder } = context.order;
  const {
    renderCustomJobs,
    mrActionsSection,
    setupMrActions,
    renderJiraQuickActions,
    addJiraQuickActionRow,
    renderQuickComments,
    addQuickCommentRow,
    renderCherryPickBranches,
    addCherryPickBranchRow,
    getCustomJobsFromUI,
    rebuildButtonOrderCustom,
  } = context.editors;

  function renderDefaultTab(container: HTMLElement) {
    container.innerHTML = "";
    container.innerHTML =
      "<h4>" +
      escHtml(t("buttonOrder")) +
      "</h4>" +
      '<div class="hint" style="margin-bottom:6px">' +
      escHtml(t("buttonOrderHint")) +
      "</div>" +
      '<div id="buttonOrder"></div>' +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("general")) +
      "</h4>" +
      '<div class="field"><label>' +
      escHtml(t("languageLabel")) +
      "</label>" +
      '<select id="language">' +
      '<option value="auto">' +
      escHtml(t("languageAuto")) +
      "</option>" +
      '<option value="en">English</option>' +
      '<option value="ru">Русский</option>' +
      '<option value="zh_CN">中文</option>' +
      '<option value="ja">日本語</option>' +
      '<option value="de">Deutsch</option>' +
      '<option value="fr">Français</option>' +
      '<option value="es">Español</option>' +
      "</select></div>" +
      '<div class="toggle"><input type="checkbox" id="sound_enabled"><label for="sound_enabled">' +
      escHtml(t("soundNotifications")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="notifications_enabled"><label for="notifications_enabled">' +
      escHtml(t("desktopNotifications")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_time_tracker"><label for="show_time_tracker">' +
      escHtml(t("showTimeTracker")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_failed_job_view"><label for="show_failed_job_view">' +
      escHtml(t("showFailedJobView")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="skip_confirmations"><label for="skip_confirmations">' +
      escHtml(t("skipConfirmations")) +
      "</label></div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("uxEnhancer")) +
      "</h4>" +
      '<div class="toggle"><input type="checkbox" id="dim_drafts"><label for="dim_drafts">' +
      escHtml(t("dimDrafts")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="highlight_own_mrs"><label for="highlight_own_mrs">' +
      escHtml(t("highlightOwnMrs")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_only_mine"><label for="show_only_mine">' +
      escHtml(t("showOnlyMine")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_needs_review"><label for="show_needs_review">' +
      escHtml(t("showNeedsReview")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_reviewer_badge"><label for="show_reviewer_badge">' +
      escHtml(t("showReviewerBadge")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_copy_mr"><label for="show_copy_mr">' +
      escHtml(t("showCopyMr")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_threads_badge"><label for="show_threads_badge">' +
      escHtml(t("showThreadsBadge")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_size_badge"><label for="show_size_badge">' +
      escHtml(t("showSizeBadge")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_conflicts_badge"><label for="show_conflicts_badge">' +
      escHtml(t("showConflictsBadge")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_approval_badge"><label for="show_approval_badge">' +
      escHtml(t("showApprovalBadge")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_branches"><label for="show_branches">' +
      escHtml(t("showBranches")) +
      "</label></div>" +
      '<div class="toggle" style="margin-left:18px"><input type="checkbox" id="show_branches_links"><label for="show_branches_links">' +
      escHtml(t("showBranchesLinks")) +
      "</label></div>" +
      // '<div class="toggle"><input type="checkbox" id="show_group_by_author"><label for="show_group_by_author">' + escHtml(t('showGroupByAuthor')) + '</label></div>' +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("uiCustomization")) +
      "</h4>" +
      '<div class="toggle"><input type="checkbox" id="collapse_bars"><label for="collapse_bars">' +
      escHtml(t("collapseBars")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="hide_right_sidebar"><label for="hide_right_sidebar">' +
      escHtml(t("hideRightSidebar")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_cmd_palette"><label for="show_cmd_palette">' +
      escHtml(t("showCmdPalette")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_standup"><label for="show_standup">' +
      escHtml(t("showStandup")) +
      "</label></div>" +
      '<div class="toggle sub-toggle"><input type="checkbox" id="standup_jira_enrich"><label for="standup_jira_enrich">' +
      escHtml(t("standupJiraEnrich")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_cherry_pick"><label for="show_cherry_pick">' +
      escHtml(t("showCherryPick")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_commit_version"><label for="show_commit_version">' +
      escHtml(t("showCommitVersion")) +
      "</label></div>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("showCommitVersionHint")) +
      "</div>" +
      '<div class="toggle"><input type="checkbox" id="show_group_play"><label for="show_group_play">' +
      escHtml(t("showGroupPlay")) +
      "</label></div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("mrDetailEnhancements")) +
      "</h4>" +
      '<div class="toggle"><input type="checkbox" id="show_sensitive_warning"><label for="show_sensitive_warning">' +
      escHtml(t("showSensitiveWarning")) +
      "</label></div>" +
      '<div class="toggle"><input type="checkbox" id="show_git_commands"><label for="show_git_commands">' +
      escHtml(t("showGitCommands")) +
      "</label></div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("aiReviewSettingsTitle")) +
      "</h4>" +
      '<div class="toggle"><input type="checkbox" id="show_ai_review_copy"><label for="show_ai_review_copy">' +
      escHtml(t("showAiReviewCopy")) +
      "</label></div>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("aiReviewSettingsHint")) +
      "</div>" +
      '<div class="toggle"><input type="checkbox" id="ai_review_confirm_close"><label for="ai_review_confirm_close">' +
      escHtml(t("aiReviewConfirmCloseSetting")) +
      "</label></div>" +
      '<p class="hint">' +
      escHtml(t("aiReviewPrivacyHint")) +
      "</p>" +
      '<p><a class="how-link review-guide-link" href="' +
      escHtml(REVIEW_GUIDE_URL) +
      '" target="_blank" rel="noopener noreferrer">' +
      escHtml(t("aiReviewGuide")) +
      " (EN / RU)</a></p>" +
      '<div class="field ai-review-language"><label for="ai_review_response_language">' +
      escHtml(t("aiReviewResponseLanguage")) +
      "</label>" +
      '<select id="ai_review_response_language"><option value="auto">' +
      escHtml(t("aiReviewResponseLanguageAuto")) +
      "</option>" +
      [
        ["ru", "Русский"],
        ["en", "English"],
        ["de", "Deutsch"],
        ["es", "Español"],
        ["fr", "Français"],
        ["ja", "日本語"],
        ["zh_CN", "简体中文"],
      ]
        .map(function (item) {
          return '<option value="' + item[0] + '">' + item[1] + "</option>";
        })
        .join("") +
      "</select>" +
      '<div class="hint">' +
      escHtml(t("aiReviewResponseLanguageHint")) +
      "</div></div>" +
      AI_REVIEW_PROMPTS.map(function (prompt) {
        const hintId = prompt.key + "_hint";
        return (
          '<div class="field"><label for="' +
          prompt.key +
          '">' +
          escHtml(t(prompt.label)) +
          "</label>" +
          '<textarea id="' +
          prompt.key +
          '" rows="8" maxlength="' +
          AI_REVIEW_PROMPT_MAX_LENGTH +
          '" aria-describedby="' +
          hintId +
          '"></textarea>' +
          '<div class="hint" id="' +
          hintId +
          '">' +
          escHtml(t(prompt.hint)) +
          "</div>" +
          '<button type="button" class="add-btn" id="' +
          prompt.reset +
          '">' +
          escHtml(t("aiReviewResetPrompt")) +
          "</button></div>"
        );
      }).join("") +
      '<details class="ai-review-rules"><summary>' +
      escHtml(t("aiReviewAutomaticInstructions")) +
      "</summary>" +
      '<p class="hint">' +
      escHtml(t("aiReviewAutomaticInstructionsHint")) +
      "</p>" +
      AI_REVIEW_RULES.map(function (block) {
        const key = workflow.INSTRUCTION_PREFIX + block.id;
        const label = t("aiReviewRule_" + block.id);
        return (
          '<details class="ai-review-rule"><summary>' +
          escHtml(label) +
          "</summary>" +
          '<div class="toggle"><input type="checkbox" id="' +
          key +
          '_enabled"><label for="' +
          key +
          '_enabled">' +
          escHtml(t("aiReviewInstructionEnabled")) +
          "</label></div>" +
          '<div class="field"><label for="' +
          key +
          '">' +
          escHtml(label) +
          "</label>" +
          '<textarea id="' +
          key +
          '" rows="8" maxlength="' +
          AI_REVIEW_PROMPT_MAX_LENGTH +
          '" aria-describedby="' +
          key +
          '_hint"></textarea>' +
          '<div class="hint" id="' +
          key +
          '_hint">' +
          escHtml(
            t(
              block.id === "language"
                ? "aiReviewLanguageTemplateHint"
                : block.id === "reply_task"
                  ? "aiReviewSelectionTemplateHint"
                  : "aiReviewInstructionTextHint",
            ),
          ) +
          "</div>" +
          '<button type="button" class="add-btn" id="' +
          key +
          '_reset">' +
          escHtml(t("aiReviewResetPrompt")) +
          "</button></div></details>"
        );
      }).join("") +
      "</details>" +
      "<h4>" +
      escHtml(t("aiReviewFileFilters")) +
      "</h4>" +
      '<p class="hint">' +
      escHtml(t("aiReviewFileFiltersHint")) +
      "</p>" +
      AI_REVIEW_FILTER_FIELDS.map(function (key, index) {
        return (
          '<div class="field"><label for="ai_review_filter_' +
          key +
          '">' +
          escHtml(t(AI_REVIEW_FILTER_LABELS[index])) +
          '</label><textarea id="ai_review_filter_' +
          key +
          '" rows="3" maxlength="' +
          AI_REVIEW_PROMPT_MAX_LENGTH +
          '"></textarea></div>'
        );
      }).join("") +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("cherryPickBranches")) +
      "</h4>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("cherryPickBranchesHint")) +
      "</div>" +
      '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="cherry_pick_create_mr"><label for="cherry_pick_create_mr">' +
      escHtml(t("cherryPickCreateMrDefault")) +
      "</label></div>" +
      '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="cherry_pick_smart_fallback"><label for="cherry_pick_smart_fallback">' +
      escHtml(t("cherryPickSmartFallback")) +
      "</label></div>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("cherryPickSmartFallbackHint")) +
      "</div>" +
      '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="cherry_pick_bump_version"><label for="cherry_pick_bump_version">' +
      escHtml(t("cherryPickBumpVersion")) +
      "</label></div>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("cherryPickBumpVersionHint")) +
      "</div>" +
      '<div id="cherryPickBranchesList"></div>' +
      '<button type="button" id="addCherryPickBranch" class="add-btn">+ ' +
      escHtml(t("cherryPickBranchAdd")) +
      "</button>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("jiraIntegration")) +
      "</h4>" +
      '<div class="field"><label>' +
      escHtml(t("jiraUrl")) +
      '</label><input type="text" id="jira_url" placeholder="https://jira.company.com"><div class="hint">' +
      escHtml(t("jiraUrlHint")) +
      "</div></div>" +
      '<div class="field"><label>' +
      escHtml(t("jiraTicketRegex")) +
      '</label><input type="text" id="jira_ticket_regex" placeholder="[A-Z][A-Z0-9]+-\\d+"><div class="hint">' +
      escHtml(t("jiraTicketRegexHint")) +
      "</div></div>" +
      '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="show_jira_details"><label for="show_jira_details">' +
      escHtml(t("showJiraDetails")) +
      "</label></div>" +
      '<div class="field"><label>' +
      escHtml(t("jiraQuickActions")) +
      '</label><div class="hint">' +
      escHtml(t("jiraQuickActionsHint")) +
      '</div><div id="jiraQuickActionsList"></div>' +
      '<button type="button" id="addJiraQuickAction" class="add-btn">+ ' +
      escHtml(t("jiraQuickActionsAdd")) +
      "</button></div>" +
      '<div class="field"><label>' +
      escHtml(t("commitsJiraField")) +
      '</label><input type="text" id="commits_jira_field" placeholder="fixVersions, status"><div class="hint">' +
      escHtml(t("commitsJiraFieldHint")) +
      "</div></div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("versionBump")) +
      "</h4>" +
      '<div class="field"><label>' +
      escHtml(t("filePath")) +
      "</label>" +
      '<select id="versionFilePreset" style="margin-bottom:4px">' +
      '<option value="package.json">package.json</option>' +
      '<option value="pyproject.toml">pyproject.toml</option>' +
      '<option value="version.txt">version.txt (' +
      escHtml(t("plainText")) +
      ")</option>" +
      '<option value="custom">' +
      escHtml(t("customFile")) +
      "</option>" +
      "</select>" +
      '<input type="text" id="versionFile" placeholder="path/to/file" style="display:none">' +
      '<div class="hint">' +
      escHtml(t("filePathHint")) +
      "</div></div>" +
      '<div class="field" id="versionPathField"><label>' +
      escHtml(t("versionField")) +
      '</label><input type="text" id="versionPath" placeholder="version">' +
      '<div class="hint">' +
      escHtml(t("versionFieldHint")) +
      "</div></div>" +
      '<div class="field"><label>' +
      escHtml(t("strategy")) +
      "</label>" +
      '<select id="versionStrategy">' +
      '<option value="patch">' +
      escHtml(t("strategyPatch")) +
      "</option>" +
      '<option value="minor">' +
      escHtml(t("strategyMinor")) +
      "</option>" +
      '<option value="major">' +
      escHtml(t("strategyMajor")) +
      "</option>" +
      "</select></div>" +
      '<div class="field"><label>' +
      escHtml(t("commitMessage")) +
      '</label><input type="text" id="versionCommitTemplate" placeholder="' +
      escHtml(VERSION_DEFAULTS.versionCommitTemplate) +
      '">' +
      '<div class="hint">' +
      escHtml(t("commitMessageHint")) +
      "</div></div>" +
      '<div class="toggle"><input type="checkbox" id="version_from_target"><label for="version_from_target">' +
      escHtml(t("versionFromTarget")) +
      "</label></div>" +
      '<div class="hint">' +
      escHtml(t("versionFromTargetHint")) +
      "</div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("quickComments")) +
      "</h4>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("quickCommentsHint")) +
      "</div>" +
      '<div id="quickCommentsList"></div>' +
      '<button type="button" id="addQuickComment" class="add-btn">+ ' +
      escHtml(t("quickCommentsAdd")) +
      "</button>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("reviewers")) +
      "</h4>" +
      '<div class="field"><label>' +
      escHtml(t("reviewersList")) +
      '</label><input type="text" id="reviewersList" placeholder="@user1, @user2"><div class="hint">' +
      escHtml(t("reviewersListHint")) +
      "</div></div>" +
      '<div class="field"><label>' +
      escHtml(t("jobName")) +
      '</label><input type="text" id="reviewersJob" placeholder="' +
      escHtml(MR_DEFAULTS.reviewersJob) +
      '"><div class="hint">' +
      escHtml(t("jobNameHint")) +
      "</div></div>" +
      '<div class="sep"></div>' +
      "<h4>" +
      escHtml(t("customJobButtons")) +
      "</h4>" +
      '<div class="hint" style="margin-bottom:8px">' +
      escHtml(t("customJobsHint")) +
      "</div>" +
      '<div id="customJobsList"></div>' +
      '<button class="add-btn" id="addCustomJob">' +
      escHtml(t("addJobButton")) +
      "</button>" +
      mrActionsSection("mrActionsList", "addMrAction");

    const enabledMap: Record<string, boolean> = {};
    BUILTIN_BUTTONS.forEach(function (b) {
      enabledMap[b.key] =
        state.data[b.key] !== undefined
          ? !!state.data[b.key]
          : (BUTTON_DEFAULTS as Record<string, boolean>)[b.key];
    });

    const customJobs = state.data.customJobs || [];
    const ordered = buildOrderedList(
      state.data.buttonOrder || [],
      enabledMap,
      customJobs,
      state.data.mrActions || [],
    );
    renderButtonOrder(ordered, "buttonOrder");
    renderCustomJobs(customJobs, "customJobsList", "buttonOrder");
    setupMrActions(
      state.data.mrActions || [],
      "mrActionsList",
      "addMrAction",
      "buttonOrder",
    );

    byId<HTMLInputElement>("sound_enabled").checked =
      state.data.sound_enabled || false;
    byId<HTMLInputElement>("notifications_enabled").checked =
      state.data.notifications_enabled !== false;
    byId<HTMLInputElement>("show_time_tracker").checked =
      state.data.show_time_tracker !== false;
    byId<HTMLInputElement>("show_failed_job_view").checked =
      state.data.show_failed_job_view !== false;
    byId<HTMLInputElement>("skip_confirmations").checked =
      state.data.skip_confirmations || false;
    byId<HTMLInputElement>("dim_drafts").checked =
      state.data.dim_drafts || false;
    byId<HTMLInputElement>("highlight_own_mrs").checked =
      state.data.highlight_own_mrs || false;
    byId<HTMLInputElement>("show_only_mine").checked =
      state.data.show_only_mine || false;
    byId<HTMLInputElement>("show_needs_review").checked =
      state.data.show_needs_review || false;
    byId<HTMLInputElement>("show_reviewer_badge").checked =
      state.data.show_reviewer_badge || false;
    byId<HTMLInputElement>("show_copy_mr").checked =
      state.data.show_copy_mr || false;
    byId<HTMLInputElement>("show_threads_badge").checked =
      state.data.show_threads_badge || false;
    byId<HTMLInputElement>("show_size_badge").checked =
      state.data.show_size_badge || false;
    byId<HTMLInputElement>("show_conflicts_badge").checked =
      state.data.show_conflicts_badge || false;
    byId<HTMLInputElement>("show_approval_badge").checked =
      state.data.show_approval_badge || false;
    byId<HTMLInputElement>("show_branches").checked =
      state.data.show_branches !== false;
    byId<HTMLInputElement>("show_branches_links").checked =
      state.data.show_branches_links || false;
    // byId<HTMLInputElement>('show_group_by_author').checked = allData.show_group_by_author || false;
    byId<HTMLInputElement>("collapse_bars").checked =
      state.data.collapse_bars || false;
    byId<HTMLInputElement>("hide_right_sidebar").checked =
      state.data.hide_right_sidebar || false;
    byId<HTMLInputElement>("show_cmd_palette").checked =
      state.data.show_cmd_palette !== false;
    byId<HTMLInputElement>("show_standup").checked =
      state.data.show_standup !== false;
    byId<HTMLInputElement>("standup_jira_enrich").checked =
      state.data.standup_jira_enrich !== false;
    byId<HTMLInputElement>("show_cherry_pick").checked =
      state.data.show_cherry_pick !== false;
    byId<HTMLInputElement>("show_commit_version").checked =
      state.data.show_commit_version || false;
    byId<HTMLInputElement>("show_group_play").checked =
      state.data.show_group_play !== false;
    byId<HTMLInputElement>("show_sensitive_warning").checked =
      state.data.show_sensitive_warning || false;
    byId<HTMLInputElement>("show_git_commands").checked =
      state.data.show_git_commands || false;
    byId<HTMLInputElement>("show_ai_review_copy").checked =
      state.data.show_ai_review_copy !== false;
    byId<HTMLInputElement>("ai_review_confirm_close").checked =
      state.data.ai_review_confirm_close === true;
    byId<HTMLInputElement>("ai_review_response_language").value =
      workflow.normalizeResponseLanguage(
        state.data.ai_review_response_language,
      );
    AI_REVIEW_PROMPTS.forEach(function (prompt) {
      const input = byId<HTMLInputElement>(prompt.key);
      input.value =
        typeof state.data[prompt.key] === "string"
          ? (state.data[prompt.key] as string)
          : prompt.value;
      input.placeholder = prompt.value;
      byId(prompt.reset).addEventListener("click", function () {
        input.value = prompt.value;
        scheduleAutoSave();
      });
    });
    AI_REVIEW_RULES.forEach(function (block) {
      const key = workflow.INSTRUCTION_PREFIX + block.id;
      let value;
      try {
        value = workflow.normalizeInstruction(block, state.data[key]);
      } catch {
        value = { enabled: true, text: block.text };
      }
      byId<HTMLInputElement>(key).value = value.text;
      byId<HTMLInputElement>(key).placeholder = block.text;
      byId<HTMLInputElement>(key + "_enabled").checked = value.enabled;
      byId(key + "_reset").addEventListener("click", function () {
        byId<HTMLInputElement>(key).value = block.text;
        byId<HTMLInputElement>(key + "_enabled").checked = true;
        scheduleAutoSave();
      });
    });
    AI_REVIEW_FILTER_FIELDS.forEach(function (key) {
      byId<HTMLInputElement>("ai_review_filter_" + key).value =
        state.data.ai_review_file_filter &&
        typeof state.data.ai_review_file_filter[key] === "string"
          ? state.data.ai_review_file_filter[key]
          : "";
    });
    byId<HTMLInputElement>("cherry_pick_create_mr").checked =
      state.data.cherry_pick_create_mr !== false;
    byId<HTMLInputElement>("cherry_pick_smart_fallback").checked =
      state.data.cherry_pick_smart_fallback !== false;
    byId<HTMLInputElement>("cherry_pick_bump_version").checked =
      state.data.cherry_pick_bump_version || false;
    byId<HTMLInputElement>("commits_jira_field").value =
      state.data.commits_jira_field || "fixVersions, status";
    renderCherryPickBranches(state.data.cherry_pick_branches || []);
    byId("addCherryPickBranch").addEventListener("click", function () {
      addCherryPickBranchRow("");
    });
    byId<HTMLInputElement>("jira_url").value = state.data.jira_url || "";
    byId<HTMLInputElement>("jira_ticket_regex").value =
      state.data.jira_ticket_regex || "";
    byId<HTMLInputElement>("show_jira_details").checked =
      state.data.show_jira_details || false;
    renderJiraQuickActions(state.data.jiraQuickActions || []);
    byId("addJiraQuickAction").addEventListener("click", function () {
      addJiraQuickActionRow({});
    });
    byId<HTMLInputElement>("language").value = state.data.language || "auto";

    // Language change needs full re-render
    byId("language").addEventListener("change", function (event) {
      event.stopPropagation();
      clearTimeout(state.autoSaveTimer ?? undefined);
      state.autoSaveTimer = null;
      const newLang = byId<HTMLInputElement>("language").value;
      // Save every edited field before rebuilding the form in the new language.
      saveDefaultTab(function () {
        loadLanguage(newLang, function () {
          localizeHeader();
          renderTabs();
          renderActiveTab();
        });
      });
    });
    renderQuickComments(state.data.quickComments || []);
    byId("addQuickComment").addEventListener("click", function () {
      addQuickCommentRow("", "");
    });
    byId<HTMLInputElement>("reviewersList").value =
      state.data.reviewersList || "";
    byId<HTMLInputElement>("reviewersJob").value =
      state.data.reviewersJob || MR_DEFAULTS.reviewersJob;

    // Version bump settings
    const versionFile = state.data.versionFile || "package.json";
    const presetEl = byId<HTMLInputElement>("versionFilePreset");
    const customInput = byId<HTMLInputElement>("versionFile");
    const versionPathField = byId("versionPathField");

    const knownPresets = ["package.json", "pyproject.toml", "version.txt"];
    if (knownPresets.indexOf(versionFile) !== -1) {
      presetEl.value = versionFile;
    } else {
      presetEl.value = "custom";
      customInput.style.display = "";
      customInput.value = versionFile;
    }
    updateVersionPathVisibility();

    presetEl.addEventListener("change", function () {
      if (presetEl.value === "custom") {
        customInput.style.display = "";
        customInput.value = "";
      } else {
        customInput.style.display = "none";
        customInput.value = "";
      }
      updateVersionPathVisibility();
      // Auto-suggest version path placeholder based on file type
      const pathInput = byId<HTMLInputElement>("versionPath");
      if (presetEl.value === "pyproject.toml") {
        pathInput.placeholder = "tool.poetry.version";
      } else {
        pathInput.placeholder = "version";
      }
    });

    function updateVersionPathVisibility() {
      const val =
        presetEl.value === "custom" ? customInput.value || "" : presetEl.value;
      // Hide version path for plain text files
      if (val === "version.txt" || val.match(/\.(txt|VERSION)$/i)) {
        versionPathField.style.display = "none";
      } else {
        versionPathField.style.display = "";
      }
    }

    byId<HTMLInputElement>("versionPath").value =
      state.data.versionPath || "version";
    byId<HTMLInputElement>("versionStrategy").value =
      state.data.versionStrategy || "patch";
    byId<HTMLInputElement>("versionCommitTemplate").value =
      state.data.versionCommitTemplate ||
      VERSION_DEFAULTS.versionCommitTemplate;
    byId<HTMLInputElement>("version_from_target").checked =
      state.data.version_from_target || false;

    byId("addCustomJob").addEventListener("click", function () {
      const current = getCustomJobsFromUI("customJobsList");
      current.push({ label: "", jobName: "" });
      renderCustomJobs(current, "customJobsList", "buttonOrder");
      rebuildButtonOrderCustom("buttonOrder", "customJobsList");
    });
  }
  return { renderDefaultTab };
}
