'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');
var jiraUrl = 'https://jira.test';

[401, 403].forEach(function(status) {
  test('Jira ' + status + ' stops remaining ticket requests', async function() {
    var env = harness.background({ jira: function() { return harness.response(status, {}); } });
    var result = await env.finish(env.dispatch({ type: 'fetch-jira-statuses', jiraUrl: jiraUrl, tickets: ['PROJ-1', 'PROJ-2'], showDetails: true }));
    assert.equal(result.statuses._authError, status);
    assert.equal(env.requests.length, 1);
  });
});

test('Jira statuses map details and tolerate a missing individual ticket', async function() {
  var env = harness.background({ jira: function(req) {
    if (req.url.includes('PROJ-1')) return harness.response(404, {});
    return { fields: { status: { name: 'In progress', statusCategory: { key: 'indeterminate' } }, priority: { name: 'High', iconUrl: 'priority' }, issuetype: { name: 'Bug', iconUrl: 'bug' } } };
  } });
  var result = await env.finish(env.dispatch({ type: 'fetch-jira-statuses', jiraUrl: jiraUrl, tickets: ['PROJ-1', 'PROJ-2'], showDetails: true }));
  assert.deepEqual(harness.plain(result.statuses), { 'PROJ-2': { name: 'In progress', categoryKey: 'indeterminate', priority: 'High', priorityIcon: 'priority', type: 'Bug', typeIcon: 'bug' } });
});

[
  { type: 'do-jira-transition', fields: { transitionId: '31' }, method: 'POST', suffix: '/transitions', body: { transition: { id: '31' } } },
  { type: 'set-jira-assignee', fields: { username: 'alice' }, method: 'PUT', suffix: '', body: { fields: { assignee: { name: 'alice' } } } },
  { type: 'set-jira-assignee', fields: { username: '' }, method: 'PUT', suffix: '', body: { fields: { assignee: null } } },
  { type: 'set-jira-fix-versions', fields: { versions: ['1.2', '1.3'] }, method: 'PUT', suffix: '', body: { fields: { fixVersions: [{ name: '1.2' }, { name: '1.3' }] } } },
  { type: 'delete-jira-comment', fields: { commentId: '42' }, method: 'DELETE', suffix: '/comment/42' }
].forEach(function(example) {
  test(example.type + ' preserves the Jira API request contract ' + JSON.stringify(example.fields), async function() {
    var env = harness.background({ jira: function(req) {
      assert.equal(req.url, jiraUrl + '/rest/api/2/issue/PROJ-1' + example.suffix);
      assert.equal(req.method, example.method);
      assert.deepEqual(req.body, example.body);
      return harness.response(204, '');
    } });
    var result = await env.finish(env.dispatch(Object.assign({ type: example.type, jiraUrl: jiraUrl, ticket: 'PROJ-1' }, example.fields)));
    assert.deepEqual(harness.plain(result), { success: true });
    assert.equal(env.requests.length, 1);
  });
});

test('posting a Jira comment returns author identity and preserves Unicode', async function() {
  var env = harness.background({ jira: function(req) {
    assert.deepEqual(req.body, { body: 'Исправлено ✅' });
    return { id: '42', body: req.body.body, author: { name: 'alice', displayName: 'Alice' }, created: '2026-10-03' };
  } });
  var result = await env.finish(env.dispatch({ type: 'post-jira-comment', jiraUrl: jiraUrl, ticket: 'PROJ-1', text: 'Исправлено ✅' }));
  assert.equal(result.comment.body, 'Исправлено ✅');
  assert.equal(result.comment.authorId, 'alice');
});

test('Jira mutation errors return to the UI without automatic retries', async function() {
  var env = harness.background({ jira: function() { return harness.response(403, { errorMessages: ['Permission denied'] }); } });
  var result = await env.finish(env.dispatch({ type: 'do-jira-transition', jiraUrl: jiraUrl, ticket: 'PROJ-1', transitionId: '31' }));
  assert.match(result._error, /403/);
  assert.equal(env.requests.length, 1);
});
