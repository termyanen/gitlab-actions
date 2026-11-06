'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');

function fillers() {
  return Array.from({ length: 100 }, function(_, i) { return { id: 200 - i, name: 'other-' + i, status: 'success' }; });
}

function writes(env) {
  return env.requests.filter(function(req) { return req.method !== 'GET'; });
}

['content', 'background'].forEach(function(runtime) {
  function run(env) {
    return runtime === 'content' ? env.actions.doTriggerJob('build') : env.context.startJobByName({ projectId: 37, mrIid: 12, gitlabUrl: 'https://gitlab.test' }, 'build');
  }

  test(runtime + ': custom jobs use the head pipeline, its project, and later job pages', async function() {
    var env = harness[runtime]({ gitlab: function(req) {
      if (req.path === '/projects/37/merge_requests/12') return { head_pipeline: { id: 100, project_id: 51 } };
      if (req.path === '/projects/51/pipelines/100/jobs?per_page=100') return fillers();
      if (req.path === '/projects/51/pipelines/100/jobs?per_page=100&page=2') return [{ id: 8, name: 'build', status: 'manual' }];
      assert.equal(req.path, '/projects/51/jobs/8/play');
      return { id: 8 };
    } });
    await env.finish(run(env));
    assert.deepEqual(writes(env).map(function(req) { return req.path; }), ['/projects/51/jobs/8/play']);
  });

  test(runtime + ': retry rejection never switches to a new MR pipeline', async function() {
    var retried = false;
    var env = harness[runtime]({ gitlab: function(req) {
      if (req.path === '/projects/37/merge_requests/12') return { head_pipeline: { id: retried ? 101 : 100, project_id: 37 } };
      if (req.path === '/projects/37/pipelines/100/jobs?per_page=100') return [{ id: retried ? 9 : 8, name: 'build', status: retried ? 'running' : 'failed' }];
      assert.equal(req.path, '/projects/37/jobs/8/retry');
      retried = true;
      return runtime === 'content' ? harness.response(403, { message: '403 Already retried' }) : { _error: '403 Already retried' };
    } });
    await env.finish(run(env));
    assert.equal(writes(env).length, 1);
    assert.equal(env.requests.filter(function(req) { return req.path === '/projects/37/merge_requests/12'; }).length, 1);
  });

  ['preparing', 'waiting_for_resource', 'scheduled'].forEach(function(status) {
    test(runtime + ': a ' + status + ' job is already queued and needs no play/retry', async function() {
      var env = harness[runtime]({ gitlab: function(req) {
        if (req.path === '/projects/37/merge_requests/12') return { head_pipeline: { id: 100 } };
        assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
        return [{ id: 8, name: 'build', status: status }];
      } });
      await env.finish(run(env));
      assert.equal(writes(env).length, 0);
    });
  });
});

test('bulk failed-job retry checks every page of the head pipeline', async function() {
  var env = harness.content({ gitlab: function(req) {
    if (req.path === '/projects/37/merge_requests/12') return { head_pipeline: { id: 100, project_id: 51 } };
    if (req.path === '/projects/51/pipelines/100/jobs?per_page=100') return fillers();
    if (req.path === '/projects/51/pipelines/100/jobs?per_page=100&page=2') return [{ id: 8, name: 'build', status: 'failed' }, { id: 7, name: 'deploy', status: 'manual' }];
    assert.equal(req.path, '/projects/51/jobs/8/retry');
    return { id: 9 };
  } });
  await env.finish(env.actions.doRetryFailed());
  assert.deepEqual(writes(env).map(function(req) { return req.path; }), ['/projects/51/jobs/8/retry']);
});

test('bulk retry makes no writes if a later jobs page cannot be read', async function() {
  var jobs = fillers(); jobs[0].status = 'failed';
  var env = harness.content({ gitlab: function(req) {
    if (req.path === '/projects/37/merge_requests/12') return { head_pipeline: { id: 100 } };
    if (req.path.endsWith('page=2')) return harness.response(403, { message: 'Forbidden' });
    return jobs;
  } });
  await assert.rejects(env.finish(env.actions.doRetryFailed()), /Forbidden/);
  assert.equal(writes(env).length, 0);
});

test('background fallback ignores older commits and preserves current pipeline preference', async function() {
  var env = harness.background({ gitlab: function(req) {
    if (req.path === '/projects/37/merge_requests/12') return { sha: 'current' };
    if (req.path.endsWith('/pipelines')) return [{ id: 102, sha: 'old' }, { id: 99, sha: 'current' }, { id: 100, sha: 'current' }];
    assert.equal(req.path, '/projects/37/pipelines/99/jobs?per_page=100');
    return [{ id: 8, name: 'build', status: 'success' }];
  } });
  var task = { projectId: 37, mrIid: 12, gitlabUrl: 'https://gitlab.test' };
  await env.finish(env.context.startJobByName(task, 'build'));
  assert.equal(task.pipelineId, 99);
  assert.equal(writes(env).length, 0);
});

test('cancelling a chain during job pagination prevents the next page and all writes', async function() {
  var task = { projectId: 37, mrIid: 12, gitlabUrl: 'https://gitlab.test', pipelineId: 100 };
  var env = harness.background({ gitlab: function() { task._cancelled = true; return fillers(); } });
  await assert.rejects(env.finish(env.context.startJobByName(task, 'build')), /Cancelled/);
  assert.equal(env.requests.length, 1);
  assert.equal(writes(env).length, 0);
});

test('rebase polling explicitly requests the optional status field until it completes', async function() {
  var reads = 0;
  var env = harness.content({ gitlab: function(req) {
    if (req.path.endsWith('/rebase')) return { rebase_in_progress: true };
    assert.equal(req.path, '/projects/37/merge_requests/12?include_rebase_in_progress=true');
    reads++;
    return { rebase_in_progress: reads < 3, merge_error: null };
  } });
  await env.finish(env.actions.doRebase(false));
  assert.equal(reads, 3);
  assert.equal(writes(env).length, 1);
});

test('a missing rebase status cannot be mistaken for successful completion', async function() {
  var env = harness.content({ gitlab: function() { return {}; } });
  await assert.rejects(env.finish(env.actions.doRebase(false)), /errorRebaseStatusMissing/);
  assert.equal(writes(env).length, 1);
});

test('a forbidden rebase stops Ship before version writes and merge', async function() {
  var env = harness.content({ gitlab: function(req) {
    if (req.path === '/projects/37') return { merge_method: 'ff' };
    assert.ok(req.path.endsWith('/rebase'));
    return harness.response(403, { message: 'Cannot push to source branch' });
  } });
  await assert.rejects(env.finish(env.actions.doShip()), /Cannot push/);
  assert.deepEqual(writes(env).map(function(req) { return req.path; }), ['/projects/37/merge_requests/12/rebase']);
});

['success', 'failed', 'canceled'].forEach(function(status) {
  test('pipeline wait accepts a quickly finished ' + status + ' pipeline for the current SHA', async function() {
    var env = harness.content({ gitlab: function(req) {
      assert.equal(req.path, '/projects/37/merge_requests/12');
      return { sha: 'current', head_pipeline: { id: 100, sha: 'current', status: status } };
    } });
    await env.finish(env.actions.waitMRReady(2));
    assert.equal(env.requests.length, 1);
  });
});

test('pipeline wait skips an old running pipeline and finds the current finished one', async function() {
  var env = harness.content({ gitlab: function(req) {
    if (req.path === '/projects/37/merge_requests/12') return { sha: 'current', head_pipeline: { id: 99, sha: 'old', status: 'running' } };
    assert.ok(req.path.endsWith('/pipelines'));
    return [{ id: 99, sha: 'old', status: 'running' }, { id: 100, sha: 'current', status: 'success' }];
  } });
  await env.finish(env.actions.waitMRReady(2));
  assert.equal(env.requests.length, 2);
});

test('pipeline wait times out if only pipelines for an older SHA exist', async function() {
  var env = harness.content({ gitlab: function(req) {
    if (req.path === '/projects/37/merge_requests/12') return { sha: 'current', head_pipeline: { id: 99, sha: 'old', status: 'running' } };
    return [{ id: 99, sha: 'old', status: 'running' }];
  } });
  await assert.rejects(env.finish(env.actions.waitMRReady(2)), /did not create pipeline/);
  assert.equal(writes(env).length, 0);
});

['merge', 'train'].forEach(function(ref) {
  ['running', 'success'].forEach(function(status) {
    test('pipeline wait accepts the MR synthetic ' + ref + ' head with status ' + status, async function() {
      var env = harness.content({ gitlab: function(req) {
        assert.equal(req.path, '/projects/37/merge_requests/12');
        return { sha: 'source', head_pipeline: { id: 100, sha: 'synthetic', ref: 'refs/merge-requests/12/' + ref, status: status } };
      } });
      await env.finish(env.actions.waitMRReady(2));
      assert.equal(env.requests.length, 1);
    });
  });
});
