"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  settingsController,
  plain,
  settle,
} = require("./helpers/settings-controller.cjs");

test("autosave debounces edits and does not report success before the storage callback", async () => {
  const env = await settingsController();
  env.delayWrites = true;
  env.update({ reviewersJob: "first" });
  env.update({ reviewersJob: "latest" });
  assert.equal(env.timers.size, 1);
  assert.equal(env.writes.length, 0);
  await env.runNext();
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].reviewersJob, "latest");
  assert.equal(env.snapshot().dirty, true);
  assert.equal(env.snapshot().status.kind, "unsaved");
  await env.replyWrite();
  assert.equal(env.snapshot().dirty, false);
  assert.equal(env.snapshot().status.kind, "saved");
  env.controller.dispose();
});

test("failed autosave retains its draft and a later save can retry successfully", async () => {
  const env = await settingsController();
  env.writeError = true;
  env.update({ reviewersJob: "keep this draft" });
  await env.runNext();
  assert.equal(env.snapshot().status.kind, "failed");
  assert.equal(env.snapshot().dirty, true);
  assert.equal(env.snapshot().draft.fields.reviewersJob, "keep this draft");
  env.writeError = false;
  assert.equal(await env.controller.save(), true);
  assert.equal(env.stored.reviewersJob, "keep this draft");
  assert.equal(env.snapshot().status.kind, "saved");
  env.controller.dispose();
});

test("scope navigation waits for current edits and preserves the old scope after a failed write", async () => {
  const env = await settingsController({
    projectProfiles: {
      "team/app": {
        buttons: {},
        buttonOrder: [],
        reviewersJob: "project-job",
        customJobs: [],
      },
    },
  });
  env.delayWrites = true;
  env.update({ reviewersJob: "before navigation" });
  const failedNavigation = env.controller.navigate({ scope: "team/app" });
  await settle();
  assert.equal(env.snapshot().scope, "default");
  assert.equal(env.snapshot().busy, true);
  await env.replyWrite("quota exceeded");
  assert.equal(await failedNavigation, false);
  assert.equal(env.snapshot().scope, "default");
  assert.equal(env.snapshot().busy, false);
  assert.equal(env.snapshot().draft.fields.reviewersJob, "before navigation");
  const successfulNavigation = env.controller.navigate({ scope: "team/app" });
  await settle();
  await env.replyWrite();
  assert.equal(await successfulNavigation, true);
  assert.equal(env.snapshot().scope, "team/app");
  assert.equal(env.stored.reviewersJob, "before navigation");
  env.controller.dispose();
});

test("a completed older write cannot mark newer edits saved or overwrite their draft", async () => {
  const env = await settingsController();
  env.delayWrites = true;
  env.update({ reviewersJob: "older" });
  const older = env.controller.save();
  await settle();
  env.update({ reviewersJob: "newer" });
  const newer = env.controller.save();
  await settle();
  assert.equal(env.pendingWrites.length, 1, "writes are serialized");
  await env.replyWrite();
  assert.equal(await older, true);
  assert.equal(env.snapshot().dirty, true);
  assert.equal(env.snapshot().status.kind, "unsaved");
  assert.equal(env.snapshot().draft.fields.reviewersJob, "newer");
  await env.replyWrite();
  assert.equal(await newer, true);
  assert.equal(env.stored.reviewersJob, "newer");
  assert.equal(env.snapshot().dirty, false);
  env.controller.dispose();
});

test("invalid edits stay dirty after debounce and block replacing their scope without a write", async () => {
  const env = await settingsController({
    projectProfiles: {
      "team/app": {
        buttons: {},
        buttonOrder: [],
        reviewersJob: "",
        customJobs: [],
      },
    },
  });
  env.update({ ai_review_prompt: "x".repeat(1501) });
  await env.runNext();
  assert.equal(env.snapshot().status.kind, "failed");
  assert.equal(env.snapshot().dirty, true);
  assert.equal(env.timers.size, 0);
  assert.equal(await env.controller.navigate({ scope: "team/app" }), false);
  assert.equal(env.snapshot().scope, "default");
  assert.equal(env.snapshot().draft.fields.ai_review_prompt.length, 1501);
  assert.equal(env.writes.length, 0);
  env.controller.dispose();
});

test("external quick-toggle changes update untouched fields without replacing local edits", async () => {
  const env = await settingsController();
  env.update({ sound_enabled: true, reviewersJob: "local comment" });
  env.emit({
    sound_enabled: { newValue: false },
    notifications_enabled: { newValue: false },
  });
  assert.equal(env.snapshot().draft.fields.sound_enabled, true);
  assert.equal(env.snapshot().draft.fields.reviewersJob, "local comment");
  assert.equal(env.snapshot().draft.fields.notifications_enabled, false);
  assert.equal(env.snapshot().dirty, true);
  env.controller.dispose();
});

test("external quick-toggle change during a pending write survives acknowledgement and scope reload", async () => {
  const env = await settingsController({
    projectProfiles: {
      "team/app": {
        buttons: {},
        buttonOrder: [],
        reviewersJob: "",
        customJobs: [],
      },
    },
  });
  env.delayWrites = true;
  env.update({ reviewersJob: "queued job" });
  const saved = env.controller.save();
  await settle();
  assert.equal(Object.hasOwn(env.writes[0], "sound_enabled"), false);
  env.stored.sound_enabled = true;
  env.emit({ sound_enabled: { newValue: true } });
  assert.equal(env.snapshot().draft.fields.sound_enabled, true);
  await env.replyWrite();
  assert.equal(await saved, true);
  assert.equal(env.snapshot().data.sound_enabled, true);
  assert.equal(await env.controller.navigate({ scope: "team/app" }), true);
  assert.equal(await env.controller.navigate({ scope: "default" }), true);
  assert.equal(env.snapshot().draft.fields.sound_enabled, true);
  assert.equal(env.stored.sound_enabled, true);
  env.controller.dispose();
});

test("disposal cancels autosave, unregisters storage listeners and ignores pending completion", async () => {
  const env = await settingsController();
  let notifications = 0;
  env.controller.subscribe(() => notifications++);
  env.delayWrites = true;
  env.update({ reviewersJob: "pending" });
  const saved = env.controller.save();
  await settle();
  env.update({ reviewersJob: "will not autosave" });
  assert.equal(env.listeners.size, 1);
  const snapshot = plain(env.snapshot());
  const before = notifications;
  env.controller.dispose();
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
  await env.replyWrite();
  assert.equal(await saved, false);
  assert.equal(notifications, before);
  assert.deepEqual(plain(env.snapshot()), snapshot);
});

test("successful import feedback expires after ten seconds without changing imported settings", async () => {
  const env = await settingsController();
  await env.import({ language: "en", reviewersJob: "imported-job" });
  assert.equal(env.snapshot().status.key, "settingsImported");
  assert.equal([...env.timers.values()][0].ms, 10000);
  const saved = plain(env.stored);
  await env.runNext();
  assert.equal(env.snapshot().status.key, "");
  assert.equal(env.snapshot().dirty, false);
  assert.deepEqual(env.stored, saved);
  env.controller.dispose();
});

test("old success timers cannot hide newer feedback, unsaved edits or errors", async () => {
  const env = await settingsController();
  await env.import({ language: "en" });
  const oldTimer = [...env.timers.values()][0];
  env.update({ reviewersJob: "changed" });
  oldTimer.fn();
  assert.equal(env.snapshot().status.kind, "unsaved");
  env.writeError = true;
  await env.runNext();
  oldTimer.fn();
  assert.equal(env.snapshot().status.kind, "failed");
  assert.equal(env.timers.size, 0);
  env.writeError = false;
  await env.controller.save();
  oldTimer.fn();
  assert.equal(env.snapshot().status.kind, "saved");
  assert.equal(env.timers.size, 1);
  env.controller.dispose();
  assert.equal(env.timers.size, 0);
});

test("untouched legacy global values survive saving another field and project switches", async () => {
  const env = await settingsController({
    quickComments: [{ label: "  old label  ", text: " old text " }],
    cherry_pick_branches: [" stable ", "stable"],
    projectProfiles: { "team/a": {}, "team/b": {} },
  });
  const comments = plain(env.stored.quickComments);
  const branches = plain(env.stored.cherry_pick_branches);
  env.update({ show_time_tracker: false });
  assert.equal(await env.controller.navigate({ scope: "team/a" }), true);
  env.update({ show_time_tracker: true });
  assert.equal(await env.controller.navigate({ scope: "team/b" }), true);
  assert.equal(await env.controller.navigate({ scope: "default" }), true);
  assert.deepEqual(env.stored.quickComments, comments);
  assert.deepEqual(env.stored.cherry_pick_branches, branches);
  assert.deepEqual(env.stored.projectProfiles["team/b"], {});
  assert.equal(env.stored.projectProfiles["team/a"].overrides.show_time_tracker, true);
  env.controller.dispose();
});

test("remote profile and global changes refresh inheritance without losing unfinished local fields", async () => {
  const env = await settingsController({
    jira_url: "https://jira.example.com", projectProfiles: { "team/a": {}, "team/b": {} },
  });
  await env.controller.navigate({ scope: "team/a" });
  env.update({ reviewersJob: "unfinished local" });
  env.emit({ jira_url: { newValue: "https://new-jira.example.com" }, projectProfiles: {
    newValue: { "team/a": { overrides: { show_time_tracker: false } }, "team/b": { versionFile: "VERSION" } },
  } });
  assert.equal(env.snapshot().draft.fields.reviewersJob, "unfinished local");
  assert.equal(env.snapshot().draft.fields.jira_url, "https://new-jira.example.com");
  assert.equal(env.snapshot().draft.fields.show_time_tracker, false);
  assert.equal(await env.controller.navigate({ scope: "team/b" }), true);
  assert.equal(env.stored.projectProfiles["team/a"].reviewersJob, "unfinished local");
  assert.equal(env.stored.projectProfiles["team/a"].overrides.show_time_tracker, false);
  assert.equal(env.stored.projectProfiles["team/b"].versionFile, "VERSION");
  assert.equal(env.snapshot().draft.fields.versionFile, "VERSION");
  env.controller.dispose();
});

test("read-merge-write preserves newer profile properties even before onChanged is delivered", async () => {
  const env = await settingsController({ projectProfiles: { "team/a": {}, "team/b": {} } });
  await env.controller.navigate({ scope: "team/a" });
  env.update({ reviewersJob: "local" });
  env.stored.projectProfiles = {
    "team/a": { overrides: { show_time_tracker: false } },
    "team/b": { versionFile: "VERSION" }, "team/c": { reviewersJob: "remote" },
  };
  assert.equal(await env.controller.save(), true);
  assert.equal(env.stored.projectProfiles["team/a"].reviewersJob, "local");
  assert.equal(env.stored.projectProfiles["team/a"].overrides.show_time_tracker, false);
  assert.equal(env.stored.projectProfiles["team/b"].versionFile, "VERSION");
  assert.equal(env.stored.projectProfiles["team/c"].reviewersJob, "remote");
  env.controller.dispose();
});

for (const scope of ["default", "team/a"]) {
  test(`reverting a pending edit in ${scope} persists the latest user choice`, async () => {
    const env = await settingsController({ reviewersJob: "original", projectProfiles: { "team/a": { reviewersJob: "original" } } });
    await env.controller.navigate({ scope });
    env.delayWrites = true;
    env.update({ reviewersJob: "temporary" });
    const first = env.controller.save();
    await settle();
    env.update({ reviewersJob: "original" });
    const second = env.controller.save();
    await settle();
    await env.replyWrite();
    await first;
    await env.replyWrite();
    assert.equal(await second, true);
    const data = scope === "default" ? env.stored : env.stored.projectProfiles[scope];
    assert.equal(data.reviewersJob, "original");
    env.controller.dispose();
  });
}

test("an imported profile map cannot be replaced by a stale deleted-profile editor", async () => {
  const env = await settingsController({ projectProfiles: { "team/a": {} } });
  await env.controller.navigate({ scope: "team/a" });
  env.update({ reviewersJob: "local" });
  env.emit({ projectProfiles: { newValue: { "team/new": { reviewersJob: "imported" } } } });
  assert.equal(await env.controller.save(), false);
  assert.equal(env.snapshot().dirty, true);
  assert.equal(env.snapshot().draft.fields.reviewersJob, "local");
  assert.deepEqual(env.stored.projectProfiles, { "team/new": { reviewersJob: "imported" } });
  env.controller.dispose();
});

test("import waits for outstanding saves then replaces settings without an old debounce restoring them", async () => {
  const env = await settingsController({ projectProfiles: { "team/a": {} } });
  await env.controller.navigate({ scope: "team/a" });
  env.delayWrites = true;
  env.update({ reviewersJob: "queued" });
  const save = env.controller.save();
  await settle();
  await env.import({ reviewersJob: "imported global", projectProfiles: { "team/b": { reviewersJob: "imported profile" } } });
  assert.equal(env.pendingWrites.length, 1);
  await env.replyWrite();
  await save;
  await env.replyWrite();
  assert.equal(env.snapshot().scope, "default");
  assert.equal(env.snapshot().draft.fields.reviewersJob, "imported global");
  assert.deepEqual(env.stored.projectProfiles, { "team/b": { reviewersJob: "imported profile" } });
  assert.equal(env.snapshot().dirty, false);
  env.controller.dispose();
});

test("a merged save refreshes remote profile values before the next edit without waiting for onChanged", async () => {
  const env = await settingsController({ projectProfiles: { "team/a": {} } });
  await env.controller.navigate({ scope: "team/a" });
  env.update({ reviewersJob: "first local edit" });
  env.stored.projectProfiles["team/a"] = { reviewersList: "remote-reviewer", overrides: { show_time_tracker: false } };
  assert.equal(await env.controller.save(), true);
  assert.equal(env.snapshot().draft.fields.reviewersList, "remote-reviewer");
  assert.equal(env.snapshot().draft.fields.show_time_tracker, false);
  env.update({ reviewersJob: "second local edit" });
  assert.equal(await env.controller.save(), true);
  assert.equal(env.stored.projectProfiles["team/a"].reviewersList, "remote-reviewer");
  assert.equal(env.stored.projectProfiles["team/a"].overrides.show_time_tracker, false);
  env.controller.dispose();
});

test("opening and switching untouched profiles does not consume sync write quota", async () => {
  const env = await settingsController({ projectProfiles: { "team/a": {}, "team/b": { customJobs: [], cherry_pick_branches: [] } } });
  assert.equal(await env.controller.save(), true);
  await env.controller.navigate({ scope: "team/a" });
  assert.equal(await env.controller.save(), true);
  await env.controller.navigate({ scope: "team/b" });
  assert.equal(await env.controller.save(), true);
  assert.equal(env.writes.length, 0);
  env.controller.dispose();
});
