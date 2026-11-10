'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');

function fixture(settings) {
  var env = harness.background({ settings: settings });
  var writes = [];
  var tabs = [];
  var badges = [];
  var set = env.chrome.storage.sync.set;
  env.chrome.storage.sync.set = function(values) {
    writes.push(harness.plain(values));
    set(values);
  };
  env.chrome.tabs.create = function(options) { tabs.push(harness.plain(options)); };
  env.chrome.action.setBadgeText = function(options) { badges.push(options.text); };
  return { env: env, writes: writes, tabs: tabs, badges: badges };
}

test('fresh install enables smart defaults and opens the welcome page', function() {
  var settings = {};
  var f = fixture(settings);
  f.env.listeners.installed({ reason: 'install' });
  assert.deepEqual(settings, {
    btn_rebase_automerge: true,
    btn_pipeline_restart: true,
    btn_pipeline_cancel: true,
    btn_draft_toggle: true,
    btn_retry_failed: true,
    sound_enabled: true
  });
  assert.deepEqual(f.tabs, [{ url: 'welcome.html' }]);
  assert.deepEqual(f.badges, []);
});

test('extension update announces the manifest version without resetting user settings', function() {
  var settings = {
    btn_rebase_automerge: false, btn_pipeline_restart: false, sound_enabled: false,
    language: 'ru', jira_url: 'https://jira.test', version_from_target: true,
    versionFile: 'pyproject.toml', buttonOrder: ['version', 'ship'],
    projectProfiles: { 'team/repo': { versionStrategy: 'minor' } },
    update_version: '1.0.0', update_previous: '0.9.0'
  };
  var before = harness.plain(settings);
  var f = fixture(settings);
  var notice = { update_version: f.env.chrome.runtime.getManifest().version, update_previous: '1.0.0' };
  f.env.listeners.installed({ reason: 'update', previousVersion: '1.0.0' });
  assert.deepEqual(f.writes, [notice]);
  assert.deepEqual(settings, Object.assign(before, notice));
  assert.deepEqual(f.tabs, []);
  assert.deepEqual(f.badges, ['NEW']);
});

test('extension update tolerates a missing previous version', function() {
  var settings = {};
  var f = fixture(settings);
  f.env.listeners.installed({ reason: 'update' });
  assert.equal(settings.update_version, f.env.chrome.runtime.getManifest().version);
  assert.equal(settings.update_previous, '');
  assert.deepEqual(f.tabs, []);
  assert.deepEqual(f.badges, ['NEW']);
});

test('a Chrome update does not reset settings or show an extension update notice', function() {
  var settings = { sound_enabled: false, language: 'ru', update_version: '1.0.0' };
  var before = harness.plain(settings);
  var f = fixture(settings);
  f.env.listeners.installed({ reason: 'chrome_update' });
  assert.deepEqual(settings, before);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.tabs, []);
  assert.deepEqual(f.badges, []);
});

test('installation observes callback API failures and still opens the welcome page', function() {
  var f = fixture({});
  var errors = [];
  var observed = false;
  f.env.context.console = { error: function(prefix, error) { errors.push(prefix + ' ' + error.message); } };
  f.env.chrome.storage.sync.set = function(_values, callback) {
    Object.defineProperty(f.env.chrome.runtime, 'lastError', {
      configurable: true,
      get: function() { observed = true; return {message: 'Storage quota exceeded'}; }
    });
    callback();
    delete f.env.chrome.runtime.lastError;
  };
  f.env.listeners.installed({reason: 'install'});
  assert.equal(observed, true, 'Chrome callback errors must be read while the callback is running');
  assert.deepEqual(errors, ['[GitLab Actions] Storage quota exceeded']);
  assert.deepEqual(f.tabs, [{url: 'welcome.html'}]);
});

[null, 'Cannot create tab'].forEach(function(errorMessage) {
  test('settings message responds after tab creation: ' + (errorMessage || 'success'), async function() {
    var env = harness.background();
    var complete;
    var responses = [];
    var errors = [];
    env.context.console = {error: function(_prefix, error) { errors.push(error.message); }};
    env.chrome.tabs.create = function(options, callback) {
      assert.equal(options.url, 'chrome-extension://test-extension/popup.html');
      complete = callback;
    };
    var keepAlive = env.listeners.message({type: 'open-options'}, {}, function(response) { responses.push(harness.plain(response)); });
    assert.equal(keepAlive, true, 'the message port must stay open until Chrome responds');
    assert.deepEqual(responses, []);
    if (errorMessage) env.chrome.runtime.lastError = {message: errorMessage};
    complete();
    delete env.chrome.runtime.lastError;
    assert.deepEqual(responses, [errorMessage ? {_error: errorMessage} : {ok: true}]);
    assert.deepEqual(errors, errorMessage ? [errorMessage] : []);
    await env.context.ready;
  });
});
