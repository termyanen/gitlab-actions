'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var vm = require('node:vm');
var ui = require('./helpers/review-copy.cjs');
var harness = require('./helpers/extension.cjs');
var messages = require('../_locales/en/messages.json');
async function setup(options) {
  options = options || {};
  var env = await ui.create(options);
  env.prompts = []; env.replyPrompts = []; env.publications = [];
  env.context.window.GlReviewImport = {
    getPrompt: function(context, opts) {
      var request = Object.assign(ui.deferred(), { context: context, options: opts });
      env.prompts.push(request); return request.promise;
    },
    getReplyPrompt: function(context, opts) {
      var request = Object.assign(ui.deferred(), { context: context, options: opts });
      env.replyPrompts.push(request); return request.promise;
    }
  };
  if (options.workflow) {
    env.context.TextEncoder = TextEncoder;
    env.local = {};
    env.context.chrome.storage.local = {
      get: function(key, cb) { cb({ [key]: env.local[key] }); },
      set: function(value, cb) { Object.assign(env.local, value); cb(); }
    };
    vm.runInContext(harness.readRuntime('review-workflow.js'), env.context);
  }
  if (options.realImport) {
    env.context.TextEncoder = TextEncoder;
    vm.runInContext(harness.readRuntime('review-import.js'), env.context);
  }
  env.api.loadReviewVersions = options.loadVersions || (async function() { return { items: [], warnings: [] }; });
  await env.click('aiReviewOpen');
  if (!options.pendingLoad) await env.respond([{ id: '1'.repeat(40), notes: [{ id: 1, body: 'Fix input', resolvable: true, resolved: false }] }]);
  return env;
}

test('reply task previews without copying, then copies the same validated text', async function() {
  var env = await setup({ deferredClipboard: true, settings: { ai_review_reply_prompt: 'Describe verified fixes in Spanish.' } });
  await env.click('aiReviewTaskReply');
  assert.equal(env.document.querySelector('.gl-review-description-toggle').hidden, true);
  assert.equal(env.document.querySelector('.gl-review-code-toggle').hidden, true);
  assert.equal(env.document.querySelector('.gl-review-task-prompt').value, 'Describe verified fixes in Spanish.');
  await env.click('aiReviewPreview');
  assert.equal(env.replyPrompts[0].options.prompt, 'Describe verified fixes in Spanish.');
  env.replyPrompts[0].resolve('Reply to verified feedback'); await env.drain();
  assert.equal(env.clipboard.length, 0);
  assert.equal(env.document.querySelector('.gl-review-preview-details').open, true);
  await env.click('aiReviewCopyTask');
  assert.equal(env.replyPrompts.length, 1);
  assert.deepEqual(env.clipboard, ['Reply to verified feedback']);
  assert.notEqual(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewCopied.message);
  env.clipboardRequests[0].resolve(); await env.drain();
  assert.equal(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewCopied.message);
  assert.equal(env.publications.length, 0);
});

test('reply clipboard failure opens and selects the actual text for manual copying', async function() {
  var env = await setup({ clipboardFailure: true });
  await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
  env.replyPrompts[0].resolve('Actual replies'); await env.drain();
  var preview = env.document.querySelector('.gl-review-preview');
  assert.equal(env.document.querySelector('.gl-review-preview-details').open, true);
  assert.equal(env.document.activeElement, preview);
  assert.equal(preview.selectionEnd, preview.value.length);
  assert.equal(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewManualCopy.message);
});

['cancel', 'navigate', 'close', 'switch'].forEach(function(action) {
  test(action + ' cancels pending reply generation and ignores late data', async function() {
    var env = await setup();
    await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
    var request = env.replyPrompts[0];
    if (action === 'navigate') await env.navigate('/team/repo/-/merge_requests/13');
    else await env.click(action === 'cancel' ? 'aiReviewCancel' : action === 'close' ? 'aiReviewClose' : 'aiReviewTaskReview');
    assert.equal(request.options.signal.aborted, true);
    request.resolve('Late replies'); await env.drain();
    assert.equal(env.clipboard.length, 0);
  });
});

test('reply failure permits retry and cannot claim copy success', async function() {
  var env = await setup();
  await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
  env.replyPrompts[0].reject(new Error('Selected discussions unavailable')); await env.drain();
  assert.match(env.document.querySelector('.gl-review-status').textContent, /Selected discussions unavailable/);
  assert.equal(env.button('aiReviewCopyTask').disabled, false);
  assert.equal(env.clipboard.length, 0);
  await env.click('aiReviewCopyTask'); assert.equal(env.replyPrompts.length, 2);
});

test('the reply task uses real selected-thread loading and the edited task prompt', async function() {
  var head = 'a'.repeat(40), thread = '1'.repeat(40), requests = [];
  var env = await setup({ realImport: true, settings: { ai_review_reply_prompt: 'Explain fixes in German.' }, fetch: async function(address, init) {
    requests.push(init.method);
    var path = new URL(address).pathname;
    var value;
    if (path.endsWith('/discussions')) value = [{ id: thread, notes: [{ id: 51, body: 'Handle empty input.', resolvable: true, resolved: false }] }];
    else if (path.endsWith('/merge_requests/12')) value = { iid: 12, sha: head, diff_refs: { head_sha: head, base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40) } };
    else throw new Error('Unexpected request: ' + address);
    return { ok: true, status: 200, redirected: false, text: async function() { return JSON.stringify(value); }, headers: { get: function() { return ''; } } };
  } });
  await env.click('aiReviewTaskReply');
  await env.change(env.document.querySelector('.gl-review-task-prompt'), 'Explain verified fixes in French.', 'input');
  await env.click('aiReviewCopyTask');
  assert.match(env.clipboard[0], /Explain verified fixes in French/);
  assert.ok(env.clipboard[0].includes(head)); assert.ok(env.clipboard[0].includes(thread));
  assert.ok(requests.every(function(method) { return method === 'GET'; }));
});

test('switching back to feedback cannot reuse the prepared replies', async function() {
  var env = await setup();
  await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
  env.replyPrompts[0].resolve('Only replies'); await env.drain();
  await env.click('aiReviewTaskFix'); await env.click('aiReviewCopyTask');
  assert.equal(env.exports.length, 1);
  assert.notEqual(env.clipboard[1], 'Only replies');
});

test('repeat-review action passes the chosen GitLab version and session filters, without changing saved filters', async function() {
  var env = await setup({ workflow: true, settings: { ai_review_file_filter: { ignoreDirs: 'dist' } } });
  var fields = env.document.querySelector('.gl-review-scope').querySelectorAll('textarea');
  assert.equal(fields[3].value, 'dist');
  await env.change(fields[0], 'js, ts', 'input');
  var request;
  env.api.prepareRepeatReview = function(context, options) { request = Object.assign(ui.deferred(), { context: context, options: options }); return request.promise; };
  await env.change(env.document.querySelector('.gl-review-repeat-options').querySelector('select'), 'd'.repeat(40));
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  assert.equal(request.context.iid, '12');
  assert.equal(request.options.baselineHead, 'd'.repeat(40));
  assert.equal(request.options.fileFilter.ignoreDirs, 'dist');
  assert.equal(request.options.fileFilter.includeExtensions, 'js, ts');
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  request.resolve({ text: 'Repeated review with explicit limits', warnings: ['Comparison incomplete'] });
  await env.drain();
  assert.deepEqual(env.clipboard, ['Repeated review with explicit limits']);
  assert.match(env.document.querySelector('.gl-review-warning').textContent, /Comparison incomplete/);
  assert.equal(env.settingsWrites.length, 0);
  await env.click('aiReviewTaskFix'); await env.click('aiReviewCopyTask');
  assert.equal(env.exports.length, 1, 'feedback copying does not reuse the repeat-review packet');
});
test('canceling repeat review prevents late copying and fresh review uses session file filters', async function() {
  var env = await setup({ workflow: true });
  var request = ui.deferred(), signal;
  env.api.prepareRepeatReview = function(context, options) { signal = options.signal; return request.promise; };
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  await env.click('aiReviewCancel');
  assert.equal(signal.aborted, true);
  request.resolve({ text: 'Late review' }); await env.drain();
  assert.equal(env.clipboard.length, 0);
  await env.change(env.document.querySelector('.gl-review-scope').querySelectorAll('textarea')[2], '*.lock', 'input');
  await env.click('aiReviewTaskReview'); await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports[0].options.fileFilter.ignoreFiles, '*.lock');
});

test('GitLab version loading never selects a review baseline or overwrites a manual SHA', async function() {
  var versions = ui.deferred(), versionOptions;
  var env = await setup({ workflow: true, loadVersions: function(context, options) { versionOptions = options; return versions.promise; } });
  assert.equal(versionOptions, undefined, 'versions load only when the repeat tab is opened');
  await env.click('aiReviewTaskRepeat');
  var select = env.document.querySelector('.gl-review-repeat-options').querySelector('select');
  assert.equal(select.value, '', 'full review is the default, not an inferred previously reviewed version');
  await env.change(select, 'manual');
  var input = env.document.querySelector('.gl-review-baseline-sha');
  assert.equal(input.hidden, false);
  var called = [];
  env.api.prepareRepeatReview = async function(context, options) { called.push(options); return { text: 'Repeat packet', warnings: [] }; };
  await env.change(input, 'bad', 'input'); await env.click('aiReviewCopyTask');
  assert.equal(called.length, 0);
  await env.change(input, 'e'.repeat(40), 'input');
  versions.resolve({ items: [{ id: '17', headSha: 'd'.repeat(40), createdAt: '2026-10-13T12:00:00Z' }], warnings: [] });
  await env.drain();
  assert.equal(select.value, 'manual');
  assert.equal(input.value, 'e'.repeat(40));
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  assert.equal(called[0].baselineHead, 'e'.repeat(40));
  assert.equal(env.settingsWrites.length, 0);
  await env.click('aiReviewClose');
  assert.equal(versionOptions.signal.aborted, true);
});
test('unavailable version listing still permits an explicit full repeat review', async function() {
  var env = await setup({ workflow: true, loadVersions: async function() { return { items: [], warnings: ['Versions unavailable: HTTP 404'] }; } });
  var selected;
  env.api.prepareRepeatReview = async function(context, options) { selected = options.baselineHead; return { text: 'Full current MR and discussions', warnings: [] }; };
  await env.click('aiReviewTaskRepeat');
  assert.match(env.document.querySelector('.gl-review-versions-hint').textContent, /HTTP 404/);
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  assert.equal(selected, '');
  assert.equal(env.clipboard[0], 'Full current MR and discussions');
});


test('code inclusion defaults off, invalidates an existing preview and reaches fresh and repeat exports', async function() {
  var env = await setup({ workflow: true });
  var toggle = env.document.querySelector('.gl-review-code-toggle').querySelector('input');
  assert.equal(toggle.checked, false);
  var repeatOptions;
  env.api.prepareRepeatReview = async function(context, options) { repeatOptions = options; return { text: 'Compact repeat', warnings: [] }; };
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  assert.equal(repeatOptions.includeCode, false);
  assert.equal(env.document.querySelector('.gl-review-preview').value, 'Compact repeat');
  await env.change(toggle, true);
  assert.equal(env.document.querySelector('.gl-review-preview').value, '');
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  assert.equal(repeatOptions.includeCode, true);
  await env.click('aiReviewTaskReview');
  await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports[0].options.includeCode, true);
  assert.equal(env.settingsWrites.length, 0);
});

test('reply and repeat buttons count selected threads, pass their IDs and respect an empty selection', async function() {
  var env = await setup({ workflow: true, pendingLoad: true });
  var first = '1'.repeat(40), second = '2'.repeat(40);
  await env.respond([
    { id: first, notes: [{ id: 1, body: 'First request', resolvable: true, resolved: false }, { id: 2, body: 'A reply' }] },
    { id: second, notes: [{ id: 3, body: 'Other reviewer request', resolvable: true, resolved: false }] }
  ]);
  await env.click('aiReviewTaskReply');
  assert.match(env.document.querySelector('.gl-review-task-summary').textContent, /replies: 2/);
  await env.change(env.document.querySelector('[data-review-note="1"]'), false);
  await env.change(env.document.querySelector('[data-review-note="3"]'), false);
  assert.match(env.document.querySelector('.gl-review-task-summary').textContent, /replies: 1/);
  await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
  assert.deepEqual(Array.from(env.replyPrompts[0].options.discussionIds), [first]);
  env.replyPrompts[0].resolve('Selected thread'); await env.drain();
  var calls = [];
  env.api.prepareRepeatReview = async function(context, options) { calls.push(options); return { text: 'Repeat selection', warnings: [] }; };
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  assert.deepEqual(Array.from(calls[0].discussionIds), [first]);
  await env.click('aiReviewClear');
  assert.match(env.document.querySelector('.gl-review-task-summary').textContent, /verify: 0/);
  await env.click('aiReviewTaskReply');
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
  assert.equal(env.replyPrompts.length, 1);
  await env.click('aiReviewTaskRepeat'); await env.click('aiReviewCopyTask');
  assert.deepEqual(Array.from(calls[1].discussionIds), []);
});

test('changing selection aborts reply generation and prevents copying an outdated scope', async function() {
  var env = await setup();
  await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
  var request = env.replyPrompts[0];
  await env.change(env.document.querySelector('[data-review-note="1"]'), false);
  assert.equal(request.options.signal.aborted, true);
  request.resolve('Reply to a now-unselected discussion'); await env.drain();
  assert.equal(env.clipboard.length, 0);
  assert.equal(env.document.querySelector('.gl-review-preview').value, '');
});

test('task tabs support arrow keys and expose one selected tab and one task panel', async function() {
  var env = await setup();
  var fix = env.button('aiReviewTaskFix');
  assert.equal(fix.tabIndex, 0);
  fix.dispatch('keydown', { key: 'ArrowRight', preventDefault: function() {} }); await env.drain();
  assert.equal(env.button('aiReviewTaskReply').getAttribute('aria-selected'), 'true');
  assert.equal(env.document.activeElement, env.button('aiReviewTaskReply'));
  assert.equal(env.document.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'), 'gl-review-tab-replies');
  assert.equal(env.document.querySelectorAll('[aria-selected="true"]').length, 1);
  env.button('aiReviewTaskReply').dispatch('keydown', { key: 'Home', preventDefault: function() {} }); await env.drain();
  assert.equal(env.button('aiReviewTaskReview').getAttribute('aria-selected'), 'true');
  assert.equal(env.document.querySelector('.gl-review-picker').hidden, true);
});

test('the import entry closes the task dialog without preparing, copying or publishing anything', async function() {
  var opened = [], env = await setup({ importUI: { close: function() {}, open: function(context) { opened.push(context); } } });
  await env.click('aiReviewPasteResult');
  assert.equal(env.document.querySelector('.gl-review-overlay'), null);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].iid, '12');
  assert.equal(env.exports.length + env.freshExports.length + env.replyPrompts.length + env.clipboard.length + env.publications.length, 0);
});

test('an invalid hidden file filter cannot block replies or feedback', async function() {
  var env = await setup({ workflow: true });
  await env.click('aiReviewTaskReview');
  await env.change(env.document.querySelector('.gl-review-scope').querySelector('textarea'), 'x'.repeat(1501), 'input');
  await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports.length, 0);
  await env.click('aiReviewTaskReply'); await env.click('aiReviewCopyTask');
  assert.equal(env.replyPrompts.length, 1);
  env.replyPrompts[0].resolve('Replies unaffected by file filters'); await env.drain();
  await env.click('aiReviewTaskFix'); await env.click('aiReviewCopyTask');
  assert.equal(env.exports.length, 1);
});

test('previewing a repeat task does not copy and passes the session prompt', async function() {
  var env = await setup({ workflow: true, settings: { ai_review_repeat_prompt: 'Check regressions carefully.' } });
  var calls = [];
  env.api.prepareRepeatReview = async function(context, options) { calls.push(options); return { text: 'Repeated review', warnings: [] }; };
  await env.click('aiReviewTaskRepeat');
  await env.change(env.document.querySelector('.gl-review-task-prompt'), 'Check regressions in Spanish.', 'input');
  await env.click('aiReviewPreview');
  assert.equal(calls[0].prompt, 'Check regressions in Spanish.');
  assert.equal(env.clipboard.length, 0);
  await env.click('aiReviewCopyTask'); assert.equal(calls.length, 1);
  assert.deepEqual(env.clipboard, ['Repeated review']);
});

test('switching tasks while an inline comment loads never auto-copies a different task', async function() {
  var env = await ui.create();
  var replies = [];
  env.context.window.GlReviewImport = { getReplyPrompt: function() { replies.push(true); return Promise.resolve('Unexpected reply'); } };
  var root = env.addNote(1); await env.drain();
  await env.click('aiReviewCopyComment', root);
  await env.click('aiReviewTaskReply');
  await env.respond([{ id: '1'.repeat(40), notes: [{ id: 1, body: 'Fix it', resolvable: true, resolved: false }] }]);
  assert.equal(env.clipboard.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(env.button('aiReviewCopyTask').disabled, false);
  await env.click('aiReviewCopyTask');
  assert.equal(replies.length, 1);
});
