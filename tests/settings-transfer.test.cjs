"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { bundleForTest } = require("./helpers/runtime.cjs");
const {
  settingsController,
  plain,
  t,
  settle,
} = require("./helpers/settings-controller.cjs");
const messages = require("../_locales/en/messages.json");
const context = vm.createContext({ TextEncoder, URL });
vm.runInContext(
  bundleForTest("src/features/manage-settings/index.ts", {
    globalName: "Config",
  }),
  context,
);
const { DEFAULTS, createSettingsValidation } = context.Config;
const { settingsSnapshot, parseSettingsFile } = createSettingsValidation(t);
const file = (settings) =>
  JSON.stringify({
    format: "gitlab-mr-actions-settings",
    formatVersion: 1,
    settings,
  });

function sharedConfig() {
  return {
    language: "ru",
    show_ai_review_copy: false,
    ai_review_response_language: "de",
    ai_review_fresh_existing: true,
    ai_review_prompt: "Team review prompt",
    ai_review_rule_repository: {
      enabled: false,
      text: "Team repository rules",
    },
    jira_url: "https://jira.example.com/jira",
    jira_ticket_regex: "TEAM-\\d+",
    jiraQuickActions: [
      {
        label: "Update",
        status: "",
        assignee: "alice",
        updates: [
          { field: "fixVersions", operation: "add", value: ["1.2"] },
          {
            field: "customfield_123",
            operation: "set",
            value: { id: "42", enabled: true },
          },
        ],
      },
    ],
    customJobs: [{ label: "Deploy", jobName: "build, deploy" }],
    quickComments: [{ label: "LGTM", text: "Looks good!" }],
    buttonOrder: ["btn_ship", "custom_0"],
    cherry_pick_branches: ["release/1.2"],
    projectProfiles: {
      "team/project": {
        buttons: { btn_ship: true },
        buttonOrder: ["btn_ship"],
        customJobs: [{ label: "Ship", jobName: "deploy" }],
        cherry_pick_branches: ["project/release"],
        versionFile: "version.txt",
        versionStrategy: "minor",
      },
    },
    update_version: "do not import",
    unknown_future_setting: true,
  };
}

test("settings round trip includes every current setting and nested profile, without runtime metadata", () => {
  const snapshot = settingsSnapshot(sharedConfig());
  const imported = parseSettingsFile(file(snapshot));
  assert.deepEqual(plain(imported), plain(snapshot));
  assert.equal(Object.keys(imported).length, Object.keys(DEFAULTS).length);
  assert.equal(imported.update_version, undefined);
  assert.equal(imported.unknown_future_setting, undefined);
  assert.equal(imported.ai_review_rule_repository.enabled, false);
  assert.equal(imported.ai_review_fresh_existing, true);
});

test("missing configuration fields use extension defaults, replacing profiles but preserving runtime metadata", async () => {
  const env = await settingsController({
    update_version: "1.13.1",
    projectProfiles: { "old/project": {} },
    sound_enabled: true,
    ai_review_fresh_existing: true,
  });
  await env.import({ language: "en", sound_enabled: false });
  assert.deepEqual(env.stored.projectProfiles, {});
  assert.equal(env.stored.sound_enabled, false);
  assert.equal(env.stored.ai_review_fresh_existing, false);
  assert.equal(env.stored.update_version, "1.13.1");
  assert.equal(env.writes.length, 1);
  assert.equal(env.snapshot().status.key, "settingsImported");
  env.controller.dispose();
});

test("file format, supported version and nested types are validated before importing", () => {
  [
    "broken JSON",
    "{}",
    '{"format":"gitlab-mr-actions-settings","formatVersion":2,"settings":{"language":"en"}}',
    file({}),
    file({ sound_enabled: "true" }),
    file({ customJobs: [{ label: 42 }] }),
    file({ buttonOrder: [{}] }),
    file({ quickComments: [{ text: false }] }),
    file({
      projectProfiles: { "team/project": { buttons: { btn_ship: "true" } } },
    }),
    file({
      jiraQuickActions: [
        { updates: [{ field: "fixVersions", operation: "set", value: "1.2" }] },
      ],
    }),
    file({ jiraQuickActions: [{ updates: [null] }] }),
    file({ language: "unsupported" }),
    file({ jira_ticket_regex: "[" }),
    file({ jira_url: "javascript:alert(1)" }),
    file({ jira_url: "https://user:password@jira.example.com" }),
  ].forEach((text) =>
    assert.throws(() => parseSettingsFile(text), undefined, text),
  );
});

test("prototype keys in project maps and nested profiles cannot enter configuration", () => {
  for (const key of ["__proto__", "constructor", "prototype"])
    assert.throws(() =>
      parseSettingsFile(
        '{"format":"gitlab-mr-actions-settings","formatVersion":1,"settings":{"projectProfiles":{"' +
          key +
          '":{}}}}',
      ),
    );
  assert.throws(() =>
    parseSettingsFile(
      '{"format":"gitlab-mr-actions-settings","formatVersion":1,"settings":{"projectProfiles":{"team/project":{"__proto__":{}}}}}',
    ),
  );
});

test("Jira imports require an explicit HTTPS installation without wildcard or malformed hosts", () => {
  for (const url of [
    "jira.example.com",
    "https:jira.example.com",
    "https://jira.example.com\\other",
    "https://jira.example.com?",
    "https://jira.example.com#",
    "https://*.example.com",
    "https://%2A.example.com",
    "https://*",
  ])
    assert.throws(
      () => parseSettingsFile(file({ jira_url: url })),
      undefined,
      url,
    );
  assert.equal(
    parseSettingsFile(file({ jira_url: "https://jira.example.com/jira" }))
      .jira_url,
    "https://jira.example.com/jira",
  );
});

test("per-item byte limits and prompt/rule character limits reject oversized imports", () => {
  for (const settings of [
    { ai_review_prompt: "a".repeat(1501) },
    { ai_review_rule_repository: { enabled: true, text: "a".repeat(1501) } },
    { projectProfiles: { "team/project": { versionFile: "界".repeat(3000) } } },
  ])
    assert.throws(() => parseSettingsFile(file(settings)));
  assert.throws(() => parseSettingsFile(" ".repeat(1024 * 1024 + 1)));
});

test("import requests Jira access synchronously before replacing configuration and selecting imported language", async () => {
  const env = await settingsController();
  await env.controller.readImport(
    new File([file(sharedConfig())], "settings.json"),
  );
  env.controller.applyImport();
  assert.deepEqual(env.requests, [{ origins: ["https://jira.example.com/*"] }]);
  await settle();
  assert.equal(env.stored.language, "ru");
  assert.equal(env.snapshot().data.language, "ru");
  assert.equal(env.snapshot().scope, "default");
  assert.equal(env.snapshot().preview, null);
  assert.equal(env.snapshot().busy, false);
  env.controller.dispose();
});

test("denied Jira access leaves storage and draft intact with the preview available for retry", async () => {
  const env = await settingsController();
  env.granted = false;
  env.update({ reviewersJob: "unsaved-draft" });
  await env.import(sharedConfig());
  assert.equal(env.writes.length, 0);
  assert.equal(env.snapshot().draft.fields.reviewersJob, "unsaved-draft");
  assert.ok(env.snapshot().preview);
  assert.equal(env.snapshot().status.kind, "failed");
  assert.equal(env.snapshot().busy, false);
  env.granted = true;
  env.controller.applyImport();
  await settle();
  assert.equal(env.stored.language, "ru");
  env.controller.dispose();
});

test("storage read/write failures preserve the import preview and current draft without reporting success", async () => {
  for (const readError of [true, false]) {
    const env = await settingsController();
    env.readError = readError;
    env.writeError = !readError;
    env.update({ reviewersJob: "unsaved-draft" });
    await env.import({ language: "en", reviewersJob: "imported" });
    assert.equal(env.snapshot().draft.fields.reviewersJob, "unsaved-draft");
    assert.equal(env.stored.reviewersJob, undefined);
    assert.equal(env.snapshot().status.kind, "failed");
    assert.ok(env.snapshot().preview);
    assert.equal(env.snapshot().busy, false);
    env.controller.dispose();
  }
});

test("cancelled or superseded import reads cannot replace the current preview or report a stale error", async () => {
  for (const superseded of [false, true]) {
    const env = await settingsController();
    let rejectRead;
    const pending = env.controller.readImport({
      name: "old.json",
      size: 10,
      text: () =>
        new Promise((resolve, reject) => {
          rejectRead = reject;
        }),
    });
    if (superseded) {
      await env.controller.readImport(
        new File([file({ language: "ru" })], "new.json"),
      );
      assert.equal(env.snapshot().preview.name, "new.json");
    } else env.controller.cancelImport();
    const current = plain(env.snapshot());
    rejectRead(new Error("Stale file read failed"));
    await pending;
    assert.deepEqual(plain(env.snapshot()), current);
    assert.equal(env.writes.length, 0);
    env.controller.dispose();
  }
});

test("total sync quota includes existing metadata and rejects import without writing", async () => {
  const env = await settingsController({
    runtime_metadata: "x".repeat(102400),
  });
  await env.import({ language: "en" });
  assert.equal(env.writes.length, 0);
  assert.equal(
    env.snapshot().status.message || t(env.snapshot().status.key),
    messages.settingsFileTooLarge.message,
  );
  env.controller.dispose();
});

test("export waits for the current form save and downloads complete stored configuration only", async () => {
  const env = await settingsController(sharedConfig());
  env.delayWrites = true;
  env.update({ reviewersJob: "latest-job" });
  const exported = env.controller.exportSettings();
  await settle();
  assert.equal(env.downloads.length, 0);
  assert.equal(env.snapshot().busy, true);
  assert.equal(env.pendingWrites.length, 1);
  await env.replyWrite();
  await exported;
  assert.equal(env.downloads[0].download, "gitlab-mr-actions-settings.json");
  const data = JSON.parse(await env.downloads[0].blob.text());
  assert.equal(data.format, "gitlab-mr-actions-settings");
  assert.equal(data.settings.language, "ru");
  assert.equal(data.settings.reviewersJob, "latest-job");
  assert.equal(data.settings.update_version, undefined);
  assert.deepEqual(
    data.settings.projectProfiles,
    sharedConfig().projectProfiles,
  );
  assert.equal(env.snapshot().busy, false);
  env.controller.dispose();
  assert.deepEqual(env.revokedDownloads, [env.downloads[0].href]);
  assert.equal(env.timers.size, 0);
});

test("failed export validation, writes and reads unlock controls without downloading stale settings", async () => {
  for (const failure of ["validation", "write", "read"]) {
    const env = await settingsController();
    if (failure === "validation")
      env.update({ ai_review_prompt: "x".repeat(1501) });
    if (failure === "write") {
      env.update({ reviewersJob: "changed" });
      env.writeError = true;
    }
    if (failure === "read") env.readError = true;
    await env.controller.exportSettings();
    assert.equal(env.downloads.length, 0, failure);
    assert.equal(env.snapshot().busy, false, failure);
    assert.equal(env.snapshot().status.kind, "failed", failure);
    env.controller.dispose();
  }
});

test("MR actions round trip globally and per project with stable button identities", () => {
  const actions = [
    {
      id: "remove-qa",
      label: "Remove QA",
      type: "remove_labels",
      labels: "waiting for QA, тип::ошибка",
    },
    { id: "clear", label: "Clear labels", type: "clear_labels", labels: "" },
  ];
  const config = {
    mrActions: actions,
    buttonOrder: ["mr_action_clear", "btn_ship", "mr_action_remove-qa"],
    projectProfiles: {
      "team/repo": { mrActions: [], buttonOrder: [] },
      "other/repo": { mrActions: actions },
    },
  };
  const imported = parseSettingsFile(file(settingsSnapshot(config)));
  assert.deepEqual(plain(imported.mrActions), actions);
  assert.deepEqual(plain(imported.buttonOrder), config.buttonOrder);
  assert.deepEqual(plain(imported.projectProfiles), config.projectProfiles);
});

test("invalid or ambiguous MR actions are rejected globally and in profiles", () => {
  const valid = { id: "a", label: "Clear", type: "clear_labels", labels: "" };
  for (const action of [
    null,
    {},
    { id: "a", label: " ", type: "clear_labels", labels: "" },
    { id: "a", label: "Bad", type: "unknown", labels: "" },
    { id: "a", label: "Bad", type: "remove_labels", labels: ", \n" },
    { id: "<bad>", label: "Bad", type: "clear_labels", labels: "" },
    { id: "a", label: "Bad", type: "add_labels", labels: [] },
    valid,
  ]) {
    const actions = action === valid ? [valid, valid] : [action];
    assert.throws(() => parseSettingsFile(file({ mrActions: actions })));
    assert.throws(() =>
      parseSettingsFile(
        file({ projectProfiles: { "team/repo": { mrActions: actions } } }),
      ),
    );
  }
});

test("display policies round-trip and old exports receive current defaults", () => {
  const preferences = {
    failed_jobs_limit: 12,
    failed_job_trace_lines: 150,
    reviewer_notes_limit: 80,
    mr_size_lines: "20, 80, 250",
    mr_size_files: "2, 4, 8",
    sensitive_file_defaults: false,
    sensitive_file_patterns: "private/*\n*.token",
    sensitive_file_exclusions: "*.example",
  };
  const restored = parseSettingsFile(file(settingsSnapshot(preferences)));
  for (const key of Object.keys(preferences))
    assert.equal(restored[key], preferences[key], key);
  const legacy = parseSettingsFile(file({ language: "en" }));
  assert.equal(legacy.failed_jobs_limit, 5);
  assert.equal(legacy.sensitive_file_defaults, true);
});

test("invalid display policies cannot enter storage through imports", () => {
  for (const invalid of [
    { failed_jobs_limit: 0 },
    { failed_job_trace_lines: 501 },
    { reviewer_notes_limit: 1.5 },
    { mr_size_lines: "200, 50, 500" },
    { mr_size_files: "1, 1, 2" },
    { mr_size_files: "1, 2, Infinity" },
    { sensitive_file_defaults: "false" },
    { sensitive_file_exclusions: "x".repeat(1501) },
  ])
    assert.throws(() => parseSettingsFile(file(invalid)));
});

test("all 27 shipped languages survive settings import validation", () => {
  const fs = require("node:fs"),
    path = require("node:path");
  const locales = fs
    .readdirSync(path.join(__dirname, "../_locales"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(locales.length, 27);
  for (const language of locales) {
    const parsed = parseSettingsFile(
      file({ language, ai_review_response_language: language }),
    );
    assert.equal(parsed.language, language);
    assert.equal(parsed.ai_review_response_language, language);
  }
});

test('optional custom-button enabled flags round-trip globally and in profiles', () => {
 const job={label:'Deploy',jobName:'build, deploy',enabled:false};
 const action={id:'clear',label:'Clear labels',type:'clear_labels',labels:'',enabled:false};
 const snapshot=settingsSnapshot({customJobs:[job],mrActions:[action],projectProfiles:{'team/project':{customJobs:[{...job,enabled:true}],mrActions:[{...action,enabled:true}]}}});
 assert.deepEqual(plain(parseSettingsFile(file(snapshot))),plain(snapshot));
 const legacy=parseSettingsFile(file({customJobs:[{label:'Old job',jobName:'deploy'}],mrActions:[{id:'old',label:'Old action',type:'clear_labels',labels:''}]}));
 assert.equal(legacy.customJobs[0].enabled,undefined);
 assert.equal(legacy.mrActions[0].enabled,undefined);
 for(const enabled of ['false',0,null,{},[]]){
  for(const value of [{customJobs:[{...job,enabled}]},{mrActions:[{...action,enabled}]},{projectProfiles:{'team/project':{customJobs:[{...job,enabled}]}}},{projectProfiles:{'team/project':{mrActions:[{...action,enabled}]}}}])
   assert.throws(()=>parseSettingsFile(file(value)));
 }
});


test("import rejects malformed project cherry-pick branches and preserves legacy inheritance", () => {
  for (const invalid of ["release", [1], [null], [{}], null]) {
    assert.throws(() => parseSettingsFile(file({projectProfiles: {"team/repo": {cherry_pick_branches: invalid}}})), /Invalid|invalid/i);
  }
  for (const profile of [{}, {cherry_pick_branches: []}, {cherry_pick_branches: ["release/1"]}]) {
    const imported = parseSettingsFile(file({projectProfiles: {"team/repo": profile}}));
    assert.deepEqual(plain(imported.projectProfiles["team/repo"]), profile);
  }
});
