'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var vm = require('node:vm');
var harness = require('./helpers/extension.cjs');
var messages = require('../_locales/en/messages.json');

function environment() {
  var controls = new Map(), timers = new Map(), timer = 0;
  function element() { return { style: {}, disabled: false, hidden: true, textContent: '', setAttribute: function() {}, focus: function() {}, addEventListener: function() {}, appendChild: function() {}, remove: function() {}, click: function() {} }; }
  function control(id) { if (!controls.has(id)) controls.set(id, element()); return controls.get(id); }
  var env = { stored: { update_version: '1.13.1', language: 'en' }, writes: [], requests: [], downloads: [], granted: true, writeError: false, readError: false };
  var context = vm.createContext({ window: { innerWidth: 360 }, TextEncoder: TextEncoder, URL: URL, Blob: Blob,
    document: { body: element(), addEventListener: function() {}, getElementById: control, querySelector: function() { return control('content'); }, createElement: function() { var el = element(); el.click = function() { env.downloads.push(el); }; return el; } },
    chrome: { runtime: { getManifest: function() { return { version: '1.13.1' }; } }, i18n: { getMessage: function(key) { return messages[key] && messages[key].message || key; } },
      permissions: { request: function(request, cb) { env.requests.push(request); cb(env.granted); } },
      storage: { sync: {
        get: function(keys, cb) { if (env.readError) context.chrome.runtime.lastError = { message: 'Read failed' }; cb(JSON.parse(JSON.stringify(env.stored))); delete context.chrome.runtime.lastError; },
        set: function(data, cb) { env.writes.push(JSON.parse(JSON.stringify(data))); if (env.writeError) context.chrome.runtime.lastError = { message: 'Write failed' }; else Object.assign(env.stored, JSON.parse(JSON.stringify(data))); cb(); delete context.chrome.runtime.lastError; }
      } } },
    setTimeout: function(fn) { timers.set(++timer, fn); return timer; }, clearTimeout: function(id) { timers.delete(id); }
  });
  vm.runInContext(harness.readRuntime('review-workflow.js'), context);
  vm.runInContext(harness.readRuntime('popup.js'), context);
  context.localizeHeader = function() {};
  context.renderTabs = function() {};
  context.renderActiveTab = function() {};
  context.loadLanguage = function(lang, cb) { env.loadedLanguage = lang; cb(); };
  env.context = context; env.control = control; env.timers = timers;
  env.import = function(settings) { context._pendingSettingsImport = context.parseSettingsFile(file(settings)); context.applySettingsImport(); };
  return env;
}
function file(settings) { return JSON.stringify({ format: 'gitlab-mr-actions-settings', formatVersion: 1, settings: settings }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function sharedConfig() {
  return {
    language: 'ru', show_ai_review_copy: false, ai_review_response_language: 'de',
    ai_review_prompt: 'Team review prompt', ai_review_rule_repository: { enabled: false, text: 'Team repository rules' },
    jira_url: 'https://jira.example.com/jira', jira_ticket_regex: 'TEAM-\\d+',
    jiraQuickActions: [{ label: 'Update', status: '', assignee: 'alice', updates: [{field:'fixVersions',operation:'add',value:['1.2']},{field:'customfield_123',operation:'set',value:{id:'42', enabled:true}}] }],
    customJobs: [{ label: 'Deploy', jobName: 'build, deploy' }], quickComments: [{label:'LGTM',text:'Looks good!'}],
    buttonOrder: ['btn_ship','custom_0'], cherry_pick_branches: ['release/1.2'],
    projectProfiles: { 'team/project': { buttons: { btn_ship: true }, buttonOrder: ['btn_ship'], customJobs: [{label:'Ship',jobName:'deploy'}], versionFile: 'version.txt', versionStrategy: 'minor' } },
    update_version: 'do not import', unknown_future_setting: true
  };
}

test('settings round trip includes every current setting and nested profile, without runtime metadata', function() {
  var env = environment(), config = sharedConfig();
  var snapshot = env.context.settingsSnapshot(config);
  var imported = env.context.parseSettingsFile(file(snapshot));
  assert.deepEqual(plain(imported), plain(snapshot));
  assert.equal(Object.keys(imported).length, Object.keys(env.context.DEFAULTS).length);
  assert.equal(imported.update_version, undefined);
  assert.equal(imported.unknown_future_setting, undefined);
  assert.equal(imported.ai_review_rule_repository.enabled, false);
});

test('missing configuration fields use extension defaults, so importing replaces old profiles and settings', function() {
  var env = environment();
  env.stored.projectProfiles = { 'old/project': {} }; env.stored.sound_enabled = true;
  env.import({language:'en', sound_enabled:false});
  assert.deepEqual(env.stored.projectProfiles, {});
  assert.equal(env.stored.sound_enabled, false);
  assert.equal(env.stored.update_version, '1.13.1');
  assert.equal(env.writes.length, 1);
  assert.equal(env.control('status').textContent, messages.settingsImported.message);
});

test('file format, supported version and nested types are validated before importing', function() {
  var env = environment();
  ['broken JSON', '{}', '{"format":"gitlab-mr-actions-settings","formatVersion":2,"settings":{"language":"en"}}', file({}), file({sound_enabled:'true'}), file({customJobs:[{label:42}]}), file({buttonOrder:[{}]}), file({quickComments:[{text:false}]}), file({projectProfiles:{'team/project':{buttons:{btn_ship:'true'}}}}), file({jiraQuickActions:[{updates:[{field:'fixVersions',operation:'set',value:'1.2'}]}]}), file({jiraQuickActions:[{updates:[null]}]}), file({language:'unsupported'}), file({jira_ticket_regex:'['}), file({jira_url:'javascript:alert(1)'}), file({jira_url:'https://user:password@jira.example.com'})].forEach(function(text) {
    assert.throws(function() { env.context.parseSettingsFile(text); }, undefined, text);
  });
  assert.equal(env.writes.length, 0);
});

test('prototype keys in project maps and nested profiles cannot enter configuration', function() {
  var env = environment();
  ['__proto__','constructor','prototype'].forEach(function(key) {
    assert.throws(function() { env.context.parseSettingsFile('{"format":"gitlab-mr-actions-settings","formatVersion":1,"settings":{"projectProfiles":{"'+key+'":{}}}}'); });
  });
  assert.throws(function() { env.context.parseSettingsFile('{"format":"gitlab-mr-actions-settings","formatVersion":1,"settings":{"projectProfiles":{"team/project":{"__proto__":{}}}}}'); });
});

test('per-item byte limits and prompt/rule character limits reject oversized imports', function() {
  var env = environment();
  [{ai_review_prompt:'a'.repeat(1501)}, {ai_review_rule_repository:{enabled:true,text:'a'.repeat(1501)}}, {projectProfiles:{'team/project':{versionFile:'界'.repeat(3000)}}}].forEach(function(settings) {
    assert.throws(function() { env.context.parseSettingsFile(file(settings)); });
  });
  assert.throws(function() { env.context.parseSettingsFile(' '.repeat(1024*1024+1)); });
});

test('import requests Jira access, then replaces configuration and rebuilds in the imported language', function() {
  var env = environment(); env.import(sharedConfig());
  assert.deepEqual(plain(env.requests), [{origins:['https://jira.example.com/*']}]);
  assert.equal(env.stored.language, 'ru');
  assert.equal(env.loadedLanguage, 'ru');
  assert.equal(env.context.activeTab, 'default');
  assert.equal(env.context._pendingSettingsImport, null);
  assert.equal(env.control('settingsImportPreview').hidden, true);
  assert.equal(env.context._settingsTransferBusy, false);
});

test('denied Jira access leaves storage and the current form intact and permits retry', function() {
  var env = environment(); env.granted = false; env.context.allData = {language:'en'};
  env.import(sharedConfig());
  assert.equal(env.writes.length, 0);
  assert.equal(env.context.allData.language, 'en');
  assert.ok(env.context._pendingSettingsImport);
  assert.equal(env.control('status').className, 'status failed');
  assert.equal(env.context._settingsTransferBusy, false);
  env.granted = true; env.context.applySettingsImport();
  assert.equal(env.stored.language, 'ru');
});

test('storage failures preserve the current form and preview, without reporting import success', function() {
  [true,false].forEach(function(readError) {
    var env = environment(); env.readError = readError; env.writeError = !readError;
    env.context.allData = {reviewersJob:'unsaved-draft'};
    env.import({language:'en',reviewersJob:'imported'});
    assert.equal(env.context.allData.reviewersJob,'unsaved-draft');
    assert.equal(env.stored.reviewersJob, undefined);
    assert.equal(env.control('status').className, 'status failed');
    assert.ok(env.context._pendingSettingsImport);
    assert.equal(env.context._settingsTransferBusy, false);
  });
});

test('total sync quota includes existing metadata and rejects the import without writing', function() {
  var env = environment(); env.stored.runtime_metadata = 'x'.repeat(102400);
  env.import({language:'en'});
  assert.equal(env.writes.length,0);
  assert.equal(env.control('status').textContent,messages.settingsFileTooLarge.message);
});

test('export waits for the current form save and exports complete stored configuration only', async function() {
  var env = environment(), saved;
  env.context.saveSettings = function(cb) { saved = cb; return true; };
  env.context.exportAllSettings();
  assert.equal(env.downloads.length,0);
  assert.equal(env.context._settingsTransferBusy,true);
  Object.assign(env.stored,sharedConfig());
  var downloadedBlob;
  env.context.URL = {createObjectURL:function(blob){downloadedBlob=blob;return 'blob:settings';},revokeObjectURL:function(){}};
  saved();
  assert.equal(env.downloads[0].download,'gitlab-mr-actions-settings.json');
  var exported = JSON.parse(await downloadedBlob.text());
  assert.equal(exported.format,'gitlab-mr-actions-settings');
  assert.equal(exported.settings.language,'ru');
  assert.equal(exported.settings.update_version,undefined);
  assert.deepEqual(exported.settings.projectProfiles,sharedConfig().projectProfiles);
  assert.equal(env.context._settingsTransferBusy,false);
});

test('failed export saves and reads unlock the controls without downloading stale settings', function() {
  var env = environment(), failed;
  env.context.saveSettings = function(cb,onFailed) { failed=onFailed; return true; };
  env.context.exportAllSettings();failed();
  assert.equal(env.context._settingsTransferBusy,false); assert.equal(env.downloads.length,0);
  env.context.saveSettings = function() { return false; };env.context.exportAllSettings();
  assert.equal(env.context._settingsTransferBusy,false);
  env.context.saveSettings = function(cb) { cb(); return true; };env.readError=true;env.context.exportAllSettings();
  assert.equal(env.downloads.length,0);assert.equal(env.context._settingsTransferBusy,false);
});

test('MR actions round trip globally and in project profiles, with stable button identities', function() {
  var env = environment();
  var actions = [{id:'remove-qa',label:'Remove QA',type:'remove_labels',labels:'waiting for QA, тип::ошибка'},{id:'clear',label:'Clear labels',type:'clear_labels',labels:''}];
  var config = {mrActions:actions,buttonOrder:['mr_action_clear','btn_ship','mr_action_remove-qa'],projectProfiles:{'team/repo':{mrActions:[],buttonOrder:[]},'other/repo':{mrActions:actions}}};
  var imported = env.context.parseSettingsFile(file(env.context.settingsSnapshot(config)));
  assert.deepEqual(plain(imported.mrActions), actions);
  assert.deepEqual(plain(imported.buttonOrder), config.buttonOrder);
  assert.deepEqual(plain(imported.projectProfiles), config.projectProfiles);
});

test('invalid or ambiguous MR actions are rejected before importing any settings', function() {
  var env = environment(), valid = {id:'a',label:'Clear',type:'clear_labels',labels:''};
  [null, {}, {id:'a',label:' ',type:'clear_labels',labels:''}, {id:'a',label:'Bad',type:'unknown',labels:''},
    {id:'a',label:'Bad',type:'remove_labels',labels:', \n'}, {id:'<bad>',label:'Bad',type:'clear_labels',labels:''},
    {id:'a',label:'Bad',type:'add_labels',labels:[]}, valid].forEach(function(action) {
    var actions = action === valid ? [valid,valid] : [action];
    assert.throws(function() { env.context.parseSettingsFile(file({mrActions:actions})); });
    assert.throws(function() { env.context.parseSettingsFile(file({projectProfiles:{'team/repo':{mrActions:actions}}})); });
  });
  assert.equal(env.writes.length, 0);
});
