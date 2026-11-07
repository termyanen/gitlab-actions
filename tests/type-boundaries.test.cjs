'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bundleForTest } = require('./helpers/runtime.cjs');
const harness = require('./helpers/extension.cjs');

function moduleFor(entry, globals = {}) {
  const context = vm.createContext(globals);
  vm.runInContext(bundleForTest(entry), context);
  return context.TestModule;
}

test('GitLab response validation preserves legacy partial metadata, nulls and new fields', () => {
  const api = moduleFor('src/entities/merge-request/index.ts');
  const value = { description: null, merge_error: null, head_pipeline: null, extension_field: { future: true } };
  assert.equal(api.readActiveMergeRequest(value), value);
  assert.throws(() => api.readActiveMergeRequest({ source_branch: 17 }), /Invalid/);
  assert.throws(() => api.readActiveMergeRequest({ head_pipeline: { id: '42' } }), /Invalid/);
  assert.throws(() => api.readActiveMergeRequest([]), /Invalid/);
});

test('invalid MR data cannot reach a version-file write', async () => {
  const env = harness.content({ gitlab: () => ({ source_branch: { name: 'feature' }, target_branch: 'main' }) });
  await assert.rejects(env.finish(env.actions.doVersionBump()), /Invalid ActiveMergeRequest/);
  assert.equal(env.requests.filter(request => request.method !== 'GET').length, 0);
});

test('missing source branch stops a version bump before constructing a file request', async () => {
  const env = harness.content({ gitlab: () => ({ target_branch: 'main' }) });
  await assert.rejects(env.finish(env.actions.doVersionBump()), /source branch/);
  assert.equal(env.requests.length, 1);
});

test('an invalid job identity cannot reach a play request', async () => {
  const env = harness.content({ gitlab: request => {
    if (request.path === '/projects/37/merge_requests/12') return { head_pipeline: { id: 100 } };
    return [{ id: 'bad/id', name: 'deploy', status: 'manual' }];
  } });
  await assert.rejects(env.finish(env.actions.doTriggerJob('deploy')), /Invalid Job/);
  assert.equal(env.requests.filter(request => request.method !== 'GET').length, 0);
});

test('a job write acknowledgement can omit metadata without pretending to be a full job', () => {
  const api = moduleFor('src/entities/pipeline/index.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(api.readJobResult({}))), {});
  assert.throws(() => api.readJob({}), /Invalid/);
  assert.throws(() => api.readJobResult({ id: 'bad' }), /Invalid/);
});

test('Jira issue validation accepts unset nullable fields and rejects malformed nested data', () => {
  const api = moduleFor('src/entities/jira-issue/api/validation.ts');
  const value = { fields: { description: null, assignee: null, reporter: null, priority: null, resolution: null, customfield_123: { future: true } } };
  assert.equal(api.readRawJiraIssue(value), value);
  assert.throws(() => api.readRawJiraIssue({ fields: { status: { name: 12 } } }), /Invalid/);
  assert.throws(() => api.readRawJiraIssue({ fields: { labels: ['valid', {}] } }), /Invalid/);
});

test('session API handles empty success responses and validates error metadata', async () => {
  let response = { status: 204, ok: true };
  const api = moduleFor('src/shared/api/gitlab/index.ts', {
    document: { querySelector: () => null },
    fetch: async () => response,
  }).createSessionApi(() => 'https://gitlab.test');
  assert.deepEqual(JSON.parse(JSON.stringify(await api('POST', '/test'))), {});
  response = { status: 400, ok: false, statusText: 'Bad request', text: async () => JSON.stringify({ message: 'Conflict', error_code: { wrong: true } }) };
  await assert.rejects(api('GET', '/test'), error => error.message === 'Conflict' && error.httpStatus === 400 && error.errorCode === undefined);
  response = { status: 200, ok: true, text: async () => '<html>Signed out</html>' };
  await assert.rejects(api('GET', '/test'), /Invalid GitLab JSON/);
});

test('unknown errors retain cancellation and before-send metadata without trusting arbitrary fields', () => {
  const api = moduleFor('src/shared/lib/errors/index.ts');
  const error = api.toError({ name: 'AbortError', message: 'Cancelled', httpStatus: 403, beforeSend: true, errorCode: 'conflict' });
  assert.equal(error.name, 'AbortError');
  assert.equal(error.httpStatus, 403);
  assert.equal(error.beforeSend, true);
  assert.equal(error.errorCode, 'conflict');
  assert.equal(api.toError('network failure').message, 'network failure');
  assert.equal(api.toError({ httpStatus: '403', beforeSend: 'yes' }).beforeSend, undefined);
});

test('Jira messages validate payloads and preserve partial mutation outcomes and auth failures', () => {
  let raw;
  const runtime = { sendMessage(_message, callback) { callback(raw); } };
  const api = moduleFor('src/entities/jira-issue/model/transport.ts', { chrome: { runtime } });
  function send(type) {
    let result;
    api.sendJiraMessage({ type }, value => { result = value; });
    return JSON.parse(JSON.stringify(result));
  }
  raw = { _error: 'Field edit rejected', completed: { transition: true } };
  assert.deepEqual(send('execute-jira-quick-action'), raw);
  raw = { statuses: { 'TEAM-1': { name: 'Open', categoryKey: 'new' }, _authError: 403 } };
  assert.deepEqual(send('fetch-jira-statuses'), { statuses: { 'TEAM-1': { name: 'Open', categoryKey: 'new' } }, _authError: 403 });
  raw = { comments: [{ id: 1, body: 'Wrong field types' }], total: 1 };
  assert.match(send('fetch-jira-comments')._error, /Invalid/);
  raw = { success: true, _error: { unsafe: true } };
  assert.match(send('set-jira-assignee')._error, /Invalid/);
  raw = { _error: 'Failed', completed: { transition: 'yes' } };
  assert.deepEqual(send('execute-jira-quick-action'), { _error: 'Failed' });
  runtime.lastError = { message: 'Message port closed' };
  assert.equal(send('fetch-jira-myself')._error, 'Message port closed');
  assert.equal(send('set-jira-assignee')._errorKind, 'network');
});

test('durable jobs reject malformed checkpoints before restoring executable tasks', async () => {
  const valid = { gitlabUrl: 'https://gitlab.test', projectId: 37, mrIid: 12, jobs: ['deploy'], currentIndex: 0, status: 'starting', phase: 'ready', pipelineId: null };
  const stored = { 'task-valid': valid, 'task-bad-job': { ...valid, jobs: [{}] }, 'task-bad-checkpoint': { ...valid, pendingOperation: 'delete' }, 'task-bad-tab': { ...valid, _tabId: '42' } };
  const api = moduleFor('src/features/job-chains/model/store.ts', { chrome: { runtime: {}, storage: { local: { get(_key, callback) { callback({ job_chain_state_v1: stored }); } } } } });
  const tasks = {};
  await api.createTaskStore(tasks).load();
  assert.deepEqual(Object.keys(tasks), ['task-valid']);
  assert.equal(tasks['task-valid'], valid);
});

test('review JSON keeps invalid rows editable without claiming their fields are validated', () => {
  const api = moduleFor('src/features/review-import/model/validation.ts', { URL });
  const url = 'https://gitlab.test/team/repo/-/merge_requests/12';
  const invalid = { id: 'bad', body: { text: 'wrong type' }, path: null, side: null, line: null, code: null };
  const valid = { id: 'good', type: null, body: 'Check this', path: null, side: null, line: null, code: null };
  const input = api.parseInput(JSON.stringify({ version: 1, mr_url: url, head_sha: 'a'.repeat(40), comments: [invalid, valid] }), { webUrl: url });
  assert.equal(input.comments.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(input.comments[0])), invalid);
  assert.match(api.itemError(input.comments[0]), /must contain text/);
  assert.equal(api.validComment(input.comments[0]), false);
  assert.equal(api.validComment(input.comments[1]), true);
  assert.throws(() => api.parseInput(JSON.stringify({ version: 1, mr_url: url, head_sha: 'a'.repeat(40), comments: [null] }), { webUrl: url }), /unique text ID/);
});

test('review snapshots detach nested data and preserve omission of undefined fields', () => {
  const api = moduleFor('src/features/review-import/model/utils.ts', { structuredClone });
  const source = { title: undefined, items: [{ id: 'one', optional: undefined }], position: null };
  const copy = api.clone(source);
  assert.equal(Object.hasOwn(copy, 'title'), false);
  assert.equal(Object.hasOwn(copy.items[0], 'optional'), false);
  copy.items[0].id = 'changed';
  assert.equal(source.items[0].id, 'one');
  assert.equal(copy.position, null);
});

test('configured version paths treat prototype names as own data and never modify prototypes', () => {
  const api = moduleFor('src/shared/lib/version/index.ts');
  const file = { package: { version: '1.2.3' } };
  assert.equal(api.getNestedValue(file, 'constructor.prototype'), undefined);
  api.setNestedValue(file, '__proto__.version', '2.0.0');
  assert.equal(Object.prototype.version, undefined);
  assert.equal(Object.getPrototypeOf(file), Object.prototype);
  assert.equal(Object.hasOwn(file, '__proto__'), true);
  assert.equal(api.getNestedValue(file, '__proto__.version'), '2.0.0');
  assert.equal(file.package.version, '1.2.3');
  const toml = api.parseToml('[__proto__]\nversion = "3.0.0"');
  assert.equal(api.getNestedValue(toml, '__proto__.version'), '3.0.0');
  assert.equal(api.getNestedValue(api.parseToml(''), 'version'), undefined);
});

test('delivery journal digests retain SHA-256 identities across block boundaries and Unicode', () => {
  const { createHash } = require('node:crypto');
  const api = moduleFor('src/shared/lib/digest/index.ts', { TextEncoder });
  for (const value of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'Ревью 😀\n' + '日'.repeat(128)]) {
    assert.equal(api.digest(value), createHash('sha256').update(value).digest('hex'));
  }
});

test('settings controls distinguish inputs, selects and textareas and reject a broken template', () => {
  const controls = { input: { tagName: 'INPUT' }, select: { tagName: 'SELECT' }, text: { tagName: 'TEXTAREA' }, button: { tagName: 'BUTTON' }, bad: { tagName: 'DIV' } };
  const api = moduleFor('src/pages/settings/ui/dom.ts', { document: { getElementById: id => controls[id] || null } });
  assert.equal(api.inputById('input'), controls.input);
  assert.equal(api.valueControlById('select'), controls.select);
  assert.equal(api.textControlById('text'), controls.text);
  assert.equal(api.buttonById('button'), controls.button);
  assert.throws(() => api.inputById('select'), /Expected input/);
  assert.throws(() => api.valueControlById('bad'), /Expected form control/);
  assert.throws(() => api.byId('missing'), /missing/);
});

test('worker message validation retains legacy quick actions but rejects invalid optional fields', () => {
  const api = moduleFor('src/app/background/messages.ts', { URL });
  const valid = { type: 'execute-jira-quick-action', jiraUrl: 'https://jira.test', ticket: 'TEAM-1', action: { status: 'Done' } };
  assert.equal(api.parseBackgroundMessage(valid), valid);
  assert.equal(api.isJiraMessage(valid), true);
  for (const message of [{ type: 'open-options', jiraUrl: 'https://jira.test' }, { type: 'get-task-status', taskId: 'task-1', jiraUrl: {} }]) {
    assert.equal(api.parseBackgroundMessage(message), message);
    assert.equal(api.isJiraMessage(message), false);
  }
  assert.equal(api.parseBackgroundMessage({ ...valid, action: { updates: [{ field: 'labels', operation: {}, value: [] }] } }), null);
  assert.equal(api.parseBackgroundMessage({ type: 'fetch-jira-comments', jiraUrl: 'https://jira.test', ticket: 'TEAM-1', startAt: '20' }), null);
});
