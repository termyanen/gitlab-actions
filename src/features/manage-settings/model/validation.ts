import * as workflow from "../../../entities/review";
import { validDisplayPreferences } from "../../../entities/settings";
import { isRecord, isUnknownArray } from "../../../shared/lib/validation";
import type { Settings } from "./config";
import {
  AI_REVIEW_PROMPTS,
  AI_REVIEW_PROMPT_MAX_LENGTH,
  AI_REVIEW_RULES,
  BUTTON_DEFAULTS,
  DEFAULTS,
  MR_ACTION_TYPES,
  SETTINGS_FILE_MAX_BYTES,
} from "./config";
export function createSettingsValidation(t: (key: string) => string) {
  function validateMrActions(actions: unknown) {
    if (!isUnknownArray(actions)) throw new Error(t("mrActionInvalid"));
    const ids: string[] = [];
    actions.forEach(function (action) {
      if (
        !isRecord(action) ||
        typeof action.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(action.id) ||
        ids.indexOf(action.id) !== -1 ||
        typeof action.label !== "string" ||
        !action.label.trim() ||
        typeof action.type !== "string" ||
        MR_ACTION_TYPES.indexOf(action.type) === -1 ||
        typeof action.labels !== "string" ||
        (/^(remove|add|set)_labels$/.test(action.type) &&
          !action.labels.split(/[,\n]+/).some(function (label: string) {
            return label.trim();
          }))
      )
        throw new Error(t("mrActionInvalid"));
      ids.push(action.id);
    });
  }
  function settingsObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function validateSettingsShape(value: unknown, example: unknown) {
    if (Array.isArray(example)) {
      if (!isUnknownArray(value)) throw new Error(t("settingsFileInvalid"));
      if (example.length)
        value.forEach(function (item) {
          validateSettingsShape(item, example[0]);
        });
    } else if (settingsObject(example)) {
      if (!settingsObject(value)) throw new Error(t("settingsFileInvalid"));
      Object.keys(value).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(example, key))
          throw new Error(t("settingsFileInvalid"));
        validateSettingsShape(value[key], example[key]);
      });
    } else if (typeof value !== typeof example) {
      throw new Error(t("settingsFileInvalid"));
    }
  }
  function settingsSnapshot(data: Record<string, unknown>) {
    const settings: Record<string, unknown> = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      settings[key] = Object.prototype.hasOwnProperty.call(data, key)
        ? data[key]
        : DEFAULTS[key];
    });
    const snapshot: unknown = JSON.parse(JSON.stringify(settings));
    if (!isRecord(snapshot)) throw new Error(t("settingsFileInvalid"));
    return snapshot;
  }
  function validateSharedSettings(
    settings: Record<string, unknown>,
  ): asserts settings is Settings {
    if (!validDisplayPreferences(settings))
      throw new Error(t("displayPreferencesInvalid"));
    const job = { label: "", jobName: "" };
    const mrAction = { id: "", label: "", type: "", labels: "" };
    const profileShape = {
      buttons: BUTTON_DEFAULTS,
      buttonOrder: [""],
      customJobs: [job],
      mrActions: [mrAction],
      versionFile: "",
      versionPath: "",
      versionStrategy: "",
      versionCommitTemplate: "",
      reviewersList: "",
      reviewersJob: "",
    };
    Object.keys(settings).forEach(function (key) {
      const value = settings[key];
      if (key === "projectProfiles") {
        if (!settingsObject(value)) throw new Error(t("settingsFileInvalid"));
        Object.keys(value).forEach(function (path) {
          if (
            !path ||
            ["__proto__", "constructor", "prototype"].indexOf(path) !== -1
          )
            throw new Error(t("settingsFileInvalid"));
          const profile = value[path];
          if (!isRecord(profile)) throw new Error(t("settingsFileInvalid"));
          validateSettingsShape(profile, profileShape);
          if (profile.mrActions) validateMrActions(profile.mrActions);
        });
      } else if (key === "jiraQuickActions") {
        if (!isUnknownArray(value)) throw new Error(t("settingsFileInvalid"));
        value.forEach(function (action) {
          if (!isRecord(action)) throw new Error(t("settingsFileInvalid"));
          // Custom Jira fields intentionally accept arbitrary JSON values.
          validateSettingsShape(action, {
            label: "",
            status: "",
            assignee: "",
            updates: [],
          });
          const updates = action.updates || [];
          if (!isUnknownArray(updates))
            throw new Error(t("settingsFileInvalid"));
          updates.forEach(function (update) {
            if (
              !settingsObject(update) ||
              typeof update.field !== "string" ||
              typeof update.operation !== "string" ||
              ["set", "add", "remove"].indexOf(update.operation) === -1 ||
              !Object.prototype.hasOwnProperty.call(update, "value")
            )
              throw new Error(t("settingsFileInvalid"));
            const listField =
              ["labels", "fixVersions", "versions", "components"].indexOf(
                update.field,
              ) !== -1;
            if (listField) validateSettingsShape(update.value, [""]);
            else if (["priority", "duedate"].indexOf(update.field) !== -1)
              validateSettingsShape(update.value, "");
            else if (!/^customfield_\d+$/.test(update.field))
              throw new Error(t("settingsFileInvalid"));
          });
        });
      } else {
        let shape: unknown = DEFAULTS[key];
        if (key === "customJobs") shape = [job];
        if (key === "mrActions") {
          shape = [mrAction];
          validateMrActions(value);
        }
        if (key === "quickComments") shape = [{ label: "", text: "" }];
        if (key === "buttonOrder" || key === "cherry_pick_branches")
          shape = [""];
        validateSettingsShape(value, shape);
      }
    });
    AI_REVIEW_PROMPTS.forEach(function (prompt) {
      if (String(settings[prompt.key]).length > AI_REVIEW_PROMPT_MAX_LENGTH)
        throw new Error(t("aiReviewPromptTooLong"));
    });
    AI_REVIEW_RULES.forEach(function (block) {
      const key = workflow.INSTRUCTION_PREFIX + block.id;
      workflow.normalizeInstruction(block, settings[key]);
    });
    workflow.normalizeFilter(settings.ai_review_file_filter);
    if (
      typeof settings.language !== "string" ||
      typeof settings.ai_review_response_language !== "string" ||
      typeof settings.versionStrategy !== "string" ||
      ["auto", "en", "ru", "zh_CN", "ja", "de", "fr", "es"].indexOf(
        settings.language,
      ) === -1 ||
      ["auto", "en", "ru", "zh_CN", "ja", "de", "fr", "es"].indexOf(
        settings.ai_review_response_language,
      ) === -1 ||
      ["patch", "minor", "major"].indexOf(settings.versionStrategy) === -1
    )
      throw new Error(t("settingsFileInvalid"));
    if (typeof settings.jira_url === "string" && settings.jira_url) {
      const jira = new URL(settings.jira_url);
      if (
        jira.protocol !== "https:" ||
        jira.username ||
        jira.password ||
        jira.search ||
        jira.hash
      )
        throw new Error(t("settingsFileInvalid"));
    }
    if (
      typeof settings.jira_ticket_regex === "string" &&
      settings.jira_ticket_regex
    ) {
      try {
        new RegExp(settings.jira_ticket_regex, "g");
      } catch {
        throw new Error(t("settingsFileInvalid"));
      }
    }
    Object.keys(settings).forEach(function (key) {
      if (
        new TextEncoder().encode(key + JSON.stringify(settings[key])).length >
        8192
      )
        throw new Error(t("settingsFileTooLarge"));
    });
    return;
  }
  function parseSettingsFile(text: string) {
    if (new TextEncoder().encode(text).length > SETTINGS_FILE_MAX_BYTES)
      throw new Error(t("settingsFileTooLarge"));
    let file: unknown;
    try {
      file = JSON.parse(text);
    } catch {
      throw new Error(t("settingsFileInvalid"));
    }
    if (
      !settingsObject(file) ||
      file.format !== "gitlab-mr-actions-settings" ||
      file.formatVersion !== 1 ||
      !settingsObject(file.settings) ||
      !Object.keys(file.settings).some(function (key) {
        return Object.prototype.hasOwnProperty.call(DEFAULTS, key);
      })
    )
      throw new Error(t("settingsFileInvalid"));
    const settings = settingsSnapshot(file.settings);
    validateSharedSettings(settings);
    return settings;
  }
  return { validateMrActions, settingsSnapshot, parseSettingsFile };
}
