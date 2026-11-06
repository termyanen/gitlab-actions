const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../scripts/chrome-web-store.mjs');
const env = {
  CWS_ACTION: 'upload', CWS_PUBLISHER_ID: 'fixture-publisher', CWS_EXTENSION_ID: 'a'.repeat(32),
  CWS_CLIENT_ID: 'fixture-client', CWS_CLIENT_SECRET: 'secret&=+with spaces', CWS_REFRESH_TOKEN: 'refresh&=+token',
};
const token = {access_token: 'fixture-access-token'};
const uploaded = {uploadState: 'SUCCEEDED', crxVersion: '1.2.3'};

async function run(responses, overrides = {}) {
  const api = await modulePromise;
  const calls = [], pauses = [];
  const request = api.uploadToStore({
    config: api.storeConfig(env), archive: Buffer.from('fixture ZIP'), version: '1.2.3',
    pause: async ms => pauses.push(ms),
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected extra request');
      return {ok: !response.httpError, status: response.httpError || 200, json: async () => response};
    },
    ...overrides,
  });
  return {request, calls, pauses};
}

test('CWS requires v2 publisher configuration and validates release/ZIP versions before upload', async () => {
  const {storeConfig, checkReleaseVersion} = await modulePromise;
  assert.throws(() => storeConfig({...env, CWS_PUBLISHER_ID: ''}), /CWS_PUBLISHER_ID/);
  assert.throws(() => storeConfig({...env, CWS_ACTION: 'unexpected'}), /CWS_ACTION/);
  assert.throws(() => storeConfig({...env, CWS_EXTENSION_ID: '../bad'}), /CWS_EXTENSION_ID/);
  assert.throws(() => checkReleaseVersion('1.2.3', '1.2.4'), /ZIP version/);
  assert.throws(() => checkReleaseVersion('1.2.3', '1.2.3', 'v1.2.4'), /Release tag/);
  checkReleaseVersion('1.2.3', '1.2.3', 'v1.2.3');
});

test('CWS upload uses v2 binary media and correctly encodes OAuth secrets without publishing', async () => {
  const {request, calls} = await run([token, uploaded]);
  assert.deepEqual(await request, {uploadState: 'SUCCEEDED'});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.get('client_secret'), env.CWS_CLIENT_SECRET);
  assert.equal(calls[0].options.body.get('refresh_token'), env.CWS_REFRESH_TOKEN);
  assert.match(calls[1].url, /\/upload\/v2\/publishers\/fixture-publisher\/items\/a{32}:upload$/);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/zip');
  assert.equal(calls[1].options.body.toString(), 'fixture ZIP');
  assert.equal(calls[1].options.redirect, 'error');
});

test('CWS waits for asynchronous processing before an explicitly requested submission', async () => {
  const {storeConfig} = await modulePromise;
  const {request, calls, pauses} = await run([token, {uploadState: 'IN_PROGRESS'}, {lastAsyncUploadState: 'IN_PROGRESS'}, {lastAsyncUploadState: 'SUCCEEDED'}, {state: 'PENDING_REVIEW'}], {config: storeConfig({...env, CWS_ACTION: 'publish'})});
  assert.deepEqual(await request, {uploadState: 'SUCCEEDED', submissionState: 'PENDING_REVIEW'});
  assert.equal(pauses.length, 2);
  assert.equal(calls.filter(c => c.url.endsWith(':publish')).length, 1);
  assert.equal(calls[2].options.method, undefined);
  assert.match(calls[2].url, /:fetchStatus$/);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {publishType: 'DEFAULT_PUBLISH'});
});

for (const [name, responses, error] of [
  ['HTTP rejection', [token, {httpError: 403}], /rejected/],
  ['failed upload with HTTP 200', [token, {uploadState: 'FAILED'}], /did not finish/],
  ['unknown upload status', [token, {}], /did not finish/],
  ['unexpected archive version', [token, {...uploaded, crxVersion: '9.9.9'}], /version/],
  ['OAuth error', [{error: {message: 'secret response'}}], /rejected/],
  ['missing token', [{}], /missing access/],
  ['ambiguous upload network failure', [token, new Error('secret network detail')], /network error/],
]) test('CWS rejects ' + name + ' and never publishes', async () => {
  const {storeConfig} = await modulePromise;
  const {request, calls} = await run(responses, {config: storeConfig({...env, CWS_ACTION: 'publish'})});
  await assert.rejects(request, error);
  assert.equal(calls.some(c => c.url.endsWith(':publish')), false);
  assert.ok(calls.length <= 2, 'write requests must not retry automatically');
});

test('CWS polling is bounded and does not publish an unfinished upload', async () => {
  const {request, calls} = await run([token, {uploadState: 'IN_PROGRESS'}, {lastAsyncUploadState: 'IN_PROGRESS'}], {pollAttempts: 1});
  await assert.rejects(request, /did not finish/);
  assert.equal(calls.length, 3);
});

for (const response of [{state: 'REJECTED'}, {}, {error: {message: 'secret details'}}]) {
  test('CWS HTTP 200 without an accepted submission state is not success: ' + JSON.stringify(response), async () => {
    const {storeConfig} = await modulePromise;
    const {request} = await run([token, uploaded, response], {config: storeConfig({...env, CWS_ACTION: 'publish'})});
    await assert.rejects(request, error => !error.message.includes('secret') && /rejected|accepted state/.test(error.message));
  });
}
