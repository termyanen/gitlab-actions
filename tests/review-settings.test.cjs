'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var vm = require('node:vm');
var harness = require('./helpers/extension.cjs');
var messages = require('../_locales/en/messages.json');

function popup(sharedPrompt, sharedFreshPrompt, savedData, sharedImport) {
  var controls = new Map();
  function element() {
    return { value: '', checked: false, style: {}, className: '', textContent: '', events: {}, children: [], querySelectorAll: function() { return []; },
      addEventListener: function(name, fn) { this.events[name] = fn; }, appendChild: function(el) { this.children.push(el); }, setAttribute: function() {},
      matches: function(selectors) { return selectors.split(',').map(function(s) { return s.trim(); }).includes(this.tagName); } };
  }
  function control(id) { if (!controls.has(id)) controls.set(id, element()); return controls.get(id); }
  var env = { writes: [], timers: new Map(), control: control };
  var timerId = 0;
  var document = { addEventListener: function() {}, getElementById: control, querySelectorAll: function() { return []; }, createElement: element, body: element() };
  env.context = vm.createContext({
    window: { innerWidth: 360, GlReviewImport: sharedImport, GlReviewExport: sharedPrompt || sharedFreshPrompt ? { DEFAULT_PROMPT: sharedPrompt, DEFAULT_FRESH_REVIEW_PROMPT: sharedFreshPrompt } : undefined }, document: document, TextEncoder: TextEncoder,
    chrome: { runtime: {}, i18n: { getMessage: function(key) { return messages[key] && messages[key].message || key; } }, storage: { sync: { set: function(data, callback) { env.writes.push({ data: data, callback: callback }); } } }, permissions: { request: function() { throw new Error('Unexpected permission request'); } } },
    setTimeout: function(fn) { env.timers.set(++timerId, fn); return timerId; }, clearTimeout: function(id) { env.timers.delete(id); }
  });
  vm.runInContext(harness.readRuntime('review-workflow.js'), env.context);
  vm.runInContext(harness.readRuntime('popup.js'), env.context, { filename: 'popup.js' });
  if (savedData) env.context.allData = savedData;
  env.context.renderDefaultTab(element());
  env.document = document;
  env.save = function() { return env.context.saveDefaultTab(); };
  env.respond = function(index, error) {
    if (error) env.context.chrome.runtime.lastError = { message: error };
    else delete env.context.chrome.runtime.lastError;
    env.writes[index].callback();
    delete env.context.chrome.runtime.lastError;
  };
  return env;
}

test('AI copy settings use the shared English prompt, default enabled state and a working reset action', function() {
  var env = popup('Shared English default prompt.');
  assert.equal(env.control('show_ai_review_copy').checked, true);
  assert.equal(env.control('ai_review_prompt').value, 'Shared English default prompt.');
  env.control('show_ai_review_copy').checked = false;
  env.control('ai_review_prompt').value = 'Custom\nmultiline prompt';
  assert.equal(env.save(), true);
  assert.equal(env.writes[0].data.show_ai_review_copy, false);
  assert.equal(env.writes[0].data.ai_review_prompt, 'Custom\nmultiline prompt');
  env.control('resetAiReviewPrompt').events.click();
  assert.equal(env.control('ai_review_prompt').value, 'Shared English default prompt.');
  env.context.flushAutoSave();
  assert.equal(env.writes[1].data.ai_review_prompt, 'Shared English default prompt.');
});

test('missing shared script still has an English fallback and a blank prompt restores it', function() {
  var env = popup();
  assert.match(env.control('ai_review_prompt').value, /^Review the feedback for this GitLab/);
  env.control('ai_review_prompt').value = ' \n ';
  env.save();
  assert.equal(env.writes[0].data.ai_review_prompt, env.context.AI_REVIEW_DEFAULT_PROMPT);
});

test('prompt size validation permits Unicode but prevents invalid sync storage items without dropping the draft', function() {
  var env = popup();
  env.control('ai_review_prompt').value = '界'.repeat(1500);
  assert.equal(env.save(), true);
  env.control('ai_review_prompt').value = 'a'.repeat(1501);
  assert.equal(env.save(), false);
  assert.equal(env.writes.length, 1);
  assert.equal(env.control('ai_review_prompt').value.length, 1501);
  env.control('ai_review_prompt').value = '\u0001'.repeat(1500);
  assert.equal(env.save(), false, 'JSON escapes count against the sync item quota');
  assert.equal(env.writes.length, 1);
  assert.equal(env.control('status').className, 'status failed');
});

test('storage errors never show Saved and successful retry clears the failure', function() {
  var env = popup();
  env.save();
  env.respond(0, 'QUOTA_BYTES_PER_ITEM quota exceeded');
  assert.equal(env.control('status').className, 'status failed');
  assert.notEqual(env.control('status').textContent, messages.saved.message);
  env.save();
  env.respond(1);
  assert.equal(env.control('status').className, 'status saved');
});

test('textarea input schedules autosave and flushing preserves a draft before form replacement', function() {
  var env = popup();
  env.context.attachAutoSave();
  var prompt = env.control('ai_review_prompt');
  prompt.tagName = 'textarea';
  prompt.value = 'Latest unsaved instruction';
  env.document.body.events.input({ target: prompt });
  assert.equal(env.control('status').className, 'status unsaved');
  assert.equal(env.context.flushAutoSave(), true);
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].data.ai_review_prompt, 'Latest unsaved instruction');
  assert.equal(env.context.flushAutoSave(), true);
  assert.equal(env.writes.length, 1, 'an already-flushed timer does not write twice');
});

test('a stale storage completion cannot replace a newer unsaved status', function() {
  var env = popup();
  env.context.scheduleAutoSave();
  env.context.flushAutoSave();
  env.control('ai_review_prompt').value = 'Newer draft';
  env.context.scheduleAutoSave();
  env.respond(0);
  assert.equal(env.control('status').className, 'status unsaved');
  env.context.flushAutoSave();
  env.respond(1);
  assert.equal(env.control('status').className, 'status saved');
});

test('failed debounced validation keeps edits protected when switching tabs after the timer has fired', function() {
  var env = popup();
  env.control('ai_review_filter_includeFiles').value = '界'.repeat(1500);
  env.control('ai_review_filter_ignoreFiles').value = '界'.repeat(1500);
  env.context.scheduleAutoSave();
  var callback = env.timers.get(env.context._autoSaveTimer);
  callback();
  assert.equal(env.context._autoSaveTimer, null);
  assert.equal(env.writes.length, 0, 'oversized sync item must not be written');
  assert.equal(env.context.flushAutoSave(), false, 'switching tabs must still validate after the debounce fired');
  assert.equal(env.control('ai_review_filter_includeFiles').value, '界'.repeat(1500));
  env.control('ai_review_filter_ignoreFiles').value = '';
  assert.equal(env.context.flushAutoSave(), true, 'correcting the input permits a retry without another timer');
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].data.ai_review_file_filter.includeFiles, '界'.repeat(1500));
  assert.equal(env.context.flushAutoSave(), true);
  assert.equal(env.writes.length, 1, 'a successful save clears the dirty flag');
});

test('fresh review has an independent shared default, saved value and reset action', function() {
  var env = popup('Feedback default.', 'Fresh default.', {
    ai_review_prompt: 'Fix feedback my way.', ai_review_fresh_prompt: 'Review security and answer in German.'
  });
  assert.equal(env.control('ai_review_prompt').value, 'Fix feedback my way.');
  assert.equal(env.control('ai_review_fresh_prompt').value, 'Review security and answer in German.');
  assert.equal(env.control('ai_review_fresh_prompt').placeholder, 'Fresh default.');
  env.control('ai_review_fresh_prompt').value = 'My new review instructions.';
  assert.equal(env.save(), true);
  assert.equal(env.writes[0].data.ai_review_fresh_prompt, 'My new review instructions.');
  assert.equal(env.writes[0].data.ai_review_prompt, 'Fix feedback my way.');
  env.control('resetAiReviewFreshPrompt').events.click();
  assert.equal(env.control('ai_review_fresh_prompt').value, 'Fresh default.');
  assert.equal(env.control('ai_review_prompt').value, 'Fix feedback my way.');
  env.context.flushAutoSave();
  assert.equal(env.writes[1].data.ai_review_fresh_prompt, 'Fresh default.');
  var reloaded = popup('Feedback default.', 'Fresh default.', env.writes[0].data);
  assert.equal(reloaded.control('ai_review_fresh_prompt').value, 'My new review instructions.');
});

test('fresh review validates character and serialized byte limits before any settings write', function() {
  var env = popup();
  env.control('ai_review_fresh_prompt').value = '界'.repeat(1500);
  assert.equal(env.save(), true);
  env.control('ai_review_prompt').value = 'Feedback changed too.';
  env.control('ai_review_fresh_prompt').value = 'a'.repeat(1501);
  assert.equal(env.save(), false);
  assert.equal(env.writes.length, 1);
  assert.equal(env.control('ai_review_fresh_prompt').value.length, 1501);
  env.control('ai_review_fresh_prompt').value = '\u0001'.repeat(1500);
  assert.equal(env.save(), false, 'escaped control characters exceed the sync item quota');
  assert.equal(env.writes.length, 1, 'invalid fresh prompt prevents saving unrelated changes too');
  assert.equal(env.control('status').className, 'status failed');
  env.control('ai_review_fresh_prompt').value = 'Valid fresh draft';
  env.control('ai_review_prompt').value = 'a'.repeat(1501);
  assert.equal(env.save(), false, 'both prompts are validated before writes');
  assert.equal(env.control('ai_review_fresh_prompt').value, 'Valid fresh draft');
  assert.equal(env.writes.length, 1);
});

test('fresh review fallback matches the shared default and blank instructions restore it', function() {
  var shared = vm.createContext({ window: {} });
  vm.runInContext(harness.readRuntime('review-export.js'), shared);
  var env = popup();
  assert.equal(env.context.AI_REVIEW_DEFAULT_FRESH_PROMPT, shared.window.GlReviewExport.DEFAULT_FRESH_REVIEW_PROMPT);
  assert.match(env.control('ai_review_fresh_prompt').value, /every commit/);
  assert.match(env.control('ai_review_fresh_prompt').value, /conversation language/);
  env.control('ai_review_fresh_prompt').value = ' \n ';
  env.save();
  assert.equal(env.writes[0].data.ai_review_fresh_prompt, env.context.AI_REVIEW_DEFAULT_FRESH_PROMPT);
});

test('fresh review textarea participates in autosave without replacing feedback instructions', function() {
  var env = popup('Feedback default.', 'Fresh default.');
  env.context.attachAutoSave();
  var prompt = env.control('ai_review_fresh_prompt');
  prompt.tagName = 'textarea';
  prompt.value = 'Latest fresh-review draft';
  env.document.body.events.input({ target: prompt });
  assert.equal(env.context.flushAutoSave(), true);
  assert.equal(env.writes[0].data.ai_review_fresh_prompt, 'Latest fresh-review draft');
  assert.equal(env.writes[0].data.ai_review_prompt, 'Feedback default.');
});

['import', 'reply'].forEach(function(kind) {
  var key = 'ai_review_' + kind + '_prompt';
  var reset = kind === 'import' ? 'resetAiReviewImportPrompt' : 'resetAiReviewReplyPrompt';
  var shared = { DEFAULT_REVIEW_PROMPT: 'Review default.', DEFAULT_REPLY_PROMPT: 'Reply default.' };
  var fallback = kind === 'import' ? shared.DEFAULT_REVIEW_PROMPT : shared.DEFAULT_REPLY_PROMPT;
  test(kind + ' prompt saves independently, reloads and resets through autosave', function() {
    var saved = { ai_review_prompt: 'Feedback custom.', ai_review_fresh_prompt: 'Fresh custom.', ai_review_import_prompt: 'Import custom.', ai_review_reply_prompt: 'Reply custom.' };
    var env = popup(undefined, undefined, saved, shared);
    assert.equal(env.control(key).value, saved[key]);
    assert.equal(env.control(key).placeholder, fallback);
    env.context.attachAutoSave();
    var field = env.control(key);
    field.value = 'Answer in German; focus on concrete changes.';
    field.tagName = 'textarea';
    env.document.body.events.input({ target: field });
    assert.equal(env.context.flushAutoSave(), true);
    assert.equal(env.writes[0].data[key], field.value);
    Object.keys(saved).filter(function(other) { return other !== key; }).forEach(function(other) {
      assert.equal(env.writes[0].data[other], saved[other]);
    });
    var reload = popup(undefined, undefined, env.writes[0].data, shared);
    assert.equal(reload.control(key).value, field.value);
    env.control(reset).events.click();
    env.context.flushAutoSave();
    assert.equal(env.writes[1].data[key], fallback);
    Object.keys(saved).filter(function(other) { return other !== key; }).forEach(function(other) {
      assert.equal(env.writes[1].data[other], saved[other]);
    });
  });
  test(kind + ' prompt rejects overlong and oversized drafts before writing any settings', function() {
    var env = popup();
    env.control(key).value = '界'.repeat(1500);
    assert.equal(env.save(), true);
    ['x'.repeat(1501), '\u0001'.repeat(1500)].forEach(function(invalid) {
      env.control(key).value = invalid;
      env.control('ai_review_prompt').value = 'Another changed setting';
      assert.equal(env.save(), false);
      assert.equal(env.writes.length, 1);
      assert.equal(env.control(key).value, invalid);
    });
  });
});

test('all popup prompt fallbacks match exported defaults and blank fields restore them', function() {
  var shared = vm.createContext({ window: {} });
  vm.runInContext(harness.readRuntime('review-export.js'), shared);
  vm.runInContext(harness.readRuntime('review-import.js'), shared);
  var defaults = {
    ai_review_prompt: shared.window.GlReviewExport.DEFAULT_PROMPT,
    ai_review_fresh_prompt: shared.window.GlReviewExport.DEFAULT_FRESH_REVIEW_PROMPT,
    ai_review_import_prompt: shared.window.GlReviewImport.DEFAULT_REVIEW_PROMPT,
    ai_review_reply_prompt: shared.window.GlReviewImport.DEFAULT_REPLY_PROMPT
  };
  var env = popup();
  Object.keys(defaults).forEach(function(key) {
    assert.equal(env.control(key).value, defaults[key]);
    assert.ok(defaults[key].length <= 1500);
    env.control(key).value = '   ';
  });
  assert.equal(env.save(), true);
  Object.keys(defaults).forEach(function(key) { assert.equal(env.writes[0].data[key], defaults[key]); });
});

test('repeat-review prompt and all four file filters autosave, reload and validate atomically', function() {
  var env = popup();
  env.control('ai_review_repeat_prompt').value = 'Recheck fixes in English.';
  env.control('ai_review_filter_includeExtensions').value = 'ts, js';
  env.control('ai_review_filter_ignoreDirs').value = 'dist';
  assert.equal(env.save(), true);
  var restored = popup(undefined, undefined, env.writes[0].data);
  assert.equal(restored.control('ai_review_repeat_prompt').value, 'Recheck fixes in English.');
  assert.equal(restored.control('ai_review_filter_includeExtensions').value, 'ts, js');
  assert.equal(restored.control('ai_review_filter_ignoreDirs').value, 'dist');
  restored.control('resetAiReviewRepeatPrompt').events.click();
  assert.equal(restored.control('ai_review_repeat_prompt').value, restored.context.window.GlReviewWorkflow.DEFAULT_REPEAT_PROMPT);
  restored.context.flushAutoSave();
  assert.equal(restored.writes[0].data.ai_review_file_filter.ignoreDirs, 'dist');
  restored.control('ai_review_filter_ignoreFiles').value = 'a'.repeat(1501);
  assert.equal(restored.save(), false);
  assert.equal(restored.writes.length, 1);
  restored.control('ai_review_filter_ignoreFiles').value = '';
  restored.control('ai_review_repeat_prompt').value = 'a'.repeat(1501);
  assert.equal(restored.save(), false);
  assert.equal(restored.writes.length, 1);
});

test('AI response language is independent from interface language and survives saving', function() {
  var env = popup(undefined, undefined, { language: 'de', ai_review_response_language: 'ru' });
  assert.equal(env.control('ai_review_response_language').value, 'ru');
  env.control('ai_review_response_language').value = 'ja';
  assert.equal(env.save(), true);
  assert.equal(env.writes[0].data.ai_review_response_language, 'ja');
  var restored = popup(undefined, undefined, env.writes[0].data);
  assert.equal(restored.control('ai_review_response_language').value, 'ja');
  assert.equal(popup(undefined, undefined, { ai_review_response_language: 'invalid' }).control('ai_review_response_language').value, 'auto');
});

test('review close confirmation defaults off and persists the explicit setting', function() {
  var env = popup();
  assert.equal(env.control('ai_review_confirm_close').checked, false);
  env.control('ai_review_confirm_close').checked = true;
  assert.equal(env.save(), true);
  assert.equal(env.writes[0].data.ai_review_confirm_close, true);
  var restored = popup(undefined, undefined, env.writes[0].data);
  assert.equal(restored.control('ai_review_confirm_close').checked, true);
  restored.control('ai_review_confirm_close').checked = false;
  restored.save();
  assert.equal(restored.writes[0].data.ai_review_confirm_close, false);
});

test('automatic instruction settings default enabled, save independently, allow blank text and reset per block', function() {
  var env = popup(), blocks = env.context.AI_REVIEW_RULES;
  blocks.forEach(function(block) {
    var key = 'ai_review_rule_' + block.id;
    assert.equal(env.control(key + '_enabled').checked, true);
    assert.equal(env.control(key).value, block.text);
  });
  env.control('ai_review_rule_repository').value = 'Use my prepared checkout.';
  env.control('ai_review_rule_review_checkout_enabled').checked = false;
  env.control('ai_review_rule_review_checkout').value = 'Keep this disabled text.';
  env.control('ai_review_rule_language').value = '';
  assert.equal(env.save(), true);
  assert.equal(env.writes[0].data.ai_review_rule_repository.text, 'Use my prepared checkout.');
  assert.equal(env.writes[0].data.ai_review_rule_review_checkout.enabled, false);
  assert.equal(env.writes[0].data.ai_review_rule_language.text, '');
  var restored = popup(undefined, undefined, env.writes[0].data);
  assert.equal(restored.control('ai_review_rule_repository').value, 'Use my prepared checkout.');
  assert.equal(restored.control('ai_review_rule_review_checkout_enabled').checked, false);
  assert.equal(restored.control('ai_review_rule_review_checkout').value, 'Keep this disabled text.');
  assert.equal(restored.control('ai_review_rule_language').value, '');
  restored.control('ai_review_rule_review_checkout_reset').events.click();
  assert.equal(restored.control('ai_review_rule_review_checkout_enabled').checked, true);
  assert.notEqual(restored.control('ai_review_rule_review_checkout').value, 'Keep this disabled text.');
  restored.context.flushAutoSave();
  assert.equal(restored.writes[0].data.ai_review_rule_repository.text, 'Use my prepared checkout.');
});

test('an oversized automatic instruction prevents saving unrelated settings and preserves its draft', function() {
  var env = popup();
  env.control('ai_review_rule_repository').value = '\u0001'.repeat(1500);
  env.control('show_ai_review_copy').checked = false;
  env.context.scheduleAutoSave();
  assert.equal(env.context.flushAutoSave(), false);
  assert.equal(env.writes.length, 0);
  assert.equal(env.control('ai_review_rule_repository').value.length, 1500);
  env.control('ai_review_rule_repository').value = 'Valid custom instruction';
  assert.equal(env.context.flushAutoSave(), true);
  assert.equal(env.writes[0].data.show_ai_review_copy, false);
});
