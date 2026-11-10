"use strict";
const vm = require("node:vm");
const { bundleForTest } = require("./runtime.cjs");
const messages = require("../../_locales/en/messages.json");
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key) => messages[key]?.message || key;
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Native callback timing/errors remain explicit; only debounce/download timers
// are virtual. This fixture never loads React or a production browser profile.
async function settingsController(initial = {}) {
  const env = {
    stored: { language: "en", ...plain(initial) },
    writes: [],
    requests: [],
    downloads: [],
    revokedDownloads: [],
    timers: new Map(),
    listeners: new Set(),
    pendingWrites: [],
    granted: true,
    readError: false,
    writeError: false,
    delayWrites: false,
  };
  let nextTimer = 0;
  const runtime = {
    getManifest: () => ({ version: "1.13.3" }),
    getURL: (file) => "chrome-extension://fixture/" + file,
  };
  function respond(callback, error, value) {
    if (error) runtime.lastError = { message: error };
    callback?.(value);
    delete runtime.lastError;
  }
  function finishWrite(write, error) {
    if (!error) Object.assign(env.stored, plain(write.data));
    respond(write.callback, error);
  }
  class FixtureURL extends URL {}
  const blobs = new Map();
  FixtureURL.createObjectURL = (blob) => {
    const url = "blob:fixture-" + blobs.size;
    blobs.set(url, blob);
    return url;
  };
  FixtureURL.revokeObjectURL = (url) => {
    env.revokedDownloads.push(url);
    blobs.delete(url);
  };
  const document = {
    body: { appendChild() {} },
    createElement: () => ({
      remove() {},
      click() {
        env.downloads.push({
          href: this.href,
          download: this.download,
          blob: blobs.get(this.href),
        });
      },
    }),
  };
  const chrome = {
    runtime,
    i18n: { getMessage: t, getUILanguage: () => "en" },
    tabs: { query: (_query, callback) => callback([]) },
    permissions: {
      request: (request, callback) => {
        env.requests.push(plain(request));
        respond(callback, null, env.granted);
      },
    },
    storage: {
      onChanged: {
        addListener: (fn) => env.listeners.add(fn),
        removeListener: (fn) => env.listeners.delete(fn),
      },
      sync: {
        get: (keys, callback) => {
          const defaults =
            keys && typeof keys === "object" && !Array.isArray(keys)
              ? keys
              : {};
          respond(
            callback,
            env.readError ? "Fixture read failure" : null,
            plain({ ...defaults, ...env.stored }),
          );
        },
        set: (data, callback) => {
          const write = { data: plain(data), callback };
          env.writes.push(write.data);
          if (env.delayWrites) env.pendingWrites.push(write);
          else
            finishWrite(write, env.writeError ? "Fixture write failure" : null);
        },
      },
    },
  };
  const context = vm.createContext({
    chrome,
    navigator: { locks: { request: (_key, task) => task() } },
    document,
    window: { addEventListener() {}, removeEventListener() {} },
    location: {
      search: "",
      hash: "",
      href: "chrome-extension://fixture/popup.html",
    },
    history: { replaceState() {} },
    TextEncoder,
    URL: FixtureURL,
    URLSearchParams,
    Blob,
    File,
    structuredClone,
    crypto: require("node:crypto").webcrypto,
    setTimeout: (fn, ms) => {
      const id = ++nextTimer;
      env.timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => env.timers.delete(id),
  });
  vm.runInContext(
    bundleForTest("src/pages/settings/model/controller.ts", {
      globalName: "Controller",
    }),
    context,
  );
  env.controller = new context.Controller.SettingsController(t);
  env.snapshot = () => env.controller.getSnapshot();
  env.start = () => env.controller.start();
  env.update = (fields) => {
    const draft = env.snapshot().draft;
    env.controller.updateDraft({
      ...draft,
      fields: { ...draft.fields, ...fields },
    });
  };
  env.runNext = async () => {
    const item = [...env.timers].sort((a, b) => a[1].ms - b[1].ms)[0];
    if (!item) return;
    env.timers.delete(item[0]);
    item[1].fn();
    await settle();
  };
  env.replyWrite = async (error) => {
    const write = env.pendingWrites.shift();
    if (!write) throw new Error("No pending write");
    finishWrite(write, error);
    await settle();
  };
  env.emit = (changes) => {
    for (const [key, change] of Object.entries(changes)) {
      if (Object.hasOwn(change, "newValue")) env.stored[key] = plain(change.newValue);
      else delete env.stored[key];
    }
    for (const listener of env.listeners) listener(changes, "sync");
  };
  env.import = async (settings) => {
    await env.controller.readImport(
      new File(
        [
          JSON.stringify({
            format: "gitlab-mr-actions-settings",
            formatVersion: 1,
            settings,
          }),
        ],
        "fixture.json",
        { type: "application/json" },
      ),
    );
    env.controller.applyImport();
    await settle();
  };
  await env.start();
  return env;
}
module.exports = { settingsController, plain, t, settle };
