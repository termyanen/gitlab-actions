'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');

function fixture(options) {
  options = options || {};
  var bumped = false;
  var mr = Object.assign({
    title: 'PROJ-123 Fix', web_url: 'https://gitlab.test/team/repo/-/merge_requests/12',
    source_branch: 'feature/fix', target_branch: 'main', squash: true,
    should_remove_source_branch: false, force_remove_source_branch: false,
    head_pipeline: options.laggingPipeline ? null : { id: 100, status: 'running' }
  }, options.mr);
  return harness.content({
    settings: Object.assign({ version_from_target: true }, options.settings),
    gitlab: function(req) {
      if (req.path === '/projects/37') return { merge_method: options.mergeMethod || 'merge' };
      if (req.path === '/projects/37/merge_requests/12') {
        if (req.method === 'PUT') Object.assign(mr, req.body);
        return Object.assign({}, mr, { sha: bumped ? 'new-head' : 'old-head', rebase_in_progress: false, merge_error: options.rebaseError || null });
      }
      if (req.path.endsWith('/rebase')) return {};
      if (req.path.startsWith('/projects/37/repository/files/')) {
        if (req.method === 'PUT') {
          if (options.bumpError) return harness.response(400, { message: options.bumpError });
          bumped = true;
          return {};
        }
        var source = req.path.includes('ref=feature%2Ffix');
        return { content: Buffer.from(JSON.stringify({ version: source ? '1.0.0' : '2.0.0', keep: source })).toString('base64'), last_commit_id: source ? 'source-id' : 'target-id' };
      }
      if (req.path === '/projects/37/repository/branches/feature%2Ffix') return { commit: { id: bumped ? 'new-head' : 'old-head' } };
      if (req.path.endsWith('/merge')) return {};
      if (req.path.endsWith('/merge_requests/12/pipelines')) return options.pipelines || [{ id: 100, status: 'running' }];
      if (req.path === '/projects/37/pipelines/100/jobs?per_page=100') return options.jobs || [];
      if (req.path.endsWith('/cancel') || req.path.endsWith('/retry') || req.path.endsWith('/play')) return { id: 42 };
      if (req.path === '/projects/37/pipeline') return { id: 101 };
      if (req.path.endsWith('/notes') && req.method === 'POST') return { id: 42 };
      throw new Error('Unexpected request: ' + req.method + ' ' + req.path);
    }
  });
}

['merge', 'rebase_merge', 'ff'].forEach(function(method) {
  test('Ship preserves source contents and merge options with ' + method + ' history', async function() {
    var env = fixture({ mergeMethod: method, laggingPipeline: true });
    await env.finish(env.actions.doShip());
    var writes = env.requests.filter(function(req) { return req.method !== 'GET'; });
    assert.deepEqual(writes.map(function(req) { return req.path.split('/').pop(); }), method === 'merge' ? ['package.json', 'merge'] : ['rebase', 'package.json', 'merge']);
    var bump = writes.find(function(req) { return req.path.includes('/repository/files/'); });
    assert.deepEqual(JSON.parse(Buffer.from(bump.body.content, 'base64').toString()), { version: '2.0.1', keep: true });
    assert.deepEqual(writes[writes.length - 1].body, { merge_when_pipeline_succeeds: true, squash: true, should_remove_source_branch: false });
  });
});

['doShip', 'doForceShip', 'doRebaseVersion'].forEach(function(action) {
  test(action + ' stops after a rejected version write', async function() {
    var env = fixture({ bumpError: 'Source file changed', mergeMethod: 'rebase_merge' });
    await assert.rejects(env.finish(env.actions[action]()), /Source file changed/);
    assert.equal(env.requests.filter(function(req) { return req.path.endsWith('/merge') || req.path.endsWith('/cancel'); }).length, 0);
    assert.equal(env.requests.filter(function(req) { return req.method === 'PUT' && req.path.includes('/repository/files/'); }).length, 1);
  });
});

test('Ship stops on a rebase conflict before writing a version or merging', async function() {
  var env = fixture({ mergeMethod: 'ff', rebaseError: 'conflicts in source branch' });
  await assert.rejects(env.finish(env.actions.doShip()), /Rebase failed/);
  assert.equal(env.requests.some(function(req) { return req.path.includes('/repository/files/') || req.path.endsWith('/merge'); }), false);
});

test('Force Ship keeps its rebase, bump, cancel and merge order', async function() {
  var env = fixture({ mergeMethod: 'ff', pipelines: [{ id: 100, status: 'running' }, { id: 99, status: 'success' }] });
  await env.finish(env.actions.doForceShip());
  var writes = env.requests.filter(function(req) { return req.method !== 'GET'; });
  assert.deepEqual(writes.map(function(req) { return req.path.split('/').pop(); }), ['rebase', 'package.json', 'cancel', 'merge']);
  assert.deepEqual(writes[0].body, { skip_ci: true });
  assert.equal(writes[2].path, '/projects/37/pipelines/100/cancel');
  assert.deepEqual(writes[3].body, { squash: true, should_remove_source_branch: false });
});

test('Rebase + Auto-merge does not bump a version', async function() {
  var env = fixture({ mergeMethod: 'ff' });
  await env.finish(env.actions.doRebaseAutoMerge());
  assert.deepEqual(env.requests.filter(function(req) { return req.method !== 'GET'; }).map(function(req) { return req.path.split('/').pop(); }), ['rebase', 'merge']);
});

[
  { should_remove_source_branch: false, force_remove_source_branch: false, expected: false },
  { should_remove_source_branch: true, force_remove_source_branch: false, expected: true },
  { should_remove_source_branch: false, force_remove_source_branch: true, expected: true }
].forEach(function(example) {
  test('merge respects source branch removal flags: ' + JSON.stringify(example), async function() {
    var env = fixture({ mr: example });
    await env.finish(env.actions.doAutoMerge());
    var request = env.requests.find(function(req) { return req.path.endsWith('/merge'); });
    assert.equal(request.body.should_remove_source_branch, example.expected);
  });
});

[{ has_conflicts: true }, { blocking_discussions_resolved: false }].forEach(function(mr) {
  test('direct auto-merge rejects a blocked MR: ' + JSON.stringify(mr), async function() {
    var env = fixture({ mr: mr });
    await assert.rejects(env.finish(env.actions.doAutoMerge()), /conflicts|threads/);
    assert.equal(env.requests.some(function(req) { return req.method === 'PUT'; }), false);
  });
});

test('new pipeline uses the MR source branch', async function() {
  var env = fixture();
  await env.finish(env.actions.doPipelineRestart());
  assert.deepEqual(env.requests[env.requests.length - 1].body, { ref: 'feature/fix' });
});

test('cancel pipeline affects only active pipelines', async function() {
  var env = fixture({ pipelines: [{ id: 100, status: 'running' }, { id: 99, status: 'pending' }, { id: 98, status: 'success' }, { id: 97, status: 'failed' }] });
  await env.finish(env.actions.doPipelineCancel());
  assert.deepEqual(env.requests.filter(function(req) { return req.method === 'POST'; }).map(function(req) { return req.path; }), ['/projects/37/pipelines/100/cancel', '/projects/37/pipelines/99/cancel']);
});

test('retry failed skips successful and running jobs', async function() {
  var env = fixture({ jobs: [{ id: 1, status: 'failed' }, { id: 2, status: 'running' }, { id: 3, status: 'success' }] });
  await env.finish(env.actions.doRetryFailed());
  assert.deepEqual(env.requests.filter(function(req) { return req.method === 'POST'; }).map(function(req) { return req.path; }), ['/projects/37/jobs/1/retry']);
});

['Fix', 'Draft: Fix', 'WIP: Fix', '[Draft] Fix'].forEach(function(title) {
  test('draft toggle handles title ' + title, async function() {
    var env = fixture({ mr: { title: title } });
    var result = await env.finish(env.actions.doDraftToggle());
    assert.equal(result.newTitle, title === 'Fix' ? 'Draft: Fix' : 'Fix');
  });
});

test('copy MR keeps title and link', async function() {
  var env = fixture();
  await env.finish(env.actions.doCopyMr());
  assert.equal(env.messages[0].clipboard, 'PROJ-123 Fix\nhttps://gitlab.test/team/repo/-/merge_requests/12');
});

test('fixed reviewers produce the configured mention comment', async function() {
  var env = fixture();
  await env.finish(env.actions.doReviewers('get-reviewers', ['alice', 'bob']));
  assert.deepEqual(env.requests[0].body, { body: 'Reviewers: @alice @bob' });
});

test('single custom job runs directly; comma-separated jobs go to the background', async function() {
  var env = fixture({ jobs: [{ id: 8, name: 'build', status: 'manual' }] });
  await env.finish(env.actions.doTriggerJob('build'));
  assert.equal(env.requests[env.requests.length - 1].path, '/projects/37/jobs/8/play');
  assert.equal(env.messages.length, 0);
  await env.finish(env.actions.doTriggerJob(' build, deploy,  '));
  assert.deepEqual(env.messages[0].jobs, ['build', 'deploy']);
  assert.equal(env.messages[0].type, 'start-job-chain');
  assert.equal(env.messages[0].projectId, 37);
  assert.equal(env.messages[0].mrIid, 12);
});

[
  ['remove_labels', ' waiting for QA, bug\nwaiting for QA, тип::ошибка ', { remove_labels: 'waiting for QA,bug,тип::ошибка' }],
  ['clear_labels', 'ignored stale label', { labels: '' }],
  ['add_labels', 'bug, ready for QA', { add_labels: 'bug,ready for QA' }],
  ['set_labels', 'ready for QA', { labels: 'ready for QA' }],
  ['clear_assignees', '', { assignee_ids: [0] }],
  ['clear_reviewers', '', { reviewer_ids: [0] }],
  ['clear_milestone', '', { milestone_id: 0 }]
].forEach(function(example) {
  test('configurable MR action sends only its chosen field: ' + example[0], async function() {
    var env = fixture();
    await env.finish(env.actions.doMrAction({ label: 'Custom action', type: example[0], labels: example[1] }));
    assert.equal(env.requests.length, 1);
    assert.equal(env.requests[0].method, 'PUT');
    assert.equal(env.requests[0].path, '/projects/37/merge_requests/12');
    assert.deepEqual(env.requests[0].body, example[2]);
  });
});

[null, {}, {label:'  ',type:'clear_labels'}, {label:'Bad',type:'delete'}, {label:'Bad',type:'constructor'},
  {label:'Bad',type:'remove_labels',labels:' , \n'}, {label:'Bad',type:'set_labels',labels:''}, {label:'Bad',type:'add_labels',labels:[]}].forEach(function(action, i) {
  test('invalid MR action makes no request: ' + i, async function() {
    var env = fixture();
    await assert.rejects(env.finish(env.actions.doMrAction(action)));
    assert.equal(env.requests.length, 0);
  });
});

test('MR action API rejection is surfaced without retrying or writing other fields', async function() {
  var env = harness.content({ gitlab: function() { return harness.response(403, {message:'Forbidden'}); } });
  await assert.rejects(env.finish(env.actions.doMrAction({label:'Clear',type:'clear_labels'})), /Forbidden/);
  assert.equal(env.requests.length, 1);
});

test('MR actions inherit defaults, support project overrides, and allow an empty override', async function() {
  var defaultActions = [{id:'global',label:'Global',type:'clear_labels',labels:''}];
  for (var override of [undefined, [], [{id:'local',label:'Local',type:'clear_reviewers',labels:''}]]) {
    var profile = override === undefined ? {} : {mrActions:override};
    var env = fixture({settings:{mrActions:defaultActions,projectProfiles:{'team/repo':profile}}});
    var settings = await env.finish(env.actions.getSettings());
    assert.deepEqual(JSON.parse(JSON.stringify(settings.mrActions)), override === undefined ? defaultActions : override);
  }
});
