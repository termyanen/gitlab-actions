'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');

function flow(options) {
  options = options || {};
  var state = { bumped: false, rebased: false, mrReads: 0, pipelineReads: 0, mergeAttempts: 0 };
  var env = harness.content({ gitlab: function(req) {
    if (req.path === '/projects/37') return { merge_method: options.mergeMethod || 'merge' };
    if (req.path === '/projects/37/merge_requests/12') {
      state.mrReads++;
      return Object.assign({ source_branch: 'feature/fix', target_branch: 'main', sha: state.bumped ? 'new-head' : 'old-head', head_pipeline: { id: 100, status: 'running' }, squash: true, should_remove_source_branch: false }, options.mr ? options.mr(state) : {});
    }
    if (req.path.endsWith('/rebase')) { state.rebased = true; return {}; }
    if (req.path.includes('/repository/files/')) {
      if (req.method === 'PUT') { state.bumped = true; state.mrReads = 0; return {}; }
      return { content: Buffer.from('{"version":"1.0.0"}').toString('base64'), last_commit_id: 'file-head' };
    }
    if (req.path.includes('/repository/branches/')) return { commit: { id: 'new-head' } };
    if (req.path.endsWith('/commits')) return options.commits || [];
    if (req.path.endsWith('/pipelines')) {
      state.pipelineReads++;
      return options.pipelines ? options.pipelines(state) : [{ id: 100, status: 'running' }];
    }
    if (req.path.endsWith('/merge')) {
      state.mergeAttempts++;
      return options.merge ? options.merge(state) : {};
    }
    throw new Error('Unexpected request: ' + req.path);
  } });
  env.state = state;
  return env;
}

function writes(env, ending) {
  return env.requests.filter(function(req) { return req.method !== 'GET' && req.path.endsWith(ending); });
}

['sha', 'diff_head_sha'].forEach(function(field) {
  test('Ship waits for the bumped commit to appear in ' + field + ' before merging', async function() {
    var env = flow({ mr: function(state) {
      var mr = { sha: 'old-head', diff_head_sha: 'old-head' };
      if (state.bumped && state.mrReads >= 3) mr[field] = 'new-head';
      return mr;
    }, merge: function(state) { assert.ok(state.mrReads >= 3); return {}; } });
    await env.finish(env.actions.doShip());
    assert.equal(writes(env, '/merge').length, 1);
    assert.equal(env.requests.some(function(req) { return req.path.endsWith('/commits'); }), false);
  });
});

test('Ship uses the commits fallback when both MR SHA fields lag', async function() {
  var env = flow({ mr: function() { return { sha: 'old-head', diff_head_sha: 'old-head' }; }, commits: [{ id: 'new-head' }] });
  await env.finish(env.actions.doShip());
  assert.equal(env.requests.filter(function(req) { return req.path.endsWith('/commits'); }).length, 1);
  assert.equal(writes(env, '/merge').length, 1);
});

[[], [{ id: 'other-commit' }]].forEach(function(commits) {
  test('Ship stops when the MR never contains the bumped commit: ' + JSON.stringify(commits), async function() {
    var env = flow({ mr: function() { return { sha: 'old-head' }; }, commits: commits });
    await assert.rejects(env.finish(env.actions.doShip()), /Timeout waiting for MR to sync/);
    assert.equal(writes(env, '/merge').length, 0);
    assert.equal(writes(env, '/package.json').length, 1);
  });
});

test('Ship waits for an in-progress rebase before bumping and merging', async function() {
  var env = flow({ mergeMethod: 'ff', mr: function(state) { return { rebase_in_progress: !state.bumped && state.mrReads < 3 }; } });
  await env.finish(env.actions.doShip());
  assert.deepEqual(env.requests.filter(function(req) { return req.method !== 'GET'; }).map(function(req) { return req.path.split('/').pop(); }), ['rebase', 'package.json', 'merge']);
  var bumpIndex = env.requests.findIndex(function(req) { return req.method === 'PUT' && req.path.endsWith('/package.json'); });
  assert.equal(env.requests.slice(0, bumpIndex).filter(function(req) { return req.path === '/projects/37/merge_requests/12'; }).length, 4);
});

test('a rebase timeout stops Ship before any version write or merge', async function() {
  var env = flow({ mergeMethod: 'ff', mr: function() { return { rebase_in_progress: true }; } });
  await assert.rejects(env.finish(env.actions.doShip()), /Timeout waiting for rebase/);
  assert.equal(writes(env, '/package.json').length, 0);
  assert.equal(writes(env, '/merge').length, 0);
  assert.equal(env.state.mrReads, 60);
});

test('Ship waits through missing and finished pipelines until a new active one appears', async function() {
  var env = flow({ mr: function() { return { head_pipeline: null }; }, pipelines: function(state) {
    if (state.pipelineReads === 1) return [];
    return [{ id: 100, status: state.pipelineReads === 2 ? 'success' : 'pending' }];
  }, merge: function(state) { assert.equal(state.pipelineReads, 3); return {}; } });
  await env.finish(env.actions.doShip());
  assert.equal(writes(env, '/merge').length, 1);
});

test('a pipeline timeout stops Ship after one bump without attempting a merge', async function() {
  var env = flow({ mr: function() { return { head_pipeline: { status: 'failed' } }; }, pipelines: function() { return []; } });
  await assert.rejects(env.finish(env.actions.doShip()), /did not create pipeline/);
  assert.equal(env.state.pipelineReads, 40);
  assert.equal(writes(env, '/package.json').length, 1);
  assert.equal(writes(env, '/merge').length, 0);
});

test('Ship retries a temporary auto-merge rejection without repeating rebase or bump', async function() {
  var env = flow({ mergeMethod: 'ff', merge: function(state) {
    return state.mergeAttempts < 3 ? harness.response(400, { message: 'Merge request is still being prepared' }) : {};
  } });
  await env.finish(env.actions.doShip());
  assert.equal(writes(env, '/rebase').length, 1);
  assert.equal(writes(env, '/package.json').length, 1);
  assert.equal(writes(env, '/merge').length, 3);
  writes(env, '/merge').forEach(function(req) {
    assert.deepEqual(req.body, { merge_when_pipeline_succeeds: true, squash: true, should_remove_source_branch: false });
  });
});

[
  { status: 401, message: 'Unauthorized' },
  { status: 403, message: 'Forbidden' },
  { status: 404, message: 'Merge request not found' },
  { status: 400, message: 'has_conflicts' },
  { status: 409, message: 'Merge conflict' }
].forEach(function(error) {
  test('auto-merge does not retry a permanent error: ' + error.status + ' ' + error.message, async function() {
    var env = flow({ merge: function() { return harness.response(error.status, { message: error.message }); } });
    await assert.rejects(env.finish(env.actions.doAutoMergeWithRetry(3, 100)), new RegExp(error.message));
    assert.equal(writes(env, '/merge').length, 1);
  });
});

test('auto-merge stops exactly at its retry limit for temporary server errors', async function() {
  var env = flow({ merge: function() { return harness.response(503, { message: 'Try again later' }); } });
  await assert.rejects(env.finish(env.actions.doAutoMergeWithRetry(3, 100)), /Try again later/);
  assert.equal(writes(env, '/merge').length, 3);
});

test('failure to read merge options makes no merge request', async function() {
  var env = harness.content({ gitlab: function() { return harness.response(404, { message: 'MR removed' }); } });
  await assert.rejects(env.finish(env.actions.doAutoMergeWithRetry(3, 100)), /MR removed/);
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].method, 'GET');
});

[
  { status: 405, body: { message: '405 Method Not Allowed' } },
  { status: 405, body: { error: '405 Method Not Allowed' } },
  { status: 406, body: { message: 'Branch cannot be merged' } },
  { status: 422, body: { message: 'Branch cannot be merged' } }
].forEach(function(example) {
  test('GitLab merge readiness response is retried within the limit: ' + JSON.stringify(example), async function() {
    var env = flow({ merge: function(state) {
      return state.mergeAttempts === 1 ? harness.response(example.status, example.body) : {};
    } });
    await env.finish(env.actions.doAutoMergeWithRetry(3, 100));
    assert.equal(writes(env, '/merge').length, 2);
  });
});

test('a persistent 405 merge response still stops at the retry limit', async function() {
  var env = flow({ merge: function() { return harness.response(405, { message: '405 Method Not Allowed' }); } });
  await assert.rejects(env.finish(env.actions.doAutoMergeWithRetry(3, 100)), /405/);
  assert.equal(writes(env, '/merge').length, 3);
});

test('Ship still works without diff_head_sha, detailed_merge_status or an embedded pipeline', async function() {
  var env = flow({ mr: function() {
    return { head_pipeline: undefined, merge_status: 'can_be_merged' };
  } });
  await env.finish(env.actions.doShip());
  assert.equal(env.state.pipelineReads, 1);
  assert.equal(writes(env, '/package.json').length, 1);
  assert.deepEqual(writes(env, '/merge')[0].body, { merge_when_pipeline_succeeds: true, squash: true, should_remove_source_branch: false });
});

test('newer MR response fields do not alter the merge request options', async function() {
  var env = flow({ mr: function(state) {
    return { diff_head_sha: state.bumped ? 'new-head' : 'old-head', detailed_merge_status: 'ci_still_running', auto_merge_enabled: false };
  } });
  await env.finish(env.actions.doShip());
  assert.equal(env.state.pipelineReads, 0);
  assert.deepEqual(writes(env, '/merge')[0].body, { merge_when_pipeline_succeeds: true, squash: true, should_remove_source_branch: false });
});

[
  { status: 403, body: { message: '403 Forbidden' } },
  { status: 405, body: { error: '405 Method Not Allowed' } }
].forEach(function(example) {
  test('rebase retains its existing handling of a GitLab response: ' + JSON.stringify(example), async function() {
    var env = harness.content({ gitlab: function(req) {
      if (req.path.endsWith('/rebase')) return harness.response(example.status, example.body);
      return { sha: 'same-head', rebase_in_progress: false };
    } });
    var result = await env.finish(env.actions.doRebase(false));
    assert.equal(result.sha, 'same-head');
    assert.deepEqual(env.requests.map(function(req) { return req.method; }), ['PUT', 'GET']);
    assert.deepEqual(env.requests[0].body, {});
  });
});

test('a real rebase conflict still stops without any follow-up mutation', async function() {
  var env = harness.content({ gitlab: function() { return harness.response(400, { message: 'Rebase conflict' }); } });
  await assert.rejects(env.finish(env.actions.doRebase(false)), /Rebase conflict/);
  assert.equal(env.requests.length, 1);
});
