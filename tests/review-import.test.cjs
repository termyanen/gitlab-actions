'use strict';

var assert = require('node:assert/strict');
var test = require('node:test');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var crypto = require('node:crypto');
var source = fs.readFileSync(path.join(__dirname, '../review-import.js'), 'utf8');
var HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), START = 'c'.repeat(40);

function response(value, status, headers) { return new Response(JSON.stringify(value), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json' }, headers) }); }
function refs(extra) { return Object.assign({ head_sha: HEAD, base_sha: BASE, start_sha: START }, extra); }
function inline(extra) { return Object.assign({ id: 'R1', path: 'src/new.js', side: 'new', line: 3, code: '  changed();', body: 'При пустом вводе возникает ошибка. Добавьте проверку.' }, extra); }
function general(extra) { return Object.assign(inline(), { path: null, side: null, line: null, code: null }, extra); }
function position(extra) { return Object.assign({ position_type: 'text', old_path: 'src/old.js', new_path: 'src/new.js', old_line: null, new_line: 3 }, refs(), extra); }
function canonicalPosition(p) { return p && { position_type: 'text', base_sha: p.base_sha, start_sha: p.start_sha, head_sha: p.head_sha, old_path: p.old_path, new_path: p.new_path, old_line: p.old_line == null ? null : p.old_line, new_line: p.new_line == null ? null : p.new_line, line_range: p.line_range || null }; }

function environment(options) {
  options = options || {};
  var prefix = options.root || '';
  var web = 'https://gitlab.test' + prefix + '/team/repo/' + (options.legacy ? '' : '-/') + 'merge_requests/42';
  var context = { origin: 'https://gitlab.test', webUrl: web, projectPath: 'team/repo', kind: 'merge_requests', iid: '42', apiRoot: 'https://gitlab.test' + prefix + '/api/v4' };
  var requests = [], stored = options.stored || {}, writes = [], notes = options.notes || [], drafts = options.drafts || [];
  var state = { refs: refs(), metadataReads: 0, user: { id: 7 }, draftSupported: true };
  var window = { location: new URL(web + (options.suffix || '')) };
  var chrome = { runtime: {}, storage: { local: {} } };
  ['get', 'set', 'remove'].forEach(function(method) {
    chrome.storage.local[method] = function(arg, callback) {
      function complete() {
        if (options.storageFailure && options.storageFailure(method, arg, writes)) { chrome.runtime.lastError = { message: 'Storage failed' }; callback(); delete chrome.runtime.lastError; return; }
        if (method === 'get') { var result = {}; if (stored[arg]) result[arg] = stored[arg]; callback(result); }
        else if (method === 'set') { Object.assign(stored, arg); writes.push(JSON.parse(JSON.stringify(arg))); callback(); }
        else { delete stored[arg]; callback(); }
      }
      var gate = options.storageGate && options.storageGate(method, arg);
      if (gate) gate.then(complete); else complete();
    };
  });
  async function defaults(url, init) {
    var endpoint = url.pathname.split('/api/v4')[1];
    if (init.method === 'POST') {
      var body = JSON.parse(init.body), draft = endpoint.endsWith('/draft_notes');
      var note = draft ? { id: 100 + drafts.length, note: body.note, position: body.position, author_id: state.user.id } : { id: 200 + notes.length, body: body.body, position: body.position, author: { id: state.user.id } };
      if (draft) drafts.push(note); else notes.push(note);
      return response(draft ? note : { id: 'discussion-' + note.id, notes: [note] }, 201);
    }
    if (endpoint === '/user') return response(state.user);
    var singleNote = endpoint.match(/\/notes\/(\d+)$/);
    if (init.method === 'GET' && singleNote) {
      var found = notes.find(function(note) { return note.id === Number(singleNote[1]); });
      return response(found || {}, found ? 200 : 404);
    }
    if (endpoint.endsWith('/draft_notes')) return response(state.draftSupported ? drafts : { message: '404' }, state.draftSupported ? 200 : 404);
    if (endpoint.endsWith('/discussions')) return response(notes.map(function(note) { return { id: 'thread-' + note.id, notes: [note] }; }), 200, { 'x-next-page': '' });
    if (endpoint.endsWith('/diffs')) return response([{ old_path: 'src/old.js', new_path: 'src/new.js', renamed_file: true, diff: '@@ -1,3 +1,4 @@\n first();\n-old();\n+added();\n+  changed();\n tail();\n' }], 200, { 'x-next-page': '' });
    if (endpoint.endsWith('/merge_requests/42')) {
      state.metadataReads++;
      if (options.onMetadata) options.onMetadata(state);
      return response({ iid: 42, title: 'Handle input', sha: state.refs.head_sha, diff_refs: state.refs });
    }
    throw new Error('Unexpected request: ' + url);
  }
  var sandbox = vm.createContext({
    window: window, chrome: chrome, URL: URL, AbortController: AbortController, TextEncoder: TextEncoder,
    navigator: options.locks ? { locks: options.locks } : {},
    setTimeout: options.fastTimeout ? function(fn) { return setTimeout(fn, 5); } : setTimeout, clearTimeout: clearTimeout,
    fetch: async function(address, init) {
      var url = new URL(address);
      assert.equal(url.origin, context.origin);
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      if (init.method === 'POST' || init.method === 'PUT') { assert.equal(init.headers['X-CSRF-Token'], 'token'); assert.equal(init.headers['X-Requested-With'], 'XMLHttpRequest'); }
      requests.push({ url: url, init: init });
      if (options.handler) return options.handler(url, init, defaults, state);
      return defaults(url, init);
    }
  });
  if (options.workflow) vm.runInContext(fs.readFileSync(path.join(__dirname, '../review-workflow.js'), 'utf8'), sandbox);
  vm.runInContext(source, sandbox, { filename: 'review-import.js' });
  return {
    chrome: chrome, api: window.GlReviewImport, context: context, state: state, window: window, requests: requests, stored: stored, writes: writes, notes: notes, drafts: drafts,
    json: function(items, extra) { return JSON.stringify(Object.assign({ version: 1, mr_url: web, head_sha: HEAD, comments: items || [inline()] }, extra)); },
    posts: function() { return requests.filter(function(r) { return r.init.method === 'POST'; }); }
  };
}
function send(env, plan, ids, options) { return env.api.publish(plan, ids || plan.items.filter(function(item) { return item.status === 'ready'; }).map(function(item) { return item.id; }), Object.assign({ csrfToken: 'token', mode: 'publish' }, options)); }

var THREAD_A = '1'.repeat(40), THREAD_B = '2'.repeat(40), THREAD_C = '3'.repeat(40), THREAD_D = '4'.repeat(40);

test('standalone response format needs no network or settings and all three examples are importable after filling targets', async function() {
  var env = replyEnvironment();
  env.chrome.storage.sync = { get: function() { throw new Error('Format must not load saved prompts'); } };
  var format = env.api.getResponseFormat();
  assert.equal(env.requests.length, 0);
  assert.equal(env.writes.length, 0);
  assert.equal(format.includes(env.api.DEFAULT_REVIEW_PROMPT), false);
  assert.equal(format.includes(env.api.DEFAULT_REPLY_PROMPT), false);
  assert.match(format, /actually reviewed/);
  var example = JSON.parse(format.slice(format.indexOf('{')));
  example.mr_url = env.context.webUrl;
  example.head_sha = HEAD;
  Object.assign(example.comments[0], inline());
  example.comments[2].discussion_id = THREAD_A;
  example.comments[2].note_id = 11;
  var plan = await env.api.prepare(env.context, JSON.stringify(example));
  assert.deepEqual(Array.from(plan.items, function(item) { return item.status; }), ['ready', 'ready', 'ready']);
  assert.equal(env.posts().length, 0);
});
function reply(extra) { return Object.assign({ id: 'R1', type: 'reply', discussion_id: THREAD_A, note_id: 11, body: 'Добавлена проверка пустого ввода в validateInput; вместо исключения возвращается ошибка валидации. Проверки не запускались.' }, extra); }
function replyEnvironment(options) {
  options = options || {};
  var historical = position({ head_sha: 'f'.repeat(40), old_line: 90, new_line: 93 });
  var threads = options.threads || [
    { id: THREAD_A, individual_note: false, notes: [
      { id: 11, body: 'Проверьте пустой ввод.', author: { id: 9, name: 'Reviewer', username: 'reviewer' }, resolvable: true, resolved: false, position: historical },
      { id: 12, body: 'Падает также при null.', author: { id: 8 }, resolvable: true, resolved: false },
      { id: 13, body: 'System entry', author: { id: 7 }, system: true }
    ] },
    { id: THREAD_B, individual_note: false, notes: [{ id: 21, body: 'Проверьте timeout.', author: { id: 9 }, resolvable: true, resolved: false }] },
    { id: THREAD_C, individual_note: false, notes: [{ id: 31, body: 'Already resolved feedback', author: { id: 9 }, resolvable: true, resolved: true }] },
    { id: THREAD_D, individual_note: true, notes: [{ id: 41, body: 'General feedback', author: { id: 9 }, resolvable: false }] }
  ];
  var drafts = options.drafts || [], sequence = 300;
  var env = environment(Object.assign({}, options, { drafts: drafts, handler: function(url, init, defaults, state) {
    async function replyDefaults(url, init) {
      var singleNote = url.pathname.match(/\/notes\/(\d+)$/);
      if (init.method === 'GET' && singleNote) {
        var found = threads.flatMap(function(thread) { return thread.notes; }).find(function(note) { return note.id === Number(singleNote[1]); });
        return response(found || {}, found ? 200 : 404);
      }
      var match = url.pathname.match(/\/discussions\/([a-f0-9]{40})(\/notes)?$/);
      if (init.method === 'GET' && url.pathname.endsWith('/discussions')) return response(threads, 200, { 'x-next-page': '' });
      if (match) {
        var thread = threads.find(function(item) { return item.id === match[1]; });
        if (!thread) return response({}, 404);
        if (init.method === 'GET') return response(thread);
        if (init.method === 'PUT') {
          assert.equal(match[2], undefined);
          assert.deepEqual(JSON.parse(init.body), { resolved: true });
          thread.notes.forEach(function(note) { if (note.resolvable) note.resolved = true; });
          return response(thread);
        }
        assert.equal(match[2], '/notes');
        var payload = JSON.parse(init.body);
        var note = { id: sequence++, body: payload.body, author: { id: state.user.id }, resolvable: true, resolved: false, position: thread.notes[0].position || null };
        thread.notes.push(note);
        return response(note, 201);
      }
      if (init.method === 'POST' && url.pathname.endsWith('/draft_notes')) {
        var body = JSON.parse(init.body);
        if (body.in_reply_to_discussion_id) {
          var draft = { id: sequence++, note: body.note, author_id: state.user.id, discussion_id: body.in_reply_to_discussion_id, position: null, resolve_discussion: false };
          drafts.push(draft); return response(draft, 201);
        }
      }
      return defaults(url, init);
    }
    return options.handler ? options.handler(url, init, replyDefaults, state) : replyDefaults(url, init);
  } }));
  env.threads = threads;
  return env;
}

test('prompt includes current MR and head, requires repository review and strict import output', async function() {
  var env = environment();
  var prompt = await env.api.getPrompt(env.context);
  assert.ok(prompt.includes(env.context.webUrl)); assert.ok(prompt.includes(HEAD));
  assert.match(prompt, /every changed file/); assert.match(prompt, /Do not modify files or post to GitLab/);
  assert.match(prompt, /all its commits/); assert.match(prompt, /response language requested by the user/);
  assert.doesNotMatch(prompt, /Russian|на русском/); assert.match(prompt, /empty comments array/); assert.match(prompt, /exact selected code line/);
  assert.equal(env.requests.length, 1); assert.equal(env.posts().length, 0);
});

test('preview verifies new, removed, context lines and server rename mapping without writes', async function() {
  var env = environment();
  var plan = await env.api.prepare(env.context, env.json([
    inline(), inline({ id: 'R2', path: 'src/old.js', side: 'old', line: 2, code: 'old();', body: 'Удаление нарушает поведение.' }),
    inline({ id: 'R3', line: 4, code: 'tail();', body: 'Контекст после вставки.' }), general({ id: 'R4' })
  ]));
  assert.deepEqual(Array.from(plan.items, function(i) { return i.status; }), ['ready', 'ready', 'ready', 'ready']);
  assert.equal(plan.items[0].position.old_path, 'src/old.js'); assert.equal(plan.items[0].position.old_line, null);
  assert.equal(plan.items[1].position.old_line, 2); assert.equal(plan.items[1].position.new_line, null);
  assert.equal(plan.items[2].position.old_line, 3); assert.equal(plan.items[2].position.new_line, 4);
  assert.equal(plan.items[3].position, null); assert.equal(env.posts().length, 0); assert.equal(plan.draftSupported, true);
});

test('strict JSON accepts one complete fence, rejects wrong identity/version/IDs and limits', async function() {
  var env = environment();
  var plan = await env.api.prepare(env.context, '```json\n' + env.json([]) + '\n```');
  assert.equal(plan.items.length, 0);
  for (var bad of [env.json([], { version: 2 }), env.json([], { mr_url: env.context.webUrl.replace('/42', '/43') }), env.json([], { head_sha: 'main' }), env.json([inline(), inline()]), env.json([inline({ id: '' })]), 'Here is JSON:\n' + env.json([]), 'x'.repeat(1024 * 1024 + 1)]) {
    await assert.rejects(env.api.prepare(env.context, bad));
  }
  assert.equal(env.posts().length, 0);
});

test('individual unsafe or unverified comments stay invalid while other entries remain usable', async function() {
  var env = environment();
  var invalid = [inline({ path: '../escape.js' }), inline({ line: 500 }), inline({ code: 'changed();' }), inline({ side: 'left' }), inline({ line: 0 }), inline({ code: 'a\nb' }), general({ code: undefined }), inline({ body: '' })];
  invalid.forEach(function(item, index) { item.id = 'invalid-' + index; });
  var plan = await env.api.prepare(env.context, env.json(invalid.concat([general({ id: 'good' })])));
  assert.ok(plan.items.slice(0, -1).every(function(item) { return item.status === 'invalid'; }));
  var output = await send(env, plan, ['invalid-0', 'good']);
  assert.deepEqual(Array.from(output.items, function(i) { return i.status; }), ['skipped', 'published']);
  assert.equal(env.posts().length, 1);
});

test('quick actions cannot execute through CR removal, mixed fences or unterminated fences', async function() {
  var env = environment();
  var bodies = ['/merge', 'Explanation\n/close', '/\rmerge', '/merge\v\n', '/merge\f\n', '```\n/merge\n```', '~~~\n```\n~~~\n/merge\n```', '<div>\n```\n</div>\n\n/merge\n```', '```text\n/close'];
  var plan = await env.api.prepare(env.context, env.json(bodies.map(function(body, index) { return general({ id: 'R' + index, body: body }); }).concat([general({ id: 'safe', body: 'Команда `/close` опасна.\n\n    /close' })])));
  assert.ok(plan.items.slice(0, -1).every(function(item) { return item.status === 'invalid'; }));
  assert.equal(plan.items[plan.items.length - 1].status, 'ready');
  await send(env, plan, bodies.map(function(body, index) { return 'R' + index; }));
  assert.equal(env.posts().length, 0);
});

test('legacy changes fallback and relative-root legacy MR routes preserve exact API root', async function() {
  var env = environment({ root: '/gitlab', legacy: true, suffix: '/diffs', handler: function(url, init, defaults) {
    if (url.pathname.endsWith('/diffs')) return response({}, 404);
    if (url.pathname.endsWith('/changes')) return response({ overflow: true, changes: [{ old_path: 'src/new.js', new_path: 'src/new.js', diff: '@@ -0,0 +3 @@\n+  changed();\n' }] });
    return defaults(url, init);
  } });
  var plan = await env.api.prepare(env.context, env.json());
  assert.equal(plan.items[0].status, 'ready'); assert.ok(plan.warnings.some(function(w) { return /limited/.test(w); }));
  await send(env, plan);
  assert.ok(env.requests.every(function(r) { return r.url.pathname.indexOf('/gitlab/api/v4/') === 0; }));
});

test('partial, binary and truncated diff files never receive guessed inline anchors', async function() {
  for (var file of [{ diff: '@@ -1,3 +1,3 @@\n same\n' }, { diff: 'Binary files differ' }, { diff: '@@ -1 +3 @@\n+  changed();\n', too_large: true }, { diff: '' }]) {
    var env = environment({ handler: function(url, init, defaults) {
      if (url.pathname.endsWith('/diffs')) return response([Object.assign({ old_path: 'src/new.js', new_path: 'src/new.js' }, file)], 200, { 'x-next-page': '' });
      return defaults(url, init);
    } });
    var plan = await env.api.prepare(env.context, env.json());
    assert.equal(plan.items[0].status, 'invalid');
    await send(env, plan, ['R1']); assert.equal(env.posts().length, 0);
  }
});

test('paginated diffs and discussions are fully read even without headers on capped pages', async function() {
  var env = environment({ handler: function(url, init, defaults) {
    var page = Number(url.searchParams.get('page'));
    if (url.pathname.endsWith('/diffs')) {
      if (page === 1) return response([{ old_path: 'other.js', new_path: 'other.js', diff: '@@ -0,0 +1 @@\n+x\n' }]);
      if (page === 2) return response([{ old_path: 'src/old.js', new_path: 'src/new.js', diff: '@@ -0,0 +3 @@\n+  changed();\n' }]);
      return response([]);
    }
    if (url.pathname.endsWith('/discussions')) return response(page === 1 ? [{ id: 'old', notes: [{ id: 1, body: 'Earlier', author: { id: 9 } }] }] : []);
    return defaults(url, init);
  } });
  var plan = await env.api.prepare(env.context, env.json());
  assert.equal(plan.items[0].status, 'ready');
  assert.equal(env.requests.filter(function(r) { return r.url.pathname.endsWith('/diffs'); }).length, 3);
  assert.equal(env.requests.filter(function(r) { return r.url.pathname.endsWith('/discussions'); }).length, 2);
});

test('draft list is unpaginated and existing exact authored comments/drafts are duplicates', async function() {
  var env = environment({
    notes: [{ id: 1, body: inline().body, position: position(), author: { id: 7 } }, { id: 2, body: 'Not mine', author: { id: 8 } }],
    drafts: [{ id: 3, note: 'Draft text', author_id: 7, position: { position_type: 'text', old_path: null, new_path: null } }]
  });
  var plan = await env.api.prepare(env.context, env.json([inline(), general({ id: 'draft', body: 'Draft text' }), general({ id: 'new', body: 'Not mine' })]));
  assert.deepEqual(Array.from(plan.items, function(i) { return i.status; }), ['duplicate', 'duplicate', 'ready']);
  assert.match(plan.items[0].existingUrl, /#note_1$/); assert.match(plan.items[1].existingUrl, /#draft_3$/);
  assert.equal(env.requests.filter(function(r) { return r.url.pathname.endsWith('/draft_notes'); }).length, 1);
});

test('same body at another position or another author is not accidentally suppressed', async function() {
  var env = environment({ notes: [{ id: 1, body: inline().body, position: position({ new_line: 2 }), author: { id: 7 } }, { id: 2, body: inline().body, position: position(), author: { id: 8 } }] });
  var plan = await env.api.prepare(env.context, env.json([inline(), inline({ id: 'copy' })]));
  assert.deepEqual(Array.from(plan.items, function(i) { return i.status; }), ['ready', 'duplicate']);
});

test('publication sends only selected validated payloads and isolates the internal plan from mutation', async function() {
  var progress = [], env = environment();
  var plan = await env.api.prepare(env.context, env.json([inline(), general({ id: 'general', body: 'General' })]));
  plan.items[0].body = '/merge'; plan.items[0].position.new_line = 99; plan.context.webUrl = 'https://evil.test'; plan.refs.head_sha = 'evil';
  var output = await send(env, plan, ['R1'], { onProgress: function(p) { progress.push(p); } });
  assert.equal(output.items[0].status, 'published'); assert.match(output.items[0].url, /#note_200$/);
  var payload = JSON.parse(env.posts()[0].init.body);
  assert.equal(payload.body, inline().body); assert.equal(payload.position.new_line, 3); assert.equal(payload.position.old_line, undefined);
  assert.equal(progress[0].phase, 'publishing'); assert.equal(progress[0].completed, 1); assert.equal(progress[0].item.status, 'published');
  assert.equal(env.posts().length, 1);
  await assert.rejects(send(env, JSON.parse(JSON.stringify(plan)), ['R1']), function(e) { return e.beforeSend === true; });
});

test('draft mode uses note field, remains unpublished, and never invokes bulk publication', async function() {
  var env = environment();
  var plan = await env.api.prepare(env.context, env.json());
  var output = await send(env, plan, ['R1'], { mode: 'draft' });
  assert.equal(output.items[0].status, 'draft'); assert.match(output.items[0].url, /#draft_100$/);
  var request = env.posts()[0]; assert.ok(request.url.pathname.endsWith('/draft_notes'));
  assert.equal(JSON.parse(request.init.body).note, inline().body); assert.equal(JSON.parse(request.init.body).body, undefined);
  assert.equal(env.notes.length, 0); assert.equal(env.posts().length, 1);
});

test('unsupported draft API disables drafts but retains explicitly chosen publication', async function() {
  var env = environment(); env.state.draftSupported = false;
  var plan = await env.api.prepare(env.context, env.json([general()]));
  assert.equal(plan.draftSupported, false);
  await assert.rejects(send(env, plan, ['R1'], { mode: 'draft' }), function(e) { return e.beforeSend === true && /cannot add review drafts/.test(e.message); });
  assert.equal(env.posts().length, 0);
  assert.equal((await send(env, plan)).items[0].status, 'published');
});

test('stale reviewed heads and refs changed during preview or between writes stop sending', async function() {
  var env = environment(); env.state.refs = refs({ head_sha: 'd'.repeat(40) });
  await assert.rejects(env.api.prepare(env.context, env.json()), /changed since/);
  var midPreview = environment({ onMetadata: function(state) { if (state.metadataReads === 2) state.refs = refs({ base_sha: 'd'.repeat(40) }); } });
  await assert.rejects(midPreview.api.prepare(midPreview.context, midPreview.json()), /changed while/);
  var changed = environment();
  var plan = await changed.api.prepare(changed.context, changed.json()); changed.state.refs = refs({ start_sha: 'e'.repeat(40) });
  await assert.rejects(send(changed, plan), function(e) { return e.beforeSend === true && /changed after/.test(e.message); });
  var batch = environment({ handler: async function(url, init, defaults, state) { var result = await defaults(url, init); if (init.method === 'POST') state.refs = refs({ base_sha: 'd'.repeat(40) }); return result; } });
  var batchPlan = await batch.api.prepare(batch.context, batch.json([general(), general({ id: 'R2', body: 'Second' })]));
  var output = await send(batch, batchPlan);
  assert.deepEqual(Array.from(output.items, function(i) { return i.status; }), ['published', 'skipped']); assert.equal(batch.posts().length, 1);
});

test('route changes and foreign contexts cannot send to a stale MR or another site', async function() {
  var env = environment();
  await assert.rejects(env.api.getPrompt(Object.assign({}, env.context, { origin: 'https://evil.test', webUrl: 'https://evil.test/team/repo/-/merge_requests/42', apiRoot: 'https://evil.test/api/v4' })));
  var plan = await env.api.prepare(env.context, env.json());
  env.window.location = new URL(env.context.webUrl.replace('/42', '/43'));
  await assert.rejects(send(env, plan), function(e) { return e.beforeSend === true && /open merge request has changed/.test(e.message); });
  assert.equal(env.posts().length, 0);
  var nav = environment({ handler: async function(url, init, defaults) { var result = await defaults(url, init); if (init.method === 'POST') nav.window.location = new URL(nav.context.webUrl.replace('/42', '/43')); return result; } });
  var next = await nav.api.prepare(nav.context, nav.json([general(), general({ id: 'R2', body: 'Second' })]));
  var output = await send(nav, next);
  assert.deepEqual(Array.from(output.items, function(i) { return i.status; }), ['published', 'failed']); assert.equal(nav.posts().length, 1);
});

test('unknown POST outcomes are never retried and survive dialog/reload through local hashed journal', async function() {
  var stored = {}, env = environment({ stored: stored, handler: function(url, init, defaults) { if (init.method === 'POST') throw new Error('Lost connection'); return defaults(url, init); } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  var output = await send(env, plan);
  assert.equal(output.items[0].status, 'unknown'); assert.equal(env.posts().length, 1);
  assert.equal((await send(env, plan)).items[0].status, 'unknown'); assert.equal(env.posts().length, 1);
  var reopened = environment({ stored: stored });
  var checked = await reopened.api.prepare(reopened.context, reopened.json([general()]));
  assert.equal(checked.items[0].status, 'invalid'); assert.match(checked.items[0].message, /unknown result/);
  assert.ok(!JSON.stringify(stored).includes(general().body));
});

test('lost POST response reconciles a saved authored note without a second POST', async function() {
  var env = environment({ handler: async function(url, init, defaults) { var result = await defaults(url, init); if (init.method === 'POST') throw new Error('Response lost'); return result; } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  var output = await send(env, plan);
  assert.equal(output.items[0].status, 'published'); assert.match(output.items[0].message, /interrupted response/); assert.equal(env.posts().length, 1);
  assert.equal((await send(env, plan)).items[0].status, 'duplicate'); assert.equal(env.posts().length, 1);
});

test('confirmed success remains successful when its local progress write fails', async function() {
  var env = environment({ storageFailure: function(method, argument) { return method === 'set' && Object.values(argument).some(function(item) { return item.status === 'published'; }); } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  var output = await send(env, plan);
  assert.equal(output.items[0].status, 'published'); assert.ok(output.warnings.some(function(w) { return /browser could not save/.test(w); }));
  assert.equal(env.posts().length, 1);
});

test('confirmed ledger prevents eventual-consistency duplicates after a fresh import', async function() {
  var env = environment({ handler: function(url, init, defaults) {
    if (init.method === 'GET' && url.pathname.endsWith('/discussions')) return response([], 200, { 'x-next-page': '' });
    return defaults(url, init);
  } });
  var plan = await env.api.prepare(env.context, env.json([general()])); await send(env, plan);
  var again = await env.api.prepare(env.context, env.json([general({ id: 'new-id' })]));
  assert.equal(again.items[0].status, 'duplicate');
  assert.equal((await send(env, plan)).items[0].status, 'duplicate'); assert.equal(env.posts().length, 1);
});

test('definitive rejected POST can be explicitly retried; access and missing CSRF fail before sending', async function() {
  var failures = 1, env = environment({ handler: function(url, init, defaults) { if (init.method === 'POST' && failures--) return response({ message: 'validation' }, 422); return defaults(url, init); } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  await assert.rejects(send(env, plan, ['R1'], { csrfToken: '' }), function(e) { return e.beforeSend === true; });
  assert.equal(env.posts().length, 0);
  assert.equal((await send(env, plan)).items[0].status, 'failed');
  assert.equal((await send(env, plan)).items[0].status, 'published'); assert.equal(env.posts().length, 2);
  env.state.user = { id: 8 };
  await assert.rejects(send(env, plan), function(e) { return e.beforeSend === true && /account changed/.test(e.message); });
});

test('cancellation after uncertain POST locks that item and skips the remaining batch', async function() {
  var controller = new AbortController();
  var env = environment({ handler: function(url, init, defaults) { if (init.method === 'POST') { controller.abort(); throw new Error('Cancelled'); } return defaults(url, init); } });
  var plan = await env.api.prepare(env.context, env.json([general(), general({ id: 'R2', body: 'Second' })]));
  var output = await send(env, plan, ['R1', 'R2'], { signal: controller.signal });
  assert.deepEqual(Array.from(output.items, function(i) { return i.status; }), ['unknown', 'skipped']); assert.equal(env.posts().length, 1);
});

test('read and mutation timeouts are bounded; an unconfirmed write is marked unknown', async function() {
  var env = environment({ fastTimeout: true, handler: function(url, init, defaults) { if (init.method === 'POST') return new Promise(function() {}); return defaults(url, init); } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  assert.equal((await send(env, plan)).items[0].status, 'unknown'); assert.equal(env.posts().length, 1);
});

test('journal digests match SHA-256 for Unicode and multi-block input without saving comment bodies', async function() {
  var env = environment();
  var items = [general({ body: 'Привет 🌍' }), general({ id: 'R2', body: 'A'.repeat(400) })];
  var plan = await env.api.prepare(env.context, env.json(items)); await send(env, plan);
  items.forEach(function(item) {
    var raw = JSON.stringify([env.context.webUrl, 7, item.body, canonicalPosition(null)]);
    var key = 'glReviewImportPending:' + crypto.createHash('sha256').update(raw).digest('hex');
    assert.equal(env.stored[key].status, 'published');
  });
  assert.ok(!JSON.stringify(env.stored).includes(items[0].body));
});

test('local import progress is scoped to the current GitLab account', async function() {
  var env = environment();
  var plan = await env.api.prepare(env.context, env.json([general()])); await send(env, plan);
  env.state.user = { id: 8 };
  var anotherAccount = await env.api.prepare(env.context, env.json([general()]));
  assert.equal(anotherAccount.items[0].status, 'ready');
});

test('a draft or published response that omits the requested location is never accepted as success', async function() {
  var env = environment({ handler: function(url, init, defaults) {
    if (init.method === 'POST') return response({ id: 'wrong', notes: [{ id: 9, body: inline().body }] }, 201);
    return defaults(url, init);
  } });
  var plan = await env.api.prepare(env.context, env.json());
  assert.equal((await send(env, plan)).items[0].status, 'unknown'); assert.equal(env.posts().length, 1);
});

test('failure to persist pending state stops the comment before POST', async function() {
  var env = environment({ storageFailure: function(method, argument) { return method === 'set' && Object.values(argument).some(function(item) { return item.status === 'pending'; }); } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  assert.equal((await send(env, plan)).items[0].status, 'failed'); assert.equal(env.posts().length, 0);
});

test('incomplete existing-comment pagination or access denial blocks mutation', async function() {
  for (var failure of ['repeated', 'denied']) {
    var env = environment({ handler: function(url, init, defaults) {
      if (url.pathname.endsWith('/discussions')) return failure === 'denied' ? response({}, 403) : response([{ id: 'same', notes: [] }]);
      return defaults(url, init);
    } });
    await assert.rejects(env.api.prepare(env.context, env.json([general()])));
    assert.equal(env.posts().length, 0);
  }
});

test('reply prompt includes complete unresolved discussions and historical anchors with factual-fix instructions', async function() {
  var env = replyEnvironment();
  env.threads[0].notes[1].position = env.threads[0].notes[0].position;
  env.threads[0].notes[0].original_position = env.threads[0].notes[0].position;
  var prompt = await env.api.getReplyPrompt(env.context);
  assert.ok(prompt.includes(HEAD)); assert.ok(prompt.includes(env.context.webUrl));
  assert.ok(prompt.includes(THREAD_A)); assert.ok(prompt.includes(THREAD_B));
  assert.ok(!prompt.includes(THREAD_C)); assert.ok(!prompt.includes(THREAD_D));
  assert.ok(prompt.includes('Проверьте пустой ввод.')); assert.ok(prompt.includes('Падает также при null.'));
  assert.ok(!prompt.includes('System entry')); assert.ok(prompt.includes('f'.repeat(40)));
  assert.equal(prompt.split('f'.repeat(40)).length - 1, 1, 'the same code location is included once per discussion');
  assert.ok(!prompt.includes('"position"')); assert.ok(!prompt.includes('"original_position"')); assert.ok(!prompt.includes('"original_location"'));
  assert.equal(prompt.split('#note_11').length - 1, 1, 'the root permalink is not repeated on each comment');
  assert.match(prompt, /Do not claim unpushed local edits/); assert.match(prompt, /Do not invent fixes, commits, tests run/);
  assert.match(prompt, /partially fixed/); assert.match(prompt, /Do not modify code, post to GitLab, resolve or reopen/);
  assert.match(prompt, /"note_id": 11/); assert.match(prompt, /"type": "reply"/);
  assert.match(prompt, /response language requested by the user/); assert.doesNotMatch(prompt, /Russian replies/);
  assert.equal(env.posts().length, 0); assert.ok(!env.requests.some(function(r) { return r.url.pathname.endsWith('/diffs'); }));
});

test('reply prompt keeps a distinct original anchor and the old-side revision when needed', async function() {
  var env = replyEnvironment();
  env.threads[0].notes[0].original_position = position({ old_path: 'deleted.js', old_line: 19, new_line: null, head_sha: 'e'.repeat(40) });
  var prompt = await env.api.getReplyPrompt(env.context);
  assert.match(prompt, /"original_location"/); assert.match(prompt, /"path": "deleted.js"/);
  assert.match(prompt, /"side": "old"/); assert.ok(prompt.includes(BASE));
});

test('reply prompt refuses incomplete pagination instead of silently omitting open threads', async function() {
  var env = replyEnvironment({ handler: function(url, init, defaults) {
    if (url.pathname.endsWith('/discussions')) {
      if (url.searchParams.get('page') === '1') return response([{ id: THREAD_A, notes: [{ id: 11, body: 'First', resolvable: true, resolved: false }] }], 200, { 'x-next-page': '2' });
      return response({}, 503);
    }
    return defaults(url, init);
  } });
  await assert.rejects(env.api.getReplyPrompt(env.context), /HTTP 503/); assert.equal(env.posts().length, 0);
});

test('replies keep old code locations only as preview context and post to the exact existing thread', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  assert.equal(plan.items[0].status, 'ready'); assert.equal(plan.items[0].type, 'reply');
  assert.equal(plan.items[0].replyTo.body, 'Проверьте пустой ввод.'); assert.equal(plan.items[0].replyTo.path, 'src/new.js');
  assert.equal(plan.items[0].replyTo.line, 93); assert.equal(plan.items[0].replyTo.author.username, 'reviewer');
  assert.equal(plan.items[0].replyTo.resolved, false); assert.match(plan.items[0].replyTo.url, /#note_11$/);
  assert.equal(plan.items[0].position, null);
  var output = await send(env, plan);
  assert.equal(output.items[0].status, 'published');
  assert.ok(env.posts()[0].url.pathname.endsWith('/discussions/' + THREAD_A + '/notes'));
  assert.deepEqual(JSON.parse(env.posts()[0].init.body), { body: reply().body });
  assert.ok(!env.requests.some(function(r) { return r.url.pathname.endsWith('/diffs') || r.init.method === 'PUT'; }));
});

test('deleted-line reply previews and prompts use the old path of a renamed file', async function() {
  var env = replyEnvironment();
  env.threads[0].notes[0].position = position({ old_line: 12, new_line: null });
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  assert.equal(plan.items[0].replyTo.path, 'src/old.js'); assert.equal(plan.items[0].replyTo.line, 12); assert.equal(plan.items[0].replyTo.side, 'old');
  var prompt = await env.api.getReplyPrompt(env.context);
  assert.match(prompt, /"path": "src\/old.js"/); assert.match(prompt, /"side": "old"/);
});

test('commit comments displayed in MR context cannot become imported MR replies', async function() {
  var env = replyEnvironment(); env.threads[0].notes[0].noteable_type = 'Commit';
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  assert.equal(plan.items[0].status, 'invalid');
  await send(env, plan, ['R1']); assert.equal(env.posts().length, 0);
  var laterNote = await env.api.prepare(env.context, env.json([reply({ note_id: 12 })]));
  assert.equal(laterNote.items[0].status, 'invalid', 'a later note without explicit noteable_type cannot bypass a commit-thread root');
  var prompt = await env.api.getReplyPrompt(env.context); assert.ok(!prompt.includes(THREAD_A));
});

test('reply target must be an exact non-system published note in its specified MR discussion', async function() {
  var env = replyEnvironment();
  var inputs = [reply({ note_id: 21 }), reply({ note_id: 13 }), reply({ note_id: '11' }), reply({ discussion_id: THREAD_C, note_id: 11 }), reply({ discussion_id: '51' }), reply({ path: 'src/new.js' }), reply({ position: position() }), reply({ resolved: true }), reply({ resolve_discussion: true }), reply({ type: 'comment' })];
  inputs.forEach(function(item, index) { item.id = 'bad-' + index; });
  inputs.push(reply({ id: 'valid-reply', note_id: 12 }));
  var plan = await env.api.prepare(env.context, env.json(inputs));
  assert.ok(plan.items.slice(0, -1).every(function(item) { return item.status === 'invalid'; }));
  assert.equal(plan.items[plan.items.length - 1].status, 'ready');
  assert.equal(plan.items[plan.items.length - 1].replyTo.body, 'Падает также при null.');
  await assert.rejects(env.api.prepare(env.context, env.json([reply()], { mr_url: env.context.webUrl.replace('/42', '/43') })), /different merge request/);
  assert.equal(env.posts().length, 0);
});

test('the same reply text is independent across threads and separate from a new general comment', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply({ body: 'Исправлено.' }), reply({ id: 'R2', discussion_id: THREAD_B, note_id: 21, body: 'Исправлено.' })]));
  assert.deepEqual(Array.from(plan.items, function(item) { return item.status; }), ['ready', 'ready']);
  var output = await send(env, plan);
  assert.deepEqual(Array.from(output.items, function(item) { return item.status; }), ['published', 'published']); assert.equal(env.posts().length, 2);
  var repeated = await env.api.prepare(env.context, env.json([reply({ body: 'Исправлено.' }), general({ id: 'general', body: 'Исправлено.' })]));
  assert.deepEqual(Array.from(repeated.items, function(item) { return item.status; }), ['duplicate', 'ready']);
});

test('one draft reply per thread is protected without blocking explicit publication or overwriting', async function() {
  var env = replyEnvironment({ drafts: [{ id: 90, author_id: 7, note: 'Существующий черновик', discussion_id: THREAD_A, position: null }] });
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  assert.equal(plan.items[0].status, 'ready'); assert.match(plan.items[0].message, /different draft reply/);
  assert.equal((await send(env, plan, ['R1'], { mode: 'draft' })).items[0].status, 'failed');
  assert.equal(env.posts().length, 0); assert.equal(env.drafts[0].note, 'Существующий черновик');
  assert.equal((await send(env, plan)).items[0].status, 'published');
  assert.equal(env.posts().length, 1); assert.ok(env.posts()[0].url.pathname.endsWith('/notes'));
});

test('reply draft uses the server discussion hash and never sends resolve or a new diff position', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  var output = await send(env, plan, ['R1'], { mode: 'draft' });
  assert.equal(output.items[0].status, 'draft');
  assert.deepEqual(JSON.parse(env.posts()[0].init.body), { note: reply().body, in_reply_to_discussion_id: THREAD_A });
  assert.ok(env.posts()[0].url.pathname.endsWith('/draft_notes'));
  var again = await env.api.prepare(env.context, env.json([reply()]));
  assert.equal(again.items[0].status, 'duplicate'); assert.match(again.items[0].existingUrl, /#draft_300$/);
});

test('numeric or mismatched draft discussion identifiers are not accepted as confirmed reply links', async function() {
  for (var returnedId of [613, THREAD_B]) {
    var env = replyEnvironment({ handler: function(url, init, defaults) {
      if (init.method === 'POST' && url.pathname.endsWith('/draft_notes')) return response({ id: 500, note: reply().body, discussion_id: returnedId }, 201);
      return defaults(url, init);
    } });
    var plan = await env.api.prepare(env.context, env.json([reply()]));
    assert.equal((await send(env, plan, ['R1'], { mode: 'draft' })).items[0].status, 'unknown');
    assert.equal((await send(env, plan, ['R1'], { mode: 'draft' })).items[0].status, 'unknown');
    assert.equal(env.posts().length, 1);
  }
});

test('deleted targets, edited comments, new participant replies and resolution changes invalidate a preview', async function() {
  var changes = [
    function(thread) { thread.notes = thread.notes.filter(function(note) { return note.id !== 11; }); },
    function(thread) { thread.notes[0].body = 'Другое замечание после редактирования'; },
    function(thread) { thread.notes.push({ id: 99, body: 'Новое уточнение', author: { id: 8 }, resolvable: true, resolved: false }); },
    function(thread) { thread.notes.forEach(function(note) { if (!note.system) note.resolved = true; }); }
  ];
  for (var change of changes) {
    var env = replyEnvironment();
    var plan = await env.api.prepare(env.context, env.json([reply()])); change(env.threads[0]);
    assert.equal((await send(env, plan)).items[0].status, 'skipped'); assert.equal(env.posts().length, 0);
  }
  var missing = replyEnvironment();
  var original = await missing.api.prepare(missing.context, missing.json([reply()])); missing.threads.shift();
  assert.equal((await send(missing, original)).items[0].status, 'failed'); assert.equal(missing.posts().length, 0);
});

test('only one reply is accepted per chosen discussion in an import', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply(), reply({ id: 'R2', note_id: 12, body: 'Другой ответ' })]));
  assert.deepEqual(Array.from(plan.items, function(item) { return item.status; }), ['ready', 'invalid']);
  assert.match(plan.items[1].message, /only one reply per discussion/);
});

test('lost published and draft reply responses reconcile only within the target discussion', async function() {
  for (var mode of ['publish', 'draft']) {
    var env = replyEnvironment({ handler: async function(url, init, defaults) { var result = await defaults(url, init); if (init.method === 'POST') throw new Error('Response lost'); return result; } });
    var plan = await env.api.prepare(env.context, env.json([reply()]));
    var output = await send(env, plan, ['R1'], { mode: mode });
    assert.equal(output.items[0].status, mode === 'draft' ? 'draft' : 'published');
    assert.equal((await send(env, plan, ['R1'], { mode: mode })).items[0].status, 'duplicate');
    assert.equal(env.posts().length, 1);
  }
  var wrong = replyEnvironment({ handler: async function(url, init, defaults) {
    if (init.method === 'POST') { wrong.threads[1].notes.push({ id: 99, body: reply().body, author: { id: 7 } }); throw new Error('Response lost'); }
    return defaults(url, init);
  } });
  var plan = await wrong.api.prepare(wrong.context, wrong.json([reply()]));
  assert.equal((await send(wrong, plan)).items[0].status, 'unknown'); assert.equal(wrong.posts().length, 1);
});

test('a second-item journal read failure reports no-send failure and preserves any older uncertain entry', async function() {
  var failRead = false;
  var second = reply({ id: 'R2', discussion_id: THREAD_B, note_id: 21, body: 'Второй ответ' });
  var raw = JSON.stringify(['https://gitlab.test/team/repo/-/merge_requests/42', 7, 'reply', THREAD_B, second.body]);
  var secondKey = 'glReviewImportPending:' + crypto.createHash('sha256').update(raw).digest('hex');
  var env = replyEnvironment({ storageFailure: function(method, argument) { return failRead && method === 'get' && argument === secondKey; } });
  var plan = await env.api.prepare(env.context, env.json([reply(), second]));
  env.stored[secondKey] = { status: 'unknown', time: 1 }; failRead = true;
  var output = await send(env, plan);
  assert.deepEqual(Array.from(output.items, function(item) { return item.status; }), ['published', 'failed']);
  assert.equal(env.posts().length, 1); assert.equal(env.stored[secondKey].status, 'unknown');
  failRead = false;
  assert.equal((await send(env, plan, ['R2'])).items[0].status, 'unknown'); assert.equal(env.posts().length, 1);
});

test('revision uses the private complete source and preserves untouched comments, anchors and reply targets', async function() {
  var env = replyEnvironment();
  var input = JSON.parse(env.json([inline({ id: 'line' }), reply({ id: 'reply' }), general({ id: 'keep', body: 'Без изменений' })]));
  var plan = await env.api.prepare(env.context, JSON.stringify(input));
  assert.deepEqual(JSON.parse(JSON.stringify(plan.source)), input);
  assert.equal(plan.items[0].editable, true);
  plan.source.mr_url = 'https://other.test/wrong'; plan.source.head_sha = 'e'.repeat(40);
  plan.source.comments[0].path = 'attacker.js'; plan.source.comments[1].discussion_id = THREAD_B;
  plan.source.comments[2].body = 'Подменённый текст'; plan.source.comments.push(general({ id: 'injected' }));
  plan.items[0].position.new_line = 600; plan.items[1].note_id = 21;
  plan.context.webUrl = 'https://other.test/wrong'; plan.refs.base_sha = 'e'.repeat(40);
  var edits = [{ id: 'line', body: 'Уточнённое замечание к строке' }, { id: 'reply', body: 'Проверка null добавлена до вызова validateInput.' }];
  var revised = await env.api.revise(plan, edits);
  input.comments[0].body = edits[0].body; input.comments[1].body = edits[1].body;
  assert.deepEqual(JSON.parse(JSON.stringify(revised.source)), input);
  assert.deepEqual(Array.from(revised.items, function(item) { return item.status; }), ['ready', 'ready', 'ready']);
  assert.deepEqual(JSON.parse(JSON.stringify(revised.refs)), refs());
  assert.equal(revised.items[0].position.new_line, 3); assert.equal(revised.items[0].position.old_path, 'src/old.js');
  assert.equal(revised.items[1].discussion_id, THREAD_A); assert.equal(revised.items[1].note_id, 11);
  assert.equal(revised.items[1].replyTo.body, 'Проверьте пустой ввод.'); assert.equal(revised.items[2].body, 'Без изменений');
  assert.equal(env.posts().length, 0);
  var output = await send(env, revised, ['line', 'reply']);
  assert.deepEqual(Array.from(output.items, function(item) { return item.status; }), ['published', 'published']);
  assert.equal(JSON.parse(env.posts()[0].init.body).body, edits[0].body);
  assert.equal(JSON.parse(env.posts()[0].init.body).position.new_line, 3);
  assert.deepEqual(JSON.parse(env.posts()[1].init.body), { body: edits[1].body });
  assert.ok(env.posts()[1].url.pathname.endsWith('/discussions/' + THREAD_A + '/notes'));
});

test('revision can add a general comment without changing the original review or writing before publication', async function() {
  var env = environment();
  var plan = await env.api.prepare(env.context, env.json());
  var revised = await env.api.revise(plan, [{ id: 'manual', body: 'Дополнительно проверьте поведение при отмене.', add: true }]);
  assert.equal(plan.source.comments.length, 1); assert.equal(plan.items.length, 1);
  assert.equal(revised.items.length, 2); assert.equal(revised.items[1].type, 'comment');
  ['path', 'side', 'line', 'code', 'position'].forEach(function(key) { assert.equal(revised.items[1][key], null); });
  assert.equal(revised.source.head_sha, HEAD); assert.equal(revised.source.mr_url, env.context.webUrl);
  assert.equal(env.posts().length, 0);
  var output = await send(env, revised, ['manual']);
  assert.equal(output.items[0].status, 'published'); assert.equal(env.posts().length, 1);
  assert.ok(env.posts()[0].url.pathname.endsWith('/discussions'));
  assert.deepEqual(JSON.parse(env.posts()[0].init.body), { body: 'Дополнительно проверьте поведение при отмене.' });
});

test('revision rejects invalid bodies and executable quick actions without replacing the checked plan', async function() {
  var env = environment(); var plan = await env.api.prepare(env.context, env.json());
  for (var body of ['', ' \n\t ', 'x'.repeat(65537), '/merge', '/\rclose', 'Example\n```\n/merge\n```', '/merge\v\n']) {
    await assert.rejects(env.api.revise(plan, [{ id: 'R1', body: body }]));
    await assert.rejects(env.api.revise(plan, [{ id: 'new', body: body, add: true }]));
  }
  assert.equal(plan.source.comments[0].body, inline().body); assert.equal(env.posts().length, 0);
  assert.equal((await send(env, plan)).items[0].status, 'published');
  assert.equal(JSON.parse(env.posts()[0].init.body).body, inline().body);
});

test('revision rejects target changes, foreign IDs, duplicate edits and additions over the limit', async function() {
  var env = environment(); var plan = await env.api.prepare(env.context, env.json());
  for (var extra of [{ path: 'src/new.js' }, { side: 'new' }, { line: 3 }, { code: '  changed();' }, { position: position() }, { type: 'reply' }, { discussion_id: THREAD_A }, { note_id: 11 }, { resolve_discussion: true }, { add: 'true' }]) {
    await assert.rejects(env.api.revise(plan, [Object.assign({ id: 'R1', body: 'Изменение' }, extra)]));
  }
  for (var edits of [[{ id: 'missing', body: 'Нет такого ID' }], [{ id: 'R1', body: 'Новый', add: true }], [{ id: 'R1', body: 'Первый' }, { id: 'R1', body: 'Второй' }], [{ id: 'manual', body: 'Первый', add: true }, { id: 'manual', body: 'Второй', add: true }], [{ id: '', body: 'Пустой ID', add: true }]]) {
    await assert.rejects(env.api.revise(plan, edits));
  }
  await assert.rejects(env.api.revise(JSON.parse(JSON.stringify(plan)), [{ id: 'R1', body: 'Поддельный план' }]));
  var full = await env.api.prepare(env.context, env.json(Array.from({ length: 200 }, function(_, index) { return general({ id: 'item-' + index, body: 'Комментарий ' + index }); })));
  await assert.rejects(env.api.revise(full, [{ id: 'overflow', body: 'Лишний комментарий', add: true }]), /200/);
  assert.equal(env.posts().length, 0);
});

test('revision rechecks duplicates for edited text while leaving unrelated duplicate rows locked', async function() {
  var env = environment({ notes: [{ id: 10, body: 'Уже опубликовано', author: { id: 7 }, position: position() }] });
  var plan = await env.api.prepare(env.context, env.json([inline(), general({ id: 'other', body: 'Другое замечание' })]));
  var revised = await env.api.revise(plan, [{ id: 'R1', body: 'Уже опубликовано' }]);
  assert.equal(revised.items[0].status, 'duplicate'); assert.equal(revised.items[0].editable, false);
  await assert.rejects(env.api.revise(revised, [{ id: 'R1', body: 'Обход дубликата' }]));
  var next = await env.api.revise(revised, [{ id: 'other', body: 'Уточнение другого замечания' }]);
  assert.equal(next.items[0].status, 'duplicate'); assert.equal(next.items[1].status, 'ready');
  assert.equal((await send(env, next, ['R1', 'other'])).items[1].status, 'published');
  assert.equal(env.posts().length, 1);
});

test('saved and uncertain outcomes lock editing even when the public preview is changed', async function() {
  for (var mode of ['publish', 'draft', 'unknown']) {
    var env = environment({ handler: function(url, init, defaults) { if (mode === 'unknown' && init.method === 'POST') throw new Error('Response lost'); return defaults(url, init); } });
    var plan = await env.api.prepare(env.context, env.json());
    var output = await send(env, plan, ['R1'], { mode: mode === 'draft' ? 'draft' : 'publish' });
    assert.equal(output.items[0].status, mode === 'publish' ? 'published' : mode);
    plan.items[0].status = 'ready'; plan.items[0].editable = true; plan.items[0].body = 'Подмена'; plan.source.comments[0].body = 'Подмена';
    await assert.rejects(env.api.revise(plan, [{ id: 'R1', body: 'Не должно отправиться повторно' }]));
    assert.equal(env.posts().length, 1);
  }
});

test('an uncertain delivery remains uneditable after loading a new preview and extension instance', async function() {
  var env = environment({ handler: function(url, init, defaults) { if (init.method === 'POST') throw new Error('Response lost'); return defaults(url, init); } });
  var plan = await env.api.prepare(env.context, env.json());
  assert.equal((await send(env, plan)).items[0].status, 'unknown');
  var reopened = environment({ stored: env.stored });
  var again = await reopened.api.prepare(reopened.context, reopened.json());
  assert.equal(again.items[0].status, 'invalid'); assert.equal(again.items[0].editable, false);
  again.items[0].editable = true; again.items[0].status = 'ready';
  await assert.rejects(reopened.api.revise(again, [{ id: 'R1', body: 'Новый текст для старого неизвестного результата' }]));
  assert.equal(reopened.posts().length, 0);
});

test('revision refuses changed source, base or start refs and a changed GitLab account', async function() {
  for (var key of ['head_sha', 'base_sha', 'start_sha']) {
    var env = environment(); var plan = await env.api.prepare(env.context, env.json());
    env.state.refs[key] = 'e'.repeat(40);
    await assert.rejects(env.api.revise(plan, [{ id: 'R1', body: 'Новый текст' }]), /changed/);
    assert.equal(env.posts().length, 0); assert.equal(plan.source.head_sha, HEAD);
  }
  var account = environment(); var original = await account.api.prepare(account.context, account.json());
  account.state.user = { id: 8 };
  await assert.rejects(account.api.revise(original, [{ id: 'R1', body: 'Новый текст' }]), /account changed/);
  assert.equal(account.posts().length, 0);
});

test('revision retains edited text but cannot silently accept changed, deleted or resolved reply context', async function() {
  var changes = [
    function(thread) { thread.notes[0].body = 'Изменённое замечание'; },
    function(thread) { thread.notes.push({ id: 99, body: 'Новое уточнение', author: { id: 8 }, resolvable: true, resolved: false }); },
    function(thread) { thread.notes = thread.notes.filter(function(note) { return note.id !== 11; }); },
    function(thread) { thread.notes.forEach(function(note) { if (!note.system) note.resolved = true; }); }
  ];
  for (var change of changes) {
    var env = replyEnvironment(); var plan = await env.api.prepare(env.context, env.json([reply()]));
    change(env.threads[0]);
    var revised = await env.api.revise(plan, [{ id: 'R1', body: 'Текст пользователя должен сохраниться' }]);
    assert.equal(revised.items[0].status, 'invalid'); assert.equal(revised.items[0].body, 'Текст пользователя должен сохраниться');
    assert.equal(revised.source.comments[0].body, 'Текст пользователя должен сохраниться');
    assert.equal((await send(env, revised, ['R1'])).items[0].status, 'skipped'); assert.equal(env.posts().length, 0);
    var repeated = await env.api.revise(revised, [{ id: 'R1', body: 'Ещё одна правка без повторной проверки обсуждения' }]);
    assert.equal(repeated.items[0].status, 'invalid');
    assert.equal((await send(env, repeated, ['R1'])).items[0].status, 'skipped'); assert.equal(env.posts().length, 0);
  }
});

test('editing a body reruns exact line validation without inventing a replacement location', async function() {
  var changedDiff = false;
  var env = environment({ handler: function(url, init, defaults) {
    if (changedDiff && url.pathname.endsWith('/diffs')) return response([{ old_path: 'src/old.js', new_path: 'src/new.js', diff: '@@ -1 +1 @@\n-before();\n+after();\n' }], 200, { 'x-next-page': '' });
    return defaults(url, init);
  } });
  var plan = await env.api.prepare(env.context, env.json()); changedDiff = true;
  var revised = await env.api.revise(plan, [{ id: 'R1', body: 'Уточнение текста' }]);
  assert.equal(revised.items[0].status, 'invalid'); assert.equal(revised.source.comments[0].line, 3);
  assert.equal(revised.source.comments[0].code, '  changed();');
  assert.equal((await send(env, revised, ['R1'])).items[0].status, 'skipped'); assert.equal(env.posts().length, 0);
});

test('revision is unavailable during an in-flight publication and does not cancel the original send', async function() {
  var entered, release;
  var started = new Promise(function(resolve) { entered = resolve; });
  var held = new Promise(function(resolve) { release = resolve; });
  var env = environment({ handler: async function(url, init, defaults) {
    if (init.method === 'POST') { entered(); await held; }
    return defaults(url, init);
  } });
  var plan = await env.api.prepare(env.context, env.json());
  var sending = send(env, plan);
  await started;
  try { await assert.rejects(env.api.revise(plan, [{ id: 'R1', body: 'Редактирование во время отправки' }]), /finish sending|already|sent|sending/); }
  finally { release(); }
  assert.equal((await sending).items[0].status, 'published');
  assert.equal(env.posts().length, 1); assert.equal(JSON.parse(env.posts()[0].init.body).body, inline().body);
});

test('revision rechecks the publication lock after an awaited final journal read', async function() {
  var editStarted = false, oldReads = 0, blockMetadata = false;
  var journalEntered, journalRelease, metadataEntered, metadataRelease;
  var journalWaiting = new Promise(function(resolve) { journalEntered = resolve; });
  var journalGate = new Promise(function(resolve) { journalRelease = resolve; });
  var metadataWaiting = new Promise(function(resolve) { metadataEntered = resolve; });
  var metadataGate = new Promise(function(resolve) { metadataRelease = resolve; });
  var raw = JSON.stringify(['https://gitlab.test/team/repo/-/merge_requests/42', 7, inline().body, canonicalPosition(position())]);
  var originalKey = 'glReviewImportPending:' + crypto.createHash('sha256').update(raw).digest('hex');
  var env = environment({
    storageGate: function(method, key) {
      if (editStarted && method === 'get' && key === originalKey && ++oldReads === 2) { journalEntered(); return journalGate; }
    },
    handler: async function(url, init, defaults) {
      if (blockMetadata && init.method === 'GET' && url.pathname.endsWith('/merge_requests/42')) { metadataEntered(); await metadataGate; }
      return defaults(url, init);
    }
  });
  var plan = await env.api.prepare(env.context, env.json()); editStarted = true;
  var revising = env.api.revise(plan, [{ id: 'R1', body: 'Изменённый текст' }]);
  await journalWaiting;
  blockMetadata = true; var sending = send(env, plan); await metadataWaiting;
  journalRelease();
  try { await assert.rejects(revising, /finish sending|already|sent|sending/); }
  finally { blockMetadata = false; metadataRelease(); }
  assert.equal((await sending).items[0].status, 'published');
  assert.equal(env.posts().length, 1); assert.equal(JSON.parse(env.posts()[0].init.body).body, inline().body);
});

['getPrompt', 'getReplyPrompt'].forEach(function(method) {
  var key = method === 'getPrompt' ? 'ai_review_import_prompt' : 'ai_review_reply_prompt';
  var defaultKey = method === 'getPrompt' ? 'DEFAULT_REVIEW_PROMPT' : 'DEFAULT_REPLY_PROMPT';
  test(method + ' reads its independent saved instructions on every copy and keeps the import envelope', async function() {
    var env = replyEnvironment();
    var custom = 'Answer in German with concise evidence.';
    env.chrome.storage.sync = { get: function(defaults, callback) {
      assert.deepEqual(Object.keys(defaults), [key]);
      callback({ [key]: custom });
    } };
    var prompt = await env.api[method](env.context);
    assert.ok(prompt.includes(custom));
    assert.ok(!prompt.includes(env.api[defaultKey]));
    assert.ok(prompt.includes(HEAD));
    assert.ok(prompt.includes(env.context.webUrl));
    assert.match(prompt, /Return only one JSON object using version 1/);
    if (method === 'getReplyPrompt') { assert.ok(prompt.includes(THREAD_A)); assert.match(prompt, /"note_id": 11/); }
    custom = 'Use English and explain the observed behavior.';
    assert.ok((await env.api[method](env.context)).includes(custom));
    assert.equal(env.posts().length, 0);
  });
  test(method + ' restores defaults for absent, blank and malformed saved settings', async function() {
    var env = replyEnvironment();
    for (var value of [undefined, null, false, {}, '  ']) {
      env.chrome.storage.sync = { get: function(defaults, callback) { callback({ [key]: value }); } };
      assert.ok((await env.api[method](env.context)).includes(env.api[defaultKey]));
    }
  });
  test(method + ' reports setting read failures before any network request', async function() {
    var env = replyEnvironment();
    env.chrome.storage.sync = { get: function(defaults, callback) {
      env.chrome.runtime.lastError = { message: 'Storage failure' };
      callback();
      delete env.chrome.runtime.lastError;
    } };
    await assert.rejects(env.api[method](env.context), /Could not load AI prompt settings/);
    env.chrome.storage.sync.get = function() { throw new Error('Disconnected'); };
    await assert.rejects(env.api[method](env.context), /Could not load AI prompt settings/);
    assert.equal(env.requests.length, 0);
  });
  test(method + ' cancels a pending settings read and ignores its late callback', async function() {
    var env = replyEnvironment(), callback;
    env.chrome.storage.sync = { get: function(defaults, done) { callback = done; } };
    var controller = new AbortController();
    var result = env.api[method](env.context, { signal: controller.signal });
    controller.abort();
    await assert.rejects(result, { name: 'AbortError' });
    callback({ [key]: 'Too late' });
    await Promise.resolve();
    assert.equal(env.requests.length, 0);
  });
});

test('publication and drafts do not persist review history or expose checkpoint actions', async function() {
  for (var mode of ['publish', 'draft']) {
    var env = environment({ workflow: true });
    var plan = await env.api.prepare(env.context, env.json([inline()]));
    await send(env, plan, null, { mode: mode });
    assert.equal(env.api.markReviewed, undefined);
    assert.equal(Object.keys(env.stored).some(function(key) { return key.startsWith('ai_review_history:'); }), false);
    var storedText = JSON.stringify(env.stored);
    assert.ok(!storedText.includes(inline().body), 'only deduplication identifiers/status may be stored, not review contents');
    assert.equal(env.posts().length, 1);
  }
});

test('selected reply prompt keeps whole selected threads, including resolved/general, without other open threads', async function() {
  var env = replyEnvironment();
  var prompt = await env.api.getReplyPrompt(env.context, { discussionIds: [THREAD_A, THREAD_C, THREAD_D, THREAD_A] });
  assert.ok(prompt.includes('Проверьте пустой ввод.') && prompt.includes('Падает также при null.'));
  assert.ok(prompt.includes(THREAD_C) && prompt.includes(THREAD_D));
  assert.ok(!prompt.includes(THREAD_B));
  assert.match(prompt, /Reply only to the supplied discussions/);
  assert.match(prompt, /Selected discussions/);
  assert.equal(env.posts().length, 0);
});

test('empty or unavailable reply selection never silently expands to all unresolved discussions', async function() {
  var env = replyEnvironment();
  await assert.rejects(env.api.getReplyPrompt(env.context, { discussionIds: [] }), /Select at least one/);
  assert.equal(env.requests.length, 0);
  await assert.rejects(env.api.getReplyPrompt(env.context, { discussionIds: [THREAD_A, '9'.repeat(40)] }), /Some selected discussions are unavailable/);
  await assert.rejects(env.api.getReplyPrompt(env.context, { discussionIds: 'all' }), /Invalid discussion selection/);
  assert.equal(env.posts().length, 0);
});

test('fix replies without SHA can be edited and posted after multiple commits or a force push', async function() {
  for (var mode of ['publish', 'draft']) {
    var env = replyEnvironment();
    env.state.refs = refs({ head_sha: 'd'.repeat(40), base_sha: 'e'.repeat(40) });
    var plan = await env.api.prepare(env.context, env.json([reply()], { head_sha: undefined }));
    assert.equal(plan.items[0].status, 'ready');
    assert.match(plan.warnings.join(' '), /pushed/);
    env.state.refs = refs({ head_sha: 'f'.repeat(40), start_sha: 'e'.repeat(40) });
    var revised = await env.api.revise(plan, [{ id: 'R1', body: 'Сделано: проверка пустого ввода добавлена.' }]);
    assert.equal(revised.items[0].status, 'ready');
    var out = await send(env, revised, ['R1'], { mode: mode });
    assert.equal(out.items[0].status, mode === 'draft' ? 'draft' : 'published');
    var payload = JSON.parse(env.posts()[0].init.body);
    assert.equal(payload.position, undefined);
    assert.equal(payload.body || payload.note, 'Сделано: проверка пустого ввода добавлена.');
  }
});

test('mixed stale review blocks new findings but keeps replies ready without relabeling the source SHA', async function() {
  var env = replyEnvironment(); env.state.refs.head_sha = 'd'.repeat(40);
  var plan = await env.api.prepare(env.context, env.json([inline(), general({ id: 'R2' }), reply({ id: 'R3' })]));
  assert.deepEqual(Array.from(plan.items, function(i) { return i.status; }), ['invalid', 'invalid', 'ready']);
  assert.equal(plan.source.head_sha, HEAD);
  assert.equal(env.requests.some(function(r) { return r.url.pathname.endsWith('/diffs'); }), false);
  var out = await send(env, plan, ['R1', 'R2', 'R3']);
  assert.deepEqual(Array.from(out.items, function(i) { return i.status; }), ['skipped', 'skipped', 'published']);
  assert.equal(env.posts().length, 1);
});

test('mixed preview survives version changes when editing a reply but invalidates new findings', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([inline(), reply({ id: 'R2' })]));
  env.state.refs.base_sha = 'e'.repeat(40);
  var revised = await env.api.revise(plan, [{ id: 'R2', body: 'Исправлено.' }]);
  assert.deepEqual(Array.from(revised.items, function(i) { return i.status; }), ['invalid', 'ready']);
  assert.equal((await send(env, revised, ['R2'])).items[0].status, 'published');
});

test('version changes during mixed preview do not prevent preparing discussion replies', async function() {
  var env = replyEnvironment({ onMetadata: function(state) { if (state.metadataReads === 2) state.refs.head_sha = 'd'.repeat(40); } });
  var plan = await env.api.prepare(env.context, env.json([inline(), reply({ id: 'R2' })]));
  assert.deepEqual(Array.from(plan.items, function(i) { return i.status; }), ['invalid', 'ready']);
  assert.equal((await send(env, plan, ['R2'])).items[0].status, 'published');
});

test('new commits before or during mixed publication skip findings but still deliver replies', async function() {
  for (var before of [true, false]) {
    var env = replyEnvironment({ handler: async function(url, init, defaults, state) {
      var result = await defaults(url, init);
      if (!before && init.method === 'POST') state.refs.head_sha = 'e'.repeat(40);
      return result;
    } });
    var plan = await env.api.prepare(env.context, env.json([reply(), inline({ id: 'R2' }), reply({ id: 'R3', discussion_id: THREAD_B, note_id: 21 })]));
    if (before) env.state.refs.head_sha = 'd'.repeat(40);
    var out = await send(env, plan);
    assert.deepEqual(Array.from(out.items, function(i) { return i.status; }), ['published', 'skipped', 'published']);
    assert.equal(env.posts().length, 2);
    assert.ok(out.warnings.length);
  }
});

test('SHA-free replies still require real unchanged targets and do not weaken new-finding SHA requirements', async function() {
  var env = replyEnvironment();
  await assert.rejects(env.api.prepare(env.context, env.json([reply(), inline({ id: 'R2' })], { head_sha: undefined })), /SHA/);
  var missing = await env.api.prepare(env.context, env.json([reply({ note_id: 999 })], { head_sha: undefined }));
  assert.equal(missing.items[0].status, 'invalid');
  var plan = await env.api.prepare(env.context, env.json([reply()], { head_sha: undefined }));
  env.state.refs.head_sha = 'd'.repeat(40);
  env.threads[0].notes.push({ id: 999, body: 'Please use a different fix', author: { id: 9 } });
  assert.equal((await send(env, plan)).items[0].status, 'skipped');
  assert.equal(env.posts().length, 0);
});

test('deleted confirmed drafts can be imported and added again, including after reopening', async function() {
  for (var isReply of [false, true]) {
    for (var reopen of [false, true]) {
      var env = isReply ? replyEnvironment() : environment();
      var items = [isReply ? reply() : inline()];
      var plan = await env.api.prepare(env.context, env.json(items));
      assert.equal((await send(env, plan, ['R1'], { mode: 'draft' })).items[0].status, 'draft');
      env.drafts.splice(0);
      if (reopen) env = isReply ? replyEnvironment({ stored: env.stored }) : environment({ stored: env.stored });
      var again = await env.api.prepare(env.context, env.json(items));
      assert.equal(again.items[0].status, 'ready');
      assert.equal((await send(env, again, ['R1'], { mode: 'draft' })).items[0].status, 'draft');
      assert.equal(env.drafts.length, 1);
    }
  }
});

test('draft journal is not cleared when draft loading is unavailable, fails or the draft was edited', async function() {
  for (var mode of ['unavailable', 'error', 'edited']) {
    var fail = false;
    var env = environment({ handler: function(url, init, defaults) {
      if (fail && url.pathname.endsWith('/draft_notes')) return response({}, 500);
      return defaults(url, init);
    } });
    var plan = await env.api.prepare(env.context, env.json([general()]));
    await send(env, plan, ['R1'], { mode: 'draft' });
    if (mode === 'error') fail = true;
    else if (mode === 'unavailable') env.state.draftSupported = false;
    else env.drafts[0].note = 'Edited manually in GitLab';
    if (mode === 'error') await assert.rejects(env.api.prepare(env.context, env.json([general()])), /500/);
    else assert.equal((await env.api.prepare(env.context, env.json([general()]))).items[0].status, 'duplicate');
    assert.equal(Object.values(env.stored)[0].status, 'draft');
    assert.equal(env.posts().length, 1);
  }
});

test('published draft is detected as an existing comment instead of being offered again', async function() {
  var env = environment();
  var plan = await env.api.prepare(env.context, env.json([general()]));
  await send(env, plan, ['R1'], { mode: 'draft' });
  env.drafts.splice(0);
  env.notes.push({ id: 345, body: general().body, author: { id: 7 } });
  var again = await env.api.prepare(env.context, env.json([general()]));
  assert.equal(again.items[0].status, 'duplicate');
  assert.equal(Object.values(env.stored)[0].status, 'published');
  assert.match(again.items[0].existingUrl, /note_345$/);
});

test('import prompts apply saved response language but format-only text stays generic', async function() {
  var env = replyEnvironment({ workflow: true });
  env.chrome.storage.sync = { get: function(defaults, cb) { cb(Object.assign({}, defaults, { ai_review_response_language: 'ru' })); } };
  for (var text of [await env.api.getPrompt(env.context), await env.api.getReplyPrompt(env.context)]) {
    assert.match(text, /^Response language selected by the user: Russian/);
    assert.match(text, /Preserve JSON keys/);
  }
  assert.doesNotMatch(env.api.getResponseFormat(), /Response language selected|Russian/);
});

test('resolve requires explicit selection and runs only after a verified published reply', async function() {
  for (var resolve of [false, true]) {
    var env = replyEnvironment();
    var plan = await env.api.prepare(env.context, env.json([reply(), reply({ id: 'R2', discussion_id: THREAD_B, note_id: 21 })]));
    var result = await send(env, plan, undefined, { resolveIds: resolve ? ['R1'] : [] });
    assert.equal(result.items[0].status, 'published');
    assert.equal(result.items[0].resolveStatus, resolve ? 'resolved' : undefined);
    assert.equal(result.items[1].resolveStatus, undefined);
    var writes = env.requests.filter(r => ['POST', 'PUT'].includes(r.init.method));
    assert.deepEqual(writes.map(r => r.init.method), resolve ? ['POST', 'PUT', 'POST'] : ['POST', 'POST']);
    if (resolve) assert.ok(writes[1].url.pathname.endsWith('/discussions/' + THREAD_A));
    assert.equal(env.threads[0].notes[0].resolved, resolve);
    assert.equal(env.threads[1].notes[0].resolved, false);
  }
});

test('draft reply never resolves even when resolve IDs are supplied', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  var result = await send(env, plan, undefined, { mode: 'draft', resolveIds: ['R1'] });
  assert.equal(result.items[0].status, 'draft');
  assert.equal(result.items[0].resolveStatus, undefined);
  assert.equal(env.requests.some(r => r.init.method === 'PUT'), false);
  assert.equal(env.threads[0].notes[0].resolved, false);
  assert.equal(env.drafts[0].resolve_discussion, false);
});

test('resolve validates the private preview and selection before sending', async function() {
  for (var entry of [general(), reply({ discussion_id: THREAD_C, note_id: 31 }), reply({ discussion_id: THREAD_D, note_id: 41 })]) {
    var env = replyEnvironment();
    var plan = await env.api.prepare(env.context, env.json([entry]));
    plan.items[0].type = 'reply';
    plan.items[0].replyTo = { resolvable: true, resolved: false };
    await assert.rejects(send(env, plan, ['R1'], { resolveIds: ['R1'] }), e => e.beforeSend && /resolvable/.test(e.message));
    assert.equal(env.posts().length, 0);
  }
  for (var ids of [null, 'R1', ['missing'], ['R1','R1'], [4]]) {
    var env = replyEnvironment();
    var plan = await env.api.prepare(env.context, env.json([reply()]));
    await assert.rejects(send(env, plan, ['R1'], { resolveIds: ids }), e => e.beforeSend === true);
    assert.equal(env.posts().length, 0);
  }
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  await assert.rejects(send(env, plan, [], { resolveIds: ['R1'] }), /selected replies/);
});

test('resolution errors preserve published delivery and never allow a duplicate reply', async function() {
  for (var failure of [403, 404, 500, 'network', 'unconfirmed']) {
    var env = replyEnvironment({ handler: async function(url, init, defaults) {
      if (init.method !== 'PUT') return defaults(url, init);
      if (failure === 'network') throw new Error('Connection lost');
      if (failure === 'unconfirmed') return response(env.threads[0]);
      return response({}, failure);
    } });
    var plan = await env.api.prepare(env.context, env.json([reply()]));
    var result = await send(env, plan, undefined, { resolveIds: ['R1'] });
    assert.equal(result.items[0].status, 'published');
    assert.equal(result.items[0].resolveStatus, [403,404].includes(failure) ? 'failed' : 'unknown');
    assert.equal(Object.values(env.stored)[0].status, 'published');
    var again = await send(env, plan, undefined, { resolveIds: ['R1'] });
    assert.equal(again.items[0].status, 'duplicate');
    assert.equal(env.posts().length, 1);
    assert.equal(env.requests.filter(r => r.init.method === 'PUT').length, 1);
  }
});

test('new feedback, deleted targets, changed account or cancellation after posting prevent resolution', async function() {
  for (var change of ['message', 'edit', 'delete', 'account', 'abort']) {
    var controller = new AbortController();
    var env = replyEnvironment({ storageGate: function(method, arg) {
      if (change === 'abort' && method === 'set' && Object.values(arg).some(value => value.status === 'published')) controller.abort();
    }, handler: async function(url, init, defaults, state) {
      var result = await defaults(url, init);
      if (init.method === 'POST') {
        if (change === 'message') env.threads[0].notes.push({ id: 999, body: 'Wait, another case fails.', resolvable: true, resolved: false });
        if (change === 'edit') env.threads[0].notes[0].body = 'Changed question';
        if (change === 'delete') env.threads[0].notes.shift();
        if (change === 'account') state.user.id = 99;
      }
      return result;
    } });
    var plan = await env.api.prepare(env.context, env.json([reply()]));
    var result = await send(env, plan, undefined, { resolveIds: ['R1'], signal: controller.signal });
    assert.equal(result.items[0].status, 'published', change);
    assert.equal(result.items[0].resolveStatus, 'failed', change);
    assert.equal(env.requests.some(r => r.init.method === 'PUT'), false);
  }
});

test('already resolved discussion after posting needs no second resolution request', async function() {
  var env = replyEnvironment({ handler: async function(url, init, defaults) {
    var result = await defaults(url, init);
    if (init.method === 'POST') env.threads[0].notes.forEach(n => { if (n.resolvable) n.resolved = true; });
    return result;
  } });
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  var result = await send(env, plan, undefined, { resolveIds: ['R1'] });
  assert.equal(result.items[0].resolveStatus, 'resolved');
  assert.equal(env.requests.some(r => r.init.method === 'PUT'), false);
});

test('reply recovered after lost POST response is verified again before resolution', async function() {
  var env = replyEnvironment({ handler: async function(url, init, defaults) {
    var result = await defaults(url, init);
    if (init.method === 'POST') throw new Error('Lost response');
    return result;
  } });
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  var result = await send(env, plan, undefined, { resolveIds: ['R1'] });
  assert.equal(result.items[0].status, 'published');
  assert.equal(result.items[0].resolveStatus, 'resolved');
  assert.equal(env.posts().length, 1);
});

test('deleted published replies and comments accept identical text in the same session and after reload', async function() {
  for (var isReply of [false, true]) {
    for (var reopen of [false, true]) {
      var env = isReply ? replyEnvironment() : environment();
      var items = [isReply ? reply() : general()];
      var plan = await env.api.prepare(env.context, env.json(items));
      assert.equal((await send(env, plan)).items[0].status, 'published');
      var deletedId = Object.values(env.stored)[0].id;
      if (isReply) env.threads[0].notes = env.threads[0].notes.filter(note => note.id !== deletedId);
      else env.notes.splice(0);
      if (reopen) env = isReply ? replyEnvironment({ stored: env.stored }) : environment({ stored: env.stored });
      var again = await env.api.prepare(env.context, env.json(items));
      assert.equal(again.items[0].status, 'ready');
      assert.equal(Object.keys(env.stored).length, 0);
      assert.ok(env.requests.some(r => r.init.method === 'GET' && r.url.pathname.endsWith('/notes/' + deletedId)));
      assert.equal((await send(env, again)).items[0].status, 'published');
      var third = await env.api.prepare(env.context, env.json(items));
      assert.equal(third.items[0].status, 'duplicate');
    }
  }
});

test('publication rechecks a deleted confirmed reply even when reusing the original prepared plan', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  await send(env, plan);
  var savedId = Object.values(env.stored)[0].id;
  env.threads[0].notes = env.threads[0].notes.filter(note => note.id !== savedId);
  assert.equal((await send(env, plan)).items[0].status, 'published');
  assert.equal(env.posts().length, 2);
});

test('published journal survives unavailable or invalid single-note verification', async function() {
  for (var failure of [401, 403, 405, 500, 'network', 'invalid']) {
    var missing = false;
    var env = replyEnvironment({ handler: function(url, init, defaults) {
      if (missing && url.pathname.endsWith('/discussions')) return response([{ id: THREAD_A, notes: env.threads[0].notes.filter(note => note.id < 300) }], 200, { 'x-next-page': '' });
      if (missing && /\/notes\/\d+$/.test(url.pathname)) {
        if (failure === 'network') throw new Error('Offline');
        return failure === 'invalid' ? response({ id: 987, body: 'Wrong note' }) : response({}, failure);
      }
      return defaults(url, init);
    } });
    var plan = await env.api.prepare(env.context, env.json([reply()]));
    await send(env, plan); missing = true;
    await assert.rejects(env.api.prepare(env.context, env.json([reply()])));
    var result = await send(env, plan);
    assert.equal(result.items[0].status, 'failed');
    assert.equal(Object.values(env.stored)[0].status, 'published');
    assert.equal(env.posts().length, 1);
  }
});

test('edited published comment keeps duplicate protection by ID without a redundant note lookup', async function() {
  var env = replyEnvironment();
  var plan = await env.api.prepare(env.context, env.json([reply()]));
  await send(env, plan);
  env.threads[0].notes.find(note => note.id === Object.values(env.stored)[0].id).body = 'Edited in GitLab';
  var checked = await env.api.prepare(env.context, env.json([reply()]));
  assert.equal(checked.items[0].status, 'duplicate');
  assert.equal(env.requests.some(r => /\/notes\/\d+$/.test(r.url.pathname)), false);
});

test('failed paginated discussion loading never clears a published journal', async function() {
  var missing = false;
  var env = environment({ handler: function(url, init, defaults) {
    if (missing && url.pathname.endsWith('/discussions')) return url.searchParams.get('page') === '1'
      ? response([{ id: 'other', notes: [{ id: 999, body: 'Another note', author: { id: 7 } }] }], 200, { 'x-next-page': '2' })
      : response({}, 500);
    return defaults(url, init);
  } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  await send(env, plan); missing = true;
  await assert.rejects(env.api.prepare(env.context, env.json([general()])), /500/);
  assert.equal(Object.values(env.stored)[0].status, 'published');
  assert.equal(env.requests.some(r => /\/notes\/\d+$/.test(r.url.pathname)), false);
});

test('import task prompts prefer local Git and worktrees with base refs while format-only stays pure', async function() {
  var env = replyEnvironment({ workflow: true });
  env.chrome.storage.sync = { get: function(defaults, cb) { cb(defaults); } };
  for (var prompt of [await env.api.getPrompt(env.context, { prompt: 'Custom review instructions' }), await env.api.getReplyPrompt(env.context, { prompt: 'Custom reply instructions' })]) {
    assert.match(prompt, /first inspect the available local repository/);
    assert.match(prompt, /not a requirement to open GitLab or obtain an API token/);
    assert.match(prompt, /separate detached worktree at the verified head/);
    assert.match(prompt, /Custom/);
    assert.ok(prompt.includes('"base_sha":"' + BASE + '"'));
    assert.doesNotMatch(prompt, /Fix mode:/);
  }
  assert.doesNotMatch(env.api.getResponseFormat(), /Repository workflow|worktree|configured remote/);
});

test('concurrent imports in separate tabs use one MR lock and a later retry finds the existing comment', async function() {
  var held = new Set(), calls = [];
  var locks = { request: async function(name, options, callback) {
    calls.push({ name: name, options: options });
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name: name }); } finally { held.delete(name); }
  } };
  var shared = { stored: {}, notes: [], drafts: [], locks: locks };
  var first = environment(shared), second = environment(Object.assign({}, shared, { legacy: true }));
  var plans = await Promise.all([first.api.prepare(first.context, first.json([general()])), second.api.prepare(second.context, second.json([general()]))]);
  var results = await Promise.allSettled([send(first, plans[0]), send(second, plans[1], undefined, { mode: 'draft' })]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value.items[0].status, 'published');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.beforeSend, true);
  assert.match(results[1].reason.message, /another tab/);
  assert.equal(first.posts().length + second.posts().length, 1);
  assert.equal(shared.notes.length, 1);
  assert.equal(shared.drafts.length, 0);
  assert.equal(calls[0].name, calls[1].name, 'legacy and modern URLs share a lock');
  assert.equal(calls[0].options.ifAvailable, true);
  assert.equal(calls[0].options.mode, 'exclusive');
  var retry = await send(second, plans[1]);
  assert.equal(retry.items[0].status, 'duplicate');
  assert.equal(first.posts().length + second.posts().length, 1);
  assert.equal(held.size, 0);
});

test('an unavailable browser lock fails before requests or writes and preserves safe retry state', async function() {
  var denied = false;
  var env = environment({ locks: { request: async function(name, options, callback) {
    if (!denied) throw new Error('Lock manager unavailable');
    return callback(null);
  } } });
  var plan = await env.api.prepare(env.context, env.json([general()]));
  var count = env.requests.length;
  for (var busy of [false, true]) {
    denied = busy;
    await assert.rejects(send(env, plan), function(error) { return error.beforeSend === true; });
    assert.equal(env.requests.length, count);
    assert.equal(env.writes.length, 0);
    assert.equal(env.posts().length, 0);
  }
});

test('import and reply shortcuts use editable automatic rules without affecting the standalone format or validation', async function() {
  var env = replyEnvironment({ workflow: true }), saved = {};
  env.chrome.storage.sync = { get: function(defaults, cb) { cb(Object.assign({}, defaults, saved)); } };
  var ids = ['repository', 'review_checkout', 'import_task', 'import_safety', 'import_format', 'reply_task', 'reply_format'];
  ids.forEach(function(id) { saved['ai_review_rule_' + id] = { enabled: true, text: 'CUSTOM_' + id + ' {selection}' }; });
  var prompt = await env.api.getPrompt(env.context, { prompt: 'MAIN' });
  ['repository', 'review_checkout', 'import_task', 'import_safety', 'import_format'].forEach(function(id) { assert.ok(prompt.includes('CUSTOM_' + id), id); });
  var replies = await env.api.getReplyPrompt(env.context, { prompt: 'MAIN', discussionIds: [THREAD_A] });
  assert.match(replies, /CUSTOM_reply_task selected/);
  assert.match(replies, /CUSTOM_reply_format/);
  ids.forEach(function(id) { saved['ai_review_rule_' + id].enabled = false; });
  for (var text of [await env.api.getPrompt(env.context, { prompt: 'MAIN' }), await env.api.getReplyPrompt(env.context, { prompt: 'MAIN' })]) {
    assert.doesNotMatch(text, /CUSTOM_/);
    assert.match(text, /MAIN/);
    assert.ok(text.includes(HEAD));
    assert.match(text, /"version": 1/);
  }
  assert.doesNotMatch(env.api.getResponseFormat(), /CUSTOM_/);
  var plan = await env.api.prepare(env.context, env.json([reply({ body: '/merge' })]));
  assert.equal(plan.items[0].status, 'invalid');
  assert.equal(env.posts().length, 0);
});
