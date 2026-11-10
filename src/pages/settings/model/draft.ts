import { applyProjectSettings } from "../../../shared/api/project-settings";
import {
  LEGACY_PROJECT_FIELDS,
  isProjectSettingKey,
} from "../../../shared/config/project-settings";
import * as workflow from "../../../entities/review";
import {
  BUTTON_DEFAULTS,
  normalizeCherryPickBranches,
  validDisplayPreferences,
  VERSION_DEFAULTS,
} from "../../../entities/settings";
import type {
  CustomJob,
  MrAction,
  QuickComment,
  ProjectProfile,
} from "../../../entities/settings";
import {
  AI_REVIEW_PROMPTS,
  AI_REVIEW_RULES,
  AI_REVIEW_FILTER_FIELDS,
  AI_REVIEW_PROMPT_MAX_LENGTH,
  DEFAULTS,
  createSettingsValidation,
  readJiraBaseUrl,
} from "../../../features/manage-settings";
import type { Settings } from "../../../features/manage-settings";
import { jiraActionsToDraft, serializeJiraActions } from "./jira-actions";
import type { JiraActionDraft } from "./jira-actions";

export type Translate = (key: string, substitutions?: string[]) => string;
export interface SettingsDraft {
  overrides?: string[];
  legacyKeys?: string[];
  resetLegacy?: string[];
  inherited?: SettingsDraft;
  fields: Record<string, string | boolean>;
  jobs: CustomJob[];
  actions: MrAction[];
  comments: QuickComment[];
  branches: string[];
  jiraActions: JiraActionDraft[];
  order: string[];
  rowKeys?: { jobs: string[]; comments: string[]; branches: string[] };
}
export function fieldText(draft: SettingsDraft, key: string): string {
  const value = draft.fields[key];
  return typeof value === "string" ? value : "";
}
const profileFields = [
  "versionFile",
  "versionPath",
  "versionStrategy",
  "versionCommitTemplate",
  "reviewersList",
  "reviewersJob",
] as const;
export function createDraft(data: Settings, scope = "default"): SettingsDraft {
  const original = data;
  const profile =
    scope === "default" ? undefined : data.projectProfiles[scope] || {};
  if (profile) data = applyProjectSettings(data, { [scope]: profile }, scope);
  const fields: SettingsDraft["fields"] = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = data[key] ?? fallback;
    if (typeof value === "boolean" || typeof value === "string")
      fields[key] = value;
    else if (typeof value === "number") fields[key] = String(value);
  }
  for (const block of AI_REVIEW_RULES) {
    const key = workflow.INSTRUCTION_PREFIX + block.id;
    let instruction;
    try {
      instruction = workflow.normalizeInstruction(block, data[key]);
    } catch {
      // Match the existing editor recovery: a malformed stored block must not
      // prevent opening settings to reset it. Draft writes still validate it.
      instruction = { enabled: true, text: block.text };
    }
    fields[key] = instruction.text;
    fields[key + "_enabled"] = instruction.enabled;
  }
  for (const key of AI_REVIEW_FILTER_FIELDS)
    fields["ai_review_filter_" + key] = data.ai_review_file_filter[key];
  fields.ai_review_response_language = workflow.normalizeResponseLanguage(
    data.ai_review_response_language,
  );
  if (profile) {
    for (const key of profileFields) fields[key] = profile[key] || "";
    for (const key of Object.keys(BUTTON_DEFAULTS))
      fields[key] = profile.buttons?.[key] ?? data[key] === true;
  } else {
    // Empty global values historically display their effective defaults;
    // empty project values must continue to mean “inherit”.
    const fallbackFields = [
      "versionFile",
      "versionPath",
      "versionStrategy",
      "versionCommitTemplate",
      "reviewersJob",
      "commits_jira_field",
      "language",
    ] as const;
    for (const key of fallbackFields)
      fields[key] = fields[key] || DEFAULTS[key];
  }
  const file = typeof fields.versionFile === "string" ? fields.versionFile : "";
  const presets = profile
    ? ["package.json", "pyproject.toml"]
    : ["package.json", "pyproject.toml", "version.txt"];
  fields.versionFilePreset = presets.includes(file)
    ? file
    : file
      ? profile
        ? "__custom__"
        : "custom"
      : "";
  if (presets.includes(file)) fields.versionFile = "";
  const jobs = structuredClone(
    profile ? profile.customJobs || data.customJobs : data.customJobs,
  );
  const comments = structuredClone(data.quickComments);
  const branches = [
    ...(profile
      ? profile.cherry_pick_branches || []
      : data.cherry_pick_branches),
  ];
  return {
    ...(profile
      ? {
          overrides: Object.keys(profile.overrides || {}),
          legacyKeys: [
            ...LEGACY_PROJECT_FIELDS.filter((key) =>
              typeof profile[key] === "string"
                ? !!profile[key]
                : profile[key] !== undefined,
            ),
            ...Object.keys(profile.buttons || {}),
          ],
          resetLegacy: [],
          inherited: createDraft(original),
        }
      : {}),
    fields,
    jobs,
    comments,
    branches,
    actions: structuredClone(
      profile ? profile.mrActions || data.mrActions : data.mrActions,
    ),
    order: [
      ...(profile ? profile.buttonOrder || data.buttonOrder : data.buttonOrder),
    ],
    jiraActions: jiraActionsToDraft(data.jiraQuickActions),
    rowKeys: {
      jobs: jobs.map(() => crypto.randomUUID()),
      comments: comments.map(() => crypto.randomUUID()),
      branches: branches.map(() => crypto.randomUUID()),
    },
  };
}
export function orderedKeys(draft: SettingsDraft) {
  const available = [
    ...Object.keys(BUTTON_DEFAULTS),
    ...draft.jobs.map((_, i) => "custom_" + i),
    ...draft.actions.map((a) => "mr_action_" + a.id),
  ];
  return [
    ...new Set([
      ...draft.order.filter((key) => available.includes(key)),
      ...available,
    ]),
  ];
}

/** Visibility belongs to the row, so deleting/reordering jobs cannot transfer it. */
export function setButtonEnabled(
  draft: SettingsDraft,
  key: string,
  enabled: boolean,
): SettingsDraft {
  if (key.startsWith("custom_")) {
    const index = Number(key.slice("custom_".length));
    return {
      ...draft,
      jobs: draft.jobs.map((job, i) =>
        i === index ? { ...job, enabled } : job,
      ),
    };
  }
  if (key.startsWith("mr_action_")) {
    const id = key.slice("mr_action_".length);
    return {
      ...draft,
      actions: draft.actions.map((action) =>
        action.id === id ? { ...action, enabled } : action,
      ),
    };
  }
  return { ...draft, fields: { ...draft.fields, [key]: enabled } };
}

function normalizedActions(draft: SettingsDraft, t: Translate) {
  const actions = draft.actions.map((a) => ({
    ...a,
    label: a.label.trim(),
    labels: /^(remove|add|set)_labels$/.test(a.type)
      ? [
          ...new Set(
            (a.labels || "")
              .split(/[,\n]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ].join(", ")
      : "",
  }));
  createSettingsValidation(t).validateMrActions(actions);
  return actions;
}
export function serializeDraft(
  draft: SettingsDraft,
  data: Settings,
  scope: string,
  t: Translate,
): Record<string, unknown> {
  const text = (key: string) => fieldText(draft, key).trim();
  const jobs = draft.jobs
    .map((j) => ({
      label: j.label.trim(),
      jobName: j.jobName.trim(),
      ...(j.enabled === undefined ? {} : { enabled: j.enabled }),
    }))
    .filter((j) => j.label && j.jobName);
  const actions = normalizedActions(draft, t);
  // Job indexes in the toolbar refer to persisted, complete rows only.
  const order = orderedKeys(draft).flatMap((key) => {
    if (!key.startsWith("custom_")) return [key];
    const source = draft.jobs[Number(key.slice("custom_".length))];
    if (!source?.label.trim() || !source.jobName.trim()) return [];
    const index = draft.jobs
      .slice(0, Number(key.slice("custom_".length)))
      .filter((j) => j.label.trim() && j.jobName.trim()).length;
    return ["custom_" + index];
  });
  const preset = text("versionFilePreset");
  const file =
    preset === "custom" || preset === "__custom__"
      ? text("versionFile")
      : preset;
  if (scope !== "default") {
    const previous = data.projectProfiles[scope] || {};
    const profile: ProjectProfile = { ...previous };
    for (const key of draft.resetLegacy || []) {
      if (key.startsWith("btn_") && profile.buttons) {
        profile.buttons = { ...profile.buttons };
        delete profile.buttons[key];
        if (!Object.keys(profile.buttons).length) delete profile.buttons;
      } else {
        for (const field of LEGACY_PROJECT_FIELDS)
          if (field === key) delete profile[field];
      }
    }
    const baseline = createDraft(
      {
        ...data,
        projectProfiles: { ...data.projectProfiles, [scope]: profile },
      },
      scope,
    );
    const changed = (a: unknown, b: unknown) =>
      JSON.stringify(a) !== JSON.stringify(b);
    for (const key of Object.keys(BUTTON_DEFAULTS)) {
      if (draft.fields[key] !== baseline.fields[key])
        profile.buttons = {
          ...profile.buttons,
          [key]: draft.fields[key] === true,
        };
    }
    if (changed(draft.jobs, baseline.jobs)) profile.customJobs = jobs;
    if (changed(draft.actions, baseline.actions)) profile.mrActions = actions;
    if (
      changed(draft.order, baseline.order) ||
      changed(draft.jobs, baseline.jobs) ||
      changed(draft.actions, baseline.actions)
    )
      profile.buttonOrder = order;
    if (
      draft.fields.versionFile !== baseline.fields.versionFile ||
      draft.fields.versionFilePreset !== baseline.fields.versionFilePreset
    )
      profile.versionFile = file;
    for (const key of profileFields) {
      if (key !== "versionFile" && draft.fields[key] !== baseline.fields[key])
        profile[key] = text(key);
    }
    if (changed(draft.branches, baseline.branches)) {
      const branches = normalizeCherryPickBranches(draft.branches);
      if (branches.length) profile.cherry_pick_branches = branches;
      else delete profile.cherry_pick_branches;
    }
    const effective = serializeDraft(draft, data, "default", t);
    const overrides: Record<string, unknown> = {};
    for (const key of draft.overrides || []) {
      if (isProjectSettingKey(key) && Object.hasOwn(effective, key)) {
        // Opening or editing another setting must not rewrite imported values.
        // Compare editable content, excluding transient row identities.
        overrides[key] =
          Object.hasOwn(previous.overrides || {}, key) &&
          !changed(
            projectDraftValue(draft, key),
            projectDraftValue(baseline, key),
          )
            ? previous.overrides?.[key]
            : key === "commits_jira_field"
              ? text(key)
              : effective[key];
      }
    }
    if (Object.keys(overrides).length) profile.overrides = overrides;
    else delete profile.overrides;
    createSettingsValidation(t).parseSettingsFile(
      JSON.stringify({
        format: "gitlab-mr-actions-settings",
        formatVersion: 1,
        settings: {
          ...DEFAULTS,
          projectProfiles: { ...data.projectProfiles, [scope]: profile },
        },
      }),
    );
    return { projectProfiles: { ...data.projectProfiles, [scope]: profile } };
  }
  const result: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof fallback === "boolean") result[key] = draft.fields[key] === true;
    else if (typeof fallback === "string") result[key] = text(key);
    else if (typeof fallback === "number") result[key] = Number(text(key));
  }
  if (!validDisplayPreferences(result))
    throw new Error(t("displayPreferencesInvalid"));
  for (const prompt of AI_REVIEW_PROMPTS) {
    const value = text(prompt.key) || prompt.value;
    if (
      value.length > AI_REVIEW_PROMPT_MAX_LENGTH ||
      new TextEncoder().encode(JSON.stringify(value)).length +
        prompt.key.length >
        8192
    )
      throw new Error(t("aiReviewPromptTooLong"));
    result[prompt.key] = value;
  }
  for (const block of AI_REVIEW_RULES) {
    const key = workflow.INSTRUCTION_PREFIX + block.id;
    try {
      result[key] = workflow.normalizeInstruction(block, {
        enabled: draft.fields[key + "_enabled"] === true,
        text: fieldText(draft, key),
      });
    } catch {
      throw new Error(t("aiReviewPromptTooLong"));
    }
  }
  const filter = { ...data.ai_review_file_filter };
  for (const key of AI_REVIEW_FILTER_FIELDS)
    filter[key] = text("ai_review_filter_" + key);
  try {
    result.ai_review_file_filter = workflow.normalizeFilter(filter);
  } catch {
    throw new Error(t("aiReviewFilterInvalid"));
  }
  const jira = text("jira_url") ? readJiraBaseUrl(text("jira_url")) : undefined;
  if (text("jira_url") && !jira) throw new Error(t("jiraUrlInvalid"));
  Object.assign(result, {
    jira_url: jira?.url || "",
    jiraQuickActions: serializeJiraActions(draft.jiraActions, t),
    quickComments: draft.comments
      .map((c) => ({ label: c.label.trim(), text: c.text.trim() }))
      .filter((c) => c.label && c.text),
    cherry_pick_branches: normalizeCherryPickBranches(draft.branches),
    customJobs: jobs,
    mrActions: actions,
    buttonOrder: order,
    versionFile: file || VERSION_DEFAULTS.versionFile,
    versionPath: text("versionPath") || VERSION_DEFAULTS.versionPath,
    versionStrategy:
      text("versionStrategy") || VERSION_DEFAULTS.versionStrategy,
    versionCommitTemplate:
      text("versionCommitTemplate") || VERSION_DEFAULTS.versionCommitTemplate,
    commits_jira_field:
      text("commits_jira_field") || DEFAULTS.commits_jira_field,
    ai_review_response_language: workflow.normalizeResponseLanguage(
      text("ai_review_response_language"),
    ),
    language: text("language") || "auto",
  });
  // This preference belongs to the review dialog, not this form.
  result.ai_review_fresh_existing = data.ai_review_fresh_existing;
  return result;
}
export function resetDraftField(
  draft: SettingsDraft,
  id: string,
): SettingsDraft {
  const prompt = AI_REVIEW_PROMPTS.find((p) => p.reset === id);
  if (prompt)
    return {
      ...draft,
      fields: { ...draft.fields, [prompt.key]: prompt.value },
    };
  const block = AI_REVIEW_RULES.find(
    (b) => workflow.INSTRUCTION_PREFIX + b.id + "_reset" === id,
  );
  if (!block) return draft;
  const key = workflow.INSTRUCTION_PREFIX + block.id;
  return {
    ...draft,
    fields: { ...draft.fields, [key]: block.text, [key + "_enabled"]: true },
  };
}

export function projectFieldKey(field: string): string {
  if (field.startsWith("ai_review_filter_")) return "ai_review_file_filter";
  if (
    field.startsWith(workflow.INSTRUCTION_PREFIX) &&
    field.endsWith("_enabled")
  )
    return field.slice(0, -"_enabled".length);
  return field;
}
/** Editable content, without transient identities used to retain input focus. */
export function projectDraftValue(draft: SettingsDraft, key: string): unknown {
  if (key === "quickComments") return draft.comments;
  if (key === "jiraQuickActions")
    return draft.jiraActions.map((action) => ({
      label: action.label,
      fields: action.fields.map((field) => ({
        field: field.field,
        custom: field.custom,
        operation: field.operation,
        value: field.value,
      })),
    }));
  return Object.fromEntries(
    Object.entries(draft.fields).filter(
      ([field]) => projectFieldKey(field) === key,
    ),
  );
}
/** Editing an inherited value creates only that override; resets pass their own key list. */
export function markProjectChanges(
  previous: SettingsDraft,
  next: SettingsDraft,
): SettingsDraft {
  if (!previous.inherited || previous.overrides !== next.overrides) return next;
  const keys = new Set(previous.overrides);
  const legacyKeys = new Set(previous.legacyKeys);
  for (const key of Object.keys(next.fields))
    if (
      next.fields[key] !== previous.fields[key] &&
      (Object.hasOwn(BUTTON_DEFAULTS, key) ||
        LEGACY_PROJECT_FIELDS.some((field) => field === key))
    )
      legacyKeys.add(key);
  if (next.fields.versionFilePreset !== previous.fields.versionFilePreset)
    legacyKeys.add("versionFile");
  for (const [draftKey, profileKey] of [
    ["jobs", "customJobs"],
    ["actions", "mrActions"],
    ["order", "buttonOrder"],
  ] as const)
    if (JSON.stringify(previous[draftKey]) !== JSON.stringify(next[draftKey]))
      legacyKeys.add(profileKey);
  for (const key of Object.keys(next.fields))
    if (
      next.fields[key] !== previous.fields[key] &&
      isProjectSettingKey(projectFieldKey(key))
    )
      keys.add(projectFieldKey(key));
  if (JSON.stringify(previous.comments) !== JSON.stringify(next.comments))
    keys.add("quickComments");
  if (
    JSON.stringify(projectDraftValue(previous, "jiraQuickActions")) !==
    JSON.stringify(projectDraftValue(next, "jiraQuickActions"))
  )
    keys.add("jiraQuickActions");
  return {
    ...next,
    overrides: [...keys],
    legacyKeys: [...legacyKeys],
    resetLegacy: (next.resetLegacy || []).filter((key) => !legacyKeys.has(key)),
  };
}
export function inheritProjectSetting(
  draft: SettingsDraft,
  key: string,
): SettingsDraft {
  const inherited = draft.inherited;
  if (!inherited) return draft;
  const legacy =
    Object.hasOwn(BUTTON_DEFAULTS, key) ||
    LEGACY_PROJECT_FIELDS.some((field) => field === key);
  const fields = { ...draft.fields };
  for (const name of Object.keys(fields))
    if (projectFieldKey(name) === key)
      fields[name] = inherited.fields[name] ?? "";
  if (legacy && profileFields.some((field) => field === key)) fields[key] = "";
  if (key === "versionFile") fields.versionFilePreset = "";
  const next = {
    ...draft,
    fields,
    legacyKeys: (draft.legacyKeys || []).filter((value) => value !== key),
    resetLegacy: legacy
      ? [...new Set([...(draft.resetLegacy || []), key])]
      : draft.resetLegacy || [],
    overrides: (draft.overrides || []).filter((value) => value !== key),
    ...(key === "quickComments"
      ? {
          comments: structuredClone(inherited.comments),
          rowKeys: {
            jobs: draft.rowKeys?.jobs || [],
            branches: draft.rowKeys?.branches || [],
            comments: inherited.comments.map(() => crypto.randomUUID()),
          },
        }
      : {}),
    ...(key === "jiraQuickActions"
      ? { jiraActions: structuredClone(inherited.jiraActions) }
      : {}),
  };
  if (key === "customJobs")
    return {
      ...next,
      jobs: structuredClone(inherited.jobs),
      rowKeys: {
        jobs: inherited.jobs.map(() => crypto.randomUUID()),
        comments: draft.rowKeys?.comments || [],
        branches: draft.rowKeys?.branches || [],
      },
    };
  if (key === "mrActions")
    return { ...next, actions: structuredClone(inherited.actions) };
  if (key === "buttonOrder") return { ...next, order: [...inherited.order] };
  return next;
}
