import { CherryPickOptions } from "./cherry-pick-options";
import {
  useSettingsForm,
  SettingInheritance,
  Section,
  BoundInput,
  BoundSelect,
  BoundTextarea,
  BoundToggle,
  LanguageOptions,
  plainVersionFile,
} from "./form-controls";
import {
  ButtonOrder,
  CustomJobsEditor,
  MrActionsEditor,
  QuickCommentsEditor,
  CherryPickEditor,
  JiraActionsEditor,
} from "./editors";
import { AiSettings, AiFilters } from "./ai-settings";
import { JiraConnection } from "./jira-connection";
import { LANGUAGES } from "../../../shared/i18n";
import {
  JIRA_ACTION_FIELDS,
  MR_ACTION_TYPES,
  BUILTIN_BUTTONS,
} from "../../../features/manage-settings";
import type { SectionMeta } from "../model/navigation";
export const defaultSections: readonly SectionMeta[] = [
  {
    category: "actions",
    terms: [
      "buttonOrder",
      "buttonOrderHint",
      ...BUILTIN_BUTTONS.flatMap((b) => [b.labelKey, b.hintKey]),
    ],
  },
  {
    category: "general",
    terms: [
      "general",
      "languageLabel",
      "languageAuto",
      ...LANGUAGES.map((l) => l.label),
      "soundNotifications",
      "desktopNotifications",
      "skipConfirmations",
    ],
  },
  {
    category: "appearance",
    terms: [
      "uxEnhancer",
      "dimDrafts",
      "highlightOwnMrs",
      "showOnlyMine",
      "showNeedsReview",
      "showReviewerBadge",
      "showCopyMr",
      "showThreadsBadge",
      "showSizeBadge",
      "showConflictsBadge",
      "showApprovalBadge",
      "showBranches",
      "showBranchesLinks",
    ],
  },
  {
    category: "appearance",
    terms: [
      "uiCustomization",
      "showTimeTracker",
      "collapseBars",
      "hideRightSidebar",
      "showCmdPalette",
      "showStandup",
    ],
  },
  {
    category: "appearance",
    terms: ["mrDetailEnhancements", "showSensitiveWarning", "showGitCommands"],
  },
  {
    category: "ai",
    terms: [
      "aiReviewSettingsTitle",
      "showAiReviewCopy",
      "aiReviewSettingsHint",
      "aiReviewConfirmCloseSetting",
      "aiReviewPrivacyHint",
      "aiReviewGuide",
      "aiReviewResponseLanguage",
      "aiReviewResponseLanguageAuto",
      "aiReviewResponseLanguageHint",
      "aiReviewFeedbackPrompt",
      "aiReviewPromptHint",
      "aiReviewResetPrompt",
      "aiReviewFreshPrompt",
      "aiReviewFreshPromptHint",
      "aiReviewImportPromptSetting",
      "aiReviewImportPromptSettingHint",
      "aiReviewReplyPromptSetting",
      "aiReviewReplyPromptSettingHint",
      "aiReviewRepeatPrompt",
      "aiReviewAutomaticInstructions",
      "aiReviewAutomaticInstructionsHint",
      "aiReviewRule_repository",
      "aiReviewInstructionEnabled",
      "aiReviewInstructionTextHint",
      "aiReviewRule_fix_checkout",
      "aiReviewRule_review_checkout",
      "aiReviewRule_language",
      "aiReviewLanguageTemplateHint",
      "aiReviewRule_scope",
      "aiReviewRule_feedback_context",
      "aiReviewRule_fix_summary",
      "aiReviewRule_description_task",
      "aiReviewRule_missing_feedback",
      "aiReviewRule_fix_replies",
      "aiReviewRule_review_safety",
      "aiReviewRule_review_source",
      "aiReviewRule_included_diff",
      "aiReviewRule_omitted_diff",
      "aiReviewRule_missing_source",
      "aiReviewRule_format_intro",
      "aiReviewRule_finding_format",
      "aiReviewRule_repeat_replies",
      "aiReviewRule_same_head",
      "aiReviewRule_comparison_lines",
      "aiReviewRule_compare_locally",
      "aiReviewRule_target_changed",
      "aiReviewRule_full_review",
      "aiReviewRule_code_only",
      "aiReviewRule_selected_threads",
      "aiReviewRule_cumulative_diff",
      "aiReviewRule_existing_discussions",
      "aiReviewRule_import_task",
      "aiReviewRule_import_safety",
      "aiReviewRule_import_format",
      "aiReviewRule_reply_format",
      "aiReviewRule_reply_task",
      "aiReviewSelectionTemplateHint",
    ],
  },
  {
    category: "ai",
    terms: [
      "aiReviewFileFilters",
      "aiReviewFileFiltersHint",
      "aiReviewIncludeExtensions",
      "aiReviewIncludeFiles",
      "aiReviewIgnoreFiles",
      "aiReviewIgnoreDirs",
    ],
  },
  {
    category: "actions",
    terms: [
      "cherryPickBranches",
      "showCherryPick",
      "cherryPickBranchesHint",
      "cherryPickCreateMrDefault",
      "cherryPickSmartFallback",
      "cherryPickSmartFallbackHint",
      "cherryPickBumpVersion",
      "cherryPickBumpVersionHint",
      "cherryPickBranchAdd",
    ],
  },
  {
    category: "jira",
    terms: ["settingsConnection", "jiraUrl", "jiraUrlHint", "jiraGrantAccess"],
  },
  {
    category: "jira",
    terms: [
      "settingsJiraDisplay",
      "standupJiraEnrich",
      "showJiraDetails",
      "commitsJiraField",
      "commitsJiraFieldHint",
    ],
  },
  {
    category: "jira",
    terms: [
      "jiraQuickActions",
      "jiraQuickActionsHint",
      ...JIRA_ACTION_FIELDS.map(([, label]) => label),
      "jiraQuickActionsAdd",
    ],
  },
  {
    category: "jira",
    terms: ["settingsAdvanced", "jiraTicketRegex", "jiraTicketRegexHint"],
  },
  {
    category: "actions",
    terms: [
      "versionBump",
      "showCommitVersion",
      "showCommitVersionHint",
      "filePath",
      "plainText",
      "customFile",
      "filePathHint",
      "versionField",
      "versionFieldHint",
      "strategy",
      "strategyPatch",
      "strategyMinor",
      "strategyMajor",
      "commitMessage",
      "commitMessageHint",
      "versionFromTarget",
      "versionFromTargetHint",
    ],
  },
  {
    category: "actions",
    terms: ["quickComments", "quickCommentsHint", "quickCommentsAdd"],
  },
  {
    category: "actions",
    terms: [
      "reviewers",
      "reviewersList",
      "reviewersListHint",
      "jobName",
      "jobNameHint",
    ],
  },
  {
    category: "ci",
    terms: [
      "customJobButtons",
      "showGroupPlay",
      "showFailedJobView",
      "customJobsHint",
      "addJobButton",
    ],
  },
  {
    category: "actions",
    terms: [
      "mrActions",
      "mrActionsHint",
      "mrActionAdd",
      ...MR_ACTION_TYPES.map((type) => "mrAction_" + type),
    ],
  },
  {
    category: "ci",
    terms: [
      "displayPreferencesTitle",
      "failedJobsLimit",
      "failedJobTraceLines",
    ],
  },
  {
    category: "actions",
    terms: ["displayPreferencesTitle", "reviewerNotesLimit"],
  },
  {
    category: "appearance",
    terms: [
      "displayPreferencesTitle",
      "sizeThresholdsHint",
      "mrSizeLines",
      "mrSizeFiles",
      "sensitiveFilePatterns",
      "sensitiveFileExclusions",
      "sensitiveFileDefaults",
      "sensitivePatternsHint",
    ],
  },
];
export function DefaultForm({
  additionalProfile = false,
}: {
  additionalProfile?: boolean;
}) {
  const { draft, update, t, search } = useSettingsForm();
  const editorProps = { draft, update, t };
  return (
    <>
      {!additionalProfile && (
        <Section meta={defaultSections[0]}>
          <h2>{t("buttonOrder")}</h2>
          <div className="hint" style={{ marginBottom: "6px" }}>
            {t("buttonOrderHint")}
          </div>
          <ButtonOrder {...editorProps} />
        </Section>
      )}
      <Section meta={defaultSections[1]}>
        <h2>{t("general")}</h2>
        {!additionalProfile ? (
          <>
            <div className="field">
              <label htmlFor="language">{t("languageLabel")}</label>
              <BoundSelect id="language">
                <LanguageOptions automaticLabel={t("languageAuto")} />
              </BoundSelect>
            </div>
            <BoundToggle id="sound_enabled" label={t("soundNotifications")} />
            <BoundToggle
              id="notifications_enabled"
              label={t("desktopNotifications")}
            />
          </>
        ) : (
          <p className="hint">{t("settingsSharedPreferencesHint")}</p>
        )}
        <BoundToggle id="skip_confirmations" label={t("skipConfirmations")} />
      </Section>
      <Section meta={defaultSections[2]}>
        <h2>{t("uxEnhancer")}</h2>
        <BoundToggle id="dim_drafts" label={t("dimDrafts")} />
        <BoundToggle id="highlight_own_mrs" label={t("highlightOwnMrs")} />
        <BoundToggle id="show_only_mine" label={t("showOnlyMine")} />
        <BoundToggle id="show_needs_review" label={t("showNeedsReview")} />
        <BoundToggle id="show_reviewer_badge" label={t("showReviewerBadge")} />
        <BoundToggle id="show_copy_mr" label={t("showCopyMr")} />
        <BoundToggle id="show_threads_badge" label={t("showThreadsBadge")} />
        <BoundToggle id="show_size_badge" label={t("showSizeBadge")} />
        <BoundToggle
          id="show_conflicts_badge"
          label={t("showConflictsBadge")}
        />
        <BoundToggle id="show_approval_badge" label={t("showApprovalBadge")} />
        <BoundToggle id="show_branches" label={t("showBranches")} />
        <BoundToggle id="show_branches_links" label={t("showBranchesLinks")} />
      </Section>
      <Section meta={defaultSections[3]}>
        <h2>{t("uiCustomization")}</h2>
        <BoundToggle id="show_time_tracker" label={t("showTimeTracker")} />
        <BoundToggle id="collapse_bars" label={t("collapseBars")} />
        <BoundToggle id="hide_right_sidebar" label={t("hideRightSidebar")} />
        <BoundToggle id="show_cmd_palette" label={t("showCmdPalette")} />
        <BoundToggle id="show_standup" label={t("showStandup")} />
      </Section>
      <Section meta={defaultSections[4]}>
        <h2>{t("mrDetailEnhancements")}</h2>
        <BoundToggle
          id="show_sensitive_warning"
          label={t("showSensitiveWarning")}
        />
        <BoundToggle id="show_git_commands" label={t("showGitCommands")} />
      </Section>
      <Section meta={defaultSections[5]}>
        <AiSettings />
      </Section>
      <Section meta={defaultSections[6]}>
        <AiFilters />
      </Section>
      {!additionalProfile && (
        <Section meta={defaultSections[7]}>
          <h2>{t("cherryPickBranches")}</h2>
          <p className="hint">{t("cherryPickBranchesHint")}</p>
          <CherryPickOptions />
          <CherryPickEditor {...editorProps} />
        </Section>
      )}

      <Section meta={defaultSections[8]}>
        <h2>{t("settingsConnection")}</h2>
        <JiraConnection />
      </Section>
      <Section meta={defaultSections[9]}>
        <h2>{t("settingsJiraDisplay")}</h2>
        {!additionalProfile && (
          <BoundToggle
            id="standup_jira_enrich"
            label={t("standupJiraEnrich")}
          />
        )}
        <BoundToggle id="show_jira_details" label={t("showJiraDetails")} />
        <div className="field">
          <label htmlFor="commits_jira_field">{t("commitsJiraField")}</label>
          <BoundInput
            type="text"
            id="commits_jira_field"
            placeholder="fixVersions, status"
          />
          <div className="hint">{t("commitsJiraFieldHint")}</div>
        </div>
      </Section>
      <Section meta={defaultSections[10]}>
        <h2>{t("jiraQuickActions")}</h2>
        <div className="hint">{t("jiraQuickActionsHint")}</div>
        <SettingInheritance settingKey="jiraQuickActions">
          <JiraActionsEditor {...editorProps} />
        </SettingInheritance>
      </Section>
      <Section meta={defaultSections[11]}>
        <details open={search ? true : undefined}>
          <summary>{t("settingsAdvanced")}</summary>
          <div className="field">
            <label htmlFor="jira_ticket_regex">{t("jiraTicketRegex")}</label>
            <BoundInput
              type="text"
              id="jira_ticket_regex"
              placeholder="[A-Z][A-Z0-9]+-\\d+"
            />
            <div className="hint">{t("jiraTicketRegexHint")}</div>
          </div>
        </details>
      </Section>
      {!additionalProfile && (
        <Section meta={defaultSections[12]}>
          <h2>{t("versionBump")}</h2>
          <BoundToggle
            id="show_commit_version"
            label={t("showCommitVersion")}
          />
          <div className="hint" style={{ marginBottom: "8px" }}>
            {t("showCommitVersionHint")}
          </div>
          <div className="field">
            <label htmlFor="versionFilePreset">{t("filePath")}</label>
            <BoundSelect id="versionFilePreset" style={{ marginBottom: "4px" }}>
              <option value="package.json">{"package.json"}</option>
              <option value="pyproject.toml">{"pyproject.toml"}</option>
              <option value="version.txt">
                {"version.txt ("}
                {t("plainText")}
                {")"}
              </option>
              <option value="custom">{t("customFile")}</option>
            </BoundSelect>
            <BoundInput
              type="text"
              id="versionFile"
              placeholder="path/to/file"
              hidden={draft.fields.versionFilePreset !== "custom"}
            />
            <div className="hint">{t("filePathHint")}</div>
          </div>
          <div
            className="field"
            id="versionPathField"
            hidden={plainVersionFile(draft, false)}
          >
            <label htmlFor="versionPath">{t("versionField")}</label>
            <BoundInput type="text" id="versionPath" placeholder="version" />
            <div className="hint">{t("versionFieldHint")}</div>
          </div>
          <div className="field">
            <label htmlFor="versionStrategy">{t("strategy")}</label>
            <BoundSelect id="versionStrategy">
              <option value="patch">{t("strategyPatch")}</option>
              <option value="minor">{t("strategyMinor")}</option>
              <option value="major">{t("strategyMajor")}</option>
            </BoundSelect>
          </div>
          <div className="field">
            <label htmlFor="versionCommitTemplate">{t("commitMessage")}</label>
            <BoundInput
              type="text"
              id="versionCommitTemplate"
              placeholder="fix: bump version to {version}"
            />
            <div className="hint">{t("commitMessageHint")}</div>
          </div>
          <BoundToggle
            id="version_from_target"
            label={t("versionFromTarget")}
          />
          <div className="hint">{t("versionFromTargetHint")}</div>
        </Section>
      )}
      <Section meta={defaultSections[13]}>
        <h2>{t("quickComments")}</h2>
        <div className="hint" style={{ marginBottom: "8px" }}>
          {t("quickCommentsHint")}
        </div>
        <SettingInheritance settingKey="quickComments">
          <QuickCommentsEditor {...editorProps} />
        </SettingInheritance>
      </Section>
      {!additionalProfile && (
        <Section meta={defaultSections[14]}>
          <h2>{t("reviewers")}</h2>
          <div className="field">
            <label htmlFor="reviewersList">{t("reviewersList")}</label>
            <BoundInput
              type="text"
              id="reviewersList"
              placeholder="@user1, @user2"
            />
            <div className="hint">{t("reviewersListHint")}</div>
          </div>
          <div className="field">
            <label htmlFor="reviewersJob">{t("jobName")}</label>
            <BoundInput
              type="text"
              id="reviewersJob"
              placeholder="get-reviewers"
            />
            <div className="hint">{t("jobNameHint")}</div>
          </div>
        </Section>
      )}
      <Section meta={defaultSections[15]}>
        <h2>{t(additionalProfile ? "settingsCi" : "customJobButtons")}</h2>
        <BoundToggle id="show_group_play" label={t("showGroupPlay")} />
        <BoundToggle id="show_failed_job_view" label={t("showFailedJobView")} />
        <div className="hint" style={{ marginBottom: "8px" }}>
          {t("customJobsHint")}
        </div>
        {!additionalProfile && <CustomJobsEditor {...editorProps} />}
      </Section>
      {!additionalProfile && (
        <Section meta={defaultSections[16]}>
          <h2>{t("mrActions")}</h2>
          <p className="hint">{t("mrActionsHint")}</p>
          <MrActionsEditor {...editorProps} />
        </Section>
      )}
      <Section meta={defaultSections[17]}>
        <details open={search ? true : undefined} className="ai-review-rules">
          <summary>{t("displayPreferencesTitle")}</summary>
          <div className="field">
            <label htmlFor="failed_jobs_limit">
              {t("failedJobsLimit")}
              {" (1–20)"}
            </label>
            <BoundInput id="failed_jobs_limit" type="number" required />
          </div>
          <div className="field">
            <label htmlFor="failed_job_trace_lines">
              {t("failedJobTraceLines")}
              {" (10–500)"}
            </label>
            <BoundInput id="failed_job_trace_lines" type="number" required />
          </div>
        </details>
      </Section>
      <Section meta={defaultSections[18]}>
        <details open={search ? true : undefined} className="ai-review-rules">
          <summary>{t("displayPreferencesTitle")}</summary>
          <div className="field">
            <label htmlFor="reviewer_notes_limit">
              {t("reviewerNotesLimit")}
              {" (1–100)"}
            </label>
            <BoundInput id="reviewer_notes_limit" type="number" required />
          </div>
        </details>
      </Section>
      <Section meta={defaultSections[19]}>
        <details open={search ? true : undefined} className="ai-review-rules">
          <summary>{t("displayPreferencesTitle")}</summary>
          <p className="hint">{t("sizeThresholdsHint")}</p>
          <div className="field">
            <label htmlFor="mr_size_lines">{t("mrSizeLines")}</label>
            <BoundInput id="mr_size_lines" type="text" required />
          </div>
          <div className="field">
            <label htmlFor="mr_size_files">{t("mrSizeFiles")}</label>
            <BoundInput id="mr_size_files" type="text" required />
          </div>
          <div className="field">
            <label htmlFor="sensitive_file_patterns">
              {t("sensitiveFilePatterns")}
            </label>
            <BoundTextarea
              id="sensitive_file_patterns"
              rows={3}
              maxLength={1500}
            ></BoundTextarea>
          </div>
          <div className="field">
            <label htmlFor="sensitive_file_exclusions">
              {t("sensitiveFileExclusions")}
            </label>
            <BoundTextarea
              id="sensitive_file_exclusions"
              rows={3}
              maxLength={1500}
            ></BoundTextarea>
          </div>
          <BoundToggle
            id="sensitive_file_defaults"
            label={t("sensitiveFileDefaults")}
          />
          <p className="hint">{t("sensitivePatternsHint")}</p>
        </details>
      </Section>
    </>
  );
}
