'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');

function task() {
  return { gitlabUrl: 'https://gitlab.test', projectId: 37, mrIid: 12, jobs: ['build', 'deploy'], currentIndex: 0, status: 'starting' };
}

test('job lookups stay on the initial pipeline when a new MR pipeline appears', async function() {
  var latest = 100;
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/merge_requests/12/pipelines')) return [{ id: latest }];
    if (req.path === '/projects/37/pipelines/100/jobs?per_page=100') return [{ id: 1000, name: 'build', status: 'running' }];
    if (req.path === '/projects/37/pipelines/101/jobs?per_page=100') return [{ id: 1010, name: 'build', status: 'success' }];
    throw new Error('Unexpected path: ' + req.path);
  } });
  var chain = task();
  assert.equal((await env.finish(env.context.findJobByName(chain, 'build'))).id, 1000);
  latest = 101;
  assert.equal((await env.finish(env.context.findJobByName(chain, 'build'))).id, 1000);
  assert.equal(chain.pipelineId, 100);
  assert.equal(env.requests.filter(function(req) { return req.path.endsWith('/merge_requests/12/pipelines'); }).length, 1);
});

test('complete chain never runs the next job on a newer pipeline', async function() {
  var latest = 100;
  var buildStatus = 'manual';
  var deployStatus = 'manual';
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/merge_requests/12/pipelines')) return [{ id: latest }];
    if (req.path.includes('/pipelines/')) {
      var wrongPipeline = req.path.includes('/101/');
      return [
        { id: wrongPipeline ? 1010 : 1000, name: 'build', status: wrongPipeline ? 'success' : buildStatus },
        { id: wrongPipeline ? 1011 : 1001, name: 'deploy', status: deployStatus }
      ];
    }
    if (req.path === '/projects/37/jobs/1000/play') { buildStatus = 'success'; latest = 101; return { id: 1000 }; }
    if (req.path === '/projects/37/jobs/1001/play') { deployStatus = 'success'; return { id: 1001 }; }
    throw new Error('Wrong pipeline/job: ' + req.path);
  } });
  var started = await env.dispatch(Object.assign({ type: 'start-job-chain' }, task()));
  for (var i = 0; i < 10; i++) {
    await harness.flush();
    var state = await env.dispatch({ type: 'get-task-status', taskId: started.taskId });
    if (state.status === 'done' || state.status === 'error') break;
    await env.clock.next();
  }
  assert.equal(state.status, 'done', state.error);
  assert.deepEqual(env.requests.filter(function(req) { return req.method === 'POST'; }).map(function(req) { return req.path; }), ['/projects/37/jobs/1000/play', '/projects/37/jobs/1001/play']);
  assert.equal(env.notifications.length, 1);
});

test('retries select the newest job ID within the pinned pipeline', async function() {
  var env = harness.background({ gitlab: function(req) {
    assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
    return [{ id: 8, name: 'build', status: 'failed' }, { id: 10, name: 'other', status: 'running' }, { id: 9, name: 'build', status: 'success' }];
  } });
  var chain = Object.assign(task(), { pipelineId: 100 });
  var result = await env.finish(env.context.startJobByName(chain, 'build'));
  assert.equal(result.id, 9);
  assert.equal(result.skipped, true);
});

['manual', 'failed', 'canceled', 'running', 'pending', 'created', 'success'].forEach(function(status) {
  test('job chain preserves handling of ' + status + ' jobs', async function() {
    var env = harness.background({ gitlab: function(req) {
      if (req.method === 'GET') {
        assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
        return [{ id: 8, name: 'build', status: status }];
      }
      assert.equal(req.path, '/projects/37/jobs/8/' + (status === 'manual' ? 'play' : 'retry'));
      return { id: 9 };
    } });
    var chain = Object.assign(task(), { pipelineId: 100 });
    var result = await env.finish(env.context.startJobByName(chain, 'build'));
    var mutates = ['manual', 'failed', 'canceled'].includes(status);
    assert.equal(result.id, mutates ? 9 : 8);
    assert.equal(env.requests.filter(function(req) { return req.method === 'POST'; }).length, mutates ? 1 : 0);
  });
});

test('missing or deleted pinned pipeline stops instead of switching pipelines', async function() {
  var env = harness.background({ gitlab: function(req) {
    assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
    return { _error: '404 Pipeline not found' };
  } });
  await assert.rejects(env.finish(env.context.findJobByName(Object.assign(task(), { pipelineId: 100 }), 'build')), /404/);
  assert.equal(env.requests.length, 1);
});

test('empty MR pipelines fail without playing jobs', async function() {
  var env = harness.background({ gitlab: function() { return []; } });
  await assert.rejects(env.finish(env.context.startJobByName(task(), 'build')), /not found/);
  assert.equal(env.requests.length, 1);
});

['failed', 'canceled'].forEach(function(status) {
  test('waiting for a ' + status + ' job reports failure', async function() {
    var env = harness.background({ gitlab: function(req) {
      assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
      return [{ id: 8, name: 'build', status: status }];
    } });
    await assert.rejects(env.finish(env.context.waitForJobComplete(Object.assign(task(), { pipelineId: 100 }), 'build', 2)), new RegExp(status));
  });
});

test('waiting times out on the original pipeline', async function() {
  var env = harness.background({ gitlab: function(req) {
    assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
    return [{ id: 8, name: 'build', status: 'running' }];
  } });
  await assert.rejects(env.finish(env.context.waitForJobComplete(Object.assign(task(), { pipelineId: 100 }), 'build', 2)), /Timeout/);
  assert.equal(env.requests.length, 2);
});

test('a cancelled chain starts no further jobs', function() {
  var env = harness.background();
  env.context.tasks.cancelled = Object.assign(task(), { _cancelled: true });
  env.context.runJobChain('cancelled');
  assert.equal(env.requests.length, 0);
});

[false, true].forEach(function(alreadyRetried) {
  test('403 on retry stays in the original pipeline; new retry exists: ' + alreadyRetried, async function() {
    var latest = 100;
    var attempted = false;
    var env = harness.background({ gitlab: function(req) {
      if (req.path.endsWith('/merge_requests/12/pipelines')) return [{ id: latest }];
      if (req.path === '/projects/37/pipelines/100/jobs?per_page=100') {
        return [{ id: attempted && alreadyRetried ? 9 : 8, name: 'build', status: attempted && alreadyRetried ? 'running' : 'failed' }];
      }
      if (req.path === '/projects/37/jobs/8/retry') {
        attempted = true;
        latest = 101;
        return { _error: '403 Already retried' };
      }
      throw new Error('Wrong pipeline/job: ' + req.path);
    } });
    var result = env.finish(env.context.startJobByName(task(), 'build'));
    if (alreadyRetried) assert.equal((await result).id, 9);
    else await assert.rejects(result, /403/);
    assert.equal(env.requests.filter(function(req) { return req.method === 'POST'; }).length, 1);
    assert.equal(env.requests.filter(function(req) { return req.path.endsWith('/merge_requests/12/pipelines'); }).length, 1);
  });
});

test('polling follows a retried job inside the original pipeline', async function() {
  var reads = 0;
  var env = harness.background({ gitlab: function(req) {
    assert.equal(req.path, '/projects/37/pipelines/100/jobs?per_page=100');
    reads++;
    return [{ id: reads === 1 ? 8 : 9, name: 'build', status: reads === 1 ? 'running' : 'success' }];
  } });
  var result = await env.finish(env.context.waitForJobComplete(Object.assign(task(), { pipelineId: 100 }), 'build', 3));
  assert.equal(result.id, 9);
  assert.equal(reads, 2);
});

test('each chain resolves its own pipeline independently', async function() {
  var latest = 100;
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/merge_requests/12/pipelines')) return [{ id: latest }];
    return [{ id: req.path.includes('/100/') ? 1000 : 1010, name: 'build', status: 'running' }];
  } });
  var first = task();
  var second = task();
  await env.finish(env.context.findJobByName(first, 'build'));
  latest = 101;
  await env.finish(env.context.findJobByName(second, 'build'));
  assert.equal(first.pipelineId, 100);
  assert.equal(second.pipelineId, 101);
  assert.equal((await env.finish(env.context.findJobByName(first, 'build'))).id, 1000);
});

test('a failed first job stops the chain before deploy', async function() {
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/merge_requests/12/pipelines')) return [{ id: 100 }];
    if (req.method === 'GET') return [{ id: 8, name: 'build', status: 'running' }];
    throw new Error('Unexpected mutation: ' + req.path);
  } });
  // Simulate a pipeline disappearing while waiting for its first job.
  var started = await env.dispatch(Object.assign({ type: 'start-job-chain' }, task()));
  await harness.flush();
  env.chrome.tabs.sendMessage = function(tabId, message) {
    return Promise.resolve(message.type === 'api-proxy' ? { _error: '404 Pipeline removed' } : undefined);
  };
  await env.clock.next();
  var state = await env.dispatch({ type: 'get-task-status', taskId: started.taskId });
  assert.equal(state.status, 'error');
  assert.match(state.error, /404 Pipeline removed/);
  assert.equal(env.context.tasks[started.taskId].currentIndex, 0);
  assert.equal(env.notifications.length, 1);
});
