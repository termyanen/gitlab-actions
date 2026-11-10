"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { bundleForTest } = require("./helpers/runtime.cjs");
const messages = require("../_locales/en/messages.json");

// Exercise the same typed model used by React, without recreating DOM widgets or
// exporting production test hooks. Browser tests cover rendering and events.
const context = vm.createContext({
  TextEncoder,
  URL,
  structuredClone,
  crypto: require("node:crypto").webcrypto,
});
vm.runInContext(
  bundleForTest("src/features/manage-settings/index.ts", {
    globalName: "Config",
  }),
  context,
);
vm.runInContext(
  bundleForTest("src/entities/review/index.ts", { globalName: "Review" }),
  context,
);
vm.runInContext(
  bundleForTest("src/pages/settings/model/draft.ts", { globalName: "Draft" }),
  context,
);
const { Config, Review, Draft } = context;
const t = (key) => messages[key]?.message || key;
const plain = (value) => JSON.parse(JSON.stringify(value));
function model(saved = {}, scope = "default") {
  const data = {
    ...structuredClone(Config.DEFAULTS),
    ...structuredClone(saved),
  };
  let draft = Draft.createDraft(data, scope);
  return {
    data,
    get draft() {
      return draft;
    },
    set(key, value) {
      draft = { ...draft, fields: { ...draft.fields, [key]: value } };
    },
    change(values) {
      draft = { ...draft, ...values };
    },
    reset(id) {
      draft = Draft.resetDraftField(draft, id);
    },
    save() {
      return plain(Draft.serializeDraft(draft, data, scope, t));
    },
  };
}
const exportedPrompts = {
  ai_review_prompt: Review.DEFAULT_PROMPT,
  ai_review_fresh_prompt: Review.DEFAULT_FRESH_REVIEW_PROMPT,
  ai_review_import_prompt: Review.DEFAULT_REVIEW_PROMPT,
  ai_review_reply_prompt: Review.DEFAULT_REPLY_PROMPT,
  ai_review_repeat_prompt: Review.DEFAULT_REPEAT_PROMPT,
};

for (const prompt of Config.AI_REVIEW_PROMPTS) {
  test(
    prompt.key +
      " defaults match review operations and blank text restores the shared prompt",
    () => {
      const env = model();
      assert.equal(env.draft.fields[prompt.key], exportedPrompts[prompt.key]);
      assert.ok(
        exportedPrompts[prompt.key].length <=
          Config.AI_REVIEW_PROMPT_MAX_LENGTH,
      );
      env.set(prompt.key, " \n ");
      assert.equal(env.save()[prompt.key], exportedPrompts[prompt.key]);
    },
  );
  test(
    prompt.key +
      " saves independently, reloads and resets without changing other prompts",
    () => {
      const saved = Object.fromEntries(
        Config.AI_REVIEW_PROMPTS.map((item) => [
          item.key,
          "Custom " + item.key,
        ]),
      );
      const env = model(saved);
      env.set(prompt.key, "Answer in German; focus on concrete changes.");
      const written = env.save();
      assert.equal(
        written[prompt.key],
        "Answer in German; focus on concrete changes.",
      );
      for (const key of Object.keys(saved).filter((key) => key !== prompt.key))
        assert.equal(written[key], saved[key]);
      const reloaded = model(written);
      assert.equal(reloaded.draft.fields[prompt.key], written[prompt.key]);
      reloaded.reset(prompt.reset);
      assert.equal(
        reloaded.draft.fields[prompt.key],
        exportedPrompts[prompt.key],
      );
      const reset = reloaded.save();
      for (const key of Object.keys(saved).filter((key) => key !== prompt.key))
        assert.equal(reset[key], saved[key]);
    },
  );
  test(
    prompt.key +
      " accepts Unicode and rejects oversized character/serialized-byte drafts atomically",
    () => {
      const env = model();
      env.set(prompt.key, "界".repeat(1500));
      assert.equal(env.save()[prompt.key], "界".repeat(1500));
      for (const invalid of ["x".repeat(1501), "\u0001".repeat(1500)]) {
        env.set(prompt.key, invalid);
        env.set("show_ai_review_copy", false);
        const before = plain(env.draft);
        assert.throws(
          () => env.save(),
          (error) => error.message === t("aiReviewPromptTooLong"),
        );
        assert.deepEqual(
          plain(env.draft),
          before,
          "validation must leave every draft field editable",
        );
      }
    },
  );
}

test("AI copy enabled setting and review close confirmation keep their defaults and round-trip", () => {
  const env = model();
  assert.equal(env.draft.fields.show_ai_review_copy, true);
  assert.equal(env.draft.fields.ai_review_confirm_close, false);
  assert.equal(env.draft.fields.ai_review_expand_comments, false);
  env.set("show_ai_review_copy", false);
  env.set("ai_review_confirm_close", true);
  env.set("ai_review_expand_comments", true);
  const restored = model(env.save());
  assert.equal(restored.draft.fields.show_ai_review_copy, false);
  assert.equal(restored.draft.fields.ai_review_confirm_close, true);
  assert.equal(restored.draft.fields.ai_review_expand_comments, true);
  restored.set("ai_review_confirm_close", false);
  assert.equal(restored.save().ai_review_confirm_close, false);
});

test("all file filters reload with the repeat prompt and reject invalid aggregate storage bytes", () => {
  const env = model();
  env.set("ai_review_repeat_prompt", "Recheck fixes in English.");
  for (const [key, value] of Object.entries({
    includeExtensions: "ts, js",
    includeFiles: "src/*",
    ignoreFiles: "*.generated.ts",
    ignoreDirs: "dist",
  }))
    env.set("ai_review_filter_" + key, value);
  const restored = model(env.save());
  assert.equal(
    restored.draft.fields.ai_review_repeat_prompt,
    "Recheck fixes in English.",
  );
  assert.equal(
    restored.draft.fields.ai_review_filter_includeExtensions,
    "ts, js",
  );
  assert.equal(restored.draft.fields.ai_review_filter_includeFiles, "src/*");
  assert.equal(
    restored.draft.fields.ai_review_filter_ignoreFiles,
    "*.generated.ts",
  );
  assert.equal(restored.draft.fields.ai_review_filter_ignoreDirs, "dist");
  restored.reset("resetAiReviewRepeatPrompt");
  assert.equal(restored.save().ai_review_file_filter.ignoreDirs, "dist");
  restored.set("ai_review_filter_ignoreFiles", "x".repeat(1501));
  assert.throws(
    () => restored.save(),
    (error) => error.message === t("aiReviewFilterInvalid"),
  );
  restored.set("ai_review_filter_ignoreFiles", "界".repeat(1500));
  restored.set("ai_review_filter_includeFiles", "界".repeat(1500));
  assert.throws(
    () => restored.save(),
    (error) => error.message === t("aiReviewFilterInvalid"),
  );
  assert.equal(
    restored.draft.fields.ai_review_filter_includeFiles.length,
    1500,
  );
  restored.set("ai_review_filter_ignoreFiles", "");
  assert.equal(
    restored.save().ai_review_file_filter.includeFiles,
    "界".repeat(1500),
  );
});

test("AI response language is independent from interface language and invalid saved language falls back", () => {
  const env = model({ language: "de", ai_review_response_language: "ru" });
  assert.equal(env.draft.fields.ai_review_response_language, "ru");
  env.set("ai_review_response_language", "ja");
  const result = env.save();
  assert.equal(result.language, "de");
  assert.equal(result.ai_review_response_language, "ja");
  assert.equal(model(result).draft.fields.ai_review_response_language, "ja");
  assert.equal(
    model({ ai_review_response_language: "invalid" }).draft.fields
      .ai_review_response_language,
    "auto",
  );
});

test("automatic instructions default enabled, allow blank/disabled text, round-trip and reset individually", () => {
  const env = model();
  for (const block of Config.AI_REVIEW_RULES) {
    assert.equal(
      env.draft.fields["ai_review_rule_" + block.id + "_enabled"],
      true,
    );
    assert.equal(
      env.draft.fields["ai_review_rule_" + block.id],
      block.text.trim(),
    );
  }
  env.set("ai_review_rule_repository", "Use my prepared checkout.");
  env.set("ai_review_rule_review_checkout_enabled", false);
  env.set("ai_review_rule_review_checkout", "Keep this disabled text.");
  env.set("ai_review_rule_language", "");
  const result = env.save();
  assert.deepEqual(result.ai_review_rule_review_checkout, {
    enabled: false,
    text: "Keep this disabled text.",
  });
  assert.equal(
    result.ai_review_rule_repository.text,
    "Use my prepared checkout.",
  );
  assert.equal(result.ai_review_rule_language.text, "");
  const restored = model(result);
  assert.equal(
    restored.draft.fields.ai_review_rule_review_checkout_enabled,
    false,
  );
  restored.reset("ai_review_rule_review_checkout_reset");
  assert.equal(
    restored.draft.fields.ai_review_rule_review_checkout_enabled,
    true,
  );
  assert.notEqual(
    restored.draft.fields.ai_review_rule_review_checkout,
    "Keep this disabled text.",
  );
  assert.equal(
    restored.save().ai_review_rule_repository.text,
    "Use my prepared checkout.",
  );
});

test("oversized instruction rejects unrelated settings without changing the draft, then permits correction", () => {
  const env = model();
  env.set("ai_review_rule_repository", "\u0001".repeat(1500));
  env.set("show_ai_review_copy", false);
  assert.throws(
    () => env.save(),
    (error) => error.message === t("aiReviewPromptTooLong"),
  );
  assert.equal(env.draft.fields.ai_review_rule_repository.length, 1500);
  env.set("ai_review_rule_repository", "Valid custom instruction");
  assert.equal(env.save().show_ai_review_copy, false);
});

function jiraActions(env, actions) {
  env.change({
    jiraActions: actions.map((action, i) => ({
      id: "action-" + i,
      label: action.label,
      fields: action.changes.map((change, j) => ({
        id: "field-" + j,
        operation: "set",
        custom: "",
        ...change,
      })),
    })),
  });
}

test("Jira settings save version-only and assignee-only buttons without a status", () => {
  const env = model();
  jiraActions(env, [
    {
      label: "Release",
      changes: [
        { field: "fixVersions", value: " 2.0, 2.1, 2.0 ", operation: "add" },
      ],
    },
    { label: "Assign", changes: [{ field: "assignee", value: " alice " }] },
  ]);
  assert.deepEqual(env.save().jiraQuickActions, [
    {
      label: "Release",
      status: "",
      assignee: "",
      updates: [
        { field: "fixVersions", operation: "add", value: ["2.0", "2.1"] },
      ],
    },
    { label: "Assign", status: "", assignee: "alice", updates: [] },
  ]);
});

test("Jira settings preserve status, assignee, list operations and custom JSON across reload", () => {
  const env = model();
  jiraActions(env, [
    {
      label: "Review",
      changes: [
        { field: "status", value: "Review" },
        { field: "assignee", value: "alice" },
        { field: "labels", value: "old", operation: "remove" },
        {
          field: "custom",
          custom: "customfield_12345",
          value: '{"value":"Option"}',
        },
      ],
    },
  ]);
  const actions = [
    {
      label: "Review",
      status: "Review",
      assignee: "alice",
      updates: [
        { field: "labels", operation: "remove", value: ["old"] },
        {
          field: "customfield_12345",
          operation: "set",
          value: { value: "Option" },
        },
      ],
    },
  ];
  assert.deepEqual(env.save().jiraQuickActions, actions);
  assert.deepEqual(model(env.save()).save().jiraQuickActions, actions);
});

[
  [{ field: "custom", custom: "customfield_12345", value: "{broken" }],
  [{ field: "custom", custom: "bad_id", value: "null" }],
  [
    { field: "labels", value: "a" },
    { field: "labels", value: "b" },
  ],
  [
    { field: "status", value: "Review" },
    { field: "status", value: "Done" },
  ],
  [{ field: "duedate", value: "2026-02-30" }],
  [{ field: "duedate", value: "tomorrow" }],
].forEach((changes, index) => {
  test(
    "invalid Jira action " +
      index +
      " rejects serialization without dropping draft text",
    () => {
      const env = model();
      jiraActions(env, [{ label: "Invalid", changes }]);
      const before = plain(env.draft);
      assert.throws(() => env.save());
      assert.deepEqual(plain(env.draft), before);
    },
  );
});

test("empty Jira changes are omitted while custom zero, false and null values survive round-trip", () => {
  const env = model();
  jiraActions(env, [
    {
      label: "Empty",
      changes: [
        { field: "status", value: " " },
        { field: "labels", value: ", , " },
      ],
    },
    {
      label: "Values",
      changes: [
        { field: "custom", custom: "customfield_1", value: "0" },
        { field: "custom", custom: "customfield_2", value: "false" },
        { field: "custom", custom: "customfield_3", value: "null" },
      ],
    },
  ]);
  const actions = env.save().jiraQuickActions;
  assert.equal(actions.length, 1);
  assert.deepEqual(
    actions[0].updates.map((update) => update.value),
    [0, false, null],
  );
  assert.deepEqual(model(env.save()).save().jiraQuickActions, actions);
});

test("MR actions normalize labels and reject incomplete global and project drafts", () => {
  for (const scope of ["default", "team/repo"]) {
    const env = model({ projectProfiles: { "team/repo": {} } }, scope);
    env.change({
      actions: [
        {
          id: "qa",
          label: " Remove QA ",
          type: "remove_labels",
          labels: " QA ready, bug\nQA ready, тип::ошибка ",
        },
      ],
    });
    const result = env.save();
    const settings =
      scope === "default" ? result : result.projectProfiles[scope];
    assert.deepEqual(settings.mrActions, [
      {
        id: "qa",
        label: "Remove QA",
        type: "remove_labels",
        labels: "QA ready, bug, тип::ошибка",
      },
    ]);
    env.change({
      actions: [
        {
          id: "qa",
          label: "Remove QA",
          type: "remove_labels",
          labels: " , \n",
        },
      ],
    });
    const before = plain(env.draft);
    assert.throws(
      () => env.save(),
      (error) => error.message === t("mrActionInvalid"),
    );
    assert.deepEqual(plain(env.draft), before);
    env.change({
      actions: [{ id: "bad", label: "", type: "clear_labels", labels: "" }],
    });
    assert.throws(() => env.save());
  }
});

test("toolbar order retains job and action identity, drops deleted actions and remaps incomplete job rows", () => {
  const env = model();
  env.change({
    order: [
      "mr_action_second",
      "custom_1",
      "btn_ship",
      "mr_action_removed",
      "mr_action_first",
    ],
    jobs: [
      { label: "Draft", jobName: "" },
      { label: "Deploy", jobName: "deploy" },
    ],
    actions: [
      { id: "first", label: "First", type: "clear_labels", labels: "" },
      { id: "second", label: "Second", type: "clear_reviewers", labels: "" },
    ],
  });
  assert.deepEqual(Array.from(Draft.orderedKeys(env.draft).slice(0, 4)), [
    "mr_action_second",
    "custom_1",
    "btn_ship",
    "mr_action_first",
  ]);
  const result = env.save();
  assert.deepEqual(result.customJobs, [{ label: "Deploy", jobName: "deploy" }]);
  assert.deepEqual(result.buttonOrder.slice(0, 4), [
    "mr_action_second",
    "custom_0",
    "btn_ship",
    "mr_action_first",
  ]);
});

test("quick comments, cherry-pick branches, display preferences and reviewer/version fields preserve contracts", () => {
  const env = model();
  env.change({
    comments: [
      { label: " LGTM ", text: " Looks good " },
      { label: "Incomplete", text: "" },
    ],
    branches: [" release/test ", "  "],
  });
  env.set("failed_jobs_limit", "12");
  env.set("reviewersList", " alice, bob ");
  env.set("versionFilePreset", "custom");
  env.set("versionFile", " VERSION ");
  const result = env.save();
  assert.deepEqual(result.quickComments, [
    { label: "LGTM", text: "Looks good" },
  ]);
  assert.deepEqual(result.cherry_pick_branches, ["release/test"]);
  assert.equal(result.failed_jobs_limit, 12);
  assert.equal(result.reviewersList, "alice, bob");
  assert.equal(result.versionFile, "VERSION");
  assert.equal(model(result).draft.fields.versionFile, "VERSION");
  env.set("failed_jobs_limit", "0");
  assert.throws(
    () => env.save(),
    (error) => error.message === t("displayPreferencesInvalid"),
  );
});

test("blank project overrides keep inheritance and do not replace global settings or other profiles", () => {
  const env = model(
    {
      versionFile: "pyproject.toml",
      versionStrategy: "major",
      projectProfiles: {
        "team/repo": {},
        "other/repo": { versionStrategy: "minor" },
      },
    },
    "team/repo",
  );
  assert.equal(env.draft.fields.versionFilePreset, "");
  assert.equal(env.draft.fields.versionStrategy, "");
  const result = env.save();
  assert.deepEqual(Object.keys(result), ["projectProfiles"]);
  assert.equal(result.projectProfiles["team/repo"].versionFile, undefined);
  assert.equal(result.projectProfiles["team/repo"].versionStrategy, undefined);
  assert.equal(result.projectProfiles["other/repo"].versionStrategy, "minor");
});

test("project cherry-pick branches stay independent and empty lists restore inheritance", () => {
  const saved = {
    cherry_pick_branches: ["global/release"],
    projectProfiles: { "team/repo": {}, "other/repo": { cherry_pick_branches: ["other/release"] } },
  };
  const inherited = model(saved, "team/repo");
  assert.deepEqual(plain(inherited.draft.branches), []);
  assert.equal(inherited.save().projectProfiles["team/repo"].cherry_pick_branches, undefined);
  inherited.change({branches: [" release/project ", "", "release/project", "release/second"]});
  const patch = inherited.save();
  assert.deepEqual(patch.projectProfiles["team/repo"].cherry_pick_branches, ["release/project", "release/second"]);
  assert.deepEqual(patch.projectProfiles["other/repo"], saved.projectProfiles["other/repo"]);
  assert.equal(patch.cherry_pick_branches, undefined);
  const restored = model({...saved, ...patch}, "team/repo");
  assert.deepEqual(plain(restored.draft.branches), ["release/project", "release/second"]);
  restored.change({branches: ["   "]});
  assert.equal(restored.save().projectProfiles["team/repo"].cherry_pick_branches, undefined);
  assert.deepEqual(model(saved).save().cherry_pick_branches, ["global/release"]);
});
