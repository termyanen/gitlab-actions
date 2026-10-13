'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var vm = require('node:vm');
var harness = require('./helpers/extension.cjs');

function start(env, overrides, tabId) {
  return env.dispatch(Object.assign({ type: 'start-job-chain', gitlabUrl: 'https://gitlab.test', projectId: 37, mrIid: 12, jobs: ['build', 'deploy'] }, overrides), { tab: { id: tabId || 1 } });
}

function deferred() {
  var resolve, reject;
  var promise = new Promise(function(res, rej) { resolve = res; reject = rej; });
  return { promise: promise, resolve: resolve, reject: reject };
}

async function cancel(env, id) {
  await env.dispatch({ type: 'cancel-task', taskId: id });
}

async function assertCancelled(env, id) {
  var state = await env.dispatch({ type: 'get-task-status', taskId: id });
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'Cancelled by user');
  assert.equal(env.notifications.length, 0, 'Cancellation must not announce completion or an unrelated failure');
  assert.equal((await env.dispatch({ type: 'get-active-tasks' })).length, 0);
}

['pipeline lookup', 'job lookup', 'play response', 'poll response', 'poll delay'].forEach(function(stage) {
  test('cancel during ' + stage + ' prevents further requests and completion', async function() {
    var held = deferred();
    var jobReads = 0;
    var env = harness.background({ gitlab: function(req) {
      if (req.path.endsWith('/merge_requests/12/pipelines')) return stage === 'pipeline lookup' ? held.promise : [{ id: 100 }];
      if (req.path.includes('/pipelines/100/jobs')) {
        jobReads++;
        if ((stage === 'job lookup' && jobReads === 1) || (stage === 'poll response' && jobReads === 2)) return held.promise;
        return [{ id: 8, name: 'build', status: stage === 'poll delay' || stage === 'poll response' ? 'running' : 'manual' }];
      }
      if (req.path.endsWith('/jobs/8/play')) return stage === 'play response' ? held.promise : { id: 8 };
      throw new Error('Unexpected request: ' + req.path);
    } });
    // One job catches the race where a final successful response overwrites cancellation.
    var started = await start(env, { jobs: ['build'] });
    await harness.flush();
    if (stage === 'poll response') await env.clock.next();
    var before = env.requests.length;
    await cancel(env, started.taskId);
    if (stage === 'pipeline lookup') held.resolve([{ id: 100 }]);
    if (stage === 'job lookup') held.resolve([{ id: 8, name: 'build', status: 'manual' }]);
    if (stage === 'play response') held.resolve({ id: 8 });
    if (stage === 'poll response') held.resolve([{ id: 8, name: 'build', status: 'success' }]);
    await harness.flush();
    await env.clock.next();
    assert.equal(env.requests.length, before, 'No API request may start after cancellation');
    await assertCancelled(env, started.taskId);
  });
});

test('a late failed request cannot replace the cancellation reason', async function() {
  var held = deferred();
  var env = harness.background({ gitlab: function() { return held.promise; } });
  var started = await start(env);
  await harness.flush();
  await cancel(env, started.taskId);
  held.reject(new Error('Network offline'));
  await harness.flush();
  await assertCancelled(env, started.taskId);
});

test('cancellation after retry rejection prevents the 403 refetch and retry', async function() {
  var held = deferred();
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/pipelines')) return [{ id: 100 }];
    if (req.method === 'GET') return [{ id: 8, name: 'build', status: 'failed' }];
    return held.promise;
  } });
  var started = await start(env);
  await harness.flush();
  var before = env.requests.length;
  await cancel(env, started.taskId);
  held.resolve({ _error: '403 Already retried' });
  await harness.flush();
  assert.equal(env.requests.length, before);
  await assertCancelled(env, started.taskId);
});

test('explicit chain starts from two tabs retain independent trackers', async function() {
  var played = false;
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/pipelines')) return [{ id: 100 }];
    if (req.method === 'GET') return [{ id: 8, name: 'build', status: played ? 'running' : 'manual' }];
    played = true;
    return { id: 8 };
  } });
  var first = await start(env, null, 1);
  await harness.flush();
  var second = await start(env, null, 2);
  await harness.flush();
  assert.notEqual(second.taskId, first.taskId);
  assert.equal(env.requests.filter(function(req) { return req.method === 'POST'; }).length, 1);
  await cancel(env, first.taskId);
  assert.equal((await env.dispatch({ type: 'get-task-status', taskId: second.taskId })).status, 'running: build');
});

test('different chains started in the same millisecond have independent task IDs', async function() {
  var env = harness.background({ gitlab: function() { return new Promise(function() {}); } });
  vm.runInContext('Date.now = function() { return 1700000000000; };', env.context);
  var first = await start(env);
  var second = await start(env, { mrIid: 13 });
  assert.notEqual(first.taskId, second.taskId);
  assert.equal((await env.dispatch({ type: 'get-active-tasks' })).length, 2);
  await cancel(env, first.taskId);
  assert.equal((await env.dispatch({ type: 'get-task-status', taskId: second.taskId })).status, 'running: build');
});

test('closing the initiating tab lets a chain use another GitLab tab', async function() {
  var tabs = [{ id: 1 }, { id: 2 }];
  var reads = 0;
  var env = harness.background({ tabs: tabs, gitlab: function(req) {
    if (req.path.endsWith('/pipelines')) return [{ id: 100 }];
    reads++;
    return [{ id: 8, name: 'build', status: reads === 1 ? 'running' : 'success' }];
  } });
  var started = await start(env, { jobs: ['build'] });
  await harness.flush();
  tabs.splice(0, 1);
  await env.clock.next();
  assert.equal((await env.dispatch({ type: 'get-task-status', taskId: started.taskId })).status, 'done');
  assert.equal(env.requests[env.requests.length - 1].tabId, 2);
});

test('closing all GitLab tabs ends the chain without starting its next job', async function() {
  var tabs = [{ id: 1 }];
  var env = harness.background({ tabs: tabs, gitlab: function(req) {
    if (req.path.endsWith('/pipelines')) return [{ id: 100 }];
    return [{ id: 8, name: 'build', status: 'running' }];
  } });
  var started = await start(env);
  await harness.flush();
  tabs.length = 0;
  await env.clock.next();
  var state = await env.dispatch({ type: 'get-task-status', taskId: started.taskId });
  assert.equal(state.status, 'error');
  assert.match(state.error, /No GitLab tab open/);
  assert.equal(env.requests.some(function(req) { return req.method === 'POST'; }), false);
});

test('a fresh worker reports lost in-memory tasks and never replays mutations automatically', async function() {
  var oldWorker = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/pipelines')) return [{ id: 100 }];
    return [{ id: 8, name: 'build', status: 'running' }];
  } });
  var started = await start(oldWorker);
  await harness.flush();
  // Do not advance the old VM: a terminated worker cannot run its old timers.
  var restarted = harness.background();
  assert.equal((await restarted.dispatch({ type: 'get-task-status', taskId: started.taskId })).status, 'not_found');
  assert.equal((await restarted.dispatch({ type: 'get-active-tasks' })).length, 0);
  assert.equal(restarted.requests.length, 0);
});

test('cancelling while Chrome finds tabs prevents delivery of the API request', async function() {
  var held = deferred();
  var env = harness.background();
  env.chrome.tabs.query = function() { return held.promise; };
  var started = await start(env);
  await cancel(env, started.taskId);
  held.resolve([{ id: 1 }]);
  await harness.flush();
  assert.equal(env.requests.length, 0);
  await assertCancelled(env, started.taskId);
});

[
  { gitlabUrl: 'https://other-gitlab.test' },
  { projectId: 38 },
  { jobs: ['build', 'review'] }
].forEach(function(difference) {
  test('explicit starts keep different chain scopes independent: ' + JSON.stringify(difference), async function() {
    var env = harness.background({ gitlab: function() { return new Promise(function() {}); } });
    var first = await start(env);
    var second = await start(env, difference);
    assert.notEqual(first.taskId, second.taskId);
    assert.equal((await env.dispatch({ type: 'get-active-tasks' })).length, 2);
  });
});

test('a completed chain can be started again as a new task', async function() {
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/pipelines')) return [{ id: 100 }];
    return [{ id: 8, name: 'build', status: 'success' }];
  } });
  var first = await start(env, { jobs: ['build'] });
  await harness.flush();
  assert.equal((await env.dispatch({ type: 'get-task-status', taskId: first.taskId })).status, 'done');
  var second = await start(env, { jobs: ['build'] });
  await harness.flush();
  assert.notEqual(first.taskId, second.taskId);
  assert.equal((await env.dispatch({ type: 'get-task-status', taskId: second.taskId })).status, 'done');
});

test('an explicit chain on a newer pipeline is independent of an older active chain', async function() {
  var latest = 100;
  var env = harness.background({ gitlab: function(req) {
    if (req.path.endsWith('/pipelines')) return [{ id: latest }];
    if (req.method === 'GET') return [{ id: req.path.includes('/100/') ? 1000 : 1010, name: 'build', status: 'manual' }];
    return { id: Number(req.path.split('/').slice(-2)[0]) };
  } });
  // Different timestamps also make this scenario meaningful against the old code.
  vm.runInContext('var tick = 1700000000000; Date.now = function() { return tick++; };', env.context);
  var first = await start(env, { jobs: ['build'] });
  await harness.flush();
  latest = 101;
  var second = await start(env, { jobs: ['build'] }, 2);
  await harness.flush();
  assert.notEqual(first.taskId, second.taskId);
  assert.deepEqual(env.requests.filter(function(req) { return req.method === 'POST'; }).map(function(req) { return req.path; }), ['/projects/37/jobs/1000/play', '/projects/37/jobs/1010/play']);
  await cancel(env, first.taskId);
  assert.equal((await env.dispatch({ type: 'get-task-status', taskId: second.taskId })).status, 'running: build');
});
