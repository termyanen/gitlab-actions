'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var vm = require('node:vm');
var ui = require('./helpers/review-copy.cjs');
var harness = require('./helpers/extension.cjs');
var messages = require('../_locales/en/messages.json');

function item(id, status, extra) {
  return Object.assign({ id: id, status: status || 'ready', path: 'src/main.js', side: 'new', line: 14, code: 'return value;', body: 'Guard against an empty value.' }, extra);
}

async function setup(options) {
  options = options || {};
  var env = await ui.create(options);
  env.preparations = [];
  env.revisions = [];
  env.publications = [];
  env.prompts = [];
  env.replyPrompts = [];
  env.context.window.GlReviewImport = {
    getResponseFormat: function() { return 'Standalone response format'; },
    getPrompt: function(context, opts) {
      var request = Object.assign(ui.deferred(), { context: context, options: opts });
      env.prompts.push(request);
      return request.promise;
    },
    getReplyPrompt: function(context, opts) {
      var request = Object.assign(ui.deferred(), { context: context, options: opts });
      env.replyPrompts.push(request);
      return request.promise;
    },
    prepare: function(context, text, opts) {
      var request = Object.assign(ui.deferred(), { context: context, text: text, options: opts });
      env.preparations.push(request);
      return request.promise;
    },
    revise: function(plan, edits, opts) {
      var request = Object.assign(ui.deferred(), { plan: plan, edits: harness.plain(edits), options: opts });
      env.revisions.push(request);
      return request.promise;
    },
    publish: function(plan, ids, opts) {
      var request = Object.assign(ui.deferred(), { plan: plan, ids: harness.plain(ids), options: opts });
      env.publications.push(request);
      return request.promise;
    }
  };
  if (options.realImport) {
    env.context.TextEncoder = TextEncoder;
    env.local = {};
    env.context.chrome.storage.local = {
      get: function(key, callback) { var values = {}; if (Object.hasOwn(env.local, key)) values[key] = env.local[key]; callback(values); },
      set: function(values, callback) { Object.assign(env.local, values); callback(); },
      remove: function(key, callback) { delete env.local[key]; callback(); }
    };
    vm.runInContext(harness.readRuntime('review-import.js'), env.context, { filename: 'review-import.js' });
  }
  if (options.workflow) {
    env.context.TextEncoder = TextEncoder;
    vm.runInContext(harness.readRuntime('review-workflow.js'), env.context);
  }
  vm.runInContext(harness.readRuntime('review-import-ui.js'), env.context, { filename: 'review-import-ui.js' });
  env.importUI = env.context.window.GlReviewImportUI;
  env.openImport = function(context) {
    env.importUI.open(context || env.api.parsePage(env.context.window.location), { t: function(key, values) {
      return messages[key].message.replace(/\$(\d+)/g, function(_, n) { return (values || [])[n - 1]; });
    } });
  };
  env.openImport();
  env.input = env.document.querySelector('.gl-review-import-input');
  env.choose = function(id) { return env.document.querySelector('[data-import-item="' + id + '"]'); };
  env.checked = function() { return env.document.querySelectorAll('[data-import-item]').filter(function(check) { return check.checked; }).map(function(check) { return check.dataset.importItem; }); };
  env.edit = async function(id) {
    var edit = env.document.querySelector('[data-import-edit="' + id + '"]');
    assert.ok(edit, 'editable row ' + id);
    edit.click();
    await env.drain();
    return env.document.querySelector('.gl-review-import-editor-input');
  };
  env.finishRevision = async function(items) {
    var request = env.revisions[env.revisions.length - 1];
    var source = { version: 1, mr_url: 'https://gitlab.test/team/repo/-/merge_requests/12', head_sha: 'c'.repeat(40), comments: items.map(function(entry) {
      var source = Object.assign({}, entry);
      ['status', 'message', 'replyTo', 'existingUrl', 'editable'].forEach(function(key) { delete source[key]; });
      return source;
    }) };
    request.resolve(Object.assign({}, request.plan, { items: items, source: source }));
    await env.drain();
    return source;
  };
  env.preview = async function(items) {
    await env.change(env.input, '{"version":1,"comments":[]}', 'input');
    await env.click('aiReviewImportValidate');
    env.preparations[env.preparations.length - 1].resolve({ context: env.api.parsePage(env.context.window.location), headSha: 'abc', mrTitle: 'Safer parsing', items: items || [item('a')], warnings: [] });
    await env.drain();
  };
  return env;
}

test('import starts with read-only actions and never publishes when previewing', async function() {
  var env = await setup();
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(env.button('aiReviewImportAddDrafts').disabled, true);
  assert.equal(env.button('aiReviewImportValidate').disabled, true);
  assert.equal(env.prompts.length + env.preparations.length + env.publications.length, 0);
  await env.preview([item('a'), item('b', 'invalid', { message: 'Line changed' }), item('c', 'duplicate')]);
  assert.deepEqual(env.checked(), ['a']);
  assert.equal(env.choose('b').disabled, true);
  assert.equal(env.choose('c').disabled, true);
  assert.equal(env.publications.length, 0);
  assert.match(env.document.querySelector('.gl-review-import-preview-pane').textContent, /Line changed/);
});

test('publish sends only selected ready comments with current CSRF token and explicit publish mode', async function() {
  var env = await setup();
  await env.preview([item('a'), item('b')]);
  await env.change(env.choose('b'), false);
  var token = env.document.createElement('meta');
  token.setAttribute('name', 'csrf-token');
  token.setAttribute('content', 'current-csrf');
  env.document.body.appendChild(token);
  await env.click('aiReviewImportPublish');
  assert.equal(env.publications.length, 1);
  assert.deepEqual(env.publications[0].ids, ['a']);
  assert.equal(env.publications[0].options.mode, 'publish');
  assert.equal(env.publications[0].options.csrfToken, 'current-csrf');
  assert.equal(env.input.readOnly, true);
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(env.choose('b').disabled, true);
  env.publications[0].resolve({ items: [{ id: 'a', status: 'published' }], warnings: [] });
  await env.drain();
  assert.equal(env.choose('a').disabled, true);
  assert.equal(env.choose('a').checked, false);
  assert.equal(env.choose('b').disabled, false);
  assert.equal(env.input.readOnly, false);
});

test('Add to review uses draft mode and locks successful results against resending', async function() {
  var env = await setup();
  await env.preview();
  await env.click('aiReviewImportAddDrafts');
  assert.equal(env.publications[0].options.mode, 'draft');
  env.publications[0].resolve({ items: [{ id: 'a', status: 'draft', url: 'https://gitlab.test/team/repo/-/merge_requests/12#draft_41' }], warnings: [] });
  await env.drain();
  await env.click('aiReviewImportSelectReady');
  assert.deepEqual(env.checked(), []);
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(env.document.querySelector('.gl-review-import-item').querySelector('a').href, 'https://gitlab.test/team/repo/-/merge_requests/12#draft_41');
});

test('per-item results update during sending and retry excludes delivered and uncertain comments', async function() {
  var env = await setup();
  await env.preview([item('a'), item('b'), item('c'), item('d')]);
  await env.click('aiReviewImportPublish');
  var request = env.publications[0];
  request.options.onProgress({ phase: 'publishing', completed: 1, total: 4, item: { id: 'a', status: 'published' } });
  assert.equal(env.choose('a').checked, false);
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  request.resolve({ items: [
    { id: 'a', status: 'published' }, { id: 'b', status: 'unknown' },
    { id: 'c', status: 'failed', message: 'Forbidden' }, { id: 'd', status: 'skipped' }
  ], warnings: [] });
  await env.drain();
  assert.equal(env.choose('b').disabled, true);
  assert.deepEqual(env.checked(), ['c', 'd']);
  await env.click('aiReviewImportPublish');
  assert.deepEqual(env.publications[1].ids, ['c', 'd']);
});

test('changing JSON invalidates preview and publication until it is checked again', async function() {
  var env = await setup();
  await env.preview();
  await env.change(env.input, '{"comments":[{"body":"different"}]}', 'input');
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.deepEqual(env.checked(), []);
  await env.click('aiReviewImportPublish');
  assert.equal(env.publications.length, 0);
});

test('changing input during validation aborts and ignores the old response', async function() {
  var env = await setup();
  await env.change(env.input, '{}', 'input');
  await env.click('aiReviewImportValidate');
  var request = env.preparations[0];
  await env.change(env.input, '{"changed":true}', 'input');
  assert.equal(request.options.signal.aborted, true);
  request.resolve({ items: [item('stale')], warnings: [] });
  await env.drain();
  assert.equal(env.choose('stale'), null);
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(env.button('aiReviewImportValidate').disabled, false);
});

test('invalid AI text and links remain inert in the preview', async function() {
  var env = await setup();
  var body = '<img src=x onerror="alert(1)">\n**Untrusted markdown**';
  await env.preview([item('a', 'duplicate', { path: '<svg onload=alert(1)>', code: '<script>alert(2)</script>', body: body, existingUrl: 'javascript:alert(3)' })]);
  assert.equal(env.document.querySelector('.gl-review-import-text').textContent, body);
  var card = env.document.querySelector('.gl-review-import-item');
  assert.equal(card.querySelector('script, img, svg, a'), null);
  assert.match(card.textContent, /<script>alert\(2\)<\/script>/);
});

test('general comments keep their body and are previewed without a fabricated file location', async function() {
  var env = await setup();
  await env.preview([item('general', 'ready', { path: null, side: null, line: null, code: null, body: 'The migration needs a rollback plan.' })]);
  var card = env.document.querySelector('.gl-review-import-item');
  assert.equal(card.querySelector('.gl-review-path'), null);
  assert.equal(card.querySelector('.gl-review-import-code'), null);
  assert.equal(card.querySelector('.gl-review-import-text').textContent, 'The migration needs a rollback plan.');
  assert.match(card.textContent, new RegExp(messages.aiReviewGeneral.message));
  await env.click('aiReviewImportPublish');
  assert.deepEqual(env.publications[0].ids, ['general']);
});

test('reply preview clearly pairs the original comment and author with the proposed answer', async function() {
  var env = await setup();
  await env.preview([item('reply-1', 'ready', {
    type: 'reply', discussion_id: 'thread-a', note_id: 51, path: null, side: null, line: null, code: null,
    body: 'Added a guard and a regression check.',
    replyTo: { body: 'This fails for empty input.', author: { name: 'Reviewer', username: 'reviewer' }, resolved: false,
      path: 'src/parser.js', line: 12, url: 'https://gitlab.test/team/repo/-/merge_requests/12#note_51' }
  })]);
  var card = env.document.querySelector('.gl-review-import-item');
  var original = card.querySelector('.gl-review-import-original');
  assert.match(original.textContent, /This fails for empty input/);
  assert.match(original.textContent, /@reviewer/);
  assert.match(original.textContent, /src\/parser.js:12/);
  assert.ok(original.textContent.includes(messages.aiReviewUnresolved.message));
  assert.equal(original.querySelector('a').href, 'https://gitlab.test/team/repo/-/merge_requests/12#note_51');
  assert.equal(card.querySelector('.gl-review-import-text').textContent, 'Added a guard and a regression check.');
  assert.ok(card.textContent.includes(messages.aiReviewImportReply.message));
  assert.ok(!card.textContent.includes(messages.aiReviewGeneral.message));
  assert.equal(env.publications.length, 0);
  await env.click('aiReviewImportAddDrafts');
  assert.equal(env.publications[0].options.mode, 'draft');
  assert.deepEqual(env.publications[0].ids, ['reply-1']);
});

test('unavailable reply targets remain replies in preview without inventing an original comment', async function() {
  var env = await setup();
  await env.preview([item('reply-1', 'invalid', { type: 'reply', discussion_id: 'missing', note_id: 90,
    path: null, side: null, line: null, code: null, message: 'The discussion could not be found.' })]);
  var card = env.document.querySelector('.gl-review-import-item');
  assert.equal(card.querySelector('.gl-review-import-original'), null);
  assert.ok(card.textContent.includes(messages.aiReviewImportReply.message));
  assert.ok(!card.textContent.includes(messages.aiReviewGeneral.message));
  assert.equal(env.choose('reply-1').disabled, true);
});

test('original review text and links cannot inject active content into reply preview', async function() {
  var env = await setup();
  await env.preview([item('reply-1', 'ready', { type: 'reply', note_id: 51, replyTo: {
    body: '<script>alert(1)</script>', author: { name: '<img src=x onerror=alert(2)>' },
    path: '<svg onload=alert(3)>', line: 1, url: 'javascript:alert(4)'
  } })]);
  var original = env.document.querySelector('.gl-review-import-original');
  assert.match(original.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(original.querySelector('script, img, svg, a'), null);
});

test('validation failure displays an error and cannot publish an earlier plan', async function() {
  var env = await setup();
  await env.preview();
  await env.click('aiReviewImportValidate');
  env.preparations[1].reject(new Error('MR revision has changed'));
  await env.drain();
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.match(env.document.querySelector('.gl-review-status').textContent, /MR revision has changed/);
});

test('known unsupported draft APIs disable Add to review while ordinary publishing stays available', async function() {
  var env = await setup();
  await env.change(env.input, '{}', 'input');
  await env.click('aiReviewImportValidate');
  env.preparations[0].resolve({ headSha: 'abc', items: [item('a')], draftSupported: false, warnings: ['This GitLab version does not support drafts through the API.'] });
  await env.drain();
  assert.equal(env.button('aiReviewImportAddDrafts').disabled, true);
  assert.equal(env.button('aiReviewImportPublish').disabled, false);
  assert.match(env.document.querySelector('.gl-review-warning').textContent, /does not support drafts/);
});

test('Stop aborts the batch and uncertain delivery cannot be retried directly', async function() {
  var env = await setup();
  await env.preview();
  await env.click('aiReviewImportPublish');
  await env.click('aiReviewImportStop');
  assert.equal(env.publications[0].options.signal.aborted, true);
  assert.equal(env.button('aiReviewImportStop').disabled, true);
  var abort = new Error('Aborted'); abort.name = 'AbortError';
  env.publications[0].reject(abort);
  await env.drain();
  assert.equal(env.choose('a').disabled, true);
  assert.equal(env.choose('a').checked, false);
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(env.document.querySelector('.gl-review-import-item').getAttribute('data-import-result'), 'unknown');
});

test('a confirmed preflight refusal explains that nothing was sent without claiming uncertain delivery', async function() {
  var env = await setup();
  await env.preview();
  await env.click('aiReviewImportPublish');
  var failure = new Error('The merge request changed after the preview. Check the review again.');
  failure.beforeSend = true;
  env.publications[0].reject(failure);
  await env.drain();
  var card = env.document.querySelector('.gl-review-import-item');
  assert.equal(card.getAttribute('data-import-result'), 'failed');
  assert.match(card.textContent, /changed after the preview/);
  assert.equal(card.querySelector('.gl-review-error'), null);
  assert.deepEqual(env.checked(), ['a']);
});

test('closing aborts ongoing work, ignores its late result, and restores focus', async function() {
  var env = await setup();
  var previous = env.document.createElement('button');
  env.document.body.appendChild(previous);
  env.importUI.close();
  previous.focus();
  env.openImport();
  env.input = env.document.querySelector('.gl-review-import-input');
  await env.preview();
  await env.click('aiReviewImportPublish');
  env.importUI.close();
  assert.equal(env.publications[0].options.signal.aborted, true);
  assert.equal(env.document.activeElement, previous);
  env.publications[0].resolve({ items: [{ id: 'a', status: 'published' }], warnings: [] });
  await env.drain();
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
});

test('Escape closes the import dialog and issue pages do not open it', async function() {
  var env = await setup();
  env.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
  env.openImport({ kind: 'issues', projectPath: 'team/repo', iid: '1' });
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
});

test('old publication results cannot overwrite a newly opened import dialog', async function() {
  var env = await setup();
  await env.preview();
  await env.click('aiReviewImportPublish');
  var previous = env.publications[0];
  env.importUI.close();
  env.openImport();
  env.input = env.document.querySelector('.gl-review-import-input');
  await env.preview([item('new')]);
  previous.options.onProgress({ item: { id: 'new', status: 'published' } });
  previous.resolve({ items: [{ id: 'new', status: 'published' }], warnings: ['Old dialog warning'] });
  await env.drain();
  assert.deepEqual(env.checked(), ['new']);
  assert.equal(env.choose('new').disabled, false);
  assert.doesNotMatch(env.document.querySelector('.gl-review-import-dialog').textContent, /Old dialog warning/);
});

test('navigating to another MR prevents publication even before the route observer runs', async function() {
  var env = await setup();
  await env.preview();
  env.context.window.location.pathname = '/team/repo/-/merge_requests/120';
  env.button('aiReviewImportPublish').click();
  await env.drain();
  assert.equal(env.publications.length, 0);
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
});

test('navigation during a batch aborts it when progress arrives and ignores stale results', async function() {
  var env = await setup();
  await env.preview();
  await env.click('aiReviewImportPublish');
  env.context.window.location.pathname = '/team/repo/-/merge_requests/13';
  var request = env.publications[0];
  request.options.onProgress({ item: { id: 'a', status: 'published' } });
  assert.equal(request.options.signal.aborted, true);
  request.resolve({ items: [{ id: 'a', status: 'published' }], warnings: [] });
  await env.drain();
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
});

test('the same MR changes tab and GitLab subpath remain valid import contexts', async function() {
  var env = await setup({ pathname: '/gitlab/team/repo/-/merge_requests/12/diffs' });
  env.importUI.close();
  env.openImport(env.api.parsePage({ origin: 'https://gitlab.test', pathname: '/gitlab/team/repo/-/merge_requests/12/diffs', relativeUrlRoot: '/gitlab' }));
  env.input = env.document.querySelector('.gl-review-import-input');
  await env.preview();
  await env.click('aiReviewImportPublish');
  assert.equal(env.publications.length, 1);
  assert.match(env.document.querySelector('.gl-review-subject').textContent, /abc/);
});

test('an incomplete result cannot leave an unconfirmed comment available for retry', async function() {
  var env = await setup();
  await env.preview();
  await env.click('aiReviewImportPublish');
  env.publications[0].resolve({ items: [], warnings: [] });
  await env.drain();
  assert.equal(env.choose('a').disabled, true);
  assert.deepEqual(env.checked(), []);
});

['publish', 'draft'].forEach(function(mode) {
  test('real import data and UI: exact inline ' + mode + ', CSRF, and duplicate revalidation', async function() {
    var refs = { base_sha: 'a'.repeat(40), start_sha: 'b'.repeat(40), head_sha: 'c'.repeat(40) };
    var requests = [];
    var published = [];
    var drafts = [];
    var body = 'Handle null before normalizing; otherwise this branch throws.';
    function response(value) {
      return { ok: true, status: 200, redirected: false, text: async function() { return JSON.stringify(value); }, headers: { get: function(name) { return name.toLowerCase() === 'x-next-page' ? '' : null; } } };
    }
    var env = await setup({ realImport: true, fetch: async function(address, init) {
      var path = new URL(address).pathname;
      requests.push({ address: address, init: init });
      if (init.method === 'POST') {
        var payload = JSON.parse(init.body);
        if (path.endsWith('/draft_notes')) {
          var draft = { id: 51, note: payload.note, author_id: 7, position: payload.position };
          drafts.push(draft);
          return response(draft);
        }
        assert.ok(path.endsWith('/discussions'));
        var discussion = { id: 'thread-51', notes: [{ id: 51, body: payload.body, author: { id: 7 }, position: payload.position }] };
        published.push(discussion);
        return response(discussion);
      }
      if (path.endsWith('/user')) return response({ id: 7 });
      if (path.endsWith('/discussions')) return response(published);
      if (path.endsWith('/draft_notes')) return response(drafts);
      if (path.endsWith('/diffs')) return response([{ old_path: 'src/parser.js', new_path: 'src/parser.js', diff: '@@ -1 +1 @@\n-return value;\n+return normalize(value);\n' }]);
      if (path.endsWith('/merge_requests/12')) return response({ id: 88, iid: 12, title: 'Normalize parsed values', sha: refs.head_sha, diff_refs: refs });
      throw new Error('Unexpected request: ' + address);
    } });
    var csrf = env.document.createElement('meta');
    csrf.setAttribute('name', 'csrf-token');
    csrf.setAttribute('content', 'live-csrf-token');
    env.document.body.appendChild(csrf);
    var prompt = await env.context.window.GlReviewImport.getPrompt(env.api.parsePage(env.context.window.location));
    assert.match(prompt, /Review every changed file/);
    assert.ok(prompt.includes(refs.head_sha));
    assert.equal(requests.filter(function(request) { return request.init.method === 'POST'; }).length, 0);
    var input = { version: 1, mr_url: 'https://gitlab.test/team/repo/-/merge_requests/12', head_sha: refs.head_sha,
      comments: [{ id: 'R1', path: 'src/parser.js', side: 'new', line: 1, code: 'return normalize(value);', body: body }] };
    await env.change(env.input, JSON.stringify(input), 'input');
    await env.click('aiReviewImportValidate');
    assert.deepEqual(env.checked(), ['R1']);
    assert.equal(env.document.querySelector('.gl-review-import-text').textContent, body);
    assert.equal(requests.filter(function(request) { return request.init.method === 'POST'; }).length, 0);
    await env.click(mode === 'publish' ? 'aiReviewImportPublish' : 'aiReviewImportAddDrafts');
    var posts = requests.filter(function(request) { return request.init.method === 'POST'; });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].init.headers['X-CSRF-Token'], 'live-csrf-token');
    assert.equal(posts[0].init.credentials, 'same-origin');
    assert.equal(posts[0].init.redirect, 'error');
    var payload = JSON.parse(posts[0].init.body);
    assert.deepEqual(payload.position, Object.assign({ position_type: 'text', old_path: 'src/parser.js', new_path: 'src/parser.js' }, refs, { new_line: 1 }));
    assert.equal(payload[mode === 'publish' ? 'body' : 'note'], body);
    assert.deepEqual(Object.keys(payload).sort(), [mode === 'publish' ? 'body' : 'note', 'position']);
    assert.equal(env.document.querySelector('.gl-review-import-item').getAttribute('data-import-result'), mode === 'publish' ? 'published' : 'draft');
    assert.equal(env.button('aiReviewImportPublish').disabled, true);
    await env.click('aiReviewImportValidate');
    assert.deepEqual(env.checked(), []);
    assert.equal(env.document.querySelector('.gl-review-import-item').getAttribute('data-import-result'), 'duplicate');
    assert.equal(requests.filter(function(request) { return request.init.method === 'POST'; }).length, 1);
  });
});

test('real reply data and UI: open threads produce a prompt, preview, and explicitly targeted bulk replies', async function() {
  var refs = { base_sha: 'a'.repeat(40), start_sha: 'b'.repeat(40), head_sha: 'c'.repeat(40) };
  var firstId = 'd'.repeat(40);
  var secondId = 'e'.repeat(40);
  var requests = [];
  var bodies = ['Added a null guard and verified the regression test.', 'Moved the cleanup into finally and checked both exit paths.'];
  var discussions = [
    { id: firstId, individual_note: false, resolved: false, notes: [{ id: 51, type: 'DiffNote', body: 'Guard empty input before parsing.', author: { id: 9, username: 'reviewer' }, resolvable: true, resolved: false,
      position: Object.assign({ position_type: 'text', old_path: 'src/parser.js', new_path: 'src/parser.js', old_line: null, new_line: 12 }, refs) }] },
    { id: secondId, individual_note: false, resolved: false, notes: [{ id: 61, type: 'DiscussionNote', body: 'Always release the lock on failure.', author: { id: 9, username: 'reviewer' }, resolvable: true, resolved: false }] },
    { id: 'f'.repeat(40), individual_note: false, resolved: true, notes: [{ id: 71, type: 'DiscussionNote', body: 'Already resolved issue.', author: { id: 9 }, resolvable: true, resolved: true }] }
  ];
  function response(value) {
    return { ok: true, status: 200, redirected: false, text: async function() { return JSON.stringify(value); }, headers: { get: function(name) { return name.toLowerCase() === 'x-next-page' ? '' : null; } } };
  }
  var env = await setup({ realImport: true, fetch: async function(address, init) {
    var path = new URL(address).pathname;
    requests.push({ address: address, init: init });
    var threadMatch = path.match(/\/discussions\/([^/]+)(\/notes)?$/);
    if (init.method === 'POST') {
      assert.ok(threadMatch && threadMatch[2], 'replies use the targeted discussion notes endpoint');
      var target = discussions.find(function(thread) { return thread.id === decodeURIComponent(threadMatch[1]); });
      assert.ok(target);
      var payload = JSON.parse(init.body);
      var reply = { id: target.id === firstId ? 101 : 102, body: payload.body, author: { id: 7 }, resolvable: true, resolved: false };
      target.notes.push(reply);
      return response(reply);
    }
    if (threadMatch) return response(discussions.find(function(thread) { return thread.id === decodeURIComponent(threadMatch[1]); }));
    if (path.endsWith('/user')) return response({ id: 7 });
    if (path.endsWith('/discussions')) return response(discussions);
    if (path.endsWith('/draft_notes') || path.endsWith('/diffs')) return response([]);
    if (path.endsWith('/merge_requests/12')) return response({ id: 88, iid: 12, title: 'Fix input and cleanup', sha: refs.head_sha, diff_refs: refs });
    throw new Error('Unexpected request: ' + address);
  } });
  var csrf = env.document.createElement('meta');
  csrf.setAttribute('name', 'csrf-token');
  csrf.setAttribute('content', 'reply-csrf-token');
  env.document.body.appendChild(csrf);
  var prompt = await env.context.window.GlReviewImport.getReplyPrompt(env.api.parsePage(env.context.window.location));
  assert.ok(prompt.includes(firstId));
  assert.ok(prompt.includes(secondId));
  assert.ok(prompt.includes(refs.head_sha));
  assert.ok(prompt.includes('Guard empty input before parsing.'));
  assert.ok(!prompt.includes('Already resolved issue.'));
  var input = { version: 1, mr_url: 'https://gitlab.test/team/repo/-/merge_requests/12', head_sha: refs.head_sha,
    comments: [
      { id: 'A1', type: 'reply', discussion_id: firstId, note_id: 51, body: bodies[0] },
      { id: 'A2', type: 'reply', discussion_id: secondId, note_id: 61, body: bodies[1] }
    ] };
  await env.change(env.input, JSON.stringify(input), 'input');
  await env.click('aiReviewImportValidate');
  assert.deepEqual(env.checked(), ['A1', 'A2']);
  var originals = env.document.querySelectorAll('.gl-review-import-original');
  assert.equal(originals.length, 2);
  assert.ok(originals[0].textContent.includes('Guard empty input before parsing.'));
  assert.ok(originals[1].textContent.includes('Always release the lock on failure.'));
  assert.equal(requests.filter(function(request) { return request.init.method !== 'GET'; }).length, 0);
  await env.click('aiReviewImportPublish');
  var writes = requests.filter(function(request) { return request.init.method !== 'GET'; });
  assert.equal(writes.length, 2);
  writes.forEach(function(write, index) {
    assert.equal(write.init.method, 'POST');
    assert.ok(write.address.endsWith('/discussions/' + [firstId, secondId][index] + '/notes'));
    assert.equal(write.init.headers['X-CSRF-Token'], 'reply-csrf-token');
    assert.deepEqual(JSON.parse(write.init.body), { body: bodies[index] });
  });
  assert.deepEqual(env.checked(), []);
  assert.ok(env.document.querySelectorAll('.gl-review-import-item').every(function(card) { return card.getAttribute('data-import-result') === 'published'; }));
  assert.equal(discussions[0].resolved, false);
  assert.equal(discussions[1].resolved, false);
  await env.click('aiReviewImportValidate');
  assert.deepEqual(env.checked(), []);
  assert.ok(env.document.querySelectorAll('.gl-review-import-item').every(function(card) { return card.getAttribute('data-import-result') === 'duplicate'; }));
  assert.equal(requests.filter(function(request) { return request.init.method !== 'GET'; }).length, 2);
});

test('editing a reply checks the new body, preserves its target and exclusions, and syncs the source JSON', async function() {
  var env = await setup();
  var reply = item('reply', 'ready', { type: 'reply', path: null, side: null, line: null, code: null, discussion_id: 'd'.repeat(40), note_id: 51,
    replyTo: { body: 'Guard empty input.', author: '@reviewer', path: 'src/parser.js', line: 12 }, body: 'Done.' });
  var excluded = item('excluded');
  await env.preview([reply, excluded]);
  await env.change(env.choose('excluded'), false);
  var editButton = env.document.querySelector('[data-import-edit="reply"]');
  assert.equal(editButton.getAttribute('title'), messages.aiReviewImportEdit.message);
  assert.equal(editButton.getAttribute('aria-label'), messages.aiReviewImportEdit.message);
  assert.match(editButton.querySelector('.gl-review-icon').innerHTML, /fill="none"/);
  var editor = await env.edit('reply');
  assert.equal(editor.value, 'Done.');
  assert.ok(env.document.querySelector('.gl-review-import-original').textContent.includes('Guard empty input.'));
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(env.button('aiReviewImportAddDrafts').disabled, true);
  assert.equal(env.input.readOnly, true);
  assert.equal(env.button('aiReviewImportValidate').disabled, true);
  assert.equal(env.document.querySelector('[data-import-edit="excluded"]').disabled, true);
  assert.equal(env.button('aiReviewImportAddComment').disabled, true);
  await env.change(editor, 'Added a null check; the regression test passes.', 'input');
  await env.click('aiReviewImportSaveEdit');
  assert.equal(editor.readOnly, true);
  assert.equal(env.button('aiReviewImportSaveEdit').disabled, true);
  assert.equal(env.publications.length, 0);
  assert.deepEqual(env.revisions[0].edits, [{ id: 'reply', body: editor.value }]);
  var changed = Object.assign({}, reply, { body: editor.value });
  var source = await env.finishRevision([changed, excluded]);
  assert.equal(env.document.querySelector('.gl-review-import-editor-input'), null);
  assert.deepEqual(env.checked(), ['reply']);
  assert.deepEqual(JSON.parse(env.input.value), source);
  assert.equal(env.document.querySelector('.gl-review-import-text').textContent, changed.body);
  assert.equal(env.publications.length, 0);
  await env.click('aiReviewImportPublish');
  assert.deepEqual(env.publications[0].ids, ['reply']);
  assert.equal(env.publications[0].plan.items[0].discussion_id, reply.discussion_id);
  assert.equal(env.publications[0].plan.items[0].note_id, 51);
  assert.equal(env.publications[0].plan.items[0].body, changed.body);
  env.publications[0].resolve({ items: [{ id: 'reply', status: 'published' }] });
  await env.drain();
  await env.click('aiReviewImportValidate');
  assert.deepEqual(JSON.parse(env.preparations[1].text), source, 'revalidation uses the edited source, not the original AI text');
});

test('canceling a text edit leaves the preview and selection intact without revising or posting', async function() {
  var env = await setup();
  await env.preview([item('a'), item('b')]);
  await env.change(env.choose('a'), false);
  var source = env.input.value;
  var editor = await env.edit('a');
  await env.change(editor, 'Discard this edit.', 'input');
  await env.click('aiReviewImportCancelEdit');
  assert.equal(env.document.querySelector('.gl-review-import-text').textContent, item('a').body);
  assert.deepEqual(env.checked(), ['b']);
  assert.equal(env.input.value, source);
  assert.equal(env.input.readOnly, false);
  assert.equal(env.revisions.length + env.publications.length, 0);
  assert.equal(env.button('aiReviewImportPublish').disabled, false);
});

test('adding a manual comment is explicitly general, can be canceled, and saves without posting', async function() {
  var env = await setup();
  await env.preview([item('manual-1'), item('b')]);
  await env.change(env.choose('b'), false);
  await env.click('aiReviewImportAddComment');
  assert.ok(env.document.querySelector('.gl-review-import-new').textContent.includes(messages.aiReviewGeneral.message));
  await env.change(env.document.querySelector('.gl-review-import-editor-input'), 'Discard new comment.', 'input');
  await env.click('aiReviewImportCancelEdit');
  assert.equal(env.document.querySelector('.gl-review-import-new'), null);
  assert.equal(env.revisions.length, 0);
  assert.deepEqual(env.checked(), ['manual-1']);
  await env.click('aiReviewImportAddComment');
  await env.change(env.document.querySelector('.gl-review-import-editor-input'), 'Please include the migration rollback instructions.', 'input');
  await env.click('aiReviewImportSaveEdit');
  var edit = env.revisions[0].edits[0];
  assert.equal(edit.add, true);
  assert.notEqual(edit.id, 'manual-1');
  assert.deepEqual(Object.keys(edit).sort(), ['add', 'body', 'id']);
  var added = item(edit.id, 'ready', { type: 'comment', path: null, side: null, line: null, code: null, body: edit.body });
  await env.finishRevision([item('manual-1'), item('b'), added]);
  assert.deepEqual(env.checked(), ['manual-1', edit.id]);
  var card = env.choose(edit.id).closest('article');
  assert.ok(card.textContent.includes(messages.aiReviewGeneral.message));
  assert.equal(card.querySelector('.gl-review-import-code'), null);
  assert.equal(env.publications.length, 0);
  assert.equal(JSON.parse(env.input.value).comments[2].body, edit.body);
});

test('a rejected edit keeps the typed text and blocks publishing until it is saved or canceled', async function() {
  var env = await setup();
  await env.preview();
  var editor = await env.edit('a');
  await env.change(editor, '/close\nDo not send this command.', 'input');
  await env.click('aiReviewImportSaveEdit');
  env.revisions[0].reject(new Error('GitLab quick actions are not allowed.'));
  await env.drain();
  editor = env.document.querySelector('.gl-review-import-editor-input');
  assert.equal(editor.value, '/close\nDo not send this command.');
  assert.ok(env.document.querySelector('[role="alert"]').textContent.includes('GitLab quick actions'));
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(editor.readOnly, false);
  await env.change(editor, 'Please explain the rollback procedure.', 'input');
  await env.click('aiReviewImportSaveEdit');
  await env.finishRevision([item('a', 'ready', { body: editor.value })]);
  assert.equal(env.document.querySelector('[role="alert"]'), null);
  assert.equal(env.button('aiReviewImportPublish').disabled, false);
  assert.equal(env.publications.length, 0);
});

test('saved and uncertain outcomes stay locked while editable failures can be revised', async function() {
  var env = await setup();
  await env.preview([item('sent'), item('uncertain'), item('failure'), item('skipped'), item('duplicate', 'duplicate'), item('blocked', 'invalid', { editable: false })]);
  await env.click('aiReviewImportPublish');
  env.publications[0].resolve({ items: [
    { id: 'sent', status: 'published' }, { id: 'uncertain', status: 'unknown' },
    { id: 'failure', status: 'failed', message: 'Permission denied' }, { id: 'skipped', status: 'skipped' }
  ] });
  await env.drain();
  ['sent', 'uncertain', 'duplicate', 'blocked'].forEach(function(id) { assert.equal(env.document.querySelector('[data-import-edit="' + id + '"]'), null); });
  await env.change(env.choose('skipped'), false);
  var editor = await env.edit('failure');
  await env.change(editor, 'Explain a narrower fix.', 'input');
  await env.click('aiReviewImportSaveEdit');
  await env.finishRevision([item('sent'), item('uncertain'), item('failure', 'ready', { body: editor.value }), item('skipped'), item('duplicate', 'duplicate'), item('blocked', 'invalid', { editable: false })]);
  assert.equal(env.choose('sent').disabled, true);
  assert.equal(env.choose('uncertain').disabled, true);
  assert.equal(env.choose('sent').closest('article').getAttribute('data-import-result'), 'published');
  assert.equal(env.choose('uncertain').closest('article').getAttribute('data-import-result'), 'unknown');
  assert.deepEqual(env.checked(), ['failure']);
  assert.equal(env.choose('failure').closest('article').getAttribute('data-import-result'), 'ready');
  assert.equal(env.choose('skipped').closest('article').getAttribute('data-import-result'), 'skipped');
  assert.equal(env.publications.length, 1);
});

test('canceling an in-flight revision aborts it and ignores its late result', async function() {
  var env = await setup();
  await env.preview();
  var editor = await env.edit('a');
  await env.change(editor, 'Late modified comment.', 'input');
  await env.click('aiReviewImportSaveEdit');
  var request = env.revisions[0];
  await env.click('aiReviewImportCancelEdit');
  assert.equal(request.options.signal.aborted, true);
  await env.finishRevision([item('a', 'ready', { body: 'Late modified comment.' })]);
  assert.equal(env.document.querySelector('.gl-review-import-text').textContent, item('a').body);
  assert.deepEqual(env.checked(), ['a']);
  assert.equal(env.publications.length, 0);
});

test('revalidation replaces retry errors with newly invalid or duplicate statuses on unchanged rows', async function() {
  var env = await setup();
  await env.preview([item('edit'), item('invalidated'), item('duplicate')]);
  await env.click('aiReviewImportPublish');
  env.publications[0].resolve({ items: [
    { id: 'edit', status: 'failed', message: 'Original failure' },
    { id: 'invalidated', status: 'failed', message: 'Old permission error' },
    { id: 'duplicate', status: 'skipped', message: 'Old cancellation reason' }
  ] });
  await env.drain();
  var editor = await env.edit('edit');
  await env.change(editor, 'A clearer explanation.', 'input');
  await env.click('aiReviewImportSaveEdit');
  await env.finishRevision([
    item('edit', 'ready', { body: editor.value }),
    item('invalidated', 'invalid', { message: 'This discussion changed after the preview.' }),
    item('duplicate', 'duplicate', { message: 'This comment was already published.', editable: false })
  ]);
  var invalidated = env.choose('invalidated').closest('article');
  assert.equal(invalidated.getAttribute('data-import-result'), 'invalid');
  assert.ok(invalidated.textContent.includes('This discussion changed after the preview.'));
  assert.ok(!invalidated.textContent.includes('Old permission error'));
  var duplicate = env.choose('duplicate').closest('article');
  assert.equal(duplicate.getAttribute('data-import-result'), 'duplicate');
  assert.ok(duplicate.textContent.includes('This comment was already published.'));
  assert.ok(!duplicate.textContent.includes('Old cancellation reason'));
  assert.deepEqual(env.checked(), ['edit']);
  assert.equal(env.choose('invalidated').disabled, true);
  assert.equal(env.choose('duplicate').disabled, true);
});

['input', 'route', 'close'].forEach(function(change) {
  test('a pending revision cannot update the preview after ' + change + ' changes', async function() {
    var env = await setup();
    await env.preview();
    var editor = await env.edit('a');
    await env.change(editor, 'A late body.', 'input');
    await env.click('aiReviewImportSaveEdit');
    var request = env.revisions[0];
    if (change === 'input') await env.change(env.input, '{"new":"source"}', 'input');
    else if (change === 'route') env.context.window.location.pathname = '/team/repo/-/merge_requests/13';
    else env.importUI.close();
    await env.finishRevision([item('late', 'ready', { body: 'A late body.' })]);
    assert.equal(request.options.signal.aborted, true);
    assert.equal(env.choose('late'), null);
    assert.equal(env.publications.length, 0);
    if (change === 'input') {
      assert.equal(env.input.value, '{"new":"source"}');
      assert.equal(env.button('aiReviewImportPublish').disabled, true);
    } else assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
  });
});

test('the manual comment limit disables adding without disturbing the current preview', async function() {
  var env = await setup();
  await env.preview(Array.from({ length: 200 }, function(_, index) { return item('R' + index); }));
  assert.equal(env.button('aiReviewImportAddComment').disabled, true);
  assert.equal(env.button('aiReviewImportAddComment').getAttribute('title'), messages.aiReviewImportCommentLimit.message);
  await env.click('aiReviewImportAddComment');
  assert.equal(env.document.querySelector('.gl-review-import-editor-input'), null);
  assert.equal(env.checked().length, 200);
  assert.equal(env.revisions.length + env.publications.length, 0);
});

test('real editable preview preserves reply destinations, excludes unchecked comments, and posts saved text only after confirmation', async function() {
  var refs = { base_sha: 'a'.repeat(40), start_sha: 'b'.repeat(40), head_sha: 'c'.repeat(40) };
  var targetId = 'd'.repeat(40);
  var requests = [];
  var threads = [{ id: targetId, individual_note: false, resolved: false, notes: [
    { id: 51, type: 'DiscussionNote', body: 'How does the parser handle null input?', author: { id: 9 }, resolvable: true, resolved: false }
  ] }];
  function response(value) {
    return { ok: true, status: 200, redirected: false, text: async function() { return JSON.stringify(value); }, headers: { get: function(name) { return name.toLowerCase() === 'x-next-page' ? '' : null; } } };
  }
  var env = await setup({ realImport: true, fetch: async function(address, init) {
    var path = new URL(address).pathname;
    requests.push({ address: address, init: init });
    if (init.method === 'POST') {
      var payload = JSON.parse(init.body);
      if (path.endsWith('/discussions/' + targetId + '/notes')) {
        var reply = { id: 101, body: payload.body, author: { id: 7 }, resolvable: true, resolved: false };
        threads[0].notes.push(reply);
        return response(reply);
      }
      assert.ok(path.endsWith('/discussions'), 'manual additions use a general discussion');
      var general = { id: 'e'.repeat(40), individual_note: false, notes: [{ id: 102, body: payload.body, author: { id: 7 } }] };
      threads.push(general);
      return response(general);
    }
    if (path.endsWith('/discussions/' + targetId)) return response(threads[0]);
    if (path.endsWith('/user')) return response({ id: 7 });
    if (path.endsWith('/discussions')) return response(threads);
    if (path.endsWith('/draft_notes')) return response([]);
    if (path.endsWith('/merge_requests/12')) return response({ iid: 12, title: 'Guard empty input', sha: refs.head_sha, diff_refs: refs });
    throw new Error('Unexpected request: ' + address);
  } });
  var token = env.document.createElement('meta');
  token.setAttribute('name', 'csrf-token');
  token.setAttribute('content', 'editor-csrf');
  env.document.body.appendChild(token);
  var source = { version: 1, mr_url: 'https://gitlab.test/team/repo/-/merge_requests/12', head_sha: refs.head_sha, comments: [
    { id: 'reply', type: 'reply', discussion_id: targetId, note_id: 51, body: 'Done.' },
    { id: 'excluded', path: null, side: null, line: null, code: null, body: 'Do not send this suggestion.' }
  ] };
  await env.change(env.input, JSON.stringify(source), 'input');
  await env.click('aiReviewImportValidate');
  await env.change(env.choose('excluded'), false);
  var editor = await env.edit('reply');
  await env.change(editor, 'Added an early null guard and checked the empty-input regression.', 'input');
  await env.click('aiReviewImportSaveEdit');
  assert.equal(env.document.querySelector('.gl-review-import-editor-input'), null);
  assert.equal(env.document.querySelector('.gl-review-import-text').textContent, editor.value);
  var revisedSource = JSON.parse(env.input.value);
  assert.equal(revisedSource.comments[0].body, editor.value);
  assert.equal(revisedSource.comments[0].discussion_id, targetId);
  assert.equal(revisedSource.comments[0].note_id, 51);
  assert.equal(revisedSource.head_sha, refs.head_sha);
  await env.click('aiReviewImportAddComment');
  await env.change(env.document.querySelector('.gl-review-import-editor-input'), 'The new regression case is in parser.test.js.', 'input');
  await env.click('aiReviewImportSaveEdit');
  revisedSource = JSON.parse(env.input.value);
  var manual = revisedSource.comments[2];
  assert.equal(manual.path, null);
  assert.equal(manual.side, null);
  assert.equal(manual.line, null);
  assert.equal(manual.code, null);
  assert.deepEqual(env.checked(), ['reply', manual.id]);
  assert.equal(requests.filter(function(request) { return request.init.method !== 'GET'; }).length, 0);
  await env.click('aiReviewImportPublish');
  var posts = requests.filter(function(request) { return request.init.method !== 'GET'; });
  assert.equal(posts.length, 2);
  assert.ok(posts[0].address.endsWith('/discussions/' + targetId + '/notes'));
  assert.ok(posts[1].address.endsWith('/discussions'));
  assert.deepEqual(JSON.parse(posts[0].init.body), { body: editor.value });
  assert.deepEqual(JSON.parse(posts[1].init.body), { body: manual.body });
  assert.ok(posts.every(function(post) { return post.init.headers['X-CSRF-Token'] === 'editor-csrf'; }));
  assert.deepEqual(env.checked(), []);
  assert.equal(threads[0].resolved, false);
  assert.equal(env.document.querySelector('[data-import-edit="reply"]'), null);
  assert.equal(env.document.querySelector('[data-import-edit="' + manual.id + '"]'), null);
  assert.ok(env.document.querySelector('[data-import-edit="excluded"]'));
});


test('import offers duplicate prompt actions while focusing the AI response field', async function() {
  var env = await setup();
  var modal = env.document.querySelector('.gl-review-import-overlay');
  assert.equal(env.document.activeElement, env.input);
  assert.equal(modal.querySelector('.gl-review-prompt').readOnly, true);
  assert.equal(modal.querySelector('.gl-review-prompt-details').hidden, true);
  assert.ok(modal.textContent.includes(messages.aiReviewImportCopyPrompt.message));
  assert.ok(modal.textContent.includes(messages.aiReviewImportCopyAllReplyPrompt.message));
  assert.ok(modal.textContent.includes(messages.aiReviewImportCopyFormat.message));
});

test('format-only copying preserves the import preview without loading either task prompt', async function() {
  var env = await setup({ deferredClipboard: true });
  await env.preview([item('a'), item('b')]);
  await env.change(env.choose('b'), false);
  var input = env.input.value;
  await env.click('aiReviewImportCopyFormat');
  assert.equal(env.prompts.length + env.replyPrompts.length, 0);
  assert.equal(env.button('aiReviewImportCopyFormat').disabled, true);
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  assert.equal(env.document.querySelector('.gl-review-prompt').value, 'Standalone response format');
  assert.equal(env.document.querySelector('.gl-review-prompt').getAttribute('aria-label'), messages.aiReviewImportFormat.message);
  assert.notEqual(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewCopied.message);
  env.clipboardRequests[0].resolve(); await env.drain();
  assert.equal(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewCopied.message);
  assert.equal(env.input.value, input);
  assert.deepEqual(env.checked(), ['a']);
  assert.equal(env.publications.length, 0);
  assert.equal(env.button('aiReviewImportPublish').disabled, false);
  await env.click('aiReviewImportCopyPrompt');
  assert.equal(env.document.querySelector('.gl-review-prompt').getAttribute('aria-label'), messages.aiReviewImportPrompt.message);
});

test('format-only copying provides a manual fallback when clipboard access is unavailable', async function() {
  var env = await setup({ clipboardFailure: true });
  await env.click('aiReviewImportCopyFormat');
  var text = env.document.querySelector('.gl-review-prompt');
  assert.equal(env.document.activeElement, text);
  assert.equal(text.selectionEnd, text.value.length);
  assert.equal(env.document.querySelector('.gl-review-prompt-details').hidden, false);
  assert.equal(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewImportCopyFailed.message);
});

test('import has no action to save a reviewed version, even with no findings', async function() {
  var env = await setup({ workflow: true });
  await env.preview([]);
  assert.equal(env.document.querySelector('.gl-review-import-overlay').textContent.includes('Save reviewed version'), false);
  assert.equal(env.context.window.GlReviewWorkflow.saveCheckpoint, undefined);
  assert.equal(env.publications.length, 0);
});

test('import prompt copying preserves the checked response and selection and waits for clipboard success', async function() {
  var env = await setup({ deferredClipboard: true });
  await env.preview([item('a'), item('b')]);
  await env.change(env.choose('b'), false);
  var input = env.input.value;
  await env.click('aiReviewImportCopyPrompt');
  assert.equal(env.button('aiReviewImportPublish').disabled, true);
  env.prompts[0].resolve('Review prompt'); await env.drain();
  assert.notEqual(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewCopied.message);
  env.clipboardRequests[0].resolve(); await env.drain();
  assert.equal(env.document.querySelector('.gl-review-status').textContent, messages.aiReviewCopied.message);
  assert.equal(env.input.value, input);
  assert.deepEqual(env.checked(), ['a']);
  assert.equal(env.publications.length, 0);
  assert.equal(env.button('aiReviewImportPublish').disabled, false);
});
test('import reply prompt provides manual copy fallback and a failed next request clears stale text', async function() {
  var env = await setup({ clipboardFailure: true });
  await env.click('aiReviewImportCopyAllReplyPrompt');
  assert.equal(env.replyPrompts[0].context.iid, '12');
  env.replyPrompts[0].resolve('Reply prompt from saved instructions'); await env.drain();
  var prompt = env.document.querySelector('.gl-review-prompt');
  assert.equal(prompt.value, 'Reply prompt from saved instructions');
  assert.equal(env.document.activeElement, prompt);
  assert.equal(prompt.selectionEnd, prompt.value.length);
  await env.click('aiReviewImportCopyPrompt');
  env.prompts[0].reject(new Error('Metadata unavailable')); await env.drain();
  assert.equal(prompt.value, '');
  assert.equal(env.document.querySelector('.gl-review-prompt-details').hidden, true);
  assert.match(env.document.querySelector('.gl-review-status').textContent, /Metadata unavailable/);
});
['close', 'input'].forEach(function(action) {
  test(action + ' cancels import prompt loading and suppresses a late clipboard write', async function() {
    var env = await setup();
    await env.click('aiReviewImportCopyAllReplyPrompt');
    var request = env.replyPrompts[0];
    if (action === 'close') env.importUI.close();
    else await env.change(env.input, '{"version":1,"comments":[]}', 'input');
    assert.equal(request.options.signal.aborted, true);
    request.resolve('Outdated prompt'); await env.drain();
    assert.deepEqual(env.clipboard, []);
  });
});

['button', 'escape', 'backdrop', 'replace', 'copy'].forEach(function(action) {
  test('import discard confirmation protects input and editor on ' + action, async function() {
    var env = await setup({ settings: { ai_review_confirm_close: true } });
    await env.preview();
    var editor = await env.edit('a');
    await env.change(editor, 'Unsaved reply edits', 'input');
    var modal = env.document.querySelector('.gl-review-import-overlay');
    var asks = 0;
    env.context.window.confirm = function() { asks++; return false; };
    if (action === 'button') await env.click('aiReviewClose');
    else if (action === 'escape') env.document.dispatch('keydown', { key: 'Escape' });
    else if (action === 'backdrop') modal.dispatch('click', { target: modal });
    else if (action === 'replace') env.openImport();
    else await env.click('aiReviewOpen');
    assert.equal(asks, 1);
    assert.equal(env.document.querySelector('.gl-review-import-overlay'), modal);
    assert.equal(env.document.querySelector('.gl-review-import-editor-input').value, 'Unsaved reply edits');
    assert.equal(env.document.querySelectorAll('.gl-review-overlay').length, 1);
    env.context.window.confirm = function() { return true; };
    assert.equal(env.importUI.close(), true);
    assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
  });
});

test('cancel closing while sending keeps the request alive; confirming aborts further work', async function() {
  var env = await setup({ settings: { ai_review_confirm_close: true } }); await env.preview(); await env.click('aiReviewImportPublish');
  var request = env.publications[0]; var message;
  env.context.window.confirm = function(text) { message = text; return false; };
  assert.equal(env.importUI.close(), false);
  assert.equal(message, messages.aiReviewConfirmStopAndClose.message);
  assert.equal(request.options.signal.aborted, false);
  env.context.window.confirm = function() { return true; };
  assert.equal(env.importUI.close(), true);
  assert.equal(request.options.signal.aborted, true);
  request.resolve({ items: [{ id: 'a', status: 'published' }], warnings: [] }); await env.drain();
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
});

test('empty import closes without confirmation', async function() {
  var env = await setup();
  env.context.window.confirm = function() { throw new Error('Nothing entered'); };
  await env.click('aiReviewClose');
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), null);
});

function resolvableReply(id, extra) {
  return item(id, 'ready', Object.assign({ type: 'reply', discussion_id: '1'.repeat(40), note_id: 11,
    replyTo: { body: 'Please fix this.', resolvable: true, resolved: false } }, extra));
}

test('resolution is off by default, limited to open threads and follows selected replies', async function() {
  var env = await setup();
  await env.preview([resolvableReply('a'), resolvableReply('b'), item('new'), resolvableReply('general', { replyTo: { resolvable: false } }), resolvableReply('closed', { replyTo: { resolvable: true, resolved: true } })]);
  var checks = env.document.querySelectorAll('[data-import-resolve]');
  assert.equal(checks.length, 2);
  assert.equal(checks.every(check => !check.checked), true);
  await env.change(checks[0], true);
  await env.change(checks[1], true);
  await env.change(env.choose('b'), false);
  assert.equal(checks[1].disabled, true);
  await env.click('aiReviewImportPublish');
  assert.deepEqual(harness.plain(env.publications[0].options.resolveIds), ['a']);
  env.publications[0].resolve({ items: [{ id: 'a', status: 'published', resolveStatus: 'failed' }], warnings: [] });
  await env.drain();
  assert.ok(env.document.querySelector('.gl-review-import-preview-pane').textContent.includes(messages.aiReviewImportResolveFailed.message));
  assert.equal(env.choose('a').disabled, true);
  assert.equal(env.checked().includes('a'), false);
});

test('draft action ignores checked resolution and fresh input clears resolution choices', async function() {
  var env = await setup();
  await env.preview([resolvableReply('a')]);
  await env.change(env.document.querySelector('[data-import-resolve]'), true);
  await env.click('aiReviewImportAddDrafts');
  assert.deepEqual(harness.plain(env.publications[0].options.resolveIds), []);
  env.publications[0].resolve({ items: [{ id: 'a', status: 'draft' }], warnings: [] });
  await env.drain();
  await env.preview([resolvableReply('a')]);
  assert.equal(env.document.querySelector('[data-import-resolve]').checked, false);
  await env.click('aiReviewImportPublish');
  assert.deepEqual(harness.plain(env.publications[1].options.resolveIds), []);
});

test('editing a reply preserves an explicit resolve choice without adding it to AI JSON', async function() {
  var env = await setup();
  await env.preview([resolvableReply('a')]);
  await env.change(env.document.querySelector('[data-import-resolve]'), true);
  var editor = await env.edit('a');
  await env.change(editor, 'Verified and fixed.', 'input');
  await env.click('aiReviewImportSaveEdit');
  await env.finishRevision([resolvableReply('a', { body: 'Verified and fixed.' })]);
  assert.equal(env.document.querySelector('[data-import-resolve]').checked, true);
  assert.equal(env.input.value.includes('resolve'), false);
  await env.click('aiReviewImportPublish');
  assert.deepEqual(harness.plain(env.publications[0].options.resolveIds), ['a']);
});

test('import close confirmation is disabled by default, including stopping a send', async function() {
  var env = await setup(); await env.preview(); await env.click('aiReviewImportPublish');
  env.context.window.confirm = function() { throw new Error('Disabled by default'); };
  assert.equal(env.importUI.close(), true);
  assert.equal(env.publications[0].options.signal.aborted, true);
});

test('close preference updates an open import without discarding entered data', async function() {
  var env = await setup(); await env.preview();
  var modal = env.document.querySelector('.gl-review-import-overlay');
  env.context.window.confirm = function() { return false; };
  env.settingsEvents.forEach(fn => fn({ ai_review_confirm_close: { newValue: true } }, 'sync'));
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), modal);
  assert.equal(env.importUI.close(), false);
  env.settingsEvents.forEach(fn => fn({ ai_review_confirm_close: { newValue: false } }, 'sync'));
  assert.equal(env.document.querySelector('.gl-review-import-overlay'), modal);
  assert.equal(env.importUI.close(), true);
});

test('completed import closes without prompting even when confirmation is enabled', async function() {
  var env = await setup({ settings: { ai_review_confirm_close: true } });
  await env.preview([item('a'), item('b'), item('c', 'duplicate')]);
  await env.click('aiReviewImportPublish');
  env.publications[0].resolve({ items: [{ id: 'a', status: 'published' }, { id: 'b', status: 'draft' }] });
  await env.drain();
  env.context.window.confirm = function() { throw new Error('All work completed'); };
  assert.equal(env.importUI.close(), true);
});
