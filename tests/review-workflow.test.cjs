'use strict';
var test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
var harness = require('./helpers/extension.cjs');
var HEAD = 'a'.repeat(40), OLD = 'd'.repeat(40), BASE = 'b'.repeat(40), START = 'c'.repeat(40), THREAD = '1'.repeat(40);
function env(options) {
  options = options || {};
  var store = options.store || {}, sync = options.settings || {}, requests = [], writes = [];
  var chrome = { runtime: {}, storage: {} };
  ['local', 'sync'].forEach(function(area) {
    chrome.storage[area] = {
      get: function(key, cb) { var data = area === 'local' ? store : sync; cb(typeof key === 'string' ? { [key]: data[key] } : Object.assign({}, key, data)); },
      remove: function(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(function(key) { delete store[key]; }); cb(); },
      set: function(data, cb) { if (options.failSave) { chrome.runtime.lastError = { message: 'Quota exceeded' }; cb(); delete chrome.runtime.lastError; return; } Object.assign(area === 'local' ? store : sync, JSON.parse(JSON.stringify(data))); writes.push(data); cb(); }
    };
  });
  var metadataReads = 0;
  var sandbox = vm.createContext({ window: {}, chrome: chrome, TextEncoder: TextEncoder, TextDecoder: TextDecoder, AbortController: AbortController, URL: URL, setTimeout: setTimeout, clearTimeout: clearTimeout,
    fetch: async function(address, init) {
      var url = new URL(address); requests.push(url);
      assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin');
      var value, status = 200;
      if (url.pathname.endsWith('/versions')) {
        value = options.versionPages ? options.versionPages[Number(url.searchParams.get('page')) - 1] || [] : [{ id: 2, head_commit_sha: HEAD }, { id: 1, head_commit_sha: OLD }];
        status = options.versionsStatus || 200;
      }
      else if (url.pathname.endsWith('/commits')) value = [{ id: HEAD, title: 'Fix validation' }];
      else if (url.pathname.endsWith('/diffs') || url.pathname.endsWith('/changes')) {
        value = [file('src/main.js', '@@ -1 +1 @@\n-old();\n+fixed();\n'), file('package-lock.json', '@@ -1 +1 @@\n-old-lock\n+new-lock\n')];
        if (url.pathname.endsWith('/diffs') && options.legacy) status = 404;
        if (url.pathname.endsWith('/changes')) value = { changes: value };
      } else if (url.pathname.endsWith('/compare')) {
        if (options.compareStatus) status = options.compareStatus;
        value = { commit: { id: options.wrongCompareHead || HEAD }, compare_timeout: !!options.compareTimeout,
          diffs: options.comparisonFiles || [file('src/main.js', options.compareDiff === undefined ? '@@ -1 +1 @@\n-bug();\n+fixed();\n' : options.compareDiff), file('package-lock.json', '@@ -1 +1 @@\n-old-lock\n+new-lock\n')] };
      } else if (url.pathname.endsWith('/discussions')) {
        value = options.threads || [{ id: THREAD, notes: [
          { id: 11, body: 'Fails on empty input', resolvable: true, resolved: true, position: { old_path: 'src/main.js', new_path: 'src/main.js', new_line: 1, head_sha: OLD } },
          { id: 12, body: 'Fixed in latest push', resolvable: true, resolved: true }
        ] }];
        if (options.noDiscussions) status = 403;
      } else if (url.pathname.endsWith('/merge_requests/42')) {
        metadataReads++;
        value = { iid: 42, title: 'Fix input', description: 'Background', source_project_id: 99, sha: HEAD, changes_count: '2', diff_refs: { head_sha: options.changeAt === metadataReads ? OLD : HEAD, base_sha: BASE, start_sha: START } };
        if (options.changeAt === metadataReads) value.sha = OLD;
      } else throw new Error('Unexpected API ' + address);
      if (options.gate) await options.gate(url, init);
      return new Response(JSON.stringify(value), { status: status, headers: Object.assign({ 'content-type': 'application/json' }, url.pathname.endsWith('/versions') && options.noVersionHeaders ? {} : { 'x-next-page': '' }) });
    }
  });
  vm.runInContext(harness.readRuntime('review-workflow.js'), sandbox);
  vm.runInContext(harness.readRuntime('review-export.js'), sandbox);
  var api = sandbox.window.GlReviewExport, workflow = sandbox.window.GlReviewWorkflow;
  var context = api.parsePage({ origin: 'https://gitlab.test', pathname: '/tools/gitlab/team/repo/merge_requests/42', relativeUrlRoot: '/tools/gitlab' });
  return { api: api, workflow: workflow, context: context, store: store, chrome: chrome, requests: requests, writes: writes };
}
function file(path, diff, extra) { return Object.assign({ old_path: path, new_path: path, diff: diff }, extra); }

test('file scope supports rooted/deep globs, extension OR path inclusion, comments and exclusion precedence', function() {
  var e = env(), files = ['src/a.js', 'src/a.ts', 'nested/README.md', 'src/tests/a.js', 'dist/a.js', 'src/dist/a.js', 'nested/src/a.js', 'src/x.test.js'].map(function(path) { return file(path); });
  var result = e.workflow.filterFiles(files, { includeExtensions: 'js, ts # comment', includeFiles: 'README.md', ignoreFiles: '*.test.js', ignoreDirs: 'dist, **/tests' });
  assert.deepEqual(harness.plain(result.included.map(function(f) { return f.new_path; })), ['src/a.js', 'src/a.ts', 'nested/README.md', 'nested/src/a.js']);
  assert.deepEqual(harness.plain(e.workflow.filterFiles(files, { includeFiles: '/src/?.ts' }).included.map(function(f) { return f.new_path; })), ['src/a.ts']);
  assert.equal(e.workflow.filterFiles([file('notREADME.md')], { includeFiles: 'README.md' }).included.length, 0);
  assert.equal(e.workflow.filterFiles([file('README.md')], { includeFiles: 'readme.md' }).included.length, 0);
});
test('renames check both exclusions, deleted files use the old path and defaults retain lock files', function() {
  var e = env();
  assert.equal(e.workflow.filterFiles([file('package-lock.json')], {}).included.length, 1);
  assert.equal(e.workflow.filterFiles([file('safe/key.js', '', { old_path: 'secrets/key.js' })], { ignoreDirs: 'secrets' }).included.length, 0);
  assert.equal(e.workflow.filterFiles([file('/dev/null', '', { old_path: 'src/deleted.js', deleted_file: true })], { includeExtensions: 'js' }).included.length, 1);
  assert.throws(function() { e.workflow.normalizeFilter({ ignoreFiles: 'x'.repeat(1501) }); }, /1500/);
  assert.throws(function() { e.workflow.normalizeFilter({ ignoreFiles: '\u0001'.repeat(1500) }); }, /storage limit/);
});
test('fresh review filters code before export and explicitly lists omissions on modern and legacy endpoints', async function() {
  for (var legacy of [false, true]) {
    var e = env({ legacy: legacy, settings: { ai_review_file_filter: { ignoreFiles: '*.json' } } });
    var result = await e.api.prepareFreshReview(e.context, { includeCode: true });
    assert.equal(result.fileCount, 1); assert.equal(result.excludedFiles.length, 1);
    assert.match(result.text, /package-lock.json/); assert.doesNotMatch(result.text, /new-lock/);
    assert.match(result.text, /fixed\(\)/); assert.match(result.text, /explicit exclusion/);
    assert.equal(e.writes.length, 0, 'copying never advances the checkpoint');
  }
});
test('repeat review compares pinned snapshots in the fork after rewritten history and retains resolved discussions', async function() {
  var e = env({ settings: { ai_review_repeat_prompt: 'Recheck in German.', ai_review_file_filter: { ignoreFiles: '*.json' } } });
  var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, includeCode: true });
  var compare = e.requests.find(function(url) { return url.pathname.endsWith('/compare'); });
  assert.equal(compare.pathname, '/tools/gitlab/api/v4/projects/99/repository/compare');
  assert.equal(compare.searchParams.get('from'), OLD); assert.equal(compare.searchParams.get('to'), HEAD); assert.equal(compare.searchParams.get('straight'), 'true');
  assert.match(result.text, /Recheck in German/); assert.match(result.text, /Fixed in latest push/); assert.match(result.text, /"state": "resolved"/);
  assert.ok(result.text.includes(THREAD)); assert.match(result.text, /PREVIOUS REVIEW head/);
  assert.doesNotMatch(result.text, /new-lock/); assert.equal(result.baselineHead, OLD);
  assert.equal(e.writes.length, 0);
});
test('no comparison selected, unsupported comparison and truncated diffs never claim full incremental verification', async function() {
  var empty = env(), full = await empty.api.prepareRepeatReview(empty.context);
  assert.equal(full.baselineHead, null); assert.match(full.text, /No comparison revision/);
  assert.equal(full.complete, true); assert.equal(full.warnings.length, 0);
  for (var options of [{ compareStatus: 404 }, { compareStatus: 405 }, { compareTimeout: true }, { compareDiff: '' }, { wrongCompareHead: OLD }]) {
    var e = env(options); var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, includeCode: true });
    assert.equal(result.complete, false); assert.ok(result.warnings.length); assert.match(result.text, /Current MR for repeat review/);
  }
});
test('same-head review skips comparison, fails on changing revisions and preserves partial-data warnings', async function() {
  var e = env(); await e.api.prepareRepeatReview(e.context, { baselineHead: HEAD });
  assert.equal(e.requests.some(function(url) { return url.pathname.endsWith('/compare'); }), false);
  var changing = env({ changeAt: 4 });
  await assert.rejects(changing.api.prepareRepeatReview(changing.context, { baselineHead: OLD, includeCode: true }), /MR revision changed/);
  var partial = env({ noDiscussions: true });
  assert.match((await partial.api.prepareRepeatReview(partial.context, { baselineHead: OLD, includeCode: true })).warnings.join(' '), /discussions could not be loaded/);
});
test('repeat review cancellation returns no partial success and does not advance history', async function() {
  var controller = new AbortController(), e = env({ gate: async function(url) { if (url.pathname.endsWith('/compare')) controller.abort(); } });
 
  await assert.rejects(e.api.prepareRepeatReview(e.context, { signal: controller.signal, baselineHead: OLD, includeCode: true }), { name: 'AbortError' });
  assert.equal(e.writes.length, 0);
});

test('MR versions are fetched across headerless pages, validated and never marked reviewed automatically', async function() {
  var e = env({ noVersionHeaders: true, versionPages: [
    [{ id: 2, head_commit_sha: HEAD, created_at: '2026-10-13T10:00:00Z' }],
    [{ id: 1, head_commit_sha: OLD }, { id: 0, head_commit_sha: 'bad' }]
  ] });
  var versions = await e.api.loadReviewVersions(e.context);
  assert.equal(versions.items.length, 2);
  assert.equal(versions.items[1].headSha, OLD);
  assert.match(versions.warnings.join(' '), /incomplete MR version/);
  assert.equal(e.writes.length, 0);
  assert.ok(e.requests.every(function(url) { return url.pathname === '/tools/gitlab/api/v4/projects/team%2Frepo/merge_requests/42/versions'; }));
});
test('unsupported versions API leaves manual SHA and full review available; malformed SHA never reaches GitLab', async function() {
  var e = env({ versionsStatus: 404 });
  var versions = await e.api.loadReviewVersions(e.context);
  assert.equal(versions.items.length, 0); assert.match(versions.warnings.join(' '), /enter the reviewed SHA/);
  var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, includeCode: true });
  assert.equal(result.baselineHead, OLD);
  var before = e.requests.length;
  await assert.rejects(e.api.prepareRepeatReview(e.context, { baselineHead: 'main?secret=1' }), /complete commit SHA/);
  assert.equal(e.requests.length, before);
});


test('compact repeat review keeps pinned revisions, scope and replies with one schema and no diff requests', async function() {
  var e = env({ settings: { ai_review_file_filter: { ignoreFiles: '*.json' } } });
  var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, includeDescription: false });
  assert.equal(result.complete, true);
  assert.ok(result.text.includes(OLD) && result.text.includes(HEAD));
  assert.match(result.text, /Fixed in latest push/);
  assert.match(result.text, /"new_line": 1/);
  assert.match(result.text, /ignoreFiles.*\*.json/);
  assert.match(result.text, /all intervening commits together/);
  assert.equal((result.text.match(/"version":1/g) || []).length, 1);
  assert.equal(e.requests.some(function(url) { return /\/(compare|diffs|changes|commits)$/.test(url.pathname); }), false);
  assert.doesNotMatch(result.text, /## Cumulative|## Commits|## MR description|"truncated": false/);
  assert.equal(e.writes.length, 0);
});

test('code repeat review includes only the selected delta, with full current code on unavailable comparison', async function() {
  var e = env(), result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, includeCode: true });
  assert.match(result.text, /-bug\(\);/);
  assert.doesNotMatch(result.text, /-old\(\);|## Cumulative MR diff|## Commits/);
  assert.equal((result.text.match(/"version":1/g) || []).length, 1);
  assert.equal(e.requests.some(function(url) { return /\/(diffs|changes|commits)$/.test(url.pathname); }), false);
  for (var legacy of [false, true]) {
    var fallback = env({ compareStatus: 404, legacy: legacy });
    var full = await fallback.api.prepareRepeatReview(fallback.context, { baselineHead: OLD, includeCode: true });
    assert.match(full.text, /## Cumulative MR diff/);
    assert.match(full.text, /-old\(\);/);
    assert.equal((full.text.match(/Incremental comparison unavailable/g) || []).length, 1);
    assert.equal((full.text.match(/"version":1/g) || []).length, 1);
    assert.equal(full.complete, false);
  }
});

test('empty comparison is valid and does not pull in the full cumulative diff', async function() {
  var e = env({ comparisonFiles: [] });
  var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, includeCode: true });
  assert.equal(result.complete, true);
  assert.equal(result.fileCount, 0);
  assert.doesNotMatch(result.text, /## Cumulative|## Commits/);
  assert.equal(e.requests.some(function(url) { return url.pathname.endsWith('/diffs'); }), false);
});

test('full-code fallback rejects a changed revision instead of combining different heads', async function() {
  var e = env({ compareStatus: 404, changeAt: 3 });
  await assert.rejects(e.api.prepareRepeatReview(e.context, { baselineHead: OLD, includeCode: true }), /MR revision changed/);
});

test('repeat review verifies only selected threads and preserves every reply in those threads', async function() {
  var other = '2'.repeat(40), e = env({ threads: [
    { id: THREAD, notes: [{ id: 1, body: 'Selected finding', resolvable: true, resolved: true }, { id: 2, body: 'Selected thread context' }] },
    { id: other, notes: [{ id: 3, body: 'Unselected private feedback', resolvable: true, resolved: false }] }
  ] });
  var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, discussionIds: [THREAD] });
  assert.match(result.text, /Selected finding/); assert.match(result.text, /Selected thread context/);
  assert.doesNotMatch(result.text, /Unselected private feedback/);
  assert.match(result.text, /Unselected findings are outside/);
  assert.match(result.text, /review new code changes separately/);
  assert.equal(result.complete, true);
});

test('repeat review with no selected discussions checks code only and skips discussion loading', async function() {
  var e = env({ noDiscussions: true });
  var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, discussionIds: [], includeCode: true });
  assert.equal(result.complete, true);
  assert.match(result.text, /No discussions selected/);
  assert.match(result.text, /-bug\(\);/);
  assert.doesNotMatch(result.text, /"type":"reply"|Fixed in latest push/);
  assert.equal(e.requests.some(function(url) { return /\/(discussions|notes)$/.test(url.pathname); }), false);
});

test('full repeat review without discussions is a complete code-only task, not a loading failure', async function() {
  for (var includeCode of [false, true]) {
    var e = env({ noDiscussions: true });
    var result = await e.api.prepareRepeatReview(e.context, { discussionIds: [], includeCode: includeCode });
    assert.equal(result.complete, true);
    assert.equal(result.warnings.length, 0);
    assert.match(result.text, /Review the full current MR within the configured file scope/);
    assert.match(result.text, /No discussions selected/);
    assert.doesNotMatch(result.text, /Missing data and limitations|with existing discussions|"type":"reply"/);
    assert.equal(e.requests.some(function(url) { return /\/(discussions|notes)$/.test(url.pathname); }), false);
  }
});

test('missing selected discussion produces an explicit limitation without substituting other threads', async function() {
  var e = env(), missing = '3'.repeat(40);
  var result = await e.api.prepareRepeatReview(e.context, { baselineHead: OLD, discussionIds: [missing] });
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /Selected discussion .* could not be loaded/);
  assert.doesNotMatch(result.text, /Fixed in latest push/);
});

test('response language applies to fresh, fix and repeat tasks without changing JSON fields', async function() {
  var e = env({ settings: { ai_review_response_language: 'ru' } });
  var snapshot = { context: e.context, entity: { iid: 42, title: 'MR', sha: HEAD }, complete: true, warnings: [], discussions: [] };
  var outputs = [await e.api.prepareFreshReview(e.context), await e.api.prepareExport(snapshot, { includeDescription: false }), await e.api.prepareRepeatReview(e.context, { discussionIds: [] })];
  outputs.forEach(function(out) {
    assert.match(out.text, /^Response language selected by the user: Russian/);
    assert.match(out.text, /Preserve JSON keys, identifiers, file paths, exact code lines/);
  });
  for (var language of ['auto', 'invalid', '__proto__', null]) {
    var automatic = env({ settings: { ai_review_response_language: language } });
    assert.equal(await automatic.workflow.applyResponseLanguage('Original text'), 'Original text');
  }
  var cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(e.workflow.applyResponseLanguage('Original', { signal: cancelled.signal }), { name: 'AbortError' });
});

test('repeat reply contract stays concise even with a saved verbose prompt and leaves original evidence intact', async function() {
  var original = 'Original finding: explain every detail of the old behavior.';
  var e = env({ settings: { ai_review_repeat_prompt: 'Give a detailed report of the whole MR in every reply.' }, threads: [{ id: THREAD, notes: [{ id: 1, body: original, resolvable: true, resolved: false }] }] });
  var result = await e.api.prepareRepeatReview(e.context, { discussionIds: [THREAD] });
  assert.match(result.text, /1-3 concise sentences/);
  assert.match(result.text, /Do not quote or retell the original finding/);
  assert.match(result.text, /omit suite-wide test counts/);
  assert.match(result.text, /Do not append whole-MR conclusions/);
  assert.match(result.text, /New defects belong in separate finding items/);
  assert.ok(result.text.includes(original));
  assert.ok(e.workflow.DEFAULT_REPEAT_PROMPT.length <= 1500);
  var codeOnly = await e.api.prepareRepeatReview(e.context, { discussionIds: [] });
  assert.doesNotMatch(codeOnly.text, /"type":"reply"/);
});

test('local repository instructions cover all exported tasks and preserve custom prompts', async function() {
  var e = env();
  var snapshot = { context: e.context, entity: { iid: 42, title: 'MR', sha: HEAD }, complete: true, warnings: [], discussions: [] };
  var fresh = await e.api.prepareFreshReview(e.context, { prompt: 'Custom reviewer instructions' });
  var repeat = await e.api.prepareRepeatReview(e.context, { discussionIds: [], prompt: 'Custom repeat instructions' });
  var fix = await e.api.prepareExport(snapshot, { prompt: 'Custom fix instructions', includeDescription: false, includeReplies: false });
  [fresh, repeat, fix].forEach(function(out) {
    assert.match(out.text, /first inspect the available local repository/);
    assert.match(out.text, /not a requirement to open GitLab or obtain an API token/);
    assert.match(out.text, /verified configured remote using existing authentication/);
    assert.match(out.text, /Custom/);
  });
  [fresh, repeat].forEach(function(out) {
    assert.match(out.text, /separate detached worktree at the verified head/);
    assert.match(out.text, /git show\/diff without switching/);
    assert.doesNotMatch(out.text, /Fix mode:/);
  });
  assert.match(fix.text, /including the user's later local commits and uncommitted fixes/);
  assert.match(fix.text, /not a requirement to roll back local work/);
  assert.match(fix.text, /Do not commit or push without separate authorization/);
  assert.doesNotMatch(fix.text, /Review and reply modes:/);
});

test('automatic instructions can be customized or disabled in every export mode while context and JSON remain', async function() {
  var saved = { ai_review_response_language: 'ru' }, e = env({ settings: saved });
  var blocks = e.workflow.INSTRUCTION_BLOCKS.filter(function(block) { return !/^import_|^reply_/.test(block.id); });
  blocks.forEach(function(block) { saved[e.workflow.INSTRUCTION_PREFIX + block.id] = { enabled: true, text: 'CUSTOM_' + block.id + ' {language}' }; });
  var snapshot = { context: e.context, entity: { iid: 42, title: 'MR', sha: HEAD }, complete: true, warnings: [], discussions: [{ id: THREAD, notes: [{ id: 11, body: 'Feedback', resolvable: true, resolved: false }] }] };
  var empty = Object.assign({}, snapshot, { discussions: [] });
  async function tasks() {
    return Promise.all([
      e.api.prepareFreshReview(e.context, { prompt: 'MAIN', fileFilter: { ignoreFiles: '*.json' } }),
      e.api.prepareFreshReview(e.context, { prompt: 'MAIN', includeCode: true }),
      e.api.prepareExport(snapshot, { prompt: 'MAIN', discussionIds: [THREAD, 'missing'], includeDescription: false }),
      e.api.prepareExport(snapshot, { prompt: 'MAIN', includeReplies: false }),
      e.api.prepareExport(empty, { prompt: 'MAIN' }),
      e.api.prepareRepeatReview(e.context, { prompt: 'MAIN', baselineHead: OLD, discussionIds: [THREAD] }),
      e.api.prepareRepeatReview(e.context, { prompt: 'MAIN', baselineHead: HEAD, discussionIds: [] }),
      e.api.prepareRepeatReview(e.context, { prompt: 'MAIN', discussionIds: [] }),
      e.api.prepareRepeatReview(e.context, { prompt: 'MAIN', baselineHead: OLD, includeCode: true, discussionIds: [THREAD] })
    ]);
  }
  var outputs = await tasks(), corpus = outputs.map(function(out) { return out.text; }).join('\n');
  blocks.forEach(function(block) { assert.ok(corpus.includes('CUSTOM_' + block.id), 'Unused instruction: ' + block.id); });
  assert.match(corpus, /CUSTOM_language Russian/);
  assert.match(outputs[2].text, /"discussion_id"/);
  blocks.forEach(function(block) { saved[e.workflow.INSTRUCTION_PREFIX + block.id].enabled = false; });
  outputs = await tasks();
  outputs.forEach(function(out) { assert.doesNotMatch(out.text, /CUSTOM_/); assert.match(out.text, /MAIN/); });
  assert.match(outputs[0].text, /"version":1/);
  assert.ok(outputs[0].text.includes(HEAD));
  assert.match(outputs[2].text, /Feedback/);
  assert.match(outputs[2].text, /"discussion_id"/);
});

test('automatic instruction defaults, templates and storage validation preserve user text', async function() {
  var e = env(), blocks = e.workflow.INSTRUCTION_BLOCKS, defaults = e.workflow.instructionDefaults();
  blocks.forEach(function(block) { assert.equal(defaults[e.workflow.INSTRUCTION_PREFIX + block.id].enabled, true); assert.ok(block.text.length <= 1500); });
  var settings = { ai_review_rule_language: { enabled: true, text: 'Use {language}; keep {unknown} and $& literal.' } };
  e.chrome.storage.sync.get = function(defaults, cb) { cb(Object.assign({}, defaults, settings)); };
  var options = await e.workflow.instructionOptions({});
  assert.equal(e.workflow.instruction('language', options, { language: 'Russian' }), 'Use Russian; keep {unknown} and $& literal.');
  settings.ai_review_rule_language = { enabled: true, text: '' };
  assert.equal(e.workflow.instruction('language', await e.workflow.instructionOptions({})), '');
  settings.ai_review_rule_language = { enabled: false, text: 'Kept for later' };
  assert.equal(e.workflow.instruction('language', await e.workflow.instructionOptions({})), '');
  settings.ai_review_rule_language = { enabled: true, text: 'a'.repeat(1501) };
  await assert.rejects(e.workflow.instructionOptions({}), /storage limit/);
  settings.ai_review_rule_language = { enabled: true, text: '\u0001'.repeat(1500) };
  await assert.rejects(e.workflow.instructionOptions({}), /storage limit/);
  settings.ai_review_rule_language = { enabled: 'false', text: 'Invalid' };
  await assert.rejects(e.workflow.instructionOptions({}), /Invalid automatic/);
});
