'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');
var contracts = require('./helpers/gitlab-contracts.cjs');

function mutations(env) {
  return env.requests.filter(function(req) { return req.method !== 'GET'; }).map(function(req) { return req.method + ' ' + req.path; });
}

['content', 'background'].forEach(function(runtime) {
  test('backward parity: ' + runtime + ' fallback preserves GitLab MR-pipeline priority on the current SHA', async function() {
    var env = harness[runtime]({ gitlab: function(req) {
      if (req.path === '/projects/37/merge_requests/12') return { sha: 'current', source_project_id: 37 };
      if (req.path.endsWith('/pipelines')) {
        // GitLab 12.10+ orders MR pipelines before branch pipelines, then ID
        // descending within each group. The larger ID is not its preference.
        return [{ id: 99, sha: 'current' }, { id: 100, sha: 'current' }];
      }
      if (req.path.includes('/pipelines/')) {
        assert.equal(req.path, '/projects/37/pipelines/99/jobs?per_page=100');
        return [{ id: 8, name: 'build', status: 'manual' }];
      }
      assert.equal(req.path, '/projects/37/jobs/8/play');
      return { id: 8 };
    } });
    var operation = runtime === 'content' ? env.actions.doTriggerJob('build') : env.context.startJobByName({ projectId: 37, mrIid: 12, gitlabUrl: 'https://gitlab.test' }, 'build');
    await env.finish(operation);
    assert.deepEqual(env.requests.filter(function(req) { return req.method === 'POST'; }).map(function(req) { return req.path; }), ['/projects/37/jobs/8/play']);
  });
});

contracts.versions.forEach(function(spec) {
  var label = 'GitLab ' + spec.version + ': ';

  test('backward parity: ' + label + 'reviewers job uses the existing play API', async function() {
    var env = contracts.fixture(spec);
    await env.finish(env.actions.doReviewers('get-reviewers'));
    assert.deepEqual(mutations(env), ['POST /projects/37/jobs/10/play']);
  });

  [false, true].forEach(function(omitHead) {
    test('backward parity: ' + label + 'single custom job; head omitted: ' + omitHead, async function() {
      var env = contracts.fixture(spec, { omitHead: omitHead });
      await env.finish(env.actions.doTriggerJob('build'));
      assert.deepEqual(mutations(env), ['POST /projects/37/jobs/8/play']);
    });

    test('backward parity: ' + label + 'full background chain; head omitted: ' + omitHead, async function() {
      var env = contracts.fixture(spec, { runtime: 'background', omitHead: omitHead });
      var started = await env.dispatch({ type: 'start-job-chain', gitlabUrl: 'https://gitlab.test', projectId: 37, mrIid: 12, jobs: ['build', 'deploy'] });
      var state;
      for (var i = 0; i < 10; i++) {
        await harness.flush();
        state = await env.dispatch({ type: 'get-task-status', taskId: started.taskId });
        if (state.status === 'done' || state.status === 'error') break;
        await env.clock.next();
      }
      assert.equal(state.status, 'done', state.error);
      assert.deepEqual(mutations(env), ['POST /projects/37/jobs/8/play', 'POST /projects/37/jobs/9/play']);
    });
  });

  test('backward parity: ' + label + 'retry failed skips successful and running jobs', async function() {
    var env = contracts.fixture(spec);
    env.server.jobs[0].status = 'failed';
    env.server.jobs[1].status = 'running';
    env.server.jobs[2].status = 'success';
    await env.finish(env.actions.doRetryFailed());
    assert.deepEqual(mutations(env), ['POST /projects/37/jobs/8/retry']);
  });

  test('backward parity: ' + label + 'auto-merge keeps the old flag and retries its readiness response', async function() {
    var env = contracts.fixture(spec, { retryMerge: true, omitHead: true });
    await env.finish(env.actions.doAutoMergeWithRetry(3, 100));
    assert.equal(env.server.mergeAttempts, 2);
    var writes = env.requests.filter(function(req) { return req.method === 'PUT'; });
    writes.forEach(function(req) {
      assert.deepEqual(req.body, { merge_when_pipeline_succeeds: true, squash: true, should_remove_source_branch: false });
    });
  });

  test('backward parity: ' + label + 'source version bump retains contents and the concurrent-write guard', async function() {
    var env = contracts.fixture(spec);
    await env.finish(env.actions.doVersionBump());
    assert.equal(env.server.version, '1.2.4');
    assert.equal(env.server.commits.length, 1);
    assert.deepEqual(mutations(env), ['PUT /projects/37/repository/files/package.json']);
  });

  test('backward parity: ' + label + 'Force Ship keeps bump, cancel and merge ordering', async function() {
    var env = contracts.fixture(spec, { force: true, omitHead: true });
    await env.finish(env.actions.doForceShip());
    assert.equal(env.server.version, '1.2.4');
    assert.equal(env.server.mergeAttempts, 1);
    assert.deepEqual(mutations(env), [
      'PUT /projects/37/repository/files/package.json',
      'POST /projects/37/pipelines/100/cancel',
      'PUT /projects/37/merge_requests/12/merge'
    ]);
  });

  test(label + 'rebase completion uses its conditional status field', async function() {
    var env = contracts.fixture(spec);
    await env.finish(env.actions.doRebase(false));
    assert.equal(env.server.rebase, false);
    assert.equal(env.server.rebasePolls, 3);
    assert.deepEqual(mutations(env), ['PUT /projects/37/merge_requests/12/rebase']);
  });

  test(label + 'Ship waits for rebase before committing and retries merge without a second bump', async function() {
    var env = contracts.fixture(spec, { mergeMethod: 'ff', retryMerge: true });
    await env.finish(env.actions.doShip());
    assert.equal(env.server.rebasePolls, 3);
    assert.equal(env.server.commits.length, 1);
    assert.equal(env.server.version, '1.2.4');
    assert.equal(env.server.mergeAttempts, 2);
    assert.deepEqual(mutations(env), [
      'PUT /projects/37/merge_requests/12/rebase',
      'PUT /projects/37/repository/files/package.json',
      'PUT /projects/37/merge_requests/12/merge',
      'PUT /projects/37/merge_requests/12/merge'
    ]);
  });

  test(label + 'fork jobs work with this version’s pipeline project fields', async function() {
    var env = contracts.fixture(spec, { fork: true });
    await env.finish(env.actions.doTriggerJob('build'));
    assert.deepEqual(mutations(env), ['POST /projects/51/jobs/8/play']);
  });
});
