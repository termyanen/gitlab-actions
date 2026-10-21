'use strict';

var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var assert = require('node:assert/strict');
var root = path.resolve(__dirname, '../..');

// Optional local baseline comparison; ordinary tests always use the workspace.
function readRuntime(file) {
  return fs.readFileSync(path.join(process.env.EXTENSION_TEST_SOURCE_DIR || root, file), 'utf8');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(status, body) {
  return { testResponse: true, status: status, body: body };
}

function flush() {
  return new Promise(function(resolve) { setImmediate(resolve); });
}

// Only the extension's timers are virtual. Promise callbacks run normally, so
// polling, retries and API-proxy timeouts exercise the production promise chains.
function clock() {
  var time = 0;
  var nextId = 1;
  var timers = new Map();
  function schedule(fn, ms, repeat) {
    var id = nextId++;
    timers.set(id, { fn: fn, at: time + ms, repeat: repeat });
    return id;
  }
  return {
    setTimeout: function(fn, ms) { return schedule(fn, ms || 0, 0); },
    clearTimeout: function(id) { timers.delete(id); },
    setInterval: function(fn, ms) { return schedule(fn, ms, ms); },
    clearInterval: function(id) { timers.delete(id); },
    next: async function() {
      await flush();
      var entry = Array.from(timers.entries()).sort(function(a, b) { return a[1].at - b[1].at; })[0];
      if (!entry) return false;
      var id = entry[0];
      var timer = entry[1];
      time = timer.at;
      timers.delete(id);
      if (timer.repeat) timers.set(id, { fn: timer.fn, at: time + timer.repeat, repeat: timer.repeat });
      timer.fn();
      await flush();
      return true;
    },
    finish: async function(promise) {
      var done = false;
      var result;
      var failure;
      Promise.resolve(promise).then(function(value) {
        done = true;
        result = value;
      }, function(error) {
        done = true;
        failure = error;
      });
      for (var i = 0; i < 500; i++) {
        await flush();
        if (done) {
          if (failure) throw failure;
          return result;
        }
        assert.ok(await this.next(), 'Operation stalled without a timer or response');
      }
      throw new Error('Operation did not settle within 500 timer callbacks');
    }
  };
}

function environment(options) {
  options = options || {};
  var timers = clock();
  var requests = [];
  var messages = [];
  var notifications = [];
  var listeners = {};
  var settings = options.settings || {};
  var chrome = {
    runtime: {
      id: 'test-extension',
      getURL: function(file) { return 'chrome-extension://test-extension/' + file; },
      getManifest: function() { return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))); },
      onInstalled: { addListener: function(fn) { listeners.installed = fn; } },
      onMessage: { addListener: function(fn) { listeners.message = fn; } },
      sendMessage: function(message, callback) {
        messages.push(plain(message));
        if (callback) callback({ taskId: 'test-task' });
      }
    },
    i18n: { getMessage: function(key, substitutions) { return key + (substitutions ? ':' + substitutions.join(',') : ''); } },
    storage: {
      sync: {
        get: function(defaults, callback) { callback(plain(Object.assign({}, defaults, settings))); },
        set: function(values, callback) { Object.assign(settings, values); if (callback) callback(); }
      }
    },
    tabs: {
      query: function() { return Promise.resolve(options.tabs || [{ id: 1 }]); },
      create: function() {},
      sendMessage: function(tabId, message) {
        messages.push(Object.assign({ tabId: tabId }, plain(message)));
        if (message.type !== 'api-proxy') return Promise.resolve();
        if (options.sendMessage) return options.sendMessage(tabId, message);
        return gitlab(message.method, message.path, message.body, tabId);
      }
    },
    notifications: { create: function(id, data) { notifications.push({ id: id, data: plain(data) }); } },
    cookies: { getAll: function() { return Promise.resolve([{ name: 'session', value: 'test-only' }]); } },
    action: { setBadgeText: function() {}, setBadgeBackgroundColor: function() {} }
  };

  function gitlab(method, url, body, tabId) {
    var request = { method: method, path: url, body: body && plain(body), tabId: tabId };
    requests.push(request);
    return Promise.resolve().then(function() {
      if (!options.gitlab) throw new Error('Unexpected GitLab request: ' + method + ' ' + url);
      return options.gitlab(request);
    });
  }

  var document = {
    readyState: 'loading',
    addEventListener: function() {},
    querySelector: function(selector) {
      if (selector === 'meta[name="csrf-token"]') return { getAttribute: function() { return 'test-csrf'; } };
      return null;
    }
  };
  var context = vm.createContext({
    console: console,
    URL: URL,
    chrome: chrome,
    document: document,
    navigator: { clipboard: { writeText: function(text) { messages.push({ clipboard: text }); return Promise.resolve(); } } },
    window: {
      location: { origin: 'https://gitlab.test', pathname: '/team/repo/-/merge_requests/12' },
      addEventListener: function() {}
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    btoa: function(text) { return Buffer.from(text, 'binary').toString('base64'); },
    atob: function(text) { return Buffer.from(text, 'base64').toString('binary'); },
    fetch: function(url, init) {
      var parsed = new URL(url);
      init = init || {};
      var request;
      if (parsed.origin === 'https://gitlab.test' && parsed.pathname.indexOf('/api/v4/') === 0) {
        assert.equal(init.credentials, 'same-origin');
        if (init.method !== 'GET') assert.equal(init.headers['X-CSRF-Token'], 'test-csrf');
        request = gitlab(init.method, parsed.pathname.slice('/api/v4'.length) + parsed.search, init.body && JSON.parse(init.body));
      } else {
        var external = { method: init.method || 'GET', url: url, body: init.body && JSON.parse(init.body), headers: init.headers };
        requests.push(external);
        request = Promise.resolve().then(function() {
          if (!options.jira) throw new Error('Unexpected external request: ' + url);
          return options.jira(external);
        });
      }
      return request.then(function(data) {
        var status = data && data.testResponse ? data.status : 200;
        var body = data && data.testResponse ? data.body : data;
        return {
          ok: status >= 200 && status < 300,
          status: status,
          statusText: String(status),
          text: function() { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); },
          json: function() { return Promise.resolve(plain(body)); }
        };
      });
    }
  });

  return {
    context: context,
    clock: timers,
    requests: requests,
    messages: messages,
    notifications: notifications,
    chrome: chrome,
    listeners: listeners,
    finish: function(promise) { return timers.finish(promise); },
    dispatch: function(message, sender) {
      return new Promise(function(resolve) {
        listeners.message(message, sender || { tab: { id: 1 } }, resolve);
      });
    }
  };
}

function content(options) {
  var env = environment(options);
  var source = readRuntime('content.js');
  var end = source.lastIndexOf('})();');
  assert.ok(end > 0, 'content.js IIFE must be present');
  // Expose the original functions inside the VM only. Runtime sources and the
  // shipped extension gain no exports/test hooks. Stub presentation, not actions.
  source = source.slice(0, end) +
    'PROJECT_ID = 37; MR_IID = 12; PROJECT_PATH = "team/repo";\n' +
    'showToast = function() {}; pollTaskStatus = function() {};\n' +
    'globalThis.actions = { doVersionBump, doShip, doForceShip, doRebaseVersion, doRebaseAutoMerge, doJustRebase, doPipelineRestart, doPipelineCancel, doDraftToggle, doRetryFailed, doCopyMr, doReviewers, doTriggerJob, doAutoMerge, getSettings, getMergeOptions, bumpVersion, parseToml, updateTomlVersion, doRebase, pollRebase, waitForBranchInMR, waitMRReady, doAutoMergeWithRetry, doMrAction };\n' +
    source.slice(end);
  vm.runInContext(source, env.context, { filename: 'content.js' });
  env.actions = env.context.actions;
  return env;
}

function background(options) {
  var env = environment(options);
  vm.runInContext(readRuntime('background.js'), env.context, { filename: 'background.js' });
  return env;
}

function proxyHelpers() {
  var env = environment();
  var source = readRuntime('content_proxy.js');
  var marker = 'if (!isGitLab()) return;';
  assert.ok(source.includes(marker), 'content_proxy.js GitLab guard must be present');
  // Only pure, hoisted helpers; skip DOM feature initializers.
  source = source.replace(marker,
    'globalThis.helpers = { applyUnifiedDiff, bumpVersion, parseToml, updateTomlVersion }; return;');
  vm.runInContext(source, env.context, { filename: 'content_proxy.js' });
  return env.context.helpers;
}

module.exports = { content: content, background: background, proxyHelpers: proxyHelpers, environment: environment, plain: plain, response: response, flush: flush, root: root, readRuntime: readRuntime };
