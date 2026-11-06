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
