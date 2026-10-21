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

async function quickAction(action, options) {
  options = options || {};
  var env = harness.background({ jira: options.jira || function() { return harness.response(204, ''); } });
  var result = await env.finish(env.dispatch({ type: 'execute-jira-quick-action', jiraUrl: jiraUrl, ticket: 'PROJ-1', transitionId: options.transitionId, action: action }));
  return { result: harness.plain(result), requests: env.requests };
}

test('Fix Version-only action sends one edit without transitioning or changing assignee', async function() {
  var env = await quickAction({ updates: [{ field: 'fixVersions', operation: 'set', value: ['1.2', '1.3'] }] });
  assert.deepEqual(env.result, { success: true, completed: { transition: false, fields: true } });
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].method, 'PUT');
  assert.deepEqual(env.requests[0].body, { fields: { fixVersions: [{ name: '1.2' }, { name: '1.3' }] } });
});

test('assignee-only quick action preserves the existing saved action contract', async function() {
  var env = await quickAction({ label: 'Assign Alice', status: '', assignee: 'alice' });
  assert.equal(env.result.success, true);
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.requests[0].body, { fields: { assignee: { name: 'alice' } } });
});

test('quick action combines label/version/component operations and scalar/custom fields in one edit', async function() {
  var env = await quickAction({ assignee: 'alice', updates: [
    { field: 'labels', operation: 'add', value: ['reviewed', 'reviewed', 'готово'] },
    { field: 'fixVersions', operation: 'remove', value: ['1.1'] },
    { field: 'versions', operation: 'set', value: ['1.0'] },
    { field: 'components', operation: 'add', value: ['Backend'] },
    { field: 'priority', value: 'High' },
    { field: 'duedate', value: '2026-10-21' },
    { field: 'customfield_12345', value: { value: 'Option' } },
    { field: 'customfield_12346', value: null }
  ] });
  assert.equal(env.result.success, true);
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.requests[0].body, {
    fields: { assignee: { name: 'alice' }, versions: [{ name: '1.0' }], priority: { name: 'High' }, duedate: '2026-10-21', customfield_12345: { value: 'Option' }, customfield_12346: null },
    update: { labels: [{ add: 'reviewed' }, { add: 'готово' }], fixVersions: [{ remove: { name: '1.1' } }], components: [{ add: { name: 'Backend' } }] }
  });
});

test('status+fields quick action runs transition then edit and reports both completed steps', async function() {
  var env = await quickAction({ status: 'Review', assignee: 'alice' }, { transitionId: '31' });
  assert.deepEqual(env.requests.map(function(r) { return [r.method, r.body]; }), [
    ['POST', { transition: { id: '31' } }], ['PUT', { fields: { assignee: { name: 'alice' } } }]
  ]);
  assert.deepEqual(env.result, { success: true, completed: { transition: true, fields: true } });
});

test('failed field edit reports a completed transition without retrying either mutation', async function() {
  var env = await quickAction({ status: 'Review', assignee: 'alice' }, { transitionId: '31', jira: function(req) {
    return req.method === 'POST' ? harness.response(204, '') : harness.response(400, { errors: { assignee: 'Cannot assign' } });
  } });
  assert.deepEqual(env.result.completed, { transition: true, fields: false });
  assert.match(env.result._error, /400.*Cannot assign/);
  assert.equal(env.requests.length, 2);
});

test('failed transition prevents all field edits', async function() {
  var env = await quickAction({ status: 'Review', assignee: 'alice' }, { transitionId: '31', jira: function() { return harness.response(403, 'Denied'); } });
  assert.deepEqual(env.result.completed, { transition: false, fields: false });
  assert.match(env.result._error, /403/);
  assert.equal(env.requests.length, 1);
});

[
  [{ field: 'status', value: 'Done' }],
  [{ field: '__proto__', value: 'invalid' }],
  [{ field: 'labels', operation: 'unknown', value: ['a'] }],
  [{ field: 'labels', value: 'a' }],
  [{ field: 'labels', value: [] }],
  [{ field: 'labels', value: [' '] }],
  [{ field: 'labels', value: ['a'] }, { field: 'labels', value: ['b'] }],
  [{ field: 'duedate', value: '2026-02-30' }],
  [{ field: 'duedate', value: 'not a date' }],
  [{ field: 'customfield_invalid', value: 1 }]
].forEach(function(updates, index) {
  test('invalid quick action ' + index + ' fails before a transition or field write', async function() {
    var env = await quickAction({ status: 'Review', updates: updates }, { transitionId: '31' });
    assert.ok(env.result._error);
    assert.equal(env.requests.length, 0);
    assert.deepEqual(env.result.completed, { transition: false, fields: false });
  });
});

test('empty actions and unavailable requested transitions cannot edit fields', async function() {
  for (var action of [{}, { status: 'Review', assignee: 'alice' }]) {
    var env = await quickAction(action);
    assert.ok(env.result._error);
    assert.equal(env.requests.length, 0);
  }
});
