'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');
var cherryPick = require('./helpers/cherry-pick.cjs');
var sha = 'abcdef1234567890';
var base = '/projects/team%2Frepo';
var parent = 'parent-head';

function diff(file, extra) {
  return Object.assign({ old_path: file, new_path: file, diff: '@@ -1 +1 @@\n-old\n+new\n' }, extra);
}

function fixture(options) {
  options = options || {};
  var settings = Object.assign({ cherry_pick_branches: ['stable/1'], cherry_pick_create_mr: true, cherry_pick_smart_fallback: true, cherry_pick_bump_version: false }, options.settings);
  var versionFile = settings.versionFile || 'package.json';
  var parentFiles = Object.assign({ 'package.json': '{"version":"1.0.0","keep":"да"}', 'app.txt': 'old\n' }, options.parentFiles);
  var sourceFiles = Object.assign({}, parentFiles, { 'package.json': '{"version":"1.0.1","keep":"да"}', 'app.txt': 'new\n' }, options.sourceFiles);
  var targetFiles = Object.assign({}, parentFiles, { 'package.json': '{"version":"2.0.0","keep":"да","targetOnly":true}' }, options.targetFiles);
  var branchFiles = {};
  settings.cherry_pick_branches.forEach(function(branch) { branchFiles[branch] = Object.assign({}, targetFiles); });
  Object.assign(branchFiles, options.existingBranches);
  var env = cherryPick({ gitlab: function(req) {
    if (options.respond) {
      var override = options.respond(req, branchFiles);
      if (override !== undefined) return override;
    }
    var url = new URL('https://gitlab.test' + req.path);
    if (url.pathname === base + '/repository/branches' && req.method === 'POST') {
      if (branchFiles[req.body.branch]) return harness.response(400, { message: 'Branch already exists' });
      branchFiles[req.body.branch] = Object.assign({}, branchFiles[req.body.ref]);
      return { name: req.body.branch };
    }
    if (req.method === 'DELETE' && url.pathname.startsWith(base + '/repository/branches/')) {
      delete branchFiles[decodeURIComponent(url.pathname.split('/').pop())];
      return harness.response(204, '');
    }
    if (url.pathname === base + '/repository/commits/' + sha + '/cherry_pick') {
      if (options.conflict) return harness.response(400, { message: 'Cherry-pick conflict', error_code: 'conflict' });
      Object.assign(branchFiles[req.body.branch], sourceFiles);
      return { id: 'picked-head' };
    }
    if (url.pathname === base + '/repository/commits/' + sha) {
      return { message: 'Fix Unicode: исправление', author_name: 'Original Author', author_email: 'author@example.test', parent_ids: options.noParent ? [] : [parent] };
    }
    if (url.pathname.endsWith('/diff')) {
      var diffs = options.diffs || [diff(versionFile), diff('app.txt')];
      var page = Number(url.searchParams.get('page'));
      return diffs.slice((page - 1) * 100, page * 100);
    }
    if (url.pathname.startsWith(base + '/repository/files/')) {
      var file = decodeURIComponent(url.pathname.slice((base + '/repository/files/').length));
      var ref = url.searchParams.get('ref');
      var files = ref === parent ? parentFiles : ref === sha ? sourceFiles : branchFiles[ref];
      if (!files || files[file] === undefined) return harness.response(404, { message: 'File not found' });
      return { content: Buffer.from(files[file]).toString('base64'), last_commit_id: ref + ':' + file };
    }
    if (url.pathname === base + '/repository/commits' && req.method === 'POST') {
      req.body.actions.forEach(function(action) {
        if (action.action === 'delete') delete branchFiles[req.body.branch][action.file_path];
        else branchFiles[req.body.branch][action.file_path] = Buffer.from(action.content, 'base64').toString();
      });
      return { id: 'fallback-head' };
    }
    if (url.pathname === base + '/merge_requests') {
      if (req.method === 'GET') return [];
      return { web_url: 'https://gitlab.test/team/repo/-/merge_requests/42' };
    }
    throw new Error('Unexpected request: ' + req.method + ' ' + req.path);
  } });
  env.files = branchFiles;
  env.open(settings, sha);
  return env;
}

function mutations(env) { return env.requests.filter(function(req) { return req.method !== 'GET'; }); }
function commits(env) { return env.requests.filter(function(req) { return req.method === 'POST' && req.path === base + '/repository/commits'; }); }
function assertNoCommit(env) { assert.equal(commits(env).length, 0); assert.equal(env.requests.some(function(req) { return req.method === 'POST' && req.path === base + '/merge_requests'; }), false); }

test('native cherry-pick creates a branch and MR for each target in order', async function() {
  var env = fixture({ settings: { cherry_pick_branches: ['stable/1', 'stable/2'], cherry_pick_bump_version: true } });
  assert.deepEqual((await env.run()).map(function(row) { return row.status; }), ['success', 'success']);
  assert.deepEqual(mutations(env).map(function(req) { return req.path.split('/').pop(); }), ['branches', 'cherry_pick', 'merge_requests', 'branches', 'cherry_pick', 'merge_requests']);
  ['stable/1', 'stable/2'].forEach(function(branch, i) {
    var workBranch = 'cherry-pick-abcdef12-into-' + branch.replace('/', '-');
    assert.deepEqual(mutations(env)[i * 3].body, { branch: workBranch, ref: branch });
    assert.deepEqual(mutations(env)[i * 3 + 1].body, { branch: workBranch });
    assert.equal(mutations(env)[i * 3 + 2].body.target_branch, branch);
    assert.equal(mutations(env)[i * 3 + 2].body.remove_source_branch, true);
    assert.equal(env.files[workBranch]['app.txt'], 'new\n');
  });
  assert.equal(commits(env).length, 0, 'The optional bump applies only to fallback');
});

test('direct cherry-pick writes each target without creating branches or MRs', async function() {
  var env = fixture({ settings: { cherry_pick_create_mr: false, cherry_pick_branches: ['stable/1', 'stable/2'] } });
  assert.deepEqual((await env.run()).map(function(row) { return row.status; }), ['success', 'success']);
  assert.equal(mutations(env).length, 2);
  assert.deepEqual(mutations(env).map(function(req) { return req.body.branch; }), ['stable/1', 'stable/2']);
});

test('a repeated click while native cherry-pick is pending does not start a second operation', async function() {
  var resolve;
  var pending = new Promise(function(res) { resolve = res; });
  var env = fixture({ respond: function(req) { if (req.path.endsWith('/cherry_pick')) return pending; } });
  env.start.click();
  await harness.flush();
  env.start.click();
  resolve({ id: 'picked-head' });
  assert.equal((await env.settle())[0].status, 'success');
  assert.equal(env.requests.filter(function(req) { return req.path.endsWith('/cherry_pick'); }).length, 1);
});

test('a branch failure is isolated and does not delete an existing branch', async function() {
  var existing = { 'cherry-pick-abcdef12-into-stable-1': { 'private.txt': 'Existing work' } };
  var env = fixture({ existingBranches: existing, settings: { cherry_pick_branches: ['stable/1', 'stable/2'] } });
  var rows = await env.run();
  assert.deepEqual(rows.map(function(row) { return row.status; }), ['error', 'success']);
  assert.match(rows[0].html, /Branch already exists/);
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['private.txt'], 'Existing work');
  assert.equal(env.requests.some(function(req) { return req.method === 'DELETE'; }), false);
});

[
  { status: 403, body: { message: 'Forbidden' } },
  { status: 500, body: { message: 'Server failure' } },
  { status: 400, body: { message: 'Already picked', error_code: 'empty' } },
  { status: 400, body: { message: 'Unknown failure' } },
  { network: true }
].forEach(function(error) {
  test('non-conflict cherry-pick failure never triggers fallback: ' + JSON.stringify(error), async function() {
    var env = fixture({ respond: function(req) {
      if (req.path.endsWith('/cherry_pick')) {
        if (error.network) throw new Error('Connection lost after send');
        return harness.response(error.status, error.body);
      }
    } });
    assert.equal((await env.run())[0].status, 'error');
    assert.equal(mutations(env).length, 2, 'Only branch creation and one native cherry-pick are allowed');
    assertNoCommit(env);
  });
});

test('conflict with fallback disabled stops before replay or MR creation', async function() {
  var env = fixture({ conflict: true, settings: { cherry_pick_smart_fallback: false } });
  assert.equal((await env.run())[0].status, 'error');
  assert.equal(mutations(env).length, 2);
  assertNoCommit(env);
});

test('fallback preserves unrelated target edits and original author, then creates an MR', async function() {
  var env = fixture({ conflict: true, targetFiles: { 'app.txt': 'prefix\nold\nsuffix\n' } });
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['app.txt'], 'prefix\nnew\nsuffix\n');
  var body = commits(env)[0].body;
  assert.equal(body.author_name, 'Original Author');
  assert.equal(body.author_email, 'author@example.test');
  assert.match(body.commit_message, /исправление/);
  assert.ok(body.commit_message.includes(sha));
  assert.deepEqual(body.actions.map(function(action) { return action.file_path; }), ['app.txt']);
  assert.equal(env.requests.some(function(req) { return req.method === 'DELETE'; }), false);
});

test('retry after an MR failure reuses the successful commit without replaying it', async function() {
  var failMr = true;
  var env = fixture({ respond: function(req) {
    if (req.method === 'POST' && req.path === base + '/merge_requests' && failMr) return harness.response(400, { message: 'MR temporarily unavailable' });
  } });
  assert.equal((await env.run())[0].status, 'error');
  failMr = false;
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(env.requests.filter(function(req) { return req.path.endsWith('/cherry_pick'); }).length, 1);
  assert.equal(env.requests.filter(function(req) { return req.path.endsWith('/repository/branches'); }).length, 1);
  assert.equal(env.requests.some(function(req) { return req.method === 'DELETE'; }), false);
});

test('retry reuses an MR created before its response was lost', async function() {
  var env = fixture({ respond: function(req) {
    if (req.method === 'POST' && req.path === base + '/merge_requests') throw new Error('Connection lost after MR creation');
    if (req.method === 'GET' && req.path.startsWith(base + '/merge_requests?')) {
      var url = new URL('https://gitlab.test' + req.path);
      assert.equal(url.searchParams.get('source_branch'), 'cherry-pick-abcdef12-into-stable-1');
      assert.equal(url.searchParams.get('target_branch'), 'stable/1');
      assert.equal(url.searchParams.get('state'), 'opened');
      return [{ source_project_id: 37, target_project_id: 37, source_branch: 'cherry-pick-abcdef12-into-stable-1', target_branch: 'stable/1', web_url: 'https://gitlab.test/team/repo/-/merge_requests/99' }];
    }
  } });
  assert.equal((await env.run())[0].status, 'error');
  var rows = await env.run();
  assert.equal(rows[0].status, 'success');
  assert.match(rows[0].html, /merge_requests\/99/);
  assert.equal(env.requests.filter(function(req) { return req.method === 'POST' && req.path === base + '/merge_requests'; }).length, 1);
});

[
  { name: 'JSON', file: 'package.json', path: 'version', parent: '{"version":"1.0.0","keep":"да"}', source: '{"version":"1.0.1","keep":"да"}', target: '{"version":"2.0.0","keep":"да"}', expected: '{\n  "version": "2.0.1",\n  "keep": "да"\n}\n' },
  { name: 'TOML', file: 'pyproject.toml', path: 'project.version', parent: '[project]\nversion = "1.0.0"\nname = "keep"\n', source: '[project]\nversion = "1.0.1"\nname = "keep"\n', target: '# target comment\n[project]\nversion = "2.0.0"\nname = "keep"\n', expected: '# target comment\n[project]\nversion = "2.0.1"\nname = "keep"\n' },
  { name: 'plain text', file: 'version.txt', path: 'version', parent: '1.0.0\n', source: '1.0.1\n', target: '2.0.0\n', expected: '2.0.1\n' }
].forEach(function(example) {
  test('fallback bumps ' + example.name + ' in the same commit while preserving target content', async function() {
    var parentFiles = {}, sourceFiles = {}, targetFiles = {};
    parentFiles[example.file] = example.parent;
    sourceFiles[example.file] = example.source;
    targetFiles[example.file] = example.target;
    var env = fixture({ conflict: true, parentFiles: parentFiles, sourceFiles: sourceFiles, targetFiles: targetFiles, settings: { versionFile: example.file, versionPath: example.path, cherry_pick_bump_version: true } });
    assert.equal((await env.run())[0].status, 'success');
    assert.equal(commits(env).length, 1);
    assert.equal(commits(env)[0].body.actions.length, 2);
    assert.equal(env.files['cherry-pick-abcdef12-into-stable-1'][example.file], example.expected);
    assert.equal(env.files['stable/1'][example.file], example.target, 'MR mode leaves the target branch untouched');
  });
});

test('a version-only conflict becomes one bump-only commit', async function() {
  var env = fixture({ conflict: true, diffs: [diff('package.json')], settings: { cherry_pick_bump_version: true, cherry_pick_create_mr: false } });
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(commits(env)[0].body.actions.length, 1);
  assert.equal(JSON.parse(env.files['stable/1']['package.json']).version, '2.0.1');
});

test('a version-only conflict with bump disabled cannot create an empty commit', async function() {
  var env = fixture({ conflict: true, diffs: [diff('package.json')] });
  assert.equal((await env.run())[0].status, 'error');
  assertNoCommit(env);
});

test('retry after a fallback MR failure does not bump twice', async function() {
  var failMr = true;
  var env = fixture({ conflict: true, settings: { cherry_pick_bump_version: true }, respond: function(req) {
    if (req.method === 'POST' && req.path === base + '/merge_requests' && failMr) return harness.response(400, { message: 'MR creation failed' });
  } });
  assert.equal((await env.run())[0].status, 'error');
  failMr = false;
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(commits(env).length, 1);
  assert.equal(JSON.parse(env.files['cherry-pick-abcdef12-into-stable-1']['package.json']).version, '2.0.1');
});

test('retry only processes the failed target, leaving successful targets alone', async function() {
  var fail = true;
  var env = fixture({ settings: { cherry_pick_branches: ['stable/1', 'stable/2'] }, respond: function(req) {
    if (req.path.endsWith('/repository/branches') && req.body.ref === 'stable/2' && fail) return harness.response(403, { message: 'Forbidden' });
  } });
  assert.deepEqual((await env.run()).map(function(row) { return row.status; }), ['success', 'error']);
  var before = env.requests.length;
  fail = false;
  assert.deepEqual((await env.run()).map(function(row) { return row.status; }), ['success', 'success']);
  assert.equal(env.requests.slice(before).some(function(req) { return JSON.stringify(req.body || {}).includes('stable-1') || JSON.stringify(req.body || {}).includes('stable/1'); }), false);
});

test('fallback paginates the complete diff before committing every changed file', async function() {
  var diffs = [diff('package.json')], parentFiles = {}, sourceFiles = {}, targetFiles = {};
  for (var i = 0; i < 101; i++) {
    var file = 'file-' + i + '.txt';
    diffs.push(diff(file));
    parentFiles[file] = targetFiles[file] = 'old\n';
    sourceFiles[file] = 'new\n';
  }
  var env = fixture({ conflict: true, diffs: diffs, parentFiles: parentFiles, sourceFiles: sourceFiles, targetFiles: targetFiles });
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(env.requests.filter(function(req) { return req.path.includes('/diff?'); }).length, 2);
  assert.equal(commits(env)[0].body.actions.length, 101);
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['file-100.txt'], 'new\n');
});

test('overlapping diff pages are rejected before a partial or duplicate commit', async function() {
  var diffs = [diff('package.json')];
  for (var i = 0; i < 99; i++) diffs.push(diff('file-' + i));
  diffs.push(diff('file-0'));
  var env = fixture({ conflict: true, diffs: diffs });
  assert.match((await env.run())[0].html, /Duplicate diff entries/);
  assertNoCommit(env);
});

test('the pagination safety limit rejects an incomplete fallback', async function() {
  var diffs = [diff('package.json')];
  for (var i = 0; i < 1000; i++) diffs.push(diff('file-' + i));
  var env = fixture({ conflict: true, diffs: diffs });
  assert.match((await env.run())[0].html, /too many files/);
  assert.equal(env.requests.filter(function(req) { return req.path.includes('/diff?'); }).length, 10);
  assertNoCommit(env);
});

[
  { name: 'version file not in diff', diffs: [diff('app.txt')] },
  { name: 'other JSON fields changed', sourceFiles: { 'package.json': '{"version":"1.0.1","keep":"different"}' } },
  { name: 'missing parent commit', noParent: true },
  { name: 'changed context in target', targetFiles: { 'app.txt': 'different\n' } },
  { name: 'target file deleted', targetFiles: { 'app.txt': undefined } },
  { name: 'renamed file', diffs: [diff('package.json'), diff('renamed.txt', { old_path: 'app.txt', renamed_file: true })], sourceFiles: { 'renamed.txt': 'new\n' } }
].forEach(function(example) {
  test('fallback refuses unsafe replay: ' + example.name, async function() {
    var env = fixture(Object.assign({ conflict: true }, example));
    assert.equal((await env.run())[0].status, 'error');
    assertNoCommit(env);
  });
});

[
  { name: 'parent version read fails', file: 'package.json', ref: parent, status: 500 },
  { name: 'source version read is forbidden', file: 'package.json', ref: sha, status: 403 },
  { name: 'parent version is missing', file: 'package.json', ref: parent, status: 404 },
  { name: 'deleted file baseline cannot be read', file: 'app.txt', ref: parent, status: 500, deleted: true },
  { name: 'deleted file baseline is absent', file: 'app.txt', ref: parent, status: 404, deleted: true },
  { name: 'new file target existence cannot be verified', file: 'app.txt', ref: 'cherry-pick-abcdef12-into-stable-1', status: 403, added: true }
].forEach(function(example) {
  test('fallback stops when safety cannot be verified: ' + example.name, async function() {
    var env = fixture({ conflict: true, diffs: [diff('package.json'), diff('app.txt', { deleted_file: !!example.deleted, new_file: !!example.added })], respond: function(req) {
      var url = new URL('https://gitlab.test' + req.path);
      if (url.pathname.endsWith('/repository/files/' + example.file) && url.searchParams.get('ref') === example.ref) return harness.response(example.status, { message: 'Cannot read file' });
    } });
    assert.equal((await env.run())[0].status, 'error');
    assertNoCommit(env);
  });
});

test('fallback applies creates and safe deletes, skipping files already absent', async function() {
  var env = fixture({ conflict: true,
    diffs: [diff('package.json'), diff('new.txt', { new_file: true }), diff('app.txt', { deleted_file: true }), diff('absent.txt', { deleted_file: true })],
    parentFiles: { 'absent.txt': 'old\n' }, sourceFiles: { 'new.txt': 'new\n' }, targetFiles: { 'absent.txt': undefined }
  });
  assert.equal((await env.run())[0].status, 'success');
  assert.deepEqual(commits(env)[0].body.actions.map(function(action) { return [action.action, action.file_path]; }), [['create', 'new.txt'], ['delete', 'app.txt']]);
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['new.txt'], 'new\n');
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['app.txt'], undefined);
});

['update', 'delete', 'version'].forEach(function(kind) {
  test('fallback protects a concurrent ' + kind + ' file edit and stops after rejection', async function() {
    var guarded = false;
    var env = fixture({ conflict: true, settings: { cherry_pick_bump_version: kind === 'version' },
      diffs: [diff('package.json'), diff('app.txt', { deleted_file: kind === 'delete' })],
      respond: function(req) {
        if (req.method === 'POST' && req.path === base + '/repository/commits') {
          var file = kind === 'version' ? 'package.json' : 'app.txt';
          var action = req.body.actions.find(function(item) { return item.file_path === file; });
          guarded = action.last_commit_id === 'cherry-pick-abcdef12-into-stable-1:' + file;
          if (guarded) return harness.response(400, { message: 'File changed concurrently' });
        }
      }
    });
    assert.equal((await env.run())[0].status, 'error');
    assert.equal(guarded, true);
    assert.equal(commits(env).length, 1);
    assert.equal(env.requests.some(function(req) { return req.method === 'POST' && req.path === base + '/merge_requests'; }), false);
  });
});

test('fallback bumps the working branch snapshot if the original target advances', async function() {
  var env = fixture({ conflict: true, settings: { cherry_pick_bump_version: true }, respond: function(req, files) {
    if (req.path.endsWith('/cherry_pick')) files['stable/1']['package.json'] = '{"version":"3.0.0","newTargetChange":true}';
  } });
  assert.equal((await env.run())[0].status, 'success');
  var work = JSON.parse(env.files['cherry-pick-abcdef12-into-stable-1']['package.json']);
  assert.equal(work.version, '2.0.1');
  assert.equal(work.keep, 'да');
  assert.equal(work.newTargetChange, undefined);
  assert.equal(JSON.parse(env.files['stable/1']['package.json']).version, '3.0.0');
});

test('an MR in another fork is not mistaken for the result of this cherry-pick', async function() {
  var mrPosts = 0;
  var env = fixture({ respond: function(req) {
    if (req.method === 'POST' && req.path === base + '/merge_requests') {
      mrPosts++;
      if (mrPosts === 1) return harness.response(400, { message: 'Try again' });
    }
    if (req.method === 'GET' && req.path.startsWith(base + '/merge_requests?')) return [{ source_project_id: 999, target_project_id: 37, source_branch: 'cherry-pick-abcdef12-into-stable-1', target_branch: 'stable/1', web_url: 'https://gitlab.test/wrong-mr' }];
  } });
  assert.equal((await env.run())[0].status, 'error');
  var rows = await env.run();
  assert.equal(rows[0].status, 'success');
  assert.equal(mrPosts, 2);
  assert.doesNotMatch(rows[0].html, /wrong-mr/);
});

test('failed MR lookup on retry does not replay the commit or create another MR', async function() {
  var env = fixture({ respond: function(req) {
    if (req.path.startsWith(base + '/merge_requests')) return harness.response(503, { message: 'Service unavailable' });
  } });
  assert.equal((await env.run())[0].status, 'error');
  var before = mutations(env).length;
  assert.equal((await env.run())[0].status, 'error');
  assert.equal(mutations(env).length, before);
});

// GitLab 10.8 ChangeService + Commits API return this message without error_code.
// Whitespace comes from the multi-line Ruby string in that version.
var legacyCherryMessage = 'Sorry, we cannot cherry-pick this commit automatically.\n                   This commit may already have been cherry-picked, or a more recent commit may have updated some of its content.';
function legacyFailure(req) {
  if (req.path.endsWith('/cherry_pick')) return harness.response(400, { message: legacyCherryMessage });
}

test('legacy cherry-pick failure without error_code can replay verified non-version changes', async function() {
  var env = fixture({ respond: legacyFailure, settings: { cherry_pick_bump_version: true } });
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['app.txt'], 'new\n');
  assert.equal(commits(env).length, 1);
  assert.equal(JSON.parse(env.files['cherry-pick-abcdef12-into-stable-1']['package.json']).version, '2.0.1');
});

[
  { name: 'version-only change', diffs: [diff('package.json')] },
  { name: 'non-version changes already applied', targetFiles: { 'app.txt': 'new\n' } },
  { name: 'no verifiable non-version content change', sourceFiles: { 'app.txt': 'old\n' }, diffs: [diff('package.json'), diff('app.txt', { diff: '' })] },
  { name: 'deleted file already absent', diffs: [diff('package.json'), diff('app.txt', { deleted_file: true })], targetFiles: { 'app.txt': undefined } }
].forEach(function(example) {
  test('legacy ambiguous cherry-pick cannot trigger an extra bump: ' + example.name, async function() {
    var env = fixture(Object.assign({ respond: legacyFailure, settings: { cherry_pick_bump_version: true } }, example));
    assert.equal((await env.run())[0].status, 'error');
    assertNoCommit(env);
  });
});

[403, 500].forEach(function(status) {
  test('a legacy-looking message with HTTP ' + status + ' must not trigger fallback', async function() {
    var env = fixture({ respond: function(req) {
      if (req.path.endsWith('/cherry_pick')) return harness.response(status, { message: legacyCherryMessage });
    } });
    assert.equal((await env.run())[0].status, 'error');
    assertNoCommit(env);
  });
});

test('MR mode can be changed after branch creation fails, without deleting that branch', async function() {
  var env = fixture({ settings: { cherry_pick_smart_fallback: false }, respond: function(req) {
    if (req.path.endsWith('/repository/branches')) return harness.response(400, { message: 'Branch already exists' });
  } });
  assert.equal((await env.run())[0].status, 'error');
  env.context.document.body.querySelector('.gl-cherry-pick-mr-checkbox').checked = false;
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(env.files['stable/1']['app.txt'], 'new\n');
  assert.equal(env.requests.some(function(req) { return req.method === 'DELETE'; }), false);
});

test('changing to direct mode after MR creation fails applies the pick to the newly chosen destination', async function() {
  var env = fixture({ respond: function(req) {
    if (req.method === 'POST' && req.path === base + '/merge_requests') return harness.response(403, { message: 'Cannot create MR' });
  } });
  assert.equal((await env.run())[0].status, 'error');
  var workBranch = 'cherry-pick-abcdef12-into-stable-1';
  var appliedFiles = Object.assign({}, env.files[workBranch]);
  assert.equal(env.files['stable/1']['app.txt'], 'old\n');
  env.context.document.body.querySelector('.gl-cherry-pick-mr-checkbox').checked = false;
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(env.files['stable/1']['app.txt'], 'new\n');
  assert.deepEqual(env.files[workBranch], appliedFiles);
  assert.deepEqual(env.requests.filter(function(req) { return req.path.endsWith('/cherry_pick'); }).map(function(req) { return req.body.branch; }), [workBranch, 'stable/1']);
  assert.equal(env.requests.some(function(req) { return req.method === 'DELETE'; }), false);
});

test('legacy fallback preserves unrelated target edits when the exact patch still applies', async function() {
  var env = fixture({ respond: legacyFailure, targetFiles: { 'app.txt': 'prefix\nold\nsuffix\n' } });
  assert.equal((await env.run())[0].status, 'success');
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['app.txt'], 'prefix\nnew\nsuffix\n');
  assert.deepEqual(commits(env)[0].body.actions.map(function(action) { return action.file_path; }), ['app.txt']);
});

test('legacy fallback supports verified creates and deletes with bump disabled', async function() {
  var env = fixture({ respond: legacyFailure,
    diffs: [diff('package.json'), diff('new.txt', { new_file: true }), diff('app.txt', { deleted_file: true })],
    sourceFiles: { 'new.txt': 'created\n' }
  });
  assert.equal((await env.run())[0].status, 'success');
  assert.deepEqual(commits(env)[0].body.actions.map(function(action) { return action.action; }), ['create', 'delete']);
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['new.txt'], 'created\n');
  assert.equal(env.files['cherry-pick-abcdef12-into-stable-1']['app.txt'], undefined);
});

['empty', 'unknown'].forEach(function(code) {
  test('explicit cherry-pick error code overrides the legacy-looking message: ' + code, async function() {
    var env = fixture({ respond: function(req) {
      if (req.path.endsWith('/cherry_pick')) return harness.response(400, { message: legacyCherryMessage, error_code: code });
    }, settings: { cherry_pick_bump_version: true } });
    assert.equal((await env.run())[0].status, 'error');
    assertNoCommit(env);
  });
});
