'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');
var task = { gitlabUrl: 'https://gitlab.test', _tabId: 2 };

test('API proxy prefers the initiating GitLab tab', async function() {
  var env = harness.background({ tabs: [{ id: 1 }, { id: 2 }], gitlab: function(req) { return { fromTab: req.tabId }; } });
  assert.equal((await env.finish(env.context.api(task, 'GET', '/user'))).fromTab, 2);
  assert.equal(env.requests.length, 1);
});

test('GET moves to another tab when the initiating tab is frozen', async function() {
  var env = harness.background({ tabs: [{ id: 1 }, { id: 2 }], sendMessage: function(tabId) {
    return tabId === 2 ? new Promise(function() {}) : Promise.resolve({ id: 42 });
  } });
  assert.equal((await env.finish(env.context.api(task, 'GET', '/user'))).id, 42);
  assert.deepEqual(env.messages.map(function(message) { return message.tabId; }), [2, 1]);
});

['POST', 'PUT', 'DELETE'].forEach(function(method) {
  test(method + ' is never repeated on another tab after an ambiguous timeout', async function() {
    var env = harness.background({ tabs: [{ id: 1 }, { id: 2 }], sendMessage: function() { return new Promise(function() {}); } });
    await assert.rejects(env.finish(env.context.api(task, method, '/jobs/42/play', {})), /timeout/);
    assert.equal(env.messages.length, 1);
  });
});

test('undelivered mutations can use another tab', async function() {
  var env = harness.background({ tabs: [{ id: 1 }, { id: 2 }], sendMessage: function(tabId) {
    return tabId === 2 ? Promise.reject(new Error('Could not establish connection')) : Promise.resolve({ id: 42 });
  } });
  assert.equal((await env.finish(env.context.api(task, 'POST', '/jobs/42/play', {}))).id, 42);
  assert.deepEqual(env.messages.map(function(message) { return message.tabId; }), [2, 1]);
});

test('an API error is reported without replaying the operation', async function() {
  var env = harness.background({ tabs: [{ id: 1 }, { id: 2 }], sendMessage: function() { return Promise.resolve({ _error: '403 Forbidden' }); } });
  await assert.rejects(env.finish(env.context.api(task, 'POST', '/jobs/42/play')), /403/);
  assert.equal(env.messages.length, 1);
});

test('no GitLab tabs fails clearly', async function() {
  var env = harness.background({ tabs: [] });
  await assert.rejects(env.finish(env.context.api(task, 'GET', '/user')), /No GitLab tab open/);
});
