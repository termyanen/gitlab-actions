'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');

function fixture(options) {
  options = options || {};
  return harness.content({ gitlab: function(req) {
    if (req.path.endsWith('/notes?per_page=100')) return options.notes || [];
    if (req.path === '/projects/37/merge_requests/12') {
      return options.mr || { head_pipeline: { id: 100, project_id: 37 } };
    }
    if (req.path.endsWith('/merge_requests/12/pipelines')) return options.pipelines || [{ id: 99 }];
    if (req.path.includes('/jobs?')) return options.jobs(req);
    if (req.method === 'POST') return {};
    throw new Error('Unexpected request: ' + req.path);
  } });
}

function writes(env) {
  return env.requests.filter(function(req) { return req.method !== 'GET'; });
}

test('reviewers use the MR head pipeline rather than the first pipeline in the list', async function() {
  var env = fixture({ jobs: function(req) {
    assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
    return [{ id: 8, name: 'get-reviewers', status: 'manual' }];
  } });
  var result = await env.finish(env.actions.doReviewers());
  assert.equal(result.action, 'triggered');
  assert.equal(result.jobId, 8);
  assert.deepEqual(writes(env).map(function(req) { return req.path; }), ['/projects/37/jobs/8/play']);
});

test('reviewers find a job after the first 100 jobs in the selected pipeline', async function() {
  var env = fixture({ jobs: function(req) {
    if (req.path === '/projects/37/pipelines/100/jobs?per_page=100') {
      return Array.from({ length: 100 }, function(_, i) { return { id: 200 - i, name: 'build-' + i, status: 'success' }; });
    }
    assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100&page=2');
    return [{ id: 8, name: 'get-reviewers', status: 'manual' }];
  } });
  await env.finish(env.actions.doReviewers());
  assert.equal(writes(env)[0].path, '/projects/37/jobs/8/play');
});

test('reviewers fallback preserves pipeline preference for the current commit', async function() {
  var env = fixture({
    mr: { head_pipeline: null, sha: 'current' },
    pipelines: [{ id: 102, sha: 'old' }, { id: 99, sha: 'current' }, { id: 100, sha: 'current' }],
    jobs: function(req) {
      assert.equal(req.path, '/projects/37/pipelines/99/jobs?per_page=100');
      return [{ id: 8, name: 'get-reviewers', status: 'manual' }];
    }
  });
  await env.finish(env.actions.doReviewers());
  assert.equal(writes(env).length, 1);
});

test('reviewers do not start a job from an old commit when the new pipeline is missing', async function() {
  var env = fixture({ mr: { sha: 'current' }, pipelines: [{ id: 99, sha: 'old' }] });
  await assert.rejects(env.finish(env.actions.doReviewers()), /No pipelines found/);
  assert.equal(writes(env).length, 0);
  assert.equal(env.requests.some(function(req) { return req.path.includes('/jobs'); }), false);
});

test('reviewers keep the pipeline project for fork jobs', async function() {
  var env = fixture({
    mr: { head_pipeline: { id: 100, project_id: 51 }, source_project_id: 51 },
    jobs: function(req) {
      assert.equal(req.path, '/projects/51/pipelines/100/jobs?per_page=100');
      return [{ id: 8, name: 'get-reviewers', status: 'manual' }];
    }
  });
  await env.finish(env.actions.doReviewers());
  assert.equal(writes(env)[0].path, '/projects/51/jobs/8/play');
});

test('missing reviewers job identifies the checked pipeline and never searches old pipelines', async function() {
  var env = fixture({ jobs: function() { return [{ id: 9, name: 'build', status: 'success' }]; } });
  await assert.rejects(env.finish(env.actions.doReviewers()), /Job "get-reviewers" not found in pipeline #100/);
  assert.equal(writes(env).length, 0);
  assert.equal(env.requests.filter(function(req) { return req.path.includes('/jobs?'); }).length, 1);
});

test('reviewers stop on a later jobs-page error without starting any job', async function() {
  var env = fixture({ jobs: function(req) {
    if (req.path.includes('page=2')) return harness.response(403, { message: 'Forbidden' });
    return Array.from({ length: 100 }, function(_, i) { return { id: 200 - i, name: 'build-' + i }; });
  } });
  await assert.rejects(env.finish(env.actions.doReviewers()), /Forbidden/);
  assert.equal(writes(env).length, 0);
});

test('reviewers stop after an empty final page when exactly 100 jobs do not match', async function() {
  var reads = 0;
  var env = fixture({ jobs: function(req) {
    reads++;
    if (req.path.includes('page=2')) return [];
    return Array.from({ length: 100 }, function(_, i) { return { id: 200 - i, name: 'build-' + i }; });
  } });
  await assert.rejects(env.finish(env.actions.doReviewers()), /not found in pipeline #100/);
  assert.equal(reads, 2);
  assert.equal(writes(env).length, 0);
});

test('reviewers abort if the server repeats a full jobs page', async function() {
  var reads = 0;
  var env = fixture({ jobs: function() {
    reads++;
    return Array.from({ length: 100 }, function(_, i) { return { id: 200 - i, name: 'build-' + i }; });
  } });
  await assert.rejects(env.finish(env.actions.doReviewers()), /errorJobsPageRepeated:100/);
  assert.equal(reads, 2);
  assert.equal(writes(env).length, 0);
});

test('reviewers surface an MR read error without falling back to another pipeline', async function() {
  var env = fixture({ mr: harness.response(403, { message: 'Forbidden' }) });
  await assert.rejects(env.finish(env.actions.doReviewers()), /Forbidden/);
  assert.equal(env.requests.length, 2);
  assert.equal(writes(env).length, 0);
});

test('reviewers report an empty pipeline list without starting a job', async function() {
  var env = fixture({ mr: {}, pipelines: [] });
  await assert.rejects(env.finish(env.actions.doReviewers()), /No pipelines found/);
  assert.equal(writes(env).length, 0);
});

test('reviewers still work on legacy MR responses without head_pipeline or sha', async function() {
  var env = fixture({ mr: {}, pipelines: [{ id: 100 }, { id: 99 }], jobs: function(req) {
    assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
    return [{ id: 8, name: 'get-reviewers', status: 'manual' }];
  } });
  await env.finish(env.actions.doReviewers());
  assert.equal(writes(env)[0].path, '/projects/37/jobs/8/play');
});

[
  ['manual', 'triggered', 'play'], ['skipped', 'triggered', 'play'],
  ['failed', 'retried', 'retry'], ['canceled', 'retried', 'retry'],
  ['running', 'already running'], ['success', 'already success']
].forEach(function(example) {
  test('reviewers preserve job handling for ' + example[0], async function() {
    var env = fixture({ jobs: function() {
      return [{ id: 7, name: 'get-reviewers', status: 'failed' }, { id: 8, name: 'get-reviewers', status: example[0] }];
    } });
    var result = await env.finish(env.actions.doReviewers());
    assert.equal(result.action, example[1]);
    assert.equal(result.jobId, 8);
    assert.deepEqual(writes(env).map(function(req) { return req.path; }), example[2] ? ['/projects/37/jobs/8/' + example[2]] : []);
  });
});

test('an existing reviewers comment is reposted without looking for a CI job', async function() {
  var env = fixture({ notes: [{ body: 'Reviewers: @alice @bob' }] });
  await env.finish(env.actions.doReviewers());
  assert.equal(env.requests.length, 2);
  assert.deepEqual(writes(env)[0].body, { body: 'Reviewers: @alice @bob' });
});
