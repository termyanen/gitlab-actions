import type { ButtonItem } from "../model/types";
import { byId, escHtml } from "./dom";
import { createActionEditors } from "./action-editors";
const {
  renderCustomJobs,
  mrActionsSection,
  getMrActionsFromUI,
  setupMrActions,
  renderJiraQuickActions,
  addJiraQuickActionRow,
  getJiraQuickActionsFromUI,
  renderQuickComments,
  addQuickCommentRow,
  getQuickCommentsFromUI,
  renderCherryPickBranches,
  addCherryPickBranchRow,
  getCherryPickBranchesFromUI,
  getCustomJobsFromUI,
  rebuildButtonOrderCustom,
} = createActionEditors({
  t,
  scheduleAutoSave: () => scheduleAutoSave(),
  getButtonOrderFromUI: (id) => getButtonOrderFromUI(id),
  renderButtonOrder: (items, id) => renderButtonOrder(items, id),
  validateMrActions: (actions) => validateMrActions(actions),
});

import * as workflow from "../../../entities/review";
import type { CustomJob, MrAction } from "../../../entities/settings";
import { createSettingsValidation } from "../../../features/manage-settings";
const { validateMrActions, settingsSnapshot, parseSettingsFile } =
  createSettingsValidation(t);
import type { Settings } from "../../../features/manage-settings";
import {
  BUILTIN_BUTTONS,
  BUTTON_DEFAULTS,
  AI_REVIEW_PROMPT_MAX_LENGTH,
  AI_REVIEW_FILTER_FIELDS,
  AI_REVIEW_FILTER_LABELS,
  AI_REVIEW_PROMPTS,
  AI_REVIEW_RULES,
  DEFAULTS,
  SETTINGS_FILE_MAX_BYTES,
} from "../../../features/manage-settings";
if (window.innerWidth > 400) {
  document.addEventListener("DOMContentLoaded", function () {
    document.body.classList.add("fullpage");
  });
}

let _i18nMessages: Record<string, { message: string }> | null = null;

function t(key: string, substitutions?: string[]) {
  // Use manually loaded messages if available
  if (_i18nMessages && _i18nMessages[key]) {
    let msg = _i18nMessages[key].message || "";
    if (substitutions && substitutions.length) {
      for (let i = 0; i < substitutions.length; i++) {
        msg = msg.replace("$" + (i + 1), substitutions[i]);
      }
    }
    return msg;
  }
  const msg = chrome.i18n.getMessage(key, substitutions);
  return msg || key;
}

function loadLanguage(lang: string, callback: () => void) {
  if (!lang || lang === "auto") {
    _i18nMessages = null;
    callback();
    return;
  }
  fetch(chrome.runtime.getURL("_locales/" + lang + "/messages.json"))
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      _i18nMessages = data;
      callback();
    })
    .catch(function () {
      _i18nMessages = null;
      callback();
    });
}

function localizeHeader() {
  byId("howLink").textContent = t("howItWorks");
  const openTab = byId("openSettingsTab");
  openTab.title = t("openSettingsInTab");
  openTab.setAttribute("aria-label", t("openSettingsInTab"));
  [
    "exportSettings",
    "importSettings",
    "settingsTransferHint",
    "settingsImportReplace",
    "applySettingsImport",
    "cancelSettingsImport",
  ].forEach(function (key) {
    byId(key).textContent = t(key);
  });
}

let currentProjectPath: string | null = null;

let activeTab = "default";

let allData: Partial<Settings> = {};

function detectCurrentProject() {
  return new Promise<void>(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0] && tabs[0].url) {
        const m = tabs[0].url.match(
          /https?:\/\/[^/]+\/(.+?)\/-\/merge_requests/,
        );
        if (m) {
          currentProjectPath = m[1];
          const el = byId("currentProject");
          el.textContent = t("current", [currentProjectPath]);
          el.style.display = "";
        }
      }
      resolve();
    });
  });
}

function renderTabs() {
  const container = byId("tabs");
  container.innerHTML =
    '<div class="tab' +
    (activeTab === "default" ? " active" : "") +
    '" data-tab="default">' +
    escHtml(t("default")) +
    "</div>";

  const profiles = allData.projectProfiles || {};
  Object.keys(profiles).forEach(function (path) {
    const tab = document.createElement("div");
    tab.className = "tab" + (activeTab === path ? " active" : "");
    tab.setAttribute("data-tab", path);
    // Show short name
    const shortName = path.split("/").pop()!;
    tab.innerHTML =
      escHtml(shortName) +
      '<span class="tab-remove" data-path="' +
      escHtml(path) +
      '">&times;</span>';
    container.appendChild(tab);
  });

  // Tab click handlers
  container.querySelectorAll<HTMLElement>(".tab").forEach(function (tab) {
    tab.addEventListener("click", function (e) {
      if ((e.target as HTMLElement).classList.contains("tab-remove")) {
        const path = (e.target as HTMLElement).getAttribute("data-path")!;
        if (confirm(t("removeProfile", [path]))) {
          if (!flushAutoSave()) return;
          delete allData.projectProfiles![path];
          if (activeTab === path) activeTab = "default";
          renderTabs();
          renderActiveTab();
        }
        return;
      }
      if (!flushAutoSave()) return;
      activeTab = tab.getAttribute("data-tab")!;
      renderTabs();
      renderActiveTab();
    });
  });

  // Show/hide add profile button
  const addBtn = byId("addProfile");
  if (currentProjectPath && !profiles[currentProjectPath]) {
    addBtn.style.display = "";
    addBtn.textContent = t("addProfileFor", [
      currentProjectPath.split("/").pop()!,
    ]);
  } else {
    addBtn.style.display = "none";
  }
}

function renderActiveTab() {
  const contentEl = document.querySelector<HTMLElement>(".tab-content")!;
  if (activeTab === "default") {
    renderDefaultTab(contentEl);
  } else {
    renderProfileTab(contentEl, activeTab);
  }
}

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
    '<p><a class="how-link review-guide-link" href="https://termyanen.github.io/gitlab-actions/review-guide.html" target="_blank" rel="noopener noreferrer">' +
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
        '" rows="8" maxlength="1500" aria-describedby="' +
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
        '" rows="3" maxlength="1500"></textarea></div>'
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
    '</label><input type="text" id="versionCommitTemplate" placeholder="fix: bump version to {version}">' +
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
    '</label><input type="text" id="reviewersJob" placeholder="get-reviewers"><div class="hint">' +
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
      allData[b.key] !== undefined
        ? !!allData[b.key]
        : (BUTTON_DEFAULTS as Record<string, boolean>)[b.key];
  });

  const customJobs = allData.customJobs || [];
  const ordered = buildOrderedList(
    allData.buttonOrder || [],
    enabledMap,
    customJobs,
    allData.mrActions || [],
  );
  renderButtonOrder(ordered, "buttonOrder");
  renderCustomJobs(customJobs, "customJobsList", "buttonOrder");
  setupMrActions(
    allData.mrActions || [],
    "mrActionsList",
    "addMrAction",
    "buttonOrder",
  );

  byId<HTMLInputElement>("sound_enabled").checked =
    allData.sound_enabled || false;
  byId<HTMLInputElement>("notifications_enabled").checked =
    allData.notifications_enabled !== false;
  byId<HTMLInputElement>("show_time_tracker").checked =
    allData.show_time_tracker !== false;
  byId<HTMLInputElement>("show_failed_job_view").checked =
    allData.show_failed_job_view !== false;
  byId<HTMLInputElement>("skip_confirmations").checked =
    allData.skip_confirmations || false;
  byId<HTMLInputElement>("dim_drafts").checked = allData.dim_drafts || false;
  byId<HTMLInputElement>("highlight_own_mrs").checked =
    allData.highlight_own_mrs || false;
  byId<HTMLInputElement>("show_only_mine").checked =
    allData.show_only_mine || false;
  byId<HTMLInputElement>("show_needs_review").checked =
    allData.show_needs_review || false;
  byId<HTMLInputElement>("show_reviewer_badge").checked =
    allData.show_reviewer_badge || false;
  byId<HTMLInputElement>("show_copy_mr").checked =
    allData.show_copy_mr || false;
  byId<HTMLInputElement>("show_threads_badge").checked =
    allData.show_threads_badge || false;
  byId<HTMLInputElement>("show_size_badge").checked =
    allData.show_size_badge || false;
  byId<HTMLInputElement>("show_conflicts_badge").checked =
    allData.show_conflicts_badge || false;
  byId<HTMLInputElement>("show_approval_badge").checked =
    allData.show_approval_badge || false;
  byId<HTMLInputElement>("show_branches").checked =
    allData.show_branches !== false;
  byId<HTMLInputElement>("show_branches_links").checked =
    allData.show_branches_links || false;
  // byId<HTMLInputElement>('show_group_by_author').checked = allData.show_group_by_author || false;
  byId<HTMLInputElement>("collapse_bars").checked =
    allData.collapse_bars || false;
  byId<HTMLInputElement>("hide_right_sidebar").checked =
    allData.hide_right_sidebar || false;
  byId<HTMLInputElement>("show_cmd_palette").checked =
    allData.show_cmd_palette !== false;
  byId<HTMLInputElement>("show_standup").checked =
    allData.show_standup !== false;
  byId<HTMLInputElement>("standup_jira_enrich").checked =
    allData.standup_jira_enrich !== false;
  byId<HTMLInputElement>("show_cherry_pick").checked =
    allData.show_cherry_pick !== false;
  byId<HTMLInputElement>("show_commit_version").checked =
    allData.show_commit_version || false;
  byId<HTMLInputElement>("show_group_play").checked =
    allData.show_group_play !== false;
  byId<HTMLInputElement>("show_sensitive_warning").checked =
    allData.show_sensitive_warning || false;
  byId<HTMLInputElement>("show_git_commands").checked =
    allData.show_git_commands || false;
  byId<HTMLInputElement>("show_ai_review_copy").checked =
    allData.show_ai_review_copy !== false;
  byId<HTMLInputElement>("ai_review_confirm_close").checked =
    allData.ai_review_confirm_close === true;
  byId<HTMLInputElement>("ai_review_response_language").value =
    workflow.normalizeResponseLanguage(allData.ai_review_response_language);
  AI_REVIEW_PROMPTS.forEach(function (prompt) {
    const input = byId<HTMLInputElement>(prompt.key);
    input.value =
      typeof allData[prompt.key] === "string"
        ? (allData[prompt.key] as string)
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
      value = workflow.normalizeInstruction(block, allData[key]);
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
      allData.ai_review_file_filter &&
      typeof allData.ai_review_file_filter[key] === "string"
        ? allData.ai_review_file_filter[key]
        : "";
  });
  byId<HTMLInputElement>("cherry_pick_create_mr").checked =
    allData.cherry_pick_create_mr !== false;
  byId<HTMLInputElement>("cherry_pick_smart_fallback").checked =
    allData.cherry_pick_smart_fallback !== false;
  byId<HTMLInputElement>("cherry_pick_bump_version").checked =
    allData.cherry_pick_bump_version || false;
  byId<HTMLInputElement>("commits_jira_field").value =
    allData.commits_jira_field || "fixVersions, status";
  renderCherryPickBranches(allData.cherry_pick_branches || []);
  byId("addCherryPickBranch").addEventListener("click", function () {
    addCherryPickBranchRow("");
  });
  byId<HTMLInputElement>("jira_url").value = allData.jira_url || "";
  byId<HTMLInputElement>("jira_ticket_regex").value =
    allData.jira_ticket_regex || "";
  byId<HTMLInputElement>("show_jira_details").checked =
    allData.show_jira_details || false;
  renderJiraQuickActions(allData.jiraQuickActions || []);
  byId("addJiraQuickAction").addEventListener("click", function () {
    addJiraQuickActionRow({});
  });
  byId<HTMLInputElement>("language").value = allData.language || "auto";

  // Language change needs full re-render
  byId("language").addEventListener("change", function (event) {
    event.stopPropagation();
    clearTimeout(_autoSaveTimer ?? undefined);
    _autoSaveTimer = null;
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
  renderQuickComments(allData.quickComments || []);
  byId("addQuickComment").addEventListener("click", function () {
    addQuickCommentRow("", "");
  });
  byId<HTMLInputElement>("reviewersList").value = allData.reviewersList || "";
  byId<HTMLInputElement>("reviewersJob").value =
    allData.reviewersJob || "get-reviewers";

  // Version bump settings
  const versionFile = allData.versionFile || "package.json";
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
    allData.versionPath || "version";
  byId<HTMLInputElement>("versionStrategy").value =
    allData.versionStrategy || "patch";
  byId<HTMLInputElement>("versionCommitTemplate").value =
    allData.versionCommitTemplate || "fix: bump version to {version}";
  byId<HTMLInputElement>("version_from_target").checked =
    allData.version_from_target || false;

  byId("addCustomJob").addEventListener("click", function () {
    const current = getCustomJobsFromUI("customJobsList");
    current.push({ label: "", jobName: "" });
    renderCustomJobs(current, "customJobsList", "buttonOrder");
    rebuildButtonOrderCustom("buttonOrder", "customJobsList");
  });
}

function renderProfileTab(container: HTMLElement, path: string) {
  const profile = (allData.projectProfiles || {})[path] || {};
  container.innerHTML =
    "<h4>" +
    escHtml(t("buttonsFor", [path.split("/").pop()!])) +
    "</h4>" +
    '<div class="hint" style="margin-bottom:6px">' +
    escHtml(t("overrideHint")) +
    "</div>" +
    '<div id="profileButtonOrder"></div>' +
    '<div class="sep"></div>' +
    "<h4>" +
    escHtml(t("versionBump")) +
    "</h4>" +
    '<div class="hint" style="margin-bottom:6px">' +
    escHtml(t("leaveEmptyDefault")) +
    "</div>" +
    '<div class="field"><label>' +
    escHtml(t("filePath")) +
    "</label>" +
    '<select id="profileVersionFilePreset" style="margin-bottom:4px">' +
    '<option value="">(' +
    escHtml(t("default")) +
    ")</option>" +
    '<option value="package.json">package.json</option>' +
    '<option value="pyproject.toml">pyproject.toml</option>' +
    '<option value="__custom__">' +
    escHtml(t("customFile")) +
    "</option>" +
    "</select>" +
    '<input type="text" id="profileVersionFile" placeholder="path/to/file" style="display:none"></div>' +
    '<div class="field" id="profileVersionPathField"><label>' +
    escHtml(t("versionField")) +
    '</label><input type="text" id="profileVersionPath" placeholder="(' +
    escHtml(t("default")) +
    ')"><div class="hint">' +
    escHtml(t("versionFieldHint")) +
    "</div></div>" +
    '<div class="field"><label>' +
    escHtml(t("strategy")) +
    "</label>" +
    '<select id="profileVersionStrategy">' +
    '<option value="">(' +
    escHtml(t("default")) +
    ")</option>" +
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
    '</label><input type="text" id="profileVersionCommitTemplate" placeholder="(' +
    escHtml(t("default")) +
    ')"><div class="hint">' +
    escHtml(t("commitMessageHint")) +
    "</div></div>" +
    '<div class="sep"></div>' +
    "<h4>" +
    escHtml(t("reviewers")) +
    "</h4>" +
    '<div class="field"><label>' +
    escHtml(t("reviewersList")) +
    '</label><input type="text" id="profileReviewersList" placeholder="(' +
    escHtml(t("leaveEmptyDefault")) +
    ')"><div class="hint">' +
    escHtml(t("reviewersListHint")) +
    "</div></div>" +
    '<div class="field"><label>' +
    escHtml(t("jobName")) +
    '</label><input type="text" id="profileReviewersJob" placeholder="(' +
    escHtml(t("leaveEmptyDefault")) +
    ')"><div class="hint">' +
    escHtml(t("leaveEmptyDefault")) +
    "</div></div>" +
    '<div class="sep"></div>' +
    "<h4>" +
    escHtml(t("customJobButtons")) +
    "</h4>" +
    '<div class="hint" style="margin-bottom:8px">' +
    escHtml(t("projectSpecificJobs")) +
    "</div>" +
    '<div id="profileCustomJobsList"></div>' +
    '<button class="add-btn" id="profileAddCustomJob">' +
    escHtml(t("addJobButton")) +
    "</button>" +
    mrActionsSection("profileMrActionsList", "profileAddMrAction", true);

  // Build enabled map from profile, falling back to defaults
  const enabledMap: Record<string, boolean> = {};
  BUILTIN_BUTTONS.forEach(function (b) {
    const profileVal = profile.buttons && profile.buttons[b.key];
    enabledMap[b.key] =
      profileVal !== undefined
        ? profileVal
        : allData[b.key] !== undefined
          ? !!allData[b.key]
          : (BUTTON_DEFAULTS as Record<string, boolean>)[b.key];
  });

  const customJobs = profile.customJobs || [];
  const ordered = buildOrderedList(
    profile.buttonOrder || allData.buttonOrder || [],
    enabledMap,
    customJobs,
    profile.mrActions || allData.mrActions || [],
  );
  renderButtonOrder(ordered, "profileButtonOrder");
  renderCustomJobs(customJobs, "profileCustomJobsList", "profileButtonOrder");
  setupMrActions(
    profile.mrActions || allData.mrActions || [],
    "profileMrActionsList",
    "profileAddMrAction",
    "profileButtonOrder",
  );

  // Version bump fields
  const pVersionFile = profile.versionFile || "";
  const pPresetEl = byId<HTMLInputElement>("profileVersionFilePreset");
  const pCustomInput = byId<HTMLInputElement>("profileVersionFile");
  const pVersionPathField = byId("profileVersionPathField");
  const knownPresets = ["package.json", "pyproject.toml"];
  if (pVersionFile && knownPresets.indexOf(pVersionFile) !== -1) {
    pPresetEl.value = pVersionFile;
  } else if (pVersionFile) {
    pPresetEl.value = "__custom__";
    pCustomInput.style.display = "";
    pCustomInput.value = pVersionFile;
  } else {
    pPresetEl.value = "";
  }
  // Hide path field for plain text
  function updateProfilePathVisibility() {
    const v = pPresetEl.value;
    if (v === "__custom__") {
      const ext = (pCustomInput.value || "").split(".").pop()!.toLowerCase();
      pVersionPathField.style.display =
        ext === "txt" || ext === "text" ? "none" : "";
    } else {
      pVersionPathField.style.display = "";
    }
  }
  pPresetEl.addEventListener("change", function () {
    pCustomInput.style.display = pPresetEl.value === "__custom__" ? "" : "none";
    updateProfilePathVisibility();
    scheduleAutoSave();
  });
  pCustomInput.addEventListener("input", function () {
    updateProfilePathVisibility();
    scheduleAutoSave();
  });
  updateProfilePathVisibility();

  byId<HTMLInputElement>("profileVersionPath").value =
    profile.versionPath || "";
  byId<HTMLInputElement>("profileVersionStrategy").value =
    profile.versionStrategy || "";
  byId<HTMLInputElement>("profileVersionCommitTemplate").value =
    profile.versionCommitTemplate || "";

  byId<HTMLInputElement>("profileReviewersList").value =
    profile.reviewersList || "";
  byId<HTMLInputElement>("profileReviewersJob").value =
    profile.reviewersJob || "";

  byId("profileAddCustomJob").addEventListener("click", function () {
    const current = getCustomJobsFromUI("profileCustomJobsList");
    current.push({ label: "", jobName: "" });
    renderCustomJobs(current, "profileCustomJobsList", "profileButtonOrder");
    rebuildButtonOrderCustom("profileButtonOrder", "profileCustomJobsList");
  });
}

function buildOrderedList(
  savedOrder: string[],
  enabledMap: Record<string, boolean>,
  customJobs: CustomJob[],
  mrActions: MrAction[],
) {
  const allKeys: string[] = [];
  BUILTIN_BUTTONS.forEach(function (b) {
    allKeys.push(b.key);
  });
  (customJobs || []).forEach(function (j, i) {
    allKeys.push("custom_" + i);
  });

  (mrActions || []).forEach(function (a) {
    allKeys.push("mr_action_" + a.id);
  });
  const ordered: string[] = [];
  (savedOrder || []).forEach(function (key) {
    if (allKeys.indexOf(key) !== -1) ordered.push(key);
  });
  allKeys.forEach(function (key) {
    if (ordered.indexOf(key) === -1) ordered.push(key);
  });

  return ordered
    .map(function (key) {
      if (key.indexOf("mr_action_") === 0) {
        const action = (mrActions || []).find(function (a) {
          return key === "mr_action_" + a.id;
        });
        return {
          key: key,
          label: action!.label || t("mrActions"),
          enabled: true,
          isCustom: true,
        };
      }
      if (key.indexOf("custom_") === 0) {
        const idx = parseInt(key.replace("custom_", ""));
        const cj = customJobs[idx];
        if (!cj) return null;
        return {
          key: key,
          label: cj.label || cj.jobName || "Custom",
          enabled: true,
          isCustom: true,
        };
      }
      const builtin = BUILTIN_BUTTONS.find(function (b) {
        return b.key === key;
      });
      if (!builtin) return null;
      return {
        key: key,
        label: t(builtin.labelKey),
        enabled: enabledMap[key] || false,
        isCustom: false,
      };
    })
    .filter((item): item is ButtonItem => item !== null);
}

function renderButtonOrder(items: ButtonItem[], containerId: string) {
  const container = byId(containerId);
  if (!container) return;
  container.innerHTML = "";

  let dragSrcEl: HTMLElement | null = null;

  items.forEach(function (item, i) {
    const row = document.createElement("div");
    row.className = "btn-item";
    row.setAttribute("data-key", item.key);
    row.setAttribute("draggable", "true");

    // Find hint from BUILTIN_BUTTONS
    let hint = "";
    if (!item.isCustom) {
      const def = BUILTIN_BUTTONS.find(function (b) {
        return b.key === item.key;
      });
      if (def && def.hintKey) hint = t(def.hintKey);
    }
    if (hint) row.title = hint;

    // Drag handle
    const handle = document.createElement("span");
    handle.className = "btn-drag-handle";
    handle.innerHTML = "&#9776;";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.enabled;
    if (item.isCustom) {
      cb.checked = true;
      cb.disabled = true;
    }

    const lbl = document.createElement("span");
    lbl.className = "btn-label" + (item.isCustom ? " custom-label" : "");
    lbl.textContent = item.label;
    lbl.addEventListener("click", function () {
      if (!cb.disabled) {
        cb.checked = !cb.checked;
        scheduleAutoSave();
      }
    });

    cb.addEventListener("change", function () {
      scheduleAutoSave();
    });

    row.appendChild(handle);
    row.appendChild(cb);
    row.appendChild(lbl);

    // Drag events
    let enterCount = 0;
    row.addEventListener("dragstart", function (e) {
      dragSrcEl = row;
      row.classList.add("dragging");
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", i.toString());
    });
    row.addEventListener("dragend", function () {
      row.classList.remove("dragging");
      container
        .querySelectorAll<HTMLElement>(".btn-item")
        .forEach(function (el) {
          el.classList.remove("drag-over");
        });
    });
    row.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    });
    row.addEventListener("dragenter", function (e) {
      e.preventDefault();
      enterCount++;
      if (row !== dragSrcEl) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", function () {
      enterCount--;
      if (enterCount <= 0) {
        row.classList.remove("drag-over");
        enterCount = 0;
      }
    });
    row.addEventListener("drop", function (e) {
      e.preventDefault();
      enterCount = 0;
      row.classList.remove("drag-over");
      if (dragSrcEl === row) return;
      const fromIdx = parseInt(e.dataTransfer!.getData("text/plain"));
      const toIdx = Array.from(container.children).indexOf(row);
      if (fromIdx === toIdx) return;
      const currentItems = getButtonOrderFromUI(containerId);
      const moved = currentItems.splice(fromIdx, 1)[0];
      currentItems.splice(toIdx, 0, moved);
      renderButtonOrder(currentItems, containerId);
      scheduleAutoSave();
    });

    container.appendChild(row);
  });
}

function getButtonOrderFromUI(containerId: string) {
  const rows = document.querySelectorAll<HTMLElement>(
    "#" + containerId + " .btn-item",
  );
  const items: ButtonItem[] = [];
  rows.forEach(function (row) {
    items.push({
      key: row.getAttribute("data-key")!,
      label: row.querySelector<HTMLElement>(".btn-label")!.textContent,
      enabled: row.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .checked,
      isCustom: /^(custom_|mr_action_)/.test(row.getAttribute("data-key")!),
    });
  });
  return items;
}

function saveSettings(
  onSaved?: (() => void) | null,
  onFailed?: (() => void) | null,
) {
  if (typeof onSaved !== "function") onSaved = null;
  if (typeof onFailed !== "function") onFailed = null;
  if (activeTab === "default") {
    const saved = saveDefaultTab(onSaved, onFailed);
    if (saved) _autoSaveDirty = false;
    return saved;
  } else {
    const saved = saveProfileTab(activeTab, onSaved, onFailed);
    if (saved) _autoSaveDirty = false;
    return saved;
  }
}

function saveDefaultTab(
  onSaved?: (() => void) | null,
  onFailed?: (() => void) | null,
) {
  let jiraQuickActions, mrActions;
  try {
    jiraQuickActions = getJiraQuickActionsFromUI();
    mrActions = getMrActionsFromUI("mrActionsList", true);
  } catch (error) {
    showSaveFailed(error instanceof Error ? error.message : String(error));
    return false;
  }
  const prompts: Record<string, string> = {};
  // Validate every prompt before saving any setting, including escaped UTF-8 bytes.
  const invalidPrompt = AI_REVIEW_PROMPTS.some(function (prompt) {
    const value =
      byId<HTMLInputElement>(prompt.key).value.trim() || prompt.value;
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
        enabled: byId<HTMLInputElement>(key + "_enabled").checked,
        text: byId<HTMLInputElement>(key).value,
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
    fileFilter[key] = byId<HTMLInputElement>(
      "ai_review_filter_" + key,
    ).value.trim();
  });
  try {
    fileFilter = workflow.normalizeFilter(fileFilter);
  } catch {
    showSaveFailed(t("aiReviewFilterInvalid"));
    return false;
  }
  const saveVersion = _statusVersion;
  const items = getButtonOrderFromUI("buttonOrder");
  const settings: Record<string, unknown> = {};

  items.forEach(function (it) {
    if (!it.isCustom) settings[it.key] = it.enabled;
  });

  settings.buttonOrder = items.map(function (it) {
    return it.key;
  });
  settings.sound_enabled = byId<HTMLInputElement>("sound_enabled").checked;
  settings.notifications_enabled = byId<HTMLInputElement>(
    "notifications_enabled",
  ).checked;
  settings.show_time_tracker =
    byId<HTMLInputElement>("show_time_tracker").checked;
  settings.show_failed_job_view = byId<HTMLInputElement>(
    "show_failed_job_view",
  ).checked;
  settings.skip_confirmations =
    byId<HTMLInputElement>("skip_confirmations").checked;
  settings.dim_drafts = byId<HTMLInputElement>("dim_drafts").checked;
  settings.highlight_own_mrs =
    byId<HTMLInputElement>("highlight_own_mrs").checked;
  settings.show_only_mine = byId<HTMLInputElement>("show_only_mine").checked;
  settings.show_needs_review =
    byId<HTMLInputElement>("show_needs_review").checked;
  settings.show_reviewer_badge = byId<HTMLInputElement>(
    "show_reviewer_badge",
  ).checked;
  settings.show_copy_mr = byId<HTMLInputElement>("show_copy_mr").checked;
  settings.show_threads_badge =
    byId<HTMLInputElement>("show_threads_badge").checked;
  settings.show_size_badge = byId<HTMLInputElement>("show_size_badge").checked;
  settings.show_conflicts_badge = byId<HTMLInputElement>(
    "show_conflicts_badge",
  ).checked;
  settings.show_approval_badge = byId<HTMLInputElement>(
    "show_approval_badge",
  ).checked;
  settings.show_branches = byId<HTMLInputElement>("show_branches").checked;
  settings.show_branches_links = byId<HTMLInputElement>(
    "show_branches_links",
  ).checked;
  // settings.show_group_by_author = byId<HTMLInputElement>('show_group_by_author').checked;
  settings.collapse_bars = byId<HTMLInputElement>("collapse_bars").checked;
  settings.hide_right_sidebar =
    byId<HTMLInputElement>("hide_right_sidebar").checked;
  settings.show_cmd_palette =
    byId<HTMLInputElement>("show_cmd_palette").checked;
  settings.show_standup = byId<HTMLInputElement>("show_standup").checked;
  settings.standup_jira_enrich = byId<HTMLInputElement>(
    "standup_jira_enrich",
  ).checked;
  settings.show_cherry_pick =
    byId<HTMLInputElement>("show_cherry_pick").checked;
  settings.show_commit_version = byId<HTMLInputElement>(
    "show_commit_version",
  ).checked;
  settings.show_group_play = byId<HTMLInputElement>("show_group_play").checked;
  settings.show_sensitive_warning = byId<HTMLInputElement>(
    "show_sensitive_warning",
  ).checked;
  settings.show_git_commands =
    byId<HTMLInputElement>("show_git_commands").checked;
  settings.show_ai_review_copy = byId<HTMLInputElement>(
    "show_ai_review_copy",
  ).checked;
  settings.ai_review_confirm_close = byId<HTMLInputElement>(
    "ai_review_confirm_close",
  ).checked;
  settings.ai_review_response_language = workflow.normalizeResponseLanguage(
    byId<HTMLInputElement>("ai_review_response_language").value,
  );
  Object.assign(settings, prompts);
  Object.assign(settings, rules);
  settings.ai_review_file_filter = fileFilter;
  settings.cherry_pick_create_mr = byId<HTMLInputElement>(
    "cherry_pick_create_mr",
  ).checked;
  settings.cherry_pick_smart_fallback = byId<HTMLInputElement>(
    "cherry_pick_smart_fallback",
  ).checked;
  settings.cherry_pick_bump_version = byId<HTMLInputElement>(
    "cherry_pick_bump_version",
  ).checked;
  settings.commits_jira_field =
    (byId<HTMLInputElement>("commits_jira_field").value || "").trim() ||
    "fixVersions, status";
  settings.cherry_pick_branches = getCherryPickBranchesFromUI();
  const newJiraUrl = (byId<HTMLInputElement>("jira_url").value || "")
    .trim()
    .replace(/\/+$/, "");
  if (newJiraUrl && newJiraUrl !== allData.jira_url) {
    // Request host permission for Jira domain
    chrome.permissions.request(
      { origins: [newJiraUrl + "/"] },
      function (granted) {
        if (!granted) {
          byId<HTMLInputElement>("jira_url").value = allData.jira_url || "";
        }
      },
    );
  }
  settings.jira_url = newJiraUrl;
  settings.jira_ticket_regex = (
    byId<HTMLInputElement>("jira_ticket_regex").value || ""
  ).trim();
  settings.show_jira_details =
    byId<HTMLInputElement>("show_jira_details").checked;
  settings.jiraQuickActions = jiraQuickActions;
  settings.language = byId<HTMLInputElement>("language").value || "auto";
  settings.quickComments = getQuickCommentsFromUI();
  settings.reviewersList = (
    byId<HTMLInputElement>("reviewersList").value || ""
  ).trim();
  settings.reviewersJob = (
    byId<HTMLInputElement>("reviewersJob").value || ""
  ).trim();
  settings.mrActions = mrActions;
  settings.customJobs = getCustomJobsFromUI("customJobsList").filter(
    function (j) {
      return j.label && j.jobName;
    },
  );
  settings.projectProfiles = allData.projectProfiles || {};

  // Version bump settings
  const presetVal = byId<HTMLInputElement>("versionFilePreset").value;
  if (presetVal === "custom") {
    settings.versionFile =
      (byId<HTMLInputElement>("versionFile").value || "").trim() ||
      "package.json";
  } else {
    settings.versionFile = presetVal;
  }
  settings.versionPath =
    (byId<HTMLInputElement>("versionPath").value || "").trim() || "version";
  settings.versionStrategy =
    byId<HTMLInputElement>("versionStrategy").value || "patch";
  settings.versionCommitTemplate =
    (byId<HTMLInputElement>("versionCommitTemplate").value || "").trim() ||
    "fix: bump version to {version}";
  settings.version_from_target = byId<HTMLInputElement>(
    "version_from_target",
  ).checked;

  Object.assign(allData, settings);

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
  const saveVersion = _statusVersion;
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
  const pPresetVal = byId<HTMLInputElement>("profileVersionFilePreset").value;
  let profileVersionFile = "";
  if (pPresetVal === "__custom__") {
    profileVersionFile = (
      byId<HTMLInputElement>("profileVersionFile").value || ""
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
    versionPath: (
      byId<HTMLInputElement>("profileVersionPath").value || ""
    ).trim(),
    versionStrategy:
      byId<HTMLInputElement>("profileVersionStrategy").value || "",
    versionCommitTemplate: (
      byId<HTMLInputElement>("profileVersionCommitTemplate").value || ""
    ).trim(),
    reviewersList: (
      byId<HTMLInputElement>("profileReviewersList").value || ""
    ).trim(),
    reviewersJob: (
      byId<HTMLInputElement>("profileReviewersJob").value || ""
    ).trim(),
    customJobs: getCustomJobsFromUI("profileCustomJobsList").filter(
      function (j) {
        return j.label && j.jobName;
      },
    ),
  };

  if (!allData.projectProfiles) allData.projectProfiles = {};
  allData.projectProfiles[path] = profile;

  chrome.storage.sync.set(
    { projectProfiles: allData.projectProfiles },
    function () {
      const failed = !!chrome.runtime.lastError;
      showSaved(saveVersion);
      if (!failed && onSaved) onSaved();
      if (failed && onFailed) onFailed();
    },
  );
  return true;
}

let _statusVersion = 0;

let _statusTimer: ReturnType<typeof setTimeout> | null = null;

let _statusHideTimer: ReturnType<typeof setTimeout> | null = null;

function clearStatusTimers() {
  clearTimeout(_statusTimer ?? undefined);
  clearTimeout(_statusHideTimer ?? undefined);
}

function showSaveFailed(message?: string) {
  clearStatusTimers();
  const status = byId("status");
  status.textContent = message || t("settingsSaveFailed");
  status.className = "status failed";
  status.style.display = "block";
  status.style.opacity = "1";
}

function showSaved(saveVersion?: number) {
  // lastError must be read inside the storage callback, even for stale saves.
  const failed = !!chrome.runtime.lastError;
  if (typeof saveVersion === "number" && saveVersion !== _statusVersion) return;
  if (failed) {
    showSaveFailed();
    return;
  }
  clearStatusTimers();
  const status = byId("status");
  status.textContent = t("saved");
  status.className = "status saved";
  status.style.display = "block";
  status.style.opacity = "1";
  _statusTimer = setTimeout(function () {
    status.style.opacity = "0";
    _statusHideTimer = setTimeout(function () {
      status.style.display = "none";
    }, 300);
  }, 1500);
}

let _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

let _autoSaveDirty = false;

function flushAutoSave() {
  if (_autoSaveTimer === null && !_autoSaveDirty) return true;
  clearTimeout(_autoSaveTimer ?? undefined);
  _autoSaveTimer = null;
  return saveSettings();
}

function scheduleAutoSave() {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer ?? undefined);
  _autoSaveDirty = true;
  _statusVersion++;
  clearStatusTimers();
  const status = byId("status");
  status.textContent = t("unsavedChanges");
  status.className = "status unsaved";
  status.style.display = "block";
  status.style.opacity = "1";
  _autoSaveTimer = setTimeout(function () {
    _autoSaveTimer = null;
    saveSettings();
  }, 500);
}

function attachAutoSave() {
  // Listen for all input changes in the popup
  document.body.addEventListener("input", function (e) {
    if (
      (e.target as HTMLElement).id !== "settingsImportFile" &&
      (e.target as HTMLElement).matches("input, select, textarea")
    )
      scheduleAutoSave();
  });
  document.body.addEventListener("change", function (e) {
    if (
      (e.target as HTMLElement).id !== "settingsImportFile" &&
      (e.target as HTMLElement).matches("input, select, textarea")
    )
      scheduleAutoSave();
  });
}

let _pendingSettingsImport: Settings | null = null;

let _settingsTransferBusy = false;

function setSettingsTransferBusy(busy: boolean) {
  _settingsTransferBusy = busy;
  [
    "exportSettings",
    "importSettings",
    "applySettingsImport",
    "cancelSettingsImport",
    "openSettingsTab",
    "addProfile",
  ].forEach(function (id) {
    byId<HTMLButtonElement>(id).disabled = busy;
  });
  byId("tabs").inert = busy;
  document.querySelector<HTMLElement>(".tab-content")!.inert = busy;
}

function exportAllSettings() {
  if (_settingsTransferBusy) return;
  clearTimeout(_autoSaveTimer ?? undefined);
  _autoSaveTimer = null;
  setSettingsTransferBusy(true);
  // Wait for the current form to reach storage before reading the complete set.
  if (
    !saveSettings(
      function () {
        chrome.storage.sync.get(Object.keys(DEFAULTS), function (data) {
          if (chrome.runtime.lastError) {
            setSettingsTransferBusy(false);
            showSaveFailed(t("settingsExportFailed"));
            return;
          }
          try {
            const file = {
              format: "gitlab-mr-actions-settings",
              formatVersion: 1,
              extensionVersion: chrome.runtime.getManifest().version,
              settings: settingsSnapshot(data),
            };
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(file, null, 2)], {
                type: "application/json",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "gitlab-mr-actions-settings.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () {
              URL.revokeObjectURL(url);
            }, 10000);
          } catch {
            showSaveFailed(t("settingsExportFailed"));
          }
          setSettingsTransferBusy(false);
        });
      },
      function () {
        setSettingsTransferBusy(false);
      },
    )
  )
    setSettingsTransferBusy(false);
}

function readSettingsImport(file: File | undefined) {
  _pendingSettingsImport = null;
  byId("settingsImportPreview").hidden = true;
  if (!file) return;
  if (file.size > SETTINGS_FILE_MAX_BYTES) {
    showSaveFailed(t("settingsFileTooLarge"));
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    try {
      _pendingSettingsImport = parseSettingsFile(String(reader.result));
      byId("settingsImportSummary").textContent = t("settingsImportSummary", [
        file.name,
        String(Object.keys(_pendingSettingsImport.projectProfiles).length),
      ]);
      byId("settingsImportPreview").hidden = false;
      byId("applySettingsImport").focus();
    } catch (error) {
      showSaveFailed(
        (error instanceof Error ? error.message : String(error)) ||
          t("settingsFileInvalid"),
      );
    }
  };
  reader.onerror = function () {
    showSaveFailed(t("settingsFileInvalid"));
  };
  reader.readAsText(file);
}

function applySettingsImport() {
  if (!_pendingSettingsImport || _settingsTransferBusy) return;
  const settings = _pendingSettingsImport;
  function fail(message?: string) {
    setSettingsTransferBusy(false);
    showSaveFailed(message || t("settingsImportFailed"));
  }
  function write() {
    clearTimeout(_autoSaveTimer ?? undefined);
    _autoSaveTimer = null;
    chrome.storage.sync.get(null, function (stored) {
      if (chrome.runtime.lastError) {
        fail();
        return;
      }
      const combined = Object.assign({}, stored, settings);
      const bytes = Object.keys(combined).reduce(function (total, key) {
        return (
          total +
          new TextEncoder().encode(key + JSON.stringify(combined[key])).length
        );
      }, 0);
      if (bytes > 102400 || Object.keys(combined).length > 512) {
        fail(t("settingsFileTooLarge"));
        return;
      }
      // One write replaces configuration, preserving unrelated extension state.
      chrome.storage.sync.set(settings, function () {
        if (chrome.runtime.lastError) {
          fail();
          return;
        }
        _autoSaveDirty = false;
        _statusVersion++;
        allData = settings;
        activeTab = "default";
        _pendingSettingsImport = null;
        byId("settingsImportPreview").hidden = true;
        loadLanguage(settings.language, function () {
          localizeHeader();
          renderTabs();
          renderActiveTab();
          setSettingsTransferBusy(false);
          showSaved();
          byId("status").textContent = t("settingsImported");
        });
      });
    });
  }
  setSettingsTransferBusy(true);
  if (settings.jira_url) {
    // Keep the permission request attached to the explicit Apply click.
    chrome.permissions.request(
      { origins: [new URL(settings.jira_url).origin + "/*"] },
      function (granted) {
        if (chrome.runtime.lastError || !granted) {
          fail(t("settingsImportPermissionDenied"));
          return;
        }
        write();
      },
    );
  } else write();
}

export function startSettings() {
  document.addEventListener("DOMContentLoaded", function () {
    // Load language setting first, then render everything
    chrome.storage.sync.get(
      { language: "auto" },
      function (langData: { language: string }) {
        loadLanguage(langData.language, function () {
          // Apply i18n to static elements
          localizeHeader();

          // Show update banner if extension was just updated
          chrome.storage.sync.get(
            { update_version: "", update_dismissed: "" },
            function (ud: {
              update_version: string;
              update_dismissed: string;
            }) {
              if (!ud.update_version) return;
              if (ud.update_dismissed === ud.update_version) return;
              const banner = byId("updateBanner");
              const isRu =
                langData.language === "ru" ||
                ((!langData.language || langData.language === "auto") &&
                  (chrome.i18n.getUILanguage() || "").startsWith("ru"));
              const changelogUrl =
                "https://github.com/termyanen/gitlab-actions/blob/main/" +
                (isRu ? "CHANGELOG_RU.md" : "CHANGELOG.md");
              const reviewUrl =
                "https://chromewebstore.google.com/detail/gitlab-mr-actions/lbploihmpffiihpgeojdlpcclegbdeak/reviews";
              banner.innerHTML =
                '<button class="update-close" id="updateClose">&times;</button>' +
                '<span class="update-version">v' +
                escHtml(ud.update_version) +
                "</span><br>" +
                escHtml(t("updateBannerText")) +
                '<br><a href="' +
                changelogUrl +
                '" target="_blank">' +
                escHtml(t("updateChangelog")) +
                "</a>" +
                '<span class="update-review">' +
                escHtml(t("updateReviewAsk")) +
                " " +
                '<a href="' +
                reviewUrl +
                '" target="_blank">' +
                escHtml(t("updateReviewLink")) +
                "</a></span>";
              banner.style.display = "block";
              byId("updateClose").addEventListener("click", function () {
                banner.style.display = "none";
                chrome.storage.sync.set({
                  update_dismissed: ud.update_version,
                });
                chrome.action.setBadgeText({ text: "" });
              });
              // Clear badge when popup is opened
              chrome.action.setBadgeText({ text: "" });
            },
          );

          detectCurrentProject().then(function () {
            chrome.storage.sync.get(Object.keys(DEFAULTS), function (data) {
              allData = data;
              renderTabs();
              renderActiveTab();

              // Auto-switch to current project's profile if it exists
              if (
                currentProjectPath &&
                allData.projectProfiles &&
                allData.projectProfiles[currentProjectPath]
              ) {
                activeTab = currentProjectPath;
                renderTabs();
                renderActiveTab();
              }
              byId<HTMLButtonElement>("openSettingsTab").disabled = false;
              byId<HTMLButtonElement>("exportSettings").disabled = false;
              byId<HTMLButtonElement>("importSettings").disabled = false;
            });
          });
        });
      },
    );

    byId("addProfile").addEventListener("click", function () {
      if (!currentProjectPath) return;
      if (!flushAutoSave()) return;
      if (!allData.projectProfiles) allData.projectProfiles = {};
      // Create profile with current defaults
      allData.projectProfiles[currentProjectPath] = {
        buttons: {},
        buttonOrder: [],
        reviewersJob: "",
        customJobs: [],
      };
      activeTab = currentProjectPath;
      renderTabs();
      renderActiveTab();
      scheduleAutoSave();
    });

    byId("save").addEventListener("click", () => saveSettings());
    byId("openSettingsTab").addEventListener("click", function () {
      clearTimeout(_autoSaveTimer ?? undefined);
      _autoSaveTimer = null;
      saveSettings(function () {
        chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
      });
    });
    byId("exportSettings").addEventListener("click", exportAllSettings);
    byId("importSettings").addEventListener("click", function () {
      const input = byId<HTMLInputElement>("settingsImportFile");
      input.value = "";
      input.click();
    });
    byId("settingsImportFile").addEventListener("change", function (event) {
      readSettingsImport((event.target as HTMLInputElement).files?.[0]);
    });
    byId("applySettingsImport").addEventListener("click", applySettingsImport);
    byId("cancelSettingsImport").addEventListener("click", function () {
      _pendingSettingsImport = null;
      byId("settingsImportPreview").hidden = true;
      byId("importSettings").focus();
    });
    attachAutoSave();
  });
}
