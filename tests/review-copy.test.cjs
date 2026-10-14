'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var ui = require('./helpers/review-copy.cjs');
var plain = require('./helpers/extension.cjs').plain;

function note(id, body, extra) { return Object.assign({ id: id, body: body, author: { name: 'Reviewer', username: 'reviewer' } }, extra); }
function threads() {
  return [
    { id: 'open', notes: [note(1, 'Handle an empty input', { resolvable: true, resolved: false }), note(2, 'Use a guard before parsing', { resolvable: true, resolved: false })] },
    { id: 'done', notes: [note(3, 'Rename the parameter', { resolvable: true, resolved: true })] },
    { id: 'general', notes: [note(4, 'Document the return type')] },
    { id: 'system', notes: [note(5, 'changed title', { system: true })] }
  ];
}
function check(env, id) { return env.document.querySelector('[data-review-note="' + id + '"]'); }
function preview(env) { return env.document.querySelector('.gl-review-preview'); }
function generalToggle(env) { return env.document.querySelector('.gl-review-general-toggle').querySelector('input'); }
function descriptionToggle(env) { return env.document.querySelector('.gl-review-description-toggle').querySelector('input'); }
async function picker(options) {
  var env = await ui.create(options);
  await env.click('aiReviewOpen');
  await env.respond(threads());
  return env;
}

test('MR import and copy icons share the native row without duplicate controls or competing dialogs', async function() {
  var opened = [];
  var closed = 0;
  var env = await ui.create({ importUI: {
    open: function(context, options) { opened.push({ context: context, options: options }); },
    close: function() { closed++; }
  } });
  var header = env.document.createElement('div');
  header.className = 'detail-page-header';
  var actions = env.document.createElement('div');
  var edit = env.document.createElement('button');
  edit.setAttribute('data-testid', 'edit-title-button');
  var sidebar = env.document.createElement('button');
  sidebar.className = 'js-sidebar-toggle';
  actions.appendChild(edit);
  actions.appendChild(sidebar);
  header.appendChild(actions);
  env.document.body.appendChild(header);
  await env.drain();
  var copy = env.document.querySelector('.gl-review-launcher:not(.gl-review-import-launcher)');
  var importer = env.document.querySelector('.gl-review-import-launcher');
  assert.deepEqual(actions.children, [edit, importer, copy, sidebar]);
  assert.equal(importer.getAttribute('title'), require('../_locales/en/messages.json').aiReviewImportOpen.message);
  await env.click('aiReviewOpen');
  assert.ok(closed > 0);
  await env.click('aiReviewImportOpen');
  assert.equal(env.document.querySelector('.gl-review-overlay'), null);
  assert.equal(env.loads[0].options.signal.aborted, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].context.iid, '12');
  assert.equal(typeof opened[0].options.t, 'function');
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 2);
  var replacement = env.document.createElement('div');
  replacement.className = 'js-issuable-actions';
  actions.remove();
  header.appendChild(replacement);
  await env.drain();
  assert.equal(env.document.querySelector('.gl-review-import-launcher').parentElement, replacement);
  assert.equal(env.document.querySelector('.gl-review-launcher:not(.gl-review-import-launcher)').parentElement, replacement);
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 2);
});

test('import controls follow MR navigation and disappear on issues and when review controls are disabled', async function() {
  var closed = 0;
  var env = await ui.create({ importUI: { open: function() {}, close: function() { closed++; } } });
  assert.equal(env.document.querySelectorAll('.gl-review-import-launcher').length, 1);
  var before = closed;
  await env.navigate('/team/repo/-/issues/13');
  assert.ok(closed > before);
  assert.equal(env.document.querySelector('.gl-review-import-launcher'), null);
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 1);
  await env.navigate('/team/repo/-/merge_requests/14');
  assert.equal(env.document.querySelectorAll('.gl-review-import-launcher').length, 1);
  env.settingsEvents.forEach(function(fn) { fn({ show_ai_review_copy: { newValue: false } }, 'sync'); });
  await env.drain();
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 0);
});

['legacy', 'modern'].forEach(function(variant) {
  test('single-comment button copies only that request with other replies as context (' + variant + ')', async function() {
    var env = await ui.create();
    var root = env.addNote(2, variant);
    await env.drain();
    await env.click('aiReviewCopyComment', root);
    await env.respond(threads());
    assert.deepEqual(env.selected(), ['2']);
    assert.deepEqual(plain(env.exports[0].options.noteIds), ['2']);
    assert.deepEqual(plain(env.exports[0].options.discussionIds), []);
    assert.equal(env.exports[0].options.includeDescription, false);
    assert.equal(env.clipboard.length, 1);
    assert.match(env.clipboard[0], /Comment 1 — CONTEXT ONLY/);
    assert.match(env.clipboard[0], /Comment 2 — REQUESTED/);
    assert.doesNotMatch(env.clipboard[0], /Comment 3|Comment 4/);
    assert.equal(env.document.querySelector('.gl-review-replies').open, true);
  });
});

test('discussion action in the picker requests the full thread and leaves unrelated discussions out', async function() {
  var env = await ui.create();
  var root = env.addNote(2);
  await env.drain();
  assert.equal(root.querySelectorAll('button').length, 1);
  await env.click('aiReviewCopyComment', root);
  await env.respond(threads());
  assert.equal(env.button('aiReviewSelectThread').hidden, false);
  await env.click('aiReviewSelectThread');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(env.selected(), ['1', '2']);
  assert.deepEqual(plain(env.exports[1].options.discussionIds), ['open']);
  assert.match(env.clipboard[1], /Comment 1 — REQUESTED/);
  assert.match(env.clipboard[1], /Comment 2 — REQUESTED/);
  assert.doesNotMatch(env.clipboard[1], /Comment 3/);
});

['detail-page-header-actions', 'js-issuable-actions'].forEach(function(actionClass) {
test('review launcher joins the native action row even when it mounts after the header: ' + actionClass, async function() {
  var env = await ui.create();
  var header = env.document.createElement('div');
  header.className = 'detail-page-header';
  env.document.body.appendChild(header);
  await env.drain();
  var launcher = env.document.querySelector('.gl-review-launcher');
  assert.equal(launcher.parentElement, header);
  var actions = env.document.createElement('div');
  actions.className = actionClass;
  var edit = env.document.createElement('button');
  edit.textContent = 'Edit';
  actions.appendChild(edit);
  header.appendChild(actions);
  await env.drain();
  assert.equal(launcher.parentElement, actions, 'share the native buttons alignment context');
  assert.equal(actions.children[0], edit);
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 1);
  assert.equal(launcher.matches('.gl-review-floating'), false);
  assert.equal(launcher.matches('.gl-review-in-actions'), true);
  await env.click('aiReviewOpen');
  await env.respond(threads());
  assert.ok(env.document.querySelector('.gl-review-overlay'));
});

test('review launcher is restored inside a replaced action row without duplicating controls: ' + actionClass, async function() {
  var env = await ui.create();
  var header = env.document.createElement('div');
  header.className = 'detail-page-header';
  var actions = env.document.createElement('div');
  actions.className = actionClass;
  header.appendChild(actions);
  env.document.body.appendChild(header);
  await env.drain();
  var replacement = env.document.createElement('div');
  replacement.className = actionClass;
  header.replaceChildren(replacement);
  await env.drain();
  assert.equal(env.document.querySelector('.gl-review-launcher').parentElement, replacement);
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 1);
});
});

test('compact header uses the native button row and keeps copying before the sidebar toggle', async function() {
  var env = await ui.create();
  var header = env.document.createElement('div');
  header.className = 'detail-page-header';
  var actions = env.document.createElement('div');
  var edit = env.document.createElement('button');
  edit.setAttribute('data-testid', 'edit-title-button');
  actions.appendChild(edit);
  header.appendChild(actions);
  env.document.body.appendChild(header);
  await env.drain();
  var launcher = env.document.querySelector('.gl-review-launcher');
  assert.equal(launcher.tagName, 'BUTTON', 'the icon button participates directly in native layout');
  assert.equal(launcher.parentElement, actions, 'recognize native controls even without a known toolbar class');
  var sidebar = env.document.createElement('button');
  sidebar.className = 'js-sidebar-toggle';
  actions.insertBefore(sidebar, launcher);
  await env.drain();
  assert.deepEqual(actions.children, [edit, launcher, sidebar]);
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 1);
  sidebar.remove();
  await env.drain();
  assert.deepEqual(actions.children, [edit, launcher], 'wide layout keeps the same control in the action row');
});

test('MR picker defaults to unresolved discussions only, with description and saved prompt', async function() {
  var env = await picker({ settings: { ai_review_prompt: 'Fix only verified review findings.' } });
  assert.equal(env.document.querySelector('select').value, 'unresolved');
  assert.equal(env.document.querySelector('.gl-review-general-toggle').hidden, false);
  assert.equal(generalToggle(env).checked, false);
  assert.equal(check(env, '4'), null, 'general comments are hidden until explicitly included');
  assert.deepEqual(env.selected(), ['1', '2']);
  assert.equal(env.exports.length, 0, 'opening the overall picker does not export automatically');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['open']);
  assert.equal(env.exports[0].options.includeDescription, true);
  assert.ok(env.clipboard[0].startsWith('Fix only verified review findings.'));
  assert.match(env.clipboard[0], /Expected behavior/);
  assert.doesNotMatch(env.clipboard[0], /changed title|Rename the parameter|Document the return type/);
});

[true, false].forEach(function(saved) {
  test('saved description preference applies to overall and inline copies (' + saved + ')', async function() {
    var env = await picker({ settings: { ai_review_include_description: saved } });
    assert.equal(descriptionToggle(env).checked, saved);
    await env.click('aiReviewCopyTask');
    assert.equal(env.exports[0].options.includeDescription, saved);
    assert.equal(env.clipboard[0].includes('Expected behavior'), saved);
    await env.click('aiReviewClose');
    var root = env.addNote(2);
    await env.drain();
    await env.click('aiReviewCopyComment', root);
    await env.respond(threads());
    assert.equal(descriptionToggle(env).checked, saved);
    assert.equal(env.exports[1].options.includeDescription, saved);
    assert.equal(env.clipboard[1].includes('Expected behavior'), saved);
    assert.deepEqual(env.settingsWrites, [], 'opening and copying do not overwrite the preference');
  });
});

test('description changes persist both ways without closing the picker and survive reopening', async function() {
  var env = await picker();
  var dialog = env.document.querySelector('.gl-review-overlay');
  await env.change(check(env, '1'), false);
  await env.click('aiReviewPreview');
  assert.match(preview(env).value, /Expected behavior/);
  await env.change(descriptionToggle(env), false);
  assert.equal(env.document.querySelector('.gl-review-overlay'), dialog, 'the storage event from saving must not close the picker');
  assert.deepEqual(env.selected(), ['2']);
  assert.equal(preview(env).value, '');
  assert.deepEqual(env.settingsWrites, [{ ai_review_include_description: false }]);
  assert.equal(env.settings.ai_review_include_description, false);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[1].options.includeDescription, false);
  await env.click('aiReviewClose');
  await env.click('aiReviewOpen');
  await env.respond(threads());
  assert.equal(descriptionToggle(env).checked, false);
  await env.change(descriptionToggle(env), true);
  assert.deepEqual(env.settingsWrites, [{ ai_review_include_description: false }, { ai_review_include_description: true }]);
  await env.click('aiReviewClose');
  var root = env.addNote(2);
  await env.drain();
  await env.click('aiReviewCopyComment', root);
  await env.respond(threads());
  assert.equal(descriptionToggle(env).checked, true);
  assert.equal(env.exports[2].options.includeDescription, true);
  var reloaded = await picker({ settings: env.settings });
  assert.equal(descriptionToggle(reloaded).checked, true, 'the persisted value survives a fresh page');
});

test('copy all keeps description disabled while including all human discussions', async function() {
  var env = await picker({ settings: { ai_review_include_description: false } });
  await env.click('aiReviewSelectAll');
  await env.click('aiReviewCopyTask');
  assert.equal(descriptionToggle(env).checked, false);
  assert.equal(env.exports[0].options.includeDescription, false);
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['open', 'done', 'general']);
  assert.doesNotMatch(env.clipboard[0], /Expected behavior/);
  assert.deepEqual(env.settingsWrites, []);
});

test('description preference changes from another page affect the next opening without changing an active export', async function() {
  var env = await picker({ settings: { ai_review_include_description: true } });
  var dialog = env.document.querySelector('.gl-review-overlay');
  await env.change(check(env, '1'), false);
  await env.change(env.document.querySelector('.gl-review-prompt'), 'Preserve my current edits', 'input');
  await env.click('aiReviewPreview');
  var prepared = preview(env).value;
  env.settingsEvents.forEach(function(fn) { fn({ ai_review_include_description: { oldValue: true, newValue: false } }, 'sync'); });
  await env.drain();
  assert.equal(env.document.querySelector('.gl-review-overlay'), dialog);
  assert.equal(descriptionToggle(env).checked, true);
  assert.deepEqual(env.selected(), ['2']);
  assert.equal(env.document.querySelector('.gl-review-prompt').value, 'Preserve my current edits');
  assert.equal(preview(env).value, prepared);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports.length, 1, 'the prepared export remains valid');
  assert.equal(env.clipboard[0], prepared);
  await env.click('aiReviewClose');
  await env.click('aiReviewOpen');
  await env.respond(threads());
  assert.equal(descriptionToggle(env).checked, false);
});

test('failed description preference saves keep the current choice usable and report the failure', async function() {
  var env = await picker({ storageFailure: true });
  var dialog = env.document.querySelector('.gl-review-overlay');
  await env.change(descriptionToggle(env), false);
  assert.equal(env.document.querySelector('.gl-review-overlay'), dialog);
  assert.equal(descriptionToggle(env).checked, false);
  assert.deepEqual(env.settingsWrites, [{ ai_review_include_description: false }]);
  assert.equal(env.settings.ai_review_include_description, undefined);
  assert.equal(env.document.querySelector('.gl-review-status').textContent, require('../_locales/en/messages.json').settingsSaveFailed.message);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[0].options.includeDescription, false);
  assert.doesNotMatch(env.clipboard[0], /Expected behavior/);
});

test('general comments are opt-in and turning them off removes hidden selections and the prepared preview', async function() {
  var env = await picker();
  await env.change(generalToggle(env), true);
  assert.deepEqual(env.selected(), ['1', '2', '4']);
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['open', 'general']);
  assert.match(env.clipboard[0], /Comment 4 — REQUESTED/);
  await env.change(env.document.querySelector('input'), 'empty input', 'input');
  assert.equal(check(env, '4'), null, 'search hides a general comment that remains selected');
  await env.change(generalToggle(env), false);
  assert.equal(preview(env).value, '');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[1].options.discussionIds), ['open']);
  assert.deepEqual(plain(env.exports[1].options.noteIds), []);
  assert.doesNotMatch(env.clipboard[1], /Document the return type/);
});

test('the general-comments checkbox is only visible for unresolved and resets when leaving that filter', async function() {
  var env = await picker();
  var filter = env.document.querySelector('select');
  var wrapper = env.document.querySelector('.gl-review-general-toggle');
  for (var value of ['all', 'resolved', 'general']) {
    await env.change(generalToggle(env), true);
    assert.deepEqual(env.selected(), ['1', '2', '4']);
    await env.change(filter, value);
    assert.equal(wrapper.hidden, true, value + ' hides the extra option');
    assert.equal(generalToggle(env).checked, false, value + ' resets the extra option');
    await env.change(filter, 'unresolved');
    assert.equal(wrapper.hidden, false);
    assert.equal(generalToggle(env).checked, false);
    assert.deepEqual(env.selected(), ['1', '2']);
    await env.click('aiReviewCopyTask');
    assert.deepEqual(plain(env.exports[env.exports.length - 1].options.discussionIds), ['open']);
  }
});

test('including general comments preserves manual unresolved choices and only adds search matches', async function() {
  var env = await picker();
  await env.change(check(env, '1'), false);
  await env.change(generalToggle(env), true);
  assert.deepEqual(env.selected(), ['2', '4']);
  await env.change(generalToggle(env), false);
  assert.deepEqual(env.selected(), ['2']);
  await env.change(env.document.querySelector('input'), 'empty input', 'input');
  await env.change(generalToggle(env), true);
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), []);
  assert.deepEqual(plain(env.exports[0].options.noteIds), ['2']);
  assert.doesNotMatch(env.clipboard[0], /Document the return type/);
});

test('changing status replaces all previous choices and clears the prepared export', async function() {
  var env = await picker();
  var filter = env.document.querySelector('select');
  await env.click('aiReviewSelectShown');
  await env.click('aiReviewPreview');
  assert.match(preview(env).value, /Comment 1|Comment 3|Comment 4/);
  var expected = { resolved: ['done'], general: ['general'], unresolved: ['open'], all: ['open', 'done', 'general'] };
  for (var value of Object.keys(expected)) {
    await env.change(filter, value);
    assert.equal(preview(env).value, '');
    await env.click('aiReviewCopyTask');
    var exported = env.exports[env.exports.length - 1];
    assert.deepEqual(plain(exported.options.discussionIds), expected[value]);
    assert.deepEqual(plain(exported.options.noteIds), []);
  }
  assert.doesNotMatch(env.clipboard[0], /Handle an empty input|Document the return type/);
});

test('status changes respect search and leave no hidden choices when no discussions match', async function() {
  var env = await picker();
  var filter = env.document.querySelector('select');
  await env.change(env.document.querySelector('input'), 'empty input', 'input');
  await env.change(filter, 'unresolved');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['open']);
  await env.change(filter, 'resolved');
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports.length, 1, 'zero selections no longer produce a description-only feedback task');
  assert.equal(env.freshExports.length, 0);
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  assert.equal(env.clipboard.length, 1);
});

test('search preserves manual choices while select shown adds matches; copy all includes resolved', async function() {
  var env = await picker();
  await env.change(env.document.querySelector('select'), 'all');
  await env.click('aiReviewClear');
  var search = env.document.querySelector('input');
  await env.change(search, 'Rename the parameter', 'input');
  await env.click('aiReviewSelectShown');
  await env.change(search, 'empty input', 'input');
  await env.click('aiReviewSelectShown');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['open', 'done']);
  assert.doesNotMatch(env.clipboard[0], /Document the return type/);
  await env.click('aiReviewSelectAll');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[1].options.discussionIds), ['open', 'done', 'general']);
  assert.match(env.clipboard[1], /Comment 3 — REQUESTED/);
  assert.match(env.clipboard[1], /Comment 4 — REQUESTED/);
});

test('missing clicked comment never substitutes all discussions or auto-exports', async function() {
  var env = await ui.create();
  var root = env.addNote(999);
  await env.drain();
  await env.click('aiReviewCopyComment', root);
  await env.respond(threads());
  assert.deepEqual(env.selected(), []);
  assert.equal(env.exports.length, 0);
  assert.equal(env.clipboard.length, 0);
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  assert.equal(env.button('aiReviewRetry').hidden, false);
  assert.match(env.document.querySelector('.gl-review-status').textContent, /999/);
});

test('editing selection or prompt invalidates the prepared preview before the next copy', async function() {
  var env = await picker();
  await env.click('aiReviewPreview');
  assert.match(preview(env).value, /Comment 1 — REQUESTED/);
  assert.equal(env.clipboard.length, 0);
  await env.change(check(env, '1'), false);
  assert.equal(preview(env).value, '');
  await env.click('aiReviewCopyTask');
  assert.match(env.clipboard[0], /Comment 1 — CONTEXT ONLY/);
  await env.change(env.document.querySelector('.gl-review-prompt'), 'Updated instruction', 'input');
  assert.equal(preview(env).value, '');
  await env.click('aiReviewCopyTask');
  assert.ok(env.clipboard[1].startsWith('Updated instruction'));
});

test('refresh preserves selected IDs and edited options while excluding new comments', async function() {
  var env = await picker();
  await env.click('aiReviewClear');
  await env.change(check(env, '2'), true);
  await env.change(env.document.querySelector('.gl-review-prompt'), 'Custom export instruction', 'input');
  await env.change(env.document.querySelector('.gl-review-description-toggle').querySelector('input'), false);
  await env.click('aiReviewRefresh');
  var fresh = threads();
  fresh[0].notes.push(note(6, 'New review comment'));
  await env.respond(fresh);
  assert.deepEqual(env.selected(), ['2']);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[0].options.includeDescription, false);
  assert.equal(env.exports[0].options.prompt, 'Custom export instruction');
  assert.deepEqual(plain(env.exports[0].options.noteIds), ['2']);
});

test('refresh updates the default selection to current unresolved discussions and excludes general comments', async function() {
  var env = await picker();
  await env.change(env.document.querySelector('.gl-review-prompt'), 'Keep my custom prompt', 'input');
  await env.click('aiReviewRefresh');
  var fresh = threads();
  fresh[0].notes.forEach(function(note) { note.resolved = true; });
  fresh[1].notes[0].resolved = false;
  fresh.push({ id: 'new-review', notes: [note(6, 'Handle a timeout', { resolvable: true, resolved: false })] });
  fresh.push({ id: 'new-general', individual_note: true, notes: [note(7, 'A new ordinary MR comment', { type: null, resolvable: false })] });
  await env.respond(fresh);
  assert.deepEqual(env.selected(), ['3', '6']);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[0].options.prompt, 'Keep my custom prompt');
  assert.doesNotMatch(env.clipboard[0], /Handle an empty input/);
  assert.doesNotMatch(env.clipboard[0], /Document the return type|A new ordinary MR comment/);
});

test('refresh follows current unresolved and general comments after opting in without manual selection changes', async function() {
  var env = await picker();
  await env.change(generalToggle(env), true);
  await env.click('aiReviewRefresh');
  assert.equal(generalToggle(env).disabled, true);
  var fresh = threads();
  fresh[0].notes.forEach(function(comment) { comment.resolved = true; });
  fresh[1].notes[0].resolved = false;
  fresh.push({ id: 'new-general', notes: [note(6, 'A new ordinary MR comment')] });
  fresh.push({ id: 'new-open', notes: [note(7, 'Handle the timeout', { resolvable: true, resolved: false })] });
  await env.respond(fresh);
  assert.equal(generalToggle(env).disabled, false);
  assert.equal(generalToggle(env).checked, true);
  assert.deepEqual(env.selected(), ['3', '4', '6', '7']);
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['done', 'general', 'new-general', 'new-open']);
});

test('refresh preserves manually selected IDs with general comments enabled and drops newly resolved ones', async function() {
  var env = await picker();
  await env.change(check(env, '1'), false);
  await env.change(generalToggle(env), true);
  await env.click('aiReviewRefresh');
  var fresh = threads();
  fresh[2].notes[0].resolvable = true;
  fresh[2].notes[0].resolved = true;
  fresh.push({ id: 'new-general', notes: [note(6, 'A new ordinary MR comment')] });
  await env.respond(fresh);
  assert.deepEqual(env.selected(), ['2']);
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), []);
  assert.deepEqual(plain(env.exports[0].options.noteIds), ['2']);
  assert.doesNotMatch(env.clipboard[0], /Document the return type|A new ordinary MR comment/);
});

test('refresh drops selections that no longer match the status and disables the filter during loading', async function() {
  var env = await ui.create();
  await env.click('aiReviewOpen');
  var filter = env.document.querySelector('select');
  assert.equal(filter.disabled, true);
  var initial = threads();
  initial.push({ id: 'still-done', notes: [note(6, 'Another resolved comment', { resolvable: true, resolved: true })] });
  await env.respond(initial);
  assert.equal(filter.disabled, false);
  await env.change(filter, 'resolved');
  await env.click('aiReviewRefresh');
  assert.equal(filter.disabled, true);
  var fresh = threads();
  fresh[1].notes[0].resolved = false;
  fresh.push(initial[initial.length - 1]);
  await env.respond(fresh);
  assert.equal(filter.disabled, false);
  assert.deepEqual(env.selected(), ['6']);
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['still-done']);
  assert.doesNotMatch(env.clipboard[0], /Rename the parameter/);
});

test('ordinary MR comment missing from discussions is copied through its exact note endpoint', async function() {
  var requests = [];
  var env = await ui.create({ realLoad: true, fetch: async function(url) {
    requests.push(url);
    var path = new URL(url).pathname;
    var body;
    if (path.endsWith('/discussions')) body = [];
    else if (path.endsWith('/notes/41')) body = note(41, 'Please handle the error for the whole MR.', { type: null, resolvable: false });
    else body = { iid: 12, title: 'MR with ordinary comments', description: 'MR description' };
    return { ok: true, status: 200, headers: { get: function(name) { return name === 'X-Next-Page' ? '' : null; } }, text: async function() { return JSON.stringify(body); } };
  } });
  var root = env.addNote(41);
  await env.drain();
  await env.click('aiReviewCopyComment', root);
  assert.equal(env.loads[0].options.noteId, '41');
  assert.ok(requests.some(function(url) { return url.endsWith('/notes/41'); }));
  assert.deepEqual(env.selected(), ['41']);
  assert.equal(env.button('aiReviewSelectThread').hidden, true);
  assert.equal(env.button('aiReviewRetry').hidden, true);
  assert.equal(env.clipboard.length, 1);
  assert.match(env.clipboard[0], /Please handle the error for the whole MR/);
  assert.match(env.clipboard[0], /Comment 41 — REQUESTED/);
});

['close', 'navigate'].forEach(function(action) {
  test('delayed load after ' + action + ' cannot reopen a picker or copy', async function() {
    var env = await ui.create();
    var root = env.addNote(1);
    await env.drain();
    await env.click('aiReviewCopyComment', root);
    if (action === 'close') await env.click('aiReviewClose');
    else await env.navigate('/team/repo/-/issues/13');
    assert.equal(env.loads[0].options.signal.aborted, true);
    await env.respond(threads(), 0);
    assert.equal(env.document.querySelector('.gl-review-overlay'), null);
    assert.equal(env.exports.length, 0);
    assert.equal(env.clipboard.length, 0);
  });
  test('delayed export after ' + action + ' cannot write clipboard', async function() {
    var env = await picker({ deferredExports: true });
    await env.click('aiReviewCopyTask');
    if (action === 'close') await env.click('aiReviewClose');
    else await env.navigate('/team/repo/-/merge_requests/13');
    assert.equal(env.exports[0].options.signal.aborted, true);
    env.exports[0].resolve({ text: 'stale export', warnings: [] });
    await env.drain();
    assert.equal(env.clipboard.length, 0);
    assert.equal(env.document.querySelector('.gl-review-overlay'), null);
  });
});

test('selection changes cancel in-flight preparation and ignore a late result', async function() {
  var env = await picker({ deferredExports: true });
  await env.click('aiReviewCopyTask');
  await env.change(check(env, '1'), false);
  assert.equal(env.exports[0].options.signal.aborted, true);
  env.exports[0].resolve({ text: 'stale selection', warnings: [] });
  await env.drain();
  assert.equal(env.clipboard.length, 0);
  assert.equal(preview(env).value, '');
  await env.click('aiReviewCopyTask');
  env.exports[1].resolve({ text: 'current selection', warnings: [] });
  await env.drain();
  assert.deepEqual(env.clipboard, ['current selection']);
});

test('status changes cancel in-flight copying so old selections cannot reach the clipboard', async function() {
  var env = await picker({ deferredExports: true });
  await env.click('aiReviewSelectShown');
  await env.click('aiReviewCopyTask');
  await env.change(env.document.querySelector('select'), 'resolved');
  assert.equal(env.exports[0].options.signal.aborted, true);
  env.exports[0].resolve({ text: 'stale all-comments export', warnings: [] });
  await env.drain();
  assert.equal(env.clipboard.length, 0);
  assert.equal(preview(env).value, '');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[1].options.discussionIds), ['done']);
  env.exports[1].resolve({ text: 'resolved comments only', warnings: [] });
  await env.drain();
  assert.deepEqual(env.clipboard, ['resolved comments only']);
});

test('changing the general-comments option cancels a pending export and ignores its late result', async function() {
  var env = await picker({ deferredExports: true });
  await env.change(generalToggle(env), true);
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[0].options.discussionIds), ['open', 'general']);
  await env.change(generalToggle(env), false);
  assert.equal(env.exports[0].options.signal.aborted, true);
  env.exports[0].resolve({ text: 'stale export with general comments', warnings: [] });
  await env.drain();
  assert.equal(env.clipboard.length, 0);
  assert.equal(preview(env).value, '');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[1].options.discussionIds), ['open']);
  env.exports[1].resolve({ text: 'unresolved only', warnings: [] });
  await env.drain();
  assert.deepEqual(env.clipboard, ['unresolved only']);
});

test('repeated mounting on work-item wrappers injects exactly one icon per note', async function() {
  var env = await ui.create({ pathname: '/team/repo/-/work_items/12' });
  var wrapper = env.document.createElement('div');
  wrapper.setAttribute('data-note-id', '1');
  env.document.body.appendChild(wrapper);
  var first = env.addNote(1, 'modern', wrapper);
  var duplicate = env.document.createElement('div');
  duplicate.setAttribute('data-note-id', '1');
  first.appendChild(duplicate);
  var second = env.addNote(2, 'modern', wrapper);
  await env.drain();
  env.document.dispatch('turbo:load');
  await env.drain();
  assert.equal(wrapper.querySelectorAll('.gl-review-inline').length, 2);
  assert.equal(first.querySelectorAll('.gl-review-inline').length, 1);
  assert.equal(second.querySelectorAll('.gl-review-inline').length, 1);
  assert.equal(first.querySelectorAll('button').length, 1);
  assert.equal(second.querySelectorAll('button').length, 1);
  assert.equal(first.querySelector('button').getAttribute('title'), first.querySelector('button').getAttribute('aria-label'));
  assert.equal(first.querySelector('button').textContent, '');
  assert.equal(duplicate.querySelectorAll('.gl-review-inline').length, 0);
  assert.equal(env.document.querySelectorAll('.gl-review-launcher').length, 1);
  await env.click('aiReviewCopyComment', second);
  assert.equal(env.loads[0].context.kind, 'issues');
  await env.respond(threads());
  assert.deepEqual(env.selected(), ['2']);
});

test('clipboard denial leaves an accurate, selected preview for manual copying', async function() {
  var env = await picker({ clipboardFailure: true });
  await env.click('aiReviewCopyTask');
  var output = preview(env);
  assert.ok(output.value.length > 0);
  assert.equal(env.document.activeElement, output);
  assert.equal(output.selectionStart, 0);
  assert.equal(output.selectionEnd, output.value.length);
  assert.equal(env.manualCopies.length, 1);
  assert.equal(env.manualCopies[0].value, env.clipboard[0]);
  assert.match(env.document.querySelector('.gl-review-status').textContent, /copy it manually/);
});

test('disabling the feature removes inline controls and closes the picker', async function() {
  var env = await picker();
  env.addNote(1);
  await env.drain();
  env.settingsEvents[0]({ show_ai_review_copy: { newValue: false } }, 'sync');
  await env.drain();
  assert.equal(env.document.querySelectorAll('.gl-review-launcher, .gl-review-inline, .gl-review-overlay').length, 0);
});

test('a late clipboard rejection cannot fall back to copying an invalidated preview', async function() {
  var env = await picker({ deferredClipboard: true });
  await env.click('aiReviewCopyTask');
  await env.change(check(env, '1'), false);
  assert.equal(preview(env).value, '');
  env.clipboardRequests[0].reject(new Error('Clipboard permission denied'));
  await env.drain();
  assert.equal(env.manualCopies.length, 0, 'do not copy an empty or stale preview after selection changes');
});

test('a failed initial load can be retried and an empty issue supports a description-only export', async function() {
  var env = await ui.create({ pathname: '/team/repo/-/issues/12' });
  await env.click('aiReviewOpen');
  env.loads[0].reject(new Error('Connection lost'));
  await env.drain();
  assert.equal(env.button('aiReviewRetry').hidden, false);
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  await env.click('aiReviewRetry');
  await env.respond([]);
  assert.deepEqual(env.selected(), []);
  assert.equal(env.button('aiReviewCopyTask').disabled, false);
  await env.click('aiReviewCopyTask');
  assert.match(env.clipboard[0], /description-only export/);
  assert.match(env.clipboard[0], /Expected behavior/);
});

[
  'gon.relative_url_root = "/tools/gitlab";',
  'window.gon = {"relative_url_root":"/tools\\/gitlab"};'
].forEach(function(pageScript) {
  test('inline relative URL root preserves nested project paths through real API loading: ' + pageScript, async function() {
    var requests = [];
    var env = await ui.create({
      pathname: '/tools/gitlab/engineering/platform/repo/-/merge_requests/12',
      pageScript: pageScript,
      realLoad: true,
      fetch: async function(url, init) {
        requests.push({ url: url, init: init });
        var body = url.includes('/discussions?') ? [] : { iid: 12, title: 'Nested deployment', description: 'Details' };
        return { ok: true, status: 200, headers: { get: function(name) { return name === 'X-Next-Page' ? '' : null; } }, text: async function() { return JSON.stringify(body); } };
      }
    });
    await env.click('aiReviewOpen');
    assert.equal(env.loads[0].context.projectPath, 'engineering/platform/repo');
    assert.equal(env.loads[0].context.apiRoot, 'https://gitlab.test/tools/gitlab/api/v4');
    assert.equal(env.loads[0].context.webUrl, 'https://gitlab.test/tools/gitlab/engineering/platform/repo/-/merge_requests/12');
    assert.equal(requests.length, 2);
    requests.forEach(function(request) {
      assert.ok(request.url.startsWith('https://gitlab.test/tools/gitlab/api/v4/projects/engineering%2Fplatform%2Frepo/merge_requests/12'));
      assert.equal(request.init.method, 'GET');
      assert.equal(request.init.credentials, 'same-origin');
    });
    assert.equal(env.button('aiReviewCopyTask').disabled, true);
    await env.click('aiReviewTaskReview');
    assert.equal(env.button('aiReviewCopyTask').disabled, false);
    await env.click('aiReviewCopyTask');
    assert.equal(env.freshExports[0].context.projectPath, 'engineering/platform/repo');
    assert.equal(env.freshExports[0].context.apiRoot, 'https://gitlab.test/tools/gitlab/api/v4');
    assert.match(env.clipboard[0], /https:\/\/gitlab.test\/tools\/gitlab\/engineering\/platform\/repo\/-\/merge_requests\/12/);
  });
});

test('comments inside system-note ancestors never receive copy controls', async function() {
  var env = await ui.create();
  ['class', 'attribute'].forEach(function(kind, index) {
    var wrapper = env.document.createElement('div');
    if (kind === 'class') wrapper.className = 'system-note';
    else wrapper.setAttribute('data-system-note', 'true');
    env.document.body.appendChild(wrapper);
    env.addNote(index + 1, 'modern', wrapper);
  });
  var human = env.addNote(3, 'modern');
  await env.drain();
  assert.equal(env.document.querySelectorAll('.gl-review-inline').length, 1);
  assert.equal(human.querySelectorAll('.gl-review-inline').length, 1);
});

test('replacing a note header or whole note with the same ID restores exactly one icon', async function() {
  var env = await ui.create();
  var root = env.addNote(2, 'modern');
  await env.drain();
  var replacementHeader = env.document.createElement('div');
  replacementHeader.setAttribute('data-testid', 'note-header');
  root.replaceChildren(replacementHeader);
  await env.drain();
  assert.equal(root.querySelectorAll('.gl-review-inline').length, 1);
  root.remove();
  var replacementNote = env.addNote(2, 'modern');
  await env.drain();
  assert.equal(env.document.querySelectorAll('.gl-review-inline').length, 1);
  await env.click('aiReviewCopyComment', replacementNote);
  await env.respond(threads());
  assert.deepEqual(env.selected(), ['2']);
  assert.equal(env.clipboard.length, 1);
});

['legacy', 'modern', 'attribute'].forEach(function(variant) {
  test('an existing inline icon follows a changed note ID without a rerender (' + variant + ')', async function() {
    var env = await ui.create();
    var root = env.addNote(999, variant);
    if (variant === 'attribute') {
      root.id = '';
      root.setAttribute('data-note-id', '999');
    }
    await env.drain();
    var icon = env.button('aiReviewCopyComment', root);
    if (variant === 'attribute') root.setAttribute('data-note-id', '4');
    else root.id = (variant === 'legacy' ? 'note-' : 'note_') + '4';
    // A click can arrive before the debounced observer has mounted again.
    icon.click();
    await env.drain();
    await env.respond(threads());
    assert.deepEqual(env.selected(), ['4']);
    assert.equal(env.clipboard.length, 1);
    assert.match(env.clipboard[0], /Document the return type/);
    assert.equal(env.button('aiReviewCopyComment', root), icon);
    assert.equal(root.querySelectorAll('.gl-review-inline').length, 1);
  });
});

test('an inline icon never requests its old ID after the note becomes a temporary placeholder', async function() {
  var env = await ui.create();
  var root = env.addNote(999, 'modern');
  await env.drain();
  var icon = env.button('aiReviewCopyComment', root);
  root.id = 'note_pending';
  root.setAttribute('data-note-id', 'pending');
  icon.click();
  await env.drain();
  assert.equal(env.loads.length, 0);
  assert.equal(env.document.querySelector('.gl-review-overlay'), null);
  root.id = 'note_4';
  root.setAttribute('data-note-id', '4');
  await env.drain();
  assert.equal(root.querySelectorAll('.gl-review-inline').length, 1);
  await env.click('aiReviewCopyComment', root);
  await env.respond(threads());
  assert.deepEqual(env.selected(), ['4']);
  assert.equal(env.clipboard.length, 1);
});

function addDraft(env, marker, anchor, parent) {
  var root = env.addNote(20970, 'modern', parent);
  root.id = anchor || 'note_20970';
  root.setAttribute('data-note-id', '20970');
  if (marker === 'testid') root.setAttribute('data-testid', 'draft-note');
  else if (marker) root.className = marker;
  var body = env.document.createElement('div');
  body.className = 'note-body';
  var text = env.document.createElement('div');
  text.className = 'note-text';
  text.textContent = 'Rendered draft feedback';
  body.appendChild(text);
  root.appendChild(body);
  return root;
}

function draftFetcher(requests, status) {
  return async function(url) {
    requests.push(url);
    var path = new URL(url).pathname;
    var body;
    var code = 200;
    if (path.endsWith('/discussions')) body = [{ id: 'published', notes: [note(20970, 'Unrelated published comment')] }];
    else if (path.endsWith('/draft_notes/20970')) {
      body = { id: 20970, note: 'Saved **draft** feedback' };
      code = status || 200;
    } else {
      assert.ok(!path.includes('/notes/'), 'drafts must not use the published-note endpoint');
      body = { iid: 12, title: 'MR with pending review' };
    }
    return { ok: code === 200, status: code, headers: { get: function(name) { return name === 'X-Next-Page' ? '' : null; } }, text: async function() { return JSON.stringify(body); } };
  };
}

[
  ['draft-note', 'note_20970'],
  ['draft-note-component', 'note-20970'],
  ['draft-notes', 'note_20970'],
  ['testid', 'note_20970'],
  [null, 'draft_20970']
].forEach(function(variant) {
  test('Add to review copies the exact draft through its separate API: ' + variant.join('/'), async function() {
    var requests = [];
    var env = await ui.create({ realLoad: true, fetch: draftFetcher(requests) });
    var root = addDraft(env, variant[0], variant[1]);
    env.addNote(20970, 'modern');
    await env.drain();
    assert.equal(root.querySelectorAll('.gl-review-inline').length, 1);
    await env.click('aiReviewCopyComment', root);
    assert.equal(env.loads[0].options.noteId, 'draft:20970');
    assert.ok(requests.some(function(url) { return url.endsWith('/draft_notes/20970'); }));
    assert.deepEqual(env.selected(), ['draft:20970']);
    assert.equal(env.clipboard.length, 1);
    assert.match(env.clipboard[0], /Saved \*\*draft\*\* feedback/);
    assert.match(env.clipboard[0], /unpublished draft/);
    assert.ok(env.clipboard[0].includes('#' + variant[1]));
    assert.doesNotMatch(env.clipboard[0], /Unrelated published comment|Rendered draft feedback/);
    assert.equal(env.button('aiReviewRetry').hidden, true);
  });
});

['text', 'markdown'].forEach(function(format) {
  test('old GitLab draft fallback copies only the clicked saved body: ' + format, async function() {
    var env = await ui.create({ realLoad: true, fetch: draftFetcher([], 404) });
    var root = addDraft(env, 'draft-note', 'note_20970');
    var body = root.querySelector('.note-body');
    var editor = env.document.createElement('div');
    editor.className = 'note-form';
    var unsaved = env.document.createElement('textarea');
    unsaved.className = 'hidden js-task-list-field';
    unsaved.value = 'Unsaved editor content';
    editor.appendChild(unsaved);
    body.appendChild(editor);
    var controls = env.document.createElement('button');
    controls.textContent = 'Edit Delete Pending';
    body.appendChild(controls);
    var other = addDraft(env, 'draft-note', 'draft_5', root);
    other.setAttribute('data-note-id', '5');
    other.querySelector('.note-text').textContent = 'Other draft body';
    var otherMarkdown = env.document.createElement('textarea');
    otherMarkdown.className = 'hidden js-task-list-field';
    otherMarkdown.value = 'Other saved Markdown';
    other.querySelector('.note-body').appendChild(otherMarkdown);
    if (format === 'markdown') {
      var saved = env.document.createElement('textarea');
      saved.className = 'hidden js-task-list-field';
      saved.value = 'Saved **Markdown**\n\n```suggestion\nfixed();\n```';
      body.appendChild(saved);
    }
    await env.drain();
    await env.click('aiReviewCopyComment', root.querySelector('[data-testid="note-header"]'));
    assert.equal(env.loads[0].options.visibleNote.format, format);
    assert.equal(env.clipboard.length, 1);
    assert.match(env.clipboard[0], format === 'markdown' ? /Saved \*\*Markdown\*\*/ : /Rendered draft feedback/);
    assert.match(env.clipboard[0], /code positions.*hidden replies/i);
    assert.doesNotMatch(env.clipboard[0], /Unrelated published comment|Other draft body|Other saved Markdown|Unsaved editor content|Edit Delete Pending/);
    assert.equal(env.exports[0].snapshot.complete, false);
    assert.equal(env.button('aiReviewRefresh').disabled, false);
  });
});

test('a reused draft node becomes a published note as soon as the review is submitted', async function() {
  var env = await ui.create();
  var wrapper = env.document.createElement('div');
  wrapper.className = 'draft-note-component';
  env.document.body.appendChild(wrapper);
  var root = addDraft(env, null, 'note_20970', wrapper);
  await env.drain();
  var icon = env.button('aiReviewCopyComment', root);
  await env.click('aiReviewCopyComment', root);
  assert.equal(env.loads[0].options.noteId, 'draft:20970');
  await env.click('aiReviewClose');
  wrapper.className = '';
  root.id = 'note_4';
  root.setAttribute('data-note-id', '4');
  icon.click();
  await env.drain();
  assert.equal(env.loads[1].options.noteId, '4');
  assert.equal(env.loads[1].options.visibleNote, undefined);
  await env.respond(threads());
  assert.match(env.clipboard[0], /Document the return type/);
  assert.doesNotMatch(env.clipboard[0], /draft/i);
});

test('a published note containing a draft reply with a colliding ID keeps both distinct icons', async function() {
  var env = await ui.create();
  var published = env.addNote(20970, 'modern');
  var draft = addDraft(env, null, 'draft_20970', published);
  await env.drain();
  assert.equal(env.document.querySelectorAll('.gl-review-inline').length, 2);
  await env.click('aiReviewCopyComment', published.querySelector('[data-testid="note-header"]'));
  assert.equal(env.loads[0].options.noteId, '20970');
  await env.click('aiReviewClose');
  await env.click('aiReviewCopyComment', draft);
  assert.equal(env.loads[1].options.noteId, 'draft:20970');
});

test('empty feedback selection never silently becomes a new review', async function() {
  var env = await picker();
  await env.click('aiReviewClear');
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  assert.equal(env.button('aiReviewTaskFix').getAttribute('aria-selected'), 'true');
  await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports.length, 0);
  await env.click('aiReviewTaskReview');
  assert.equal(env.button('aiReviewCopyTask').disabled, false);
  await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports.length, 1);
});

test('task tabs preserve selections and independent session prompts and only show relevant controls', async function() {
  var env = await picker({ settings: { ai_review_prompt: 'Saved feedback', ai_review_fresh_prompt: 'Saved review' } });
  var prompt = env.document.querySelector('.gl-review-task-prompt');
  await env.change(prompt, 'Edited feedback', 'input');
  await env.click('aiReviewTaskReview');
  assert.deepEqual(env.selected(), ['1', '2']);
  assert.equal(env.document.querySelector('.gl-review-picker').hidden, true);
  assert.equal(env.document.querySelector('.gl-review-code-toggle').hidden, false);
  assert.equal(prompt.value, 'Saved review');
  await env.change(prompt, 'Edited review', 'input');
  await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports[0].options.prompt, 'Edited review');
  await env.click('aiReviewTaskFix');
  assert.equal(preview(env).value, '');
  assert.equal(prompt.value, 'Edited feedback');
  assert.equal(env.document.querySelector('.gl-review-picker').hidden, false);
  assert.equal(env.document.querySelector('.gl-review-code-toggle').hidden, true);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[0].options.prompt, 'Edited feedback');
  await env.click('aiReviewTaskReview');
  assert.equal(prompt.value, 'Edited review');
  await env.click('aiReviewResetPrompt');
  assert.equal(prompt.value, env.api.DEFAULT_FRESH_REVIEW_PROMPT);
  await env.click('aiReviewTaskFix');
  assert.equal(prompt.value, 'Edited feedback');
  assert.deepEqual(env.settingsWrites, []);
});

test('review tab aborts an unfinished discussion load; switching back loads selectable feedback', async function() {
  var env = await ui.create();
  await env.click('aiReviewOpen');
  await env.click('aiReviewTaskReview');
  assert.equal(env.loads[0].options.signal.aborted, true);
  await env.click('aiReviewCopyTask');
  var text = preview(env).value;
  await env.respond(threads(), 0);
  assert.equal(preview(env).value, text);
  await env.click('aiReviewTaskFix');
  assert.equal(env.loads.length, 2);
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  await env.respond(threads(), 1);
  assert.deepEqual(env.selected(), ['1', '2']);
  assert.equal(env.button('aiReviewCopyTask').disabled, false);
});

test('a missing clicked comment needs an explicit task switch before reviewing the MR', async function() {
  var env = await ui.create({ settings: { ai_review_include_description: true } });
  var root = env.addNote(999); await env.drain();
  await env.click('aiReviewCopyComment', root); await env.respond(threads());
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  assert.equal(env.exports.length, 0);
  await env.click('aiReviewTaskReview'); await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports.length, 1);
});

['cancel', 'close', 'navigate', 'switch task'].forEach(function(action) {
  test('pending review cannot update or copy after ' + action, async function() {
    var env = await picker({ deferredFreshExports: true });
    await env.click('aiReviewTaskReview'); await env.click('aiReviewCopyTask');
    if (action === 'navigate') await env.navigate('/team/repo/-/merge_requests/13');
    else await env.click(action === 'cancel' ? 'aiReviewCancel' : action === 'close' ? 'aiReviewClose' : 'aiReviewTaskFix');
    assert.equal(env.freshExports[0].options.signal.aborted, true);
    env.freshExports[0].resolve({ text: 'late review', warnings: [] }); await env.drain();
    assert.equal(env.clipboard.length, 0);
    if (action === 'cancel' || action === 'switch task') assert.equal(preview(env).value, '');
    else assert.equal(env.document.querySelector('.gl-review-overlay'), null);
  });
});

test('switching tasks prevents a late clipboard fallback from copying the old task', async function() {
  var env = await picker({ deferredClipboard: true });
  await env.click('aiReviewTaskReview'); await env.click('aiReviewCopyTask');
  await env.click('aiReviewTaskFix');
  env.clipboardRequests[0].reject(new Error('Clipboard denied')); await env.drain();
  assert.equal(env.manualCopies.length, 0);
  assert.equal(preview(env).value, '');
});

test('issues offer feedback copying without MR task tabs or an import action', async function() {
  var env = await ui.create({ pathname: '/team/repo/-/issues/12', settings: { ai_review_include_description: false } });
  await env.click('aiReviewOpen'); await env.respond([]);
  assert.equal(env.document.querySelector('.gl-review-tabs').hidden, true);
  assert.equal(env.button('aiReviewPasteResult').hidden, true);
  assert.equal(env.button('aiReviewCopyTask').disabled, true);
  await env.change(descriptionToggle(env), true); await env.click('aiReviewCopyTask');
  assert.equal(env.freshExports.length, 0);
  assert.match(env.clipboard[0], /description-only export/);
});

test('explicit review tab uses real fresh MR data with paginated commits, cumulative diffs, and import JSON instructions', async function() {
  var head = 'a'.repeat(40);
  var first = 'b'.repeat(40);
  var calls = [];
  var entity = {
    iid: 12, title: 'Review both commits', description: 'Private description excluded by user',
    source_branch: 'feature', target_branch: 'main', sha: head, changes_count: '2',
    diff_refs: { base_sha: 'c'.repeat(40), start_sha: 'd'.repeat(40), head_sha: head }
  };
  var env = await ui.create({
    settings: { ai_review_include_description: false, ai_review_fresh_prompt: 'Review the entire MR and check reliability. Answer in Spanish.' },
    realFresh: true,
    fetch: async function(url, init) {
      calls.push({ url: url, init: init });
      var path = new URL(url);
      var body;
      var next = '';
      if (path.pathname.endsWith('/commits')) {
        if (path.searchParams.get('page') === '1') { body = [{ id: first, message: 'First commit: add validation' }]; next = '2'; }
        else body = [{ id: head, message: 'Second commit: prevent a race' }];
      } else if (path.pathname.endsWith('/diffs')) body = [
        { old_path: 'validate.js', new_path: 'validate.js', diff: '@@ -1 +1 @@\n-old validation\n+new validation\n' },
        { old_path: 'worker.js', new_path: 'worker.js', diff: '@@ -1 +1 @@\n-old worker\n+new worker\n' }
      ];
      else if (/\/merge_requests\/12$/.test(path.pathname)) body = entity;
      else throw new Error('Unexpected request: ' + url);
      return { ok: true, status: 200, headers: { get: function(name) { return name === 'X-Next-Page' ? next : null; } }, text: async function() { return JSON.stringify(body); } };
    }
  });
  await env.click('aiReviewOpen');
  await env.respond([]);
  await env.click('aiReviewTaskReview');
  await env.change(env.document.querySelector('.gl-review-code-toggle').querySelector('input'), true);
  await env.click('aiReviewPreview');
  var output = preview(env).value;
  assert.ok(output.startsWith('Review the entire MR and check reliability. Answer in Spanish.'));
  assert.match(output, /Fresh review: merge request !12: `Review both commits`/);
  assert.match(output, /Loaded context: 2 commits; 2 changed files/);
  assert.match(output, /First commit: add validation/);
  assert.match(output, /Second commit: prevent a race/);
  assert.match(output, /Cumulative MR diff \(all commits together\)/);
  assert.match(output, /new validation/);
  assert.match(output, /new worker/);
  assert.match(output, /"version":1,"mr_url":"https:\/\/gitlab.test\/team\/repo\/-\/merge_requests\/12","head_sha":"a{40}"/);
  assert.doesNotMatch(output, /Private description excluded|description-only export|REQUESTED|in Russian/i);
  assert.equal(env.clipboard.length, 0);
  assert.equal(env.exports.length, 0);
  assert.equal(calls.length, 5, 'fresh metadata is checked before and after the full paginated data load');
  calls.forEach(function(call) { assert.equal(call.init.method, 'GET'); });
  await env.click('aiReviewCopyTask');
  assert.deepEqual(env.clipboard, [output]);
  assert.equal(calls.length, 5, 'copy retains exactly the validated preview');
});

test('unresolved quick filter clears search and previous selections, selecting all unresolved threads and their replies', async function() {
  var env = await ui.create();
  await env.click('aiReviewOpen');
  assert.equal(env.button('aiReviewUnresolved').disabled, true);
  await env.respond(threads().concat([{ id: 'another-open', notes: [note(6, 'Check timeout', { resolvable: true, resolved: false })] }]));
  await env.change(generalToggle(env), true);
  await env.click('aiReviewSelectAll');
  await env.click('aiReviewCopyTask');
  assert.notEqual(preview(env).value, '');
  await env.change(env.document.querySelector('.gl-review-filters').querySelector('input'), 'empty', 'input');
  await env.click('aiReviewUnresolved');
  assert.equal(env.document.querySelector('select').value, 'unresolved');
  assert.equal(env.document.querySelector('.gl-review-filters').querySelector('input').value, '');
  assert.equal(generalToggle(env).checked, false);
  assert.deepEqual(env.selected(), ['1', '2', '6']);
  assert.equal(preview(env).value, '');
  assert.equal(env.exports.length, 1, 'the quick filter only selects, without copying automatically');
  await env.click('aiReviewCopyTask');
  assert.deepEqual(plain(env.exports[1].options.discussionIds), ['open', 'another-open']);
});

test('fix reply checkbox defaults on, invalidates prepared output and keeps its value across task tabs', async function() {
  var env = await picker();
  var toggle = env.document.querySelector('.gl-review-replies-toggle');
  var input = toggle.querySelector('input');
  assert.equal(toggle.hidden, false);
  assert.equal(input.checked, true);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[0].options.includeReplies, true);
  await env.change(input, false);
  assert.equal(preview(env).value, '');
  assert.equal(env.document.querySelector('.gl-review-next-step').textContent, require('../_locales/en/messages.json').aiReviewNextFixOnlyStep.message);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[1].options.includeReplies, false);
  await env.click('aiReviewTaskReview');
  assert.equal(toggle.hidden, true);
  await env.click('aiReviewTaskFix');
  assert.equal(toggle.hidden, false);
  assert.equal(input.checked, false);
  await env.change(input, true);
  await env.click('aiReviewCopyTask');
  assert.equal(env.exports[2].options.includeReplies, true);
});

test('response language changes invalidate cached copy text without clearing discussion selection', async function() {
  var env = await picker();
  await env.click('aiReviewCopyTask');
  assert.ok(preview(env).value);
  var selected = env.selected();
  env.settingsEvents.forEach(function(fn) { fn({ ai_review_response_language: { oldValue: 'auto', newValue: 'ru' } }, 'sync'); });
  assert.equal(preview(env).value, '');
  assert.deepEqual(env.selected(), selected);
  assert.ok(env.document.querySelector('.gl-review-overlay'));
});

['button', 'escape', 'backdrop', 'import'].forEach(function(action) {
  test('dirty copy dialog can cancel ' + action + ' without losing edits or switching dialogs', async function() {
    var opened = 0, confirmations = 0;
    var env = await picker({ settings: { ai_review_confirm_close: true }, importUI: { open: function() { opened++; }, close: function() {} } });
    var original = env.document.querySelector('.gl-review-overlay');
    var prompt = env.document.querySelectorAll('textarea').find(function(el) { return el.getAttribute('aria-label') === require('../_locales/en/messages.json').aiReviewTaskPrompt.message; });
    await env.change(prompt, 'My unsaved instructions', 'input');
    env.context.window.confirm = function() { confirmations++; return false; };
    async function attempt() {
      if (action === 'button') await env.click('aiReviewClose');
      else if (action === 'escape') env.document.dispatch('keydown', { key: 'Escape' });
      else if (action === 'backdrop') original.dispatch('click', { target: original });
      else await env.click('aiReviewPasteResult');
    }
    await attempt();
    assert.equal(confirmations, 1);
    assert.equal(env.document.querySelector('.gl-review-overlay'), original);
    assert.equal(prompt.value, 'My unsaved instructions');
    assert.equal(opened, 0);
    env.context.window.confirm = function() { return true; };
    await attempt();
    assert.equal(env.document.querySelector('.gl-review-overlay'), null);
    assert.equal(opened, action === 'import' ? 1 : 0);
  });
});

test('untouched or reverted copy settings close without confirmation', async function() {
  var env = await picker();
  env.context.window.confirm = function() { throw new Error('No changes to discard'); };
  var input = env.document.querySelector('.gl-review-replies-toggle').querySelector('input');
  await env.change(input, false); await env.change(input, true);
  await env.click('aiReviewTaskReview'); await env.click('aiReviewTaskFix');
  await env.click('aiReviewClose');
  assert.equal(env.document.querySelector('.gl-review-overlay'), null);
});

test('changing only the comment selection requires confirmation', async function() {
  var env = await picker({ settings: { ai_review_confirm_close: true } }); var asks = 0;
  env.context.window.confirm = function() { asks++; return false; };
  await env.click('aiReviewClear'); await env.click('aiReviewClose');
  assert.equal(asks, 1);
  assert.deepEqual(env.selected(), []);
  assert.ok(env.document.querySelector('.gl-review-overlay'));
});

test('dirty copy closes without asking by default and close setting changes preserve the open dialog', async function() {
  var env = await picker();
  env.context.window.confirm = function() { throw new Error('Disabled by default'); };
  await env.click('aiReviewClear'); await env.click('aiReviewClose');
  assert.equal(env.document.querySelector('.gl-review-overlay'), null);
  env = await picker();
  await env.click('aiReviewClear');
  var modal = env.document.querySelector('.gl-review-overlay');
  env.context.window.confirm = function() { return false; };
  env.settingsEvents.forEach(fn => fn({ ai_review_confirm_close: { newValue: true } }, 'sync'));
  await env.drain();
  assert.equal(env.document.querySelector('.gl-review-overlay'), modal);
  await env.click('aiReviewClose');
  assert.equal(env.document.querySelector('.gl-review-overlay'), modal);
  env.settingsEvents.forEach(fn => fn({ ai_review_confirm_close: { newValue: false } }, 'sync'));
  await env.drain();
  assert.equal(env.document.querySelector('.gl-review-overlay'), modal);
  await env.click('aiReviewClose');
  assert.equal(env.document.querySelector('.gl-review-overlay'), null);
});
