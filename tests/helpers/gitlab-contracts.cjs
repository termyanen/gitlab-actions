'use strict';

var assert = require('node:assert/strict');
var harness = require('./extension.cjs');

// Minimal response shapes derived from the official source tags, not captured
// private server responses. Tests do not download or run GitLab itself.
var versions = [
  { version: '12.10.14', pipelineProject: false, pipelineSource: false, autoMergeAlias: false, mergeReadiness: 406 },
  { version: '13.12.15', pipelineProject: true, pipelineSource: false, autoMergeAlias: false, mergeReadiness: 406 },
  { version: '14.10.5', pipelineProject: true, pipelineSource: true, autoMergeAlias: false, mergeReadiness: 406 },
  { version: '15.11.13', pipelineProject: true, pipelineSource: true, autoMergeAlias: false, mergeReadiness: 422 },
  { version: '16.11.10', pipelineProject: true, pipelineSource: true, autoMergeAlias: false, mergeReadiness: 422 },
  { version: '17.11.0', pipelineProject: true, pipelineSource: true, autoMergeAlias: true, mergeReadiness: 422 },
  { version: '18.4.0', pipelineProject: true, pipelineSource: true, autoMergeAlias: true, mergeReadiness: 422 },
  { version: '18.11.0', pipelineProject: true, pipelineSource: true, autoMergeAlias: true, mergeReadiness: 422 }
];

function fixture(spec, options) {
  options = options || {};
  var sourceProject = options.fork ? 51 : 37;
  var state = {
    sha: 'original-head', version: '1.2.3', rebase: false, rebasePolls: 0,
    mergeAttempts: 0, notes: [], commits: [],
    jobs: [
      { id: 8, name: 'build', status: 'manual' },
      { id: 9, name: 'deploy', status: 'manual' },
      { id: 10, name: 'get-reviewers', status: 'manual' }
    ],
    pipelineStatus: 'running'
  };
  function pipeline() {
    var result = {
      id: 100, sha: state.sha, ref: 'feature/compat', status: state.pipelineStatus,
      created_at: '2020-01-02T00:00:00Z', updated_at: '2020-01-02T00:00:00Z',
      web_url: 'https://gitlab.test/' + (options.fork ? 'fork/repo' : 'team/repo') + '/-/pipelines/100'
    };
    if (spec.pipelineProject) result.project_id = sourceProject;
    if (spec.pipelineSource) { result.iid = 17; result.source = 'push'; }
    return result;
  }
  function mr(params) {
    var result = {
      iid: 12, title: 'Compatibility fixture', state: 'opened', sha: state.sha,
      source_branch: 'feature/compat', target_branch: 'main', source_project_id: sourceProject, target_project_id: 37,
      web_url: 'https://gitlab.test/team/repo/-/merge_requests/12',
      squash: true, should_remove_source_branch: false, force_remove_source_branch: false,
      has_conflicts: false, blocking_discussions_resolved: true, merge_error: null
    };
    // These fields are conditional in every checked tag. Omission must not
    // make jobs or auto-merge depend on a newer embedded-pipeline response.
    if (!options.omitHead) result.head_pipeline = pipeline();
    if (params.get('include_rebase_in_progress') === 'true') {
      state.rebasePolls++;
      if (state.rebasePolls >= 3) state.rebase = false;
      result.rebase_in_progress = state.rebase;
    }
    return result;
  }
  var env = harness[options.runtime || 'content']({
    settings: { version_from_target: false },
    gitlab: function(req) {
      var url = new URL(req.path, 'https://gitlab.test');
      var path = url.pathname;
      if (path === '/projects/37') return { merge_method: options.mergeMethod || 'merge' };
      if (path === '/projects/37/merge_requests/12' && req.method === 'GET') return mr(url.searchParams);
      if (path === '/projects/37/merge_requests/12/pipelines') return [pipeline()];
      if (path === '/projects/37/merge_requests/12/rebase') {
        assert.equal(req.method, 'PUT');
        assert.deepEqual(req.body, options.skipCI ? { skip_ci: true } : {});
        state.rebase = true;
        return harness.response(202, { rebase_in_progress: true });
      }
      if (path === '/projects/' + sourceProject + '/pipelines/100/jobs') return state.jobs.map(harness.plain);
      var jobPath = path.match(/^\/projects\/(\d+)\/jobs\/(\d+)\/(play|retry)$/);
      if (jobPath) {
        assert.equal(req.method, 'POST');
        assert.equal(Number(jobPath[1]), sourceProject);
        var job = state.jobs.find(function(item) { return item.id === Number(jobPath[2]); });
        assert.ok(job, 'Unknown job');
        assert.ok(jobPath[3] === 'play' ? job.status === 'manual' : ['failed', 'canceled'].includes(job.status));
        if (jobPath[3] === 'retry') job.id += 1000;
        job.status = 'success';
        return harness.plain(job);
      }
      if (path === '/projects/37/merge_requests/12/notes') {
        if (req.method === 'GET') return state.notes.map(harness.plain);
        assert.equal(req.method, 'POST');
        state.notes.push({ id: state.notes.length + 1, body: req.body.body });
        return state.notes[state.notes.length - 1];
      }
      if (path === '/projects/37/repository/files/package.json') {
        if (req.method === 'GET') return {
          content: Buffer.from(JSON.stringify({ version: state.version, preserved: 'source contents' })).toString('base64'),
          last_commit_id: 'file-head'
        };
        assert.equal(req.method, 'PUT');
        assert.equal(state.rebase, false, 'Cannot update a branch before its rebase completes');
        assert.equal(req.body.last_commit_id, 'file-head');
        var content = JSON.parse(Buffer.from(req.body.content, 'base64').toString());
        assert.equal(content.preserved, 'source contents');
        state.version = content.version;
        state.sha = 'bumped-head';
        state.commits.push(harness.plain(req.body));
        return { commit: { id: state.sha } };
      }
      if (path === '/projects/37/repository/branches/feature%2Fcompat') return { commit: { id: state.sha } };
      if (path === '/projects/37/merge_requests/12/merge') {
        assert.equal(req.method, 'PUT');
        assert.equal(state.rebase, false, 'Cannot merge before rebase completes');
        assert.equal(req.body.squash, true);
        assert.equal(req.body.should_remove_source_branch, false);
        if (!spec.autoMergeAlias) assert.equal(Object.hasOwn(req.body, 'auto_merge'), false, 'Do not require the new auto_merge option');
        state.mergeAttempts++;
        if (req.body.merge_when_pipeline_succeeds) {
          if (options.retryMerge && state.mergeAttempts === 1) return harness.response(spec.mergeReadiness, { message: 'Branch cannot be merged' });
          assert.equal(req.body.merge_when_pipeline_succeeds, true);
        } else assert.equal(options.force, true);
        return { state: 'merged' };
      }
      if (path === '/projects/37/pipelines/100/cancel') {
        assert.equal(req.method, 'POST');
        state.pipelineStatus = 'canceled';
        return pipeline();
      }
      throw new Error(spec.version + ': unsupported request ' + req.method + ' ' + req.path);
    }
  });
  env.server = state;
  return env;
}

module.exports = { versions: versions, fixture: fixture };
