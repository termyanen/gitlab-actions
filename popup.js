// Detect if opened as a full tab (not popup)
if (window.innerWidth > 400) {
  document.addEventListener('DOMContentLoaded', function() {
    document.body.classList.add('fullpage');
  });
}

// i18n helper with manual override support
var _i18nMessages = null; // loaded manually when language is overridden

function t(key, substitutions) {
  // Use manually loaded messages if available
  if (_i18nMessages && _i18nMessages[key]) {
    var msg = _i18nMessages[key].message || '';
    if (substitutions && substitutions.length) {
      for (var i = 0; i < substitutions.length; i++) {
        msg = msg.replace('$' + (i + 1), substitutions[i]);
      }
    }
    return msg;
  }
  var msg = chrome.i18n.getMessage(key, substitutions);
  return msg || key;
}

function loadLanguage(lang, callback) {
  if (!lang || lang === 'auto') {
    _i18nMessages = null;
    callback();
    return;
  }
  fetch(chrome.runtime.getURL('_locales/' + lang + '/messages.json'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _i18nMessages = data;
      callback();
    })
    .catch(function() {
      _i18nMessages = null;
      callback();
    });
}

var BUILTIN_BUTTONS = [
  { key: 'btn_version',          labelKey: 'btnVersion',          hintKey: 'hintVersion' },
  { key: 'btn_rebase',           labelKey: 'btnRebase',           hintKey: 'hintRebase' },
  { key: 'btn_rebase_version',   labelKey: 'btnRebaseVersion',    hintKey: 'hintRebaseVersion' },
  { key: 'btn_rebase_automerge', labelKey: 'btnRebaseAutomerge',  hintKey: 'hintRebaseAutomerge' },
  { key: 'btn_rebase_force',     labelKey: 'btnRebaseForce',      hintKey: 'hintRebaseForce' },
  { key: 'btn_ship',             labelKey: 'btnShip',             hintKey: 'hintShip' },
  { key: 'btn_force_ship',       labelKey: 'btnForceShip',        hintKey: 'hintForceShip' },
  { key: 'btn_reviewers',        labelKey: 'btnReviewers',        hintKey: 'hintReviewers' },
  { key: 'btn_pipeline_restart', labelKey: 'btnPipelineRestart',  hintKey: 'hintPipelineRestart' },
  { key: 'btn_pipeline_cancel',  labelKey: 'btnPipelineCancel',   hintKey: 'hintPipelineCancel' },
  { key: 'btn_draft_toggle',     labelKey: 'btnDraftToggle',      hintKey: 'hintDraftToggle' },
  { key: 'btn_retry_failed',     labelKey: 'btnRetryFailed',      hintKey: 'hintRetryFailed' },
  { key: 'btn_copy_mr',          labelKey: 'btnCopyMr',           hintKey: 'hintCopyMr' },
];

var BUTTON_DEFAULTS = {
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

var DEFAULTS = Object.assign({}, BUTTON_DEFAULTS, {
  language: 'auto',
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
  show_cherry_pick: true,
  show_commit_version: false,
  show_group_play: true,
  cherry_pick_branches: [],
  cherry_pick_create_mr: true,
  cherry_pick_smart_fallback: true,
  cherry_pick_bump_version: false,
  commits_jira_field: 'fixVersions',
  jira_url: '',
  jira_ticket_regex: '',
  quickComments: [],
  jiraQuickActions: [],
  reviewersList: '',
  reviewersJob: 'get-reviewers',
  customJobs: [],
  buttonOrder: [],
  projectProfiles: {},
  // Version bump settings
  versionFile: 'package.json',
  versionPath: 'version',
  versionStrategy: 'patch',
  versionCommitTemplate: 'fix: bump version to {version}',
  version_from_target: false,
});

var currentProjectPath = null;
var activeTab = 'default';
var allData = {};

// =========================================================================
// Detect current project from active browser tab
// =========================================================================

function detectCurrentProject() {
  return new Promise(function(resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs && tabs[0] && tabs[0].url) {
        var m = tabs[0].url.match(/https?:\/\/[^/]+\/(.+?)\/-\/merge_requests/);
        if (m) {
          currentProjectPath = m[1];
          var el = document.getElementById('currentProject');
          el.textContent = t('current', [currentProjectPath]);
          el.style.display = '';
        }
      }
      resolve();
    });
  });
}

// =========================================================================
// Tabs
// =========================================================================

function renderTabs() {
  var container = document.getElementById('tabs');
  container.innerHTML = '<div class="tab' + (activeTab === 'default' ? ' active' : '') + '" data-tab="default">' + escHtml(t('default')) + '</div>';

  var profiles = allData.projectProfiles || {};
  Object.keys(profiles).forEach(function(path) {
    var tab = document.createElement('div');
    tab.className = 'tab' + (activeTab === path ? ' active' : '');
    tab.setAttribute('data-tab', path);
    // Show short name
    var shortName = path.split('/').pop();
    tab.innerHTML = escHtml(shortName) + '<span class="tab-remove" data-path="' + escHtml(path) + '">&times;</span>';
    container.appendChild(tab);
  });

  // Tab click handlers
  container.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function(e) {
      if (e.target.classList.contains('tab-remove')) {
        var path = e.target.getAttribute('data-path');
        if (confirm(t('removeProfile', [path]))) {
          delete allData.projectProfiles[path];
          if (activeTab === path) activeTab = 'default';
          renderTabs();
          renderActiveTab();
        }
        return;
      }
      activeTab = tab.getAttribute('data-tab');
      renderTabs();
      renderActiveTab();
    });
  });

  // Show/hide add profile button
  var addBtn = document.getElementById('addProfile');
  if (currentProjectPath && !profiles[currentProjectPath]) {
    addBtn.style.display = '';
    addBtn.textContent = t('addProfileFor', [currentProjectPath.split('/').pop()]);
  } else {
    addBtn.style.display = 'none';
  }
}

function renderActiveTab() {
  var contentEl = document.querySelector('.tab-content');
  if (activeTab === 'default') {
    renderDefaultTab(contentEl);
  } else {
    renderProfileTab(contentEl, activeTab);
  }
}

// =========================================================================
// Default tab
// =========================================================================

function renderDefaultTab(container) {
  container.innerHTML = '';
  container.innerHTML =
    '<h4>' + escHtml(t('buttonOrder')) + '</h4>' +
    '<div class="hint" style="margin-bottom:6px">' + escHtml(t('buttonOrderHint')) + '</div>' +
    '<div id="buttonOrder"></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('general')) + '</h4>' +
    '<div class="field"><label>' + escHtml(t('languageLabel')) + '</label>' +
    '<select id="language" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">' +
    '<option value="auto">' + escHtml(t('languageAuto')) + '</option>' +
    '<option value="en">English</option>' +
    '<option value="ru">Русский</option>' +
    '<option value="zh_CN">中文</option>' +
    '<option value="ja">日本語</option>' +
    '<option value="de">Deutsch</option>' +
    '<option value="fr">Français</option>' +
    '<option value="es">Español</option>' +
    '</select></div>' +
    '<div class="toggle"><input type="checkbox" id="sound_enabled"><label for="sound_enabled">' + escHtml(t('soundNotifications')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="notifications_enabled"><label for="notifications_enabled">' + escHtml(t('desktopNotifications')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_time_tracker"><label for="show_time_tracker">' + escHtml(t('showTimeTracker')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_failed_job_view"><label for="show_failed_job_view">' + escHtml(t('showFailedJobView')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="skip_confirmations"><label for="skip_confirmations">' + escHtml(t('skipConfirmations')) + '</label></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('uxEnhancer')) + '</h4>' +
    '<div class="toggle"><input type="checkbox" id="dim_drafts"><label for="dim_drafts">' + escHtml(t('dimDrafts')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="highlight_own_mrs"><label for="highlight_own_mrs">' + escHtml(t('highlightOwnMrs')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_only_mine"><label for="show_only_mine">' + escHtml(t('showOnlyMine')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_needs_review"><label for="show_needs_review">' + escHtml(t('showNeedsReview')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_reviewer_badge"><label for="show_reviewer_badge">' + escHtml(t('showReviewerBadge')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_copy_mr"><label for="show_copy_mr">' + escHtml(t('showCopyMr')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_threads_badge"><label for="show_threads_badge">' + escHtml(t('showThreadsBadge')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_size_badge"><label for="show_size_badge">' + escHtml(t('showSizeBadge')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_conflicts_badge"><label for="show_conflicts_badge">' + escHtml(t('showConflictsBadge')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_approval_badge"><label for="show_approval_badge">' + escHtml(t('showApprovalBadge')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_branches"><label for="show_branches">' + escHtml(t('showBranches')) + '</label></div>' +
    '<div class="toggle" style="margin-left:18px"><input type="checkbox" id="show_branches_links"><label for="show_branches_links">' + escHtml(t('showBranchesLinks')) + '</label></div>' +
    // '<div class="toggle"><input type="checkbox" id="show_group_by_author"><label for="show_group_by_author">' + escHtml(t('showGroupByAuthor')) + '</label></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('uiCustomization')) + '</h4>' +
    '<div class="toggle"><input type="checkbox" id="collapse_bars"><label for="collapse_bars">' + escHtml(t('collapseBars')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="hide_right_sidebar"><label for="hide_right_sidebar">' + escHtml(t('hideRightSidebar')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_cmd_palette"><label for="show_cmd_palette">' + escHtml(t('showCmdPalette')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_standup"><label for="show_standup">' + escHtml(t('showStandup')) + '</label></div>' +
    '<div class="toggle sub-toggle"><input type="checkbox" id="standup_jira_enrich"><label for="standup_jira_enrich">' + escHtml(t('standupJiraEnrich')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_cherry_pick"><label for="show_cherry_pick">' + escHtml(t('showCherryPick')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_commit_version"><label for="show_commit_version">' + escHtml(t('showCommitVersion')) + '</label></div>' +
    '<div class="hint" style="margin-bottom:8px">' + escHtml(t('showCommitVersionHint')) + '</div>' +
    '<div class="toggle"><input type="checkbox" id="show_group_play"><label for="show_group_play">' + escHtml(t('showGroupPlay')) + '</label></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('mrDetailEnhancements')) + '</h4>' +
    '<div class="toggle"><input type="checkbox" id="show_sensitive_warning"><label for="show_sensitive_warning">' + escHtml(t('showSensitiveWarning')) + '</label></div>' +
    '<div class="toggle"><input type="checkbox" id="show_git_commands"><label for="show_git_commands">' + escHtml(t('showGitCommands')) + '</label></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('cherryPickBranches')) + '</h4>' +
    '<div class="hint" style="margin-bottom:8px">' + escHtml(t('cherryPickBranchesHint')) + '</div>' +
    '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="cherry_pick_create_mr"><label for="cherry_pick_create_mr">' + escHtml(t('cherryPickCreateMrDefault')) + '</label></div>' +
    '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="cherry_pick_smart_fallback"><label for="cherry_pick_smart_fallback">' + escHtml(t('cherryPickSmartFallback')) + '</label></div>' +
    '<div class="hint" style="margin-bottom:8px">' + escHtml(t('cherryPickSmartFallbackHint')) + '</div>' +
    '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="cherry_pick_bump_version"><label for="cherry_pick_bump_version">' + escHtml(t('cherryPickBumpVersion')) + '</label></div>' +
    '<div class="hint" style="margin-bottom:8px">' + escHtml(t('cherryPickBumpVersionHint')) + '</div>' +
    '<div id="cherryPickBranchesList"></div>' +
    '<button type="button" id="addCherryPickBranch" class="add-btn">+ ' + escHtml(t('cherryPickBranchAdd')) + '</button>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('jiraIntegration')) + '</h4>' +
    '<div class="field"><label>' + escHtml(t('jiraUrl')) + '</label><input type="text" id="jira_url" placeholder="https://jira.company.com"><div class="hint">' + escHtml(t('jiraUrlHint')) + '</div></div>' +
    '<div class="field"><label>' + escHtml(t('jiraTicketRegex')) + '</label><input type="text" id="jira_ticket_regex" placeholder="[A-Z][A-Z0-9]+-\\d+"><div class="hint">' + escHtml(t('jiraTicketRegexHint')) + '</div></div>' +
    '<div class="toggle" style="margin-bottom:8px"><input type="checkbox" id="show_jira_details"><label for="show_jira_details">' + escHtml(t('showJiraDetails')) + '</label></div>' +
    '<div class="field"><label>' + escHtml(t('jiraQuickActions')) + '</label><div class="hint">' + escHtml(t('jiraQuickActionsHint')) + '</div><div id="jiraQuickActionsList"></div>' +
    '<button type="button" id="addJiraQuickAction" class="add-btn">+ ' + escHtml(t('jiraQuickActionsAdd')) + '</button></div>' +
    '<div class="field"><label>' + escHtml(t('commitsJiraField')) + '</label><input type="text" id="commits_jira_field" placeholder="fixVersions"><div class="hint">' + escHtml(t('commitsJiraFieldHint')) + '</div></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('versionBump')) + '</h4>' +
    '<div class="field"><label>' + escHtml(t('filePath')) + '</label>' +
    '<select id="versionFilePreset" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;margin-bottom:4px;box-sizing:border-box;">' +
    '<option value="package.json">package.json</option>' +
    '<option value="pyproject.toml">pyproject.toml</option>' +
    '<option value="version.txt">version.txt (' + escHtml(t('plainText')) + ')</option>' +
    '<option value="custom">' + escHtml(t('customFile')) + '</option>' +
    '</select>' +
    '<input type="text" id="versionFile" placeholder="path/to/file" style="display:none">' +
    '<div class="hint">' + escHtml(t('filePathHint')) + '</div></div>' +
    '<div class="field" id="versionPathField"><label>' + escHtml(t('versionField')) + '</label><input type="text" id="versionPath" placeholder="version">' +
    '<div class="hint">' + escHtml(t('versionFieldHint')) + '</div></div>' +
    '<div class="field"><label>' + escHtml(t('strategy')) + '</label>' +
    '<select id="versionStrategy" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">' +
    '<option value="patch">' + escHtml(t('strategyPatch')) + '</option>' +
    '<option value="minor">' + escHtml(t('strategyMinor')) + '</option>' +
    '<option value="major">' + escHtml(t('strategyMajor')) + '</option>' +
    '</select></div>' +
    '<div class="field"><label>' + escHtml(t('commitMessage')) + '</label><input type="text" id="versionCommitTemplate" placeholder="fix: bump version to {version}">' +
    '<div class="hint">' + escHtml(t('commitMessageHint')) + '</div></div>' +
    '<div class="toggle"><input type="checkbox" id="version_from_target"><label for="version_from_target">' + escHtml(t('versionFromTarget')) + '</label></div>' +
    '<div class="hint">' + escHtml(t('versionFromTargetHint')) + '</div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('quickComments')) + '</h4>' +
    '<div class="hint" style="margin-bottom:8px">' + escHtml(t('quickCommentsHint')) + '</div>' +
    '<div id="quickCommentsList"></div>' +
    '<button type="button" id="addQuickComment" class="add-btn">+ ' + escHtml(t('quickCommentsAdd')) + '</button>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('reviewers')) + '</h4>' +
    '<div class="field"><label>' + escHtml(t('reviewersList')) + '</label><input type="text" id="reviewersList" placeholder="@user1, @user2"><div class="hint">' + escHtml(t('reviewersListHint')) + '</div></div>' +
    '<div class="field"><label>' + escHtml(t('jobName')) + '</label><input type="text" id="reviewersJob" placeholder="get-reviewers"><div class="hint">' + escHtml(t('jobNameHint')) + '</div></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('customJobButtons')) + '</h4>' +
    '<div class="hint" style="margin-bottom:8px">' + escHtml(t('customJobsHint')) + '</div>' +
    '<div id="customJobsList"></div>' +
    '<button class="add-btn" id="addCustomJob">' + escHtml(t('addJobButton')) + '</button>';

  var enabledMap = {};
  BUILTIN_BUTTONS.forEach(function(b) {
    enabledMap[b.key] = allData[b.key] !== undefined ? allData[b.key] : BUTTON_DEFAULTS[b.key];
  });

  var customJobs = allData.customJobs || [];
  var ordered = buildOrderedList(allData.buttonOrder || [], enabledMap, customJobs);
  renderButtonOrder(ordered, 'buttonOrder');
  renderCustomJobs(customJobs, 'customJobsList', 'buttonOrder');

  document.getElementById('sound_enabled').checked = allData.sound_enabled || false;
  document.getElementById('notifications_enabled').checked = allData.notifications_enabled !== false;
  document.getElementById('show_time_tracker').checked = allData.show_time_tracker !== false;
  document.getElementById('show_failed_job_view').checked = allData.show_failed_job_view !== false;
  document.getElementById('skip_confirmations').checked = allData.skip_confirmations || false;
  document.getElementById('dim_drafts').checked = allData.dim_drafts || false;
  document.getElementById('highlight_own_mrs').checked = allData.highlight_own_mrs || false;
  document.getElementById('show_only_mine').checked = allData.show_only_mine || false;
  document.getElementById('show_needs_review').checked = allData.show_needs_review || false;
  document.getElementById('show_reviewer_badge').checked = allData.show_reviewer_badge || false;
  document.getElementById('show_copy_mr').checked = allData.show_copy_mr || false;
  document.getElementById('show_threads_badge').checked = allData.show_threads_badge || false;
  document.getElementById('show_size_badge').checked = allData.show_size_badge || false;
  document.getElementById('show_conflicts_badge').checked = allData.show_conflicts_badge || false;
  document.getElementById('show_approval_badge').checked = allData.show_approval_badge || false;
  document.getElementById('show_branches').checked = allData.show_branches !== false;
  document.getElementById('show_branches_links').checked = allData.show_branches_links || false;
  // document.getElementById('show_group_by_author').checked = allData.show_group_by_author || false;
  document.getElementById('collapse_bars').checked = allData.collapse_bars || false;
  document.getElementById('hide_right_sidebar').checked = allData.hide_right_sidebar || false;
  document.getElementById('show_cmd_palette').checked = allData.show_cmd_palette !== false;
  document.getElementById('show_standup').checked = allData.show_standup !== false;
  document.getElementById('standup_jira_enrich').checked = allData.standup_jira_enrich !== false;
  document.getElementById('show_cherry_pick').checked = allData.show_cherry_pick !== false;
  document.getElementById('show_commit_version').checked = allData.show_commit_version || false;
  document.getElementById('show_group_play').checked = allData.show_group_play !== false;
  document.getElementById('show_sensitive_warning').checked = allData.show_sensitive_warning || false;
  document.getElementById('show_git_commands').checked = allData.show_git_commands || false;
document.getElementById('cherry_pick_create_mr').checked = allData.cherry_pick_create_mr !== false;
  document.getElementById('cherry_pick_smart_fallback').checked = allData.cherry_pick_smart_fallback !== false;
  document.getElementById('cherry_pick_bump_version').checked = allData.cherry_pick_bump_version || false;
  document.getElementById('commits_jira_field').value = allData.commits_jira_field || 'fixVersions';
  renderCherryPickBranches(allData.cherry_pick_branches || []);
  document.getElementById('addCherryPickBranch').addEventListener('click', function() {
    addCherryPickBranchRow('');
  });
  document.getElementById('jira_url').value = allData.jira_url || '';
  document.getElementById('jira_ticket_regex').value = allData.jira_ticket_regex || '';
  document.getElementById('show_jira_details').checked = allData.show_jira_details || false;
  renderJiraQuickActions(allData.jiraQuickActions || []);
  document.getElementById('addJiraQuickAction').addEventListener('click', function() {
    addJiraQuickActionRow('', '', '');
  });
  document.getElementById('language').value = allData.language || 'auto';

  // Language change needs full re-render
  document.getElementById('language').addEventListener('change', function() {
    var newLang = document.getElementById('language').value;
    allData.language = newLang;
    chrome.storage.sync.set({ language: newLang }, function() {
      loadLanguage(newLang, function() {
        document.getElementById('howLink').textContent = t('howItWorks');
        renderTabs();
        renderActiveTab();
        showSaved();
      });
    });
  });
  renderQuickComments(allData.quickComments || []);
  document.getElementById('addQuickComment').addEventListener('click', function() {
    addQuickCommentRow('', '');
  });
  document.getElementById('reviewersList').value = allData.reviewersList || '';
  document.getElementById('reviewersJob').value = allData.reviewersJob || 'get-reviewers';

  // Version bump settings
  var versionFile = allData.versionFile || 'package.json';
  var presetEl = document.getElementById('versionFilePreset');
  var customInput = document.getElementById('versionFile');
  var versionPathField = document.getElementById('versionPathField');

  var knownPresets = ['package.json', 'pyproject.toml', 'version.txt'];
  if (knownPresets.indexOf(versionFile) !== -1) {
    presetEl.value = versionFile;
  } else {
    presetEl.value = 'custom';
    customInput.style.display = '';
    customInput.value = versionFile;
  }
  updateVersionPathVisibility();

  presetEl.addEventListener('change', function() {
    if (presetEl.value === 'custom') {
      customInput.style.display = '';
      customInput.value = '';
    } else {
      customInput.style.display = 'none';
      customInput.value = '';
    }
    updateVersionPathVisibility();
    // Auto-suggest version path placeholder based on file type
    var pathInput = document.getElementById('versionPath');
    if (presetEl.value === 'pyproject.toml') {
      pathInput.placeholder = 'tool.poetry.version';
    } else {
      pathInput.placeholder = 'version';
    }
  });

  function updateVersionPathVisibility() {
    var val = presetEl.value === 'custom' ? (customInput.value || '') : presetEl.value;
    // Hide version path for plain text files
    if (val === 'version.txt' || val.match(/\.(txt|VERSION)$/i)) {
      versionPathField.style.display = 'none';
    } else {
      versionPathField.style.display = '';
    }
  }

  document.getElementById('versionPath').value = allData.versionPath || 'version';
  document.getElementById('versionStrategy').value = allData.versionStrategy || 'patch';
  document.getElementById('versionCommitTemplate').value = allData.versionCommitTemplate || 'fix: bump version to {version}';
  document.getElementById('version_from_target').checked = allData.version_from_target || false;

  document.getElementById('addCustomJob').addEventListener('click', function() {
    var current = getCustomJobsFromUI('customJobsList');
    current.push({ label: '', jobName: '' });
    renderCustomJobs(current, 'customJobsList', 'buttonOrder');
    rebuildButtonOrderCustom('buttonOrder', 'customJobsList');
  });
}

// =========================================================================
// Profile tab
// =========================================================================

function renderProfileTab(container, path) {
  var profile = (allData.projectProfiles || {})[path] || {};
  container.innerHTML =
    '<h4>' + escHtml(t('buttonsFor', [path.split('/').pop()])) + '</h4>' +
    '<div class="hint" style="margin-bottom:6px">' + escHtml(t('overrideHint')) + '</div>' +
    '<div id="profileButtonOrder"></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('versionBump')) + '</h4>' +
    '<div class="hint" style="margin-bottom:6px">' + escHtml(t('leaveEmptyDefault')) + '</div>' +
    '<div class="field"><label>' + escHtml(t('filePath')) + '</label>' +
    '<select id="profileVersionFilePreset" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;margin-bottom:4px;box-sizing:border-box;">' +
    '<option value="">(' + escHtml(t('default')) + ')</option>' +
    '<option value="package.json">package.json</option>' +
    '<option value="pyproject.toml">pyproject.toml</option>' +
    '<option value="__custom__">' + escHtml(t('customFile')) + '</option>' +
    '</select>' +
    '<input type="text" id="profileVersionFile" placeholder="path/to/file" style="display:none"></div>' +
    '<div class="field" id="profileVersionPathField"><label>' + escHtml(t('versionField')) + '</label><input type="text" id="profileVersionPath" placeholder="(' + escHtml(t('default')) + ')"><div class="hint">' + escHtml(t('versionFieldHint')) + '</div></div>' +
    '<div class="field"><label>' + escHtml(t('strategy')) + '</label>' +
    '<select id="profileVersionStrategy" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;box-sizing:border-box;">' +
    '<option value="">(' + escHtml(t('default')) + ')</option>' +
    '<option value="patch">' + escHtml(t('strategyPatch')) + '</option>' +
    '<option value="minor">' + escHtml(t('strategyMinor')) + '</option>' +
    '<option value="major">' + escHtml(t('strategyMajor')) + '</option>' +
    '</select></div>' +
    '<div class="field"><label>' + escHtml(t('commitMessage')) + '</label><input type="text" id="profileVersionCommitTemplate" placeholder="(' + escHtml(t('default')) + ')"><div class="hint">' + escHtml(t('commitMessageHint')) + '</div></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('reviewers')) + '</h4>' +
    '<div class="field"><label>' + escHtml(t('reviewersList')) + '</label><input type="text" id="profileReviewersList" placeholder="(' + escHtml(t('leaveEmptyDefault')) + ')"><div class="hint">' + escHtml(t('reviewersListHint')) + '</div></div>' +
    '<div class="field"><label>' + escHtml(t('jobName')) + '</label><input type="text" id="profileReviewersJob" placeholder="(' + escHtml(t('leaveEmptyDefault')) + ')"><div class="hint">' + escHtml(t('leaveEmptyDefault')) + '</div></div>' +
    '<div class="sep"></div>' +
    '<h4>' + escHtml(t('customJobButtons')) + '</h4>' +
    '<div class="hint" style="margin-bottom:8px">' + escHtml(t('projectSpecificJobs')) + '</div>' +
    '<div id="profileCustomJobsList"></div>' +
    '<button class="add-btn" id="profileAddCustomJob">' + escHtml(t('addJobButton')) + '</button>';

  // Build enabled map from profile, falling back to defaults
  var enabledMap = {};
  BUILTIN_BUTTONS.forEach(function(b) {
    var profileVal = profile.buttons && profile.buttons[b.key];
    enabledMap[b.key] = profileVal !== undefined ? profileVal : (allData[b.key] !== undefined ? allData[b.key] : BUTTON_DEFAULTS[b.key]);
  });

  var customJobs = profile.customJobs || [];
  var ordered = buildOrderedList(profile.buttonOrder || allData.buttonOrder || [], enabledMap, customJobs);
  renderButtonOrder(ordered, 'profileButtonOrder');
  renderCustomJobs(customJobs, 'profileCustomJobsList', 'profileButtonOrder');

  // Version bump fields
  var pVersionFile = profile.versionFile || '';
  var pPresetEl = document.getElementById('profileVersionFilePreset');
  var pCustomInput = document.getElementById('profileVersionFile');
  var pVersionPathField = document.getElementById('profileVersionPathField');
  var knownPresets = ['package.json', 'pyproject.toml'];
  if (pVersionFile && knownPresets.indexOf(pVersionFile) !== -1) {
    pPresetEl.value = pVersionFile;
  } else if (pVersionFile) {
    pPresetEl.value = '__custom__';
    pCustomInput.style.display = '';
    pCustomInput.value = pVersionFile;
  } else {
    pPresetEl.value = '';
  }
  // Hide path field for plain text
  function updateProfilePathVisibility() {
    var v = pPresetEl.value;
    if (v === '__custom__') {
      var ext = (pCustomInput.value || '').split('.').pop().toLowerCase();
      pVersionPathField.style.display = (ext === 'txt' || ext === 'text') ? 'none' : '';
    } else {
      pVersionPathField.style.display = '';
    }
  }
  pPresetEl.addEventListener('change', function() {
    pCustomInput.style.display = pPresetEl.value === '__custom__' ? '' : 'none';
    updateProfilePathVisibility();
    scheduleAutoSave();
  });
  pCustomInput.addEventListener('input', function() { updateProfilePathVisibility(); scheduleAutoSave(); });
  updateProfilePathVisibility();

  document.getElementById('profileVersionPath').value = profile.versionPath || '';
  document.getElementById('profileVersionStrategy').value = profile.versionStrategy || '';
  document.getElementById('profileVersionCommitTemplate').value = profile.versionCommitTemplate || '';

  document.getElementById('profileReviewersList').value = profile.reviewersList || '';
  document.getElementById('profileReviewersJob').value = profile.reviewersJob || '';

  document.getElementById('profileAddCustomJob').addEventListener('click', function() {
    var current = getCustomJobsFromUI('profileCustomJobsList');
    current.push({ label: '', jobName: '' });
    renderCustomJobs(current, 'profileCustomJobsList', 'profileButtonOrder');
    rebuildButtonOrderCustom('profileButtonOrder', 'profileCustomJobsList');
  });
}

// =========================================================================
// Shared button order / custom jobs
// =========================================================================

function buildOrderedList(savedOrder, enabledMap, customJobs) {
  var allKeys = [];
  BUILTIN_BUTTONS.forEach(function(b) { allKeys.push(b.key); });
  (customJobs || []).forEach(function(j, i) { allKeys.push('custom_' + i); });

  var ordered = [];
  (savedOrder || []).forEach(function(key) {
    if (allKeys.indexOf(key) !== -1) ordered.push(key);
  });
  allKeys.forEach(function(key) {
    if (ordered.indexOf(key) === -1) ordered.push(key);
  });

  return ordered.map(function(key) {
    if (key.indexOf('custom_') === 0) {
      var idx = parseInt(key.replace('custom_', ''));
      var cj = customJobs[idx];
      if (!cj) return null;
      return { key: key, label: cj.label || cj.jobName || 'Custom', enabled: true, isCustom: true };
    }
    var builtin = BUILTIN_BUTTONS.find(function(b) { return b.key === key; });
    if (!builtin) return null;
    return { key: key, label: t(builtin.labelKey), enabled: enabledMap[key] || false, isCustom: false };
  }).filter(Boolean);
}

function renderButtonOrder(items, containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  var dragSrcEl = null;

  items.forEach(function(item, i) {
    var row = document.createElement('div');
    row.className = 'btn-item';
    row.setAttribute('data-key', item.key);
    row.setAttribute('draggable', 'true');

    // Find hint from BUILTIN_BUTTONS
    var hint = '';
    if (!item.isCustom) {
      var def = BUILTIN_BUTTONS.find(function(b) { return b.key === item.key; });
      if (def && def.hintKey) hint = t(def.hintKey);
    }
    if (hint) row.title = hint;

    // Drag handle
    var handle = document.createElement('span');
    handle.className = 'btn-drag-handle';
    handle.innerHTML = '&#9776;';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.enabled;
    if (item.isCustom) { cb.checked = true; cb.disabled = true; }

    var lbl = document.createElement('span');
    lbl.className = 'btn-label' + (item.isCustom ? ' custom-label' : '');
    lbl.textContent = item.label;
    lbl.addEventListener('click', function() {
      if (!cb.disabled) { cb.checked = !cb.checked; scheduleAutoSave(); }
    });

    cb.addEventListener('change', function() { scheduleAutoSave(); });

    row.appendChild(handle);
    row.appendChild(cb);
    row.appendChild(lbl);

    // Drag events
    var enterCount = 0;
    row.addEventListener('dragstart', function(e) {
      dragSrcEl = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', i.toString());
    });
    row.addEventListener('dragend', function() {
      row.classList.remove('dragging');
      container.querySelectorAll('.btn-item').forEach(function(el) {
        el.classList.remove('drag-over');
      });
    });
    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('dragenter', function(e) {
      e.preventDefault();
      enterCount++;
      if (row !== dragSrcEl) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', function() {
      enterCount--;
      if (enterCount <= 0) { row.classList.remove('drag-over'); enterCount = 0; }
    });
    row.addEventListener('drop', function(e) {
      e.preventDefault();
      enterCount = 0;
      row.classList.remove('drag-over');
      if (dragSrcEl === row) return;
      var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      var toIdx = Array.from(container.children).indexOf(row);
      if (fromIdx === toIdx) return;
      var currentItems = getButtonOrderFromUI(containerId);
      var moved = currentItems.splice(fromIdx, 1)[0];
      currentItems.splice(toIdx, 0, moved);
      renderButtonOrder(currentItems, containerId);
      scheduleAutoSave();
    });

    container.appendChild(row);
  });
}


function getButtonOrderFromUI(containerId) {
  var rows = document.querySelectorAll('#' + containerId + ' .btn-item');
  var items = [];
  rows.forEach(function(row) {
    items.push({
      key: row.getAttribute('data-key'),
      label: row.querySelector('.btn-label').textContent,
      enabled: row.querySelector('input[type="checkbox"]').checked,
      isCustom: row.getAttribute('data-key').indexOf('custom_') === 0,
    });
  });
  return items;
}

function renderCustomJobs(jobs, listId, orderContainerId) {
  var list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  (jobs || []).forEach(function(job, i) {
    var row = document.createElement('div');
    row.className = 'custom-job';
    row.innerHTML =
      '<input type="text" placeholder="Button label" value="' + escHtml(job.label || '') + '" data-field="label">' +
      '<input type="text" placeholder="Job name" value="' + escHtml(job.jobName || '') + '" data-field="jobName">' +
      '<span class="remove-btn" data-index="' + i + '">&times;</span>';
    list.appendChild(row);
  });

  list.querySelectorAll('.remove-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.dataset.index);
      var current = getCustomJobsFromUI(listId);
      current.splice(idx, 1);
      renderCustomJobs(current, listId, orderContainerId);
      rebuildButtonOrderCustom(orderContainerId, listId);
    });
  });
}

function renderJiraQuickActions(actions) {
  var list = document.getElementById('jiraQuickActionsList');
  list.innerHTML = '';
  (actions || []).forEach(function(a) {
    addJiraQuickActionRow(a.label || '', a.status || '', a.assignee || '');
  });
}

function addJiraQuickActionRow(label, status, assignee) {
  var list = document.getElementById('jiraQuickActionsList');
  var row = document.createElement('div');
  row.className = 'jira-quick-action';
  row.innerHTML =
    '<div class="jqa-row">' +
      '<input type="text" data-field="label" placeholder="Send to QA" value="' + escHtml(label) + '">' +
      '<span class="remove-btn" title="Remove">&times;</span>' +
    '</div>' +
    '<div class="jqa-row">' +
      '<div class="jqa-field"><span class="jqa-label">' + escHtml(t('jiraQuickActionStatus')) + '</span>' +
      '<input type="text" data-field="status" placeholder="IN QA REVIEW" value="' + escHtml(status) + '"></div>' +
      '<div class="jqa-field"><span class="jqa-label">' + escHtml(t('jiraQuickActionAssignee')) + '</span>' +
      '<input type="text" data-field="assignee" placeholder="username" value="' + escHtml(assignee) + '"></div>' +
    '</div>';
  row.querySelector('.remove-btn').addEventListener('click', function() { row.remove(); });
  list.appendChild(row);
}

function getJiraQuickActionsFromUI() {
  var rows = document.querySelectorAll('#jiraQuickActionsList .jira-quick-action');
  var actions = [];
  rows.forEach(function(row) {
    var label = row.querySelector('[data-field="label"]').value.trim();
    var status = row.querySelector('[data-field="status"]').value.trim();
    var assignee = row.querySelector('[data-field="assignee"]').value.trim();
    if (label && (status || assignee)) actions.push({ label: label, status: status, assignee: assignee });
  });
  return actions;
}

// Quick comments
function renderQuickComments(comments) {
  var list = document.getElementById('quickCommentsList');
  list.innerHTML = '';
  (comments || []).forEach(function(c) {
    addQuickCommentRow(c.label || '', c.text || '');
  });
}

function addQuickCommentRow(label, text) {
  var list = document.getElementById('quickCommentsList');
  var row = document.createElement('div');
  row.className = 'quick-comment-row';
  row.innerHTML =
    '<div class="jqa-row">' +
      '<input type="text" data-field="label" placeholder="LGTM" value="' + escHtml(label) + '" style="flex:1">' +
      '<span class="remove-btn" title="Remove">&times;</span>' +
    '</div>' +
    '<div class="jqa-row">' +
      '<input type="text" data-field="text" placeholder="Looks good to me!" value="' + escHtml(text) + '" style="width:100%">' +
    '</div>';
  row.querySelector('.remove-btn').addEventListener('click', function() { row.remove(); });
  list.appendChild(row);
}

function getQuickCommentsFromUI() {
  var rows = document.querySelectorAll('#quickCommentsList .quick-comment-row');
  var comments = [];
  rows.forEach(function(row) {
    var label = row.querySelector('[data-field="label"]').value.trim();
    var text = row.querySelector('[data-field="text"]').value.trim();
    if (label && text) comments.push({ label: label, text: text });
  });
  return comments;
}

// Cherry-pick branches
function renderCherryPickBranches(branches) {
  var list = document.getElementById('cherryPickBranchesList');
  list.innerHTML = '';
  (branches || []).forEach(function(b) {
    addCherryPickBranchRow(b);
  });
}

function addCherryPickBranchRow(branch) {
  var list = document.getElementById('cherryPickBranchesList');
  var row = document.createElement('div');
  row.className = 'cherry-pick-branch-row';
  row.innerHTML =
    '<div class="jqa-row field">' +
      '<input type="text" data-field="branch" placeholder="test-branch" value="' + escHtml(branch) + '" style="flex:1">' +
      '<span class="remove-btn" title="Remove">&times;</span>' +
    '</div>';
  row.querySelector('.remove-btn').addEventListener('click', function() { row.remove(); });
  list.appendChild(row);
}

function getCherryPickBranchesFromUI() {
  var rows = document.querySelectorAll('#cherryPickBranchesList .cherry-pick-branch-row');
  var branches = [];
  rows.forEach(function(row) {
    var branch = row.querySelector('[data-field="branch"]').value.trim();
    if (branch) branches.push(branch);
  });
  return branches;
}

function getCustomJobsFromUI(listId) {
  var rows = document.querySelectorAll('#' + listId + ' .custom-job');
  var jobs = [];
  rows.forEach(function(row) {
    var label = row.querySelector('[data-field="label"]').value.trim();
    var jobName = row.querySelector('[data-field="jobName"]').value.trim();
    if (label || jobName) jobs.push({ label: label, jobName: jobName });
  });
  return jobs;
}

function rebuildButtonOrderCustom(orderContainerId, listId) {
  var items = getButtonOrderFromUI(orderContainerId);
  var customJobs = getCustomJobsFromUI(listId);
  items = items.filter(function(it) { return !it.isCustom; });
  customJobs.forEach(function(cj, i) {
    items.push({ key: 'custom_' + i, label: cj.label || cj.jobName || 'Custom', enabled: true, isCustom: true });
  });
  renderButtonOrder(items, orderContainerId);
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// =========================================================================
// Save
// =========================================================================

function saveSettings() {
  if (activeTab === 'default') {
    saveDefaultTab();
  } else {
    saveProfileTab(activeTab);
  }
}

function saveDefaultTab() {
  var items = getButtonOrderFromUI('buttonOrder');
  var settings = {};

  items.forEach(function(it) {
    if (!it.isCustom) settings[it.key] = it.enabled;
  });

  settings.buttonOrder = items.map(function(it) { return it.key; });
  settings.sound_enabled = document.getElementById('sound_enabled').checked;
  settings.notifications_enabled = document.getElementById('notifications_enabled').checked;
  settings.show_time_tracker = document.getElementById('show_time_tracker').checked;
  settings.show_failed_job_view = document.getElementById('show_failed_job_view').checked;
  settings.skip_confirmations = document.getElementById('skip_confirmations').checked;
  settings.dim_drafts = document.getElementById('dim_drafts').checked;
  settings.highlight_own_mrs = document.getElementById('highlight_own_mrs').checked;
  settings.show_only_mine = document.getElementById('show_only_mine').checked;
  settings.show_needs_review = document.getElementById('show_needs_review').checked;
  settings.show_reviewer_badge = document.getElementById('show_reviewer_badge').checked;
  settings.show_copy_mr = document.getElementById('show_copy_mr').checked;
  settings.show_threads_badge = document.getElementById('show_threads_badge').checked;
  settings.show_size_badge = document.getElementById('show_size_badge').checked;
  settings.show_conflicts_badge = document.getElementById('show_conflicts_badge').checked;
  settings.show_approval_badge = document.getElementById('show_approval_badge').checked;
  settings.show_branches = document.getElementById('show_branches').checked;
  settings.show_branches_links = document.getElementById('show_branches_links').checked;
  // settings.show_group_by_author = document.getElementById('show_group_by_author').checked;
  settings.collapse_bars = document.getElementById('collapse_bars').checked;
  settings.hide_right_sidebar = document.getElementById('hide_right_sidebar').checked;
  settings.show_cmd_palette = document.getElementById('show_cmd_palette').checked;
  settings.show_standup = document.getElementById('show_standup').checked;
  settings.standup_jira_enrich = document.getElementById('standup_jira_enrich').checked;
  settings.show_cherry_pick = document.getElementById('show_cherry_pick').checked;
  settings.show_commit_version = document.getElementById('show_commit_version').checked;
  settings.show_group_play = document.getElementById('show_group_play').checked;
  settings.show_sensitive_warning = document.getElementById('show_sensitive_warning').checked;
  settings.show_git_commands = document.getElementById('show_git_commands').checked;
settings.cherry_pick_create_mr = document.getElementById('cherry_pick_create_mr').checked;
  settings.cherry_pick_smart_fallback = document.getElementById('cherry_pick_smart_fallback').checked;
  settings.cherry_pick_bump_version = document.getElementById('cherry_pick_bump_version').checked;
  settings.commits_jira_field = (document.getElementById('commits_jira_field').value || '').trim() || 'fixVersions';
  settings.cherry_pick_branches = getCherryPickBranchesFromUI();
  var newJiraUrl = (document.getElementById('jira_url').value || '').trim().replace(/\/+$/, '');
  if (newJiraUrl && newJiraUrl !== allData.jira_url) {
    // Request host permission for Jira domain
    chrome.permissions.request({ origins: [newJiraUrl + '/'] }, function(granted) {
      if (!granted) {
        document.getElementById('jira_url').value = allData.jira_url || '';
      }
    });
  }
  settings.jira_url = newJiraUrl;
  settings.jira_ticket_regex = (document.getElementById('jira_ticket_regex').value || '').trim();
  settings.show_jira_details = document.getElementById('show_jira_details').checked;
  settings.jiraQuickActions = getJiraQuickActionsFromUI();
  settings.language = document.getElementById('language').value || 'auto';
  settings.quickComments = getQuickCommentsFromUI();
  settings.reviewersList = (document.getElementById('reviewersList').value || '').trim();
  settings.reviewersJob = (document.getElementById('reviewersJob').value || '').trim();
  settings.customJobs = getCustomJobsFromUI('customJobsList').filter(function(j) { return j.label && j.jobName; });
  settings.projectProfiles = allData.projectProfiles || {};

  // Version bump settings
  var presetVal = document.getElementById('versionFilePreset').value;
  if (presetVal === 'custom') {
    settings.versionFile = (document.getElementById('versionFile').value || '').trim() || 'package.json';
  } else {
    settings.versionFile = presetVal;
  }
  settings.versionPath = (document.getElementById('versionPath').value || '').trim() || 'version';
  settings.versionStrategy = document.getElementById('versionStrategy').value || 'patch';
  settings.versionCommitTemplate = (document.getElementById('versionCommitTemplate').value || '').trim() || 'fix: bump version to {version}';
  settings.version_from_target = document.getElementById('version_from_target').checked;

  Object.assign(allData, settings);

  chrome.storage.sync.set(settings, function() {
    showSaved();
  });
}

function saveProfileTab(path) {
  var items = getButtonOrderFromUI('profileButtonOrder');
  var buttons = {};
  items.forEach(function(it) {
    if (!it.isCustom) buttons[it.key] = it.enabled;
  });

  // Version bump
  var pPresetVal = document.getElementById('profileVersionFilePreset').value;
  var profileVersionFile = '';
  if (pPresetVal === '__custom__') {
    profileVersionFile = (document.getElementById('profileVersionFile').value || '').trim();
  } else if (pPresetVal) {
    profileVersionFile = pPresetVal;
  }

  var profile = {
    buttons: buttons,
    buttonOrder: items.map(function(it) { return it.key; }),
    versionFile: profileVersionFile,
    versionPath: (document.getElementById('profileVersionPath').value || '').trim(),
    versionStrategy: document.getElementById('profileVersionStrategy').value || '',
    versionCommitTemplate: (document.getElementById('profileVersionCommitTemplate').value || '').trim(),
    reviewersList: (document.getElementById('profileReviewersList').value || '').trim(),
    reviewersJob: (document.getElementById('profileReviewersJob').value || '').trim(),
    customJobs: getCustomJobsFromUI('profileCustomJobsList').filter(function(j) { return j.label && j.jobName; }),
  };

  if (!allData.projectProfiles) allData.projectProfiles = {};
  allData.projectProfiles[path] = profile;

  chrome.storage.sync.set({ projectProfiles: allData.projectProfiles }, function() {
    showSaved();
  });
}

function showSaved() {
  var status = document.getElementById('status');
  status.textContent = t('saved');
  status.className = 'status saved';
  status.style.display = 'block';
  status.style.opacity = '1';
  setTimeout(function() {
    status.style.opacity = '0';
    setTimeout(function() { status.style.display = 'none'; }, 300);
  }, 1500);
}

// Debounced auto-save
var _autoSaveTimer = null;
function scheduleAutoSave() {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  var status = document.getElementById('status');
  status.textContent = t('unsavedChanges');
  status.className = 'status unsaved';
  status.style.display = 'block';
  status.style.opacity = '1';
  _autoSaveTimer = setTimeout(function() {
    saveSettings();
  }, 500);
}

function attachAutoSave() {
  // Listen for all input changes in the popup
  document.body.addEventListener('input', function(e) {
    if (e.target.matches('input, select')) scheduleAutoSave();
  });
  document.body.addEventListener('change', function(e) {
    if (e.target.matches('input, select')) scheduleAutoSave();
  });
}

// =========================================================================
// Init
// =========================================================================

document.addEventListener('DOMContentLoaded', function() {
  // Load language setting first, then render everything
  chrome.storage.sync.get({ language: 'auto' }, function(langData) {
    loadLanguage(langData.language, function() {
      // Apply i18n to static elements
      document.getElementById('howLink').textContent = t('howItWorks');

      // Show update banner if extension was just updated
      chrome.storage.sync.get({ update_version: '', update_dismissed: '' }, function(ud) {
        if (!ud.update_version) return;
        if (ud.update_dismissed === ud.update_version) return;
        var banner = document.getElementById('updateBanner');
        var isRu = (langData.language === 'ru') || (!langData.language || langData.language === 'auto') && (chrome.i18n.getUILanguage() || '').startsWith('ru');
        var changelogUrl = 'https://github.com/termyanen/gitlab-actions/blob/main/' + (isRu ? 'CHANGELOG_RU.md' : 'CHANGELOG.md');
        var reviewUrl = 'https://chromewebstore.google.com/detail/gitlab-mr-actions/lbploihmpffiihpgeojdlpcclegbdeak/reviews';
        banner.innerHTML =
          '<button class="update-close" id="updateClose">&times;</button>' +
          '<span class="update-version">v' + escHtml(ud.update_version) + '</span><br>' +
          escHtml(t('updateBannerText')) +
          '<br><a href="' + changelogUrl + '" target="_blank">' + escHtml(t('updateChangelog')) + '</a>' +
          '<span class="update-review">' + escHtml(t('updateReviewAsk')) + ' ' +
          '<a href="' + reviewUrl + '" target="_blank">' + escHtml(t('updateReviewLink')) + '</a></span>';
        banner.style.display = 'block';
        document.getElementById('updateClose').addEventListener('click', function() {
          banner.style.display = 'none';
          chrome.storage.sync.set({ update_dismissed: ud.update_version });
          chrome.action.setBadgeText({ text: '' });
        });
        // Clear badge when popup is opened
        chrome.action.setBadgeText({ text: '' });
      });

      detectCurrentProject().then(function() {
        chrome.storage.sync.get(Object.keys(DEFAULTS), function(data) {
          allData = data;
          renderTabs();
          renderActiveTab();

          // Auto-switch to current project's profile if it exists
          if (currentProjectPath && allData.projectProfiles && allData.projectProfiles[currentProjectPath]) {
            activeTab = currentProjectPath;
            renderTabs();
            renderActiveTab();
          }
        });
      });
    });
  });

  document.getElementById('addProfile').addEventListener('click', function() {
    if (!currentProjectPath) return;
    if (!allData.projectProfiles) allData.projectProfiles = {};
    // Create profile with current defaults
    allData.projectProfiles[currentProjectPath] = {
      buttons: {},
      buttonOrder: [],
      reviewersJob: '',
      customJobs: [],
    };
    activeTab = currentProjectPath;
    renderTabs();
    renderActiveTab();
    scheduleAutoSave();
  });

  document.getElementById('save').addEventListener('click', saveSettings);
  attachAutoSave();
});
