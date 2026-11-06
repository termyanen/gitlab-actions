'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/extension.cjs');
const start = env => env.dispatch({type: 'start-job-chain', gitlabUrl: 'https://gitlab.test', projectId: 37, mrIid: 12, jobs: ['build']});
const key = 'job_chain_state_v1';
function pipeline(req) {if (req.path === '/projects/37/merge_requests/12') return {head_pipeline: {id: 100, project_id: 37}};}

test('a restarted worker resumes a pinned running job without playing or retrying it', async () => {
 const first = harness.background({gitlab: req => pipeline(req) || [{id: 8, name: 'build', status: 'running'}]});
 const {taskId} = await start(first); await harness.flush();
 assert.equal(first.localStorage[key][taskId].phase, 'waiting');
 const next = harness.background({localStorage: harness.plain(first.localStorage), gitlab: req => {
  assert.equal(req.method, 'GET'); assert.match(req.path, /pipelines\/100\/jobs/);
  return [{id: 8, name: 'build', status: 'success'}];
 }});
 assert.equal((await next.dispatch({type: 'get-task-status', taskId})).status, 'running: build');
 await next.clock.next();
 assert.equal((await next.dispatch({type: 'get-task-status', taskId})).status, 'done');
 assert.equal(next.localStorage[key][taskId].currentIndex, 1);
 assert.equal(next.requests.length, 1);
});

for (const status of ['running', 'manual']) test('lost play response is reconciled safely when the observed job is ' + status, async () => {
 const first = harness.background({gitlab: req => {
  if (req.method === 'POST') return new Promise(() => {});
  return pipeline(req) || [{id: 8, name: 'build', status: 'manual'}];
 }});
 const {taskId} = await start(first); await harness.flush();
 assert.equal(first.requests.filter(req => req.method === 'POST').length, 1);
 assert.equal(first.localStorage[key][taskId].phase, 'dispatching');
 const next = harness.background({localStorage: harness.plain(first.localStorage), gitlab: req => {
  assert.equal(req.method, 'GET'); return [{id: 8, name: 'build', status}];
 }});
 await harness.flush();
 const state = await next.dispatch({type: 'get-task-status', taskId});
 assert.equal(state.status, status === 'running' ? 'running: build' : 'error');
 if (status === 'manual') assert.match(state.error, /outcome is unknown/);
 assert.equal(next.requests.filter(req => req.method === 'POST').length, 0);
});

test('persisted cancellation survives restart and prevents any API requests', async () => {
 const first = harness.background({gitlab: req => pipeline(req) || [{id: 8, name: 'build', status: 'running'}]});
 const {taskId} = await start(first); await harness.flush();
 await first.dispatch({type: 'cancel-task', taskId});
 const next = harness.background({localStorage: harness.plain(first.localStorage)});
 assert.equal((await next.dispatch({type: 'get-task-status', taskId})).error, 'Cancelled by user');
 assert.equal((await next.dispatch({type: 'get-active-tasks'})).length, 0);
 assert.equal(next.requests.length, 0);
});

test('failure to save the dispatch checkpoint prevents a mutating request', async () => {
 const env = harness.background({gitlab: req => pipeline(req) || [{id: 8, name: 'build', status: 'manual'}]});
 const set = env.chrome.storage.local.set;
 env.chrome.storage.local.set = (data, callback) => {
  if (Object.values(data[key]).some(task => task.phase === 'dispatching')) {
   env.chrome.runtime.lastError = {message: 'Disk unavailable'};
   callback(); delete env.chrome.runtime.lastError;
  } else set(data, callback);
 };
 const {taskId} = await start(env); await harness.flush();
 assert.equal((await env.dispatch({type: 'get-task-status', taskId})).status, 'error');
 assert.equal(env.requests.some(req => req.method === 'POST'), false);
});

test('repeated wakeup alarms do not duplicate a live runner', async () => {
 const env = harness.background({gitlab: req => pipeline(req) || [{id: 8, name: 'build', status: 'running'}]});
 const {taskId} = await start(env); await harness.flush();
 const before = env.requests.length;
 env.listeners.alarm({name: 'job-chain-wakeup'}); env.listeners.alarm({name: 'job-chain-wakeup'});
 await harness.flush();
 assert.equal(env.requests.length, before);
 await env.clock.next();
 assert.equal(env.requests.length, before + 1);
 await env.dispatch({type: 'cancel-task', taskId});
});
