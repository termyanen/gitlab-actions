'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var harness = require('./helpers/extension.cjs');

function fixture(options) {
  options = options || {};
  var source = options.source === undefined ? '{"version":"1.0.0","dependencies":{"lib":"2"},"description":"Привет 🌍"}' : options.source;
  var target = options.target === undefined ? '{"version":"2.3.4","dependencies":{"lib":"1"}}' : options.target;
  var settings = options.settings || {};
  var sourceBranch = 'feature/new version';
  var targetBranch = 'release/2.x';
  var writes = [];
  var env = harness.content({
    settings: settings,
    gitlab: function(req) {
      if (req.path === '/projects/37/merge_requests/12') return { source_branch: sourceBranch, target_branch: targetBranch };
      if (req.method === 'GET' && req.path.indexOf('/repository/files/') !== -1) {
        var ref = new URL('https://gitlab.test' + req.path).searchParams.get('ref');
        var data = ref === sourceBranch ? source : target;
        if (data === null) return harness.response(404, { message: 'File not found' });
        return { content: Buffer.from(data).toString('base64'), last_commit_id: ref === sourceBranch ? 'source-file-commit' : 'target-file-commit' };
      }
      if (req.method === 'PUT' && req.path.indexOf('/repository/files/') !== -1) {
        writes.push(req);
        if (options.concurrentEdit && req.body.last_commit_id === 'source-file-commit') {
          return harness.response(400, { message: 'File changed since it was read' });
        }
        return {};
      }
      throw new Error('Unexpected request: ' + req.method + ' ' + req.path);
    }
  });
  env.writes = writes;
  env.output = function() { return Buffer.from(writes[0].body.content, 'base64').toString('utf8'); };
  return env;
}

test('target-based JSON bump preserves source dependencies, fields and Unicode', async function() {
  var env = fixture({ settings: { version_from_target: true } });
  var result = await env.finish(env.actions.doVersionBump());
  assert.deepEqual(JSON.parse(env.output()), { version: '2.3.5', dependencies: { lib: '2' }, description: 'Привет 🌍' });
  assert.deepEqual(harness.plain(result), { version: '2.3.5', branch: 'feature/new version' });
  assert.equal(env.writes[0].body.branch, 'feature/new version');
  assert.equal(env.writes[0].body.last_commit_id, 'source-file-commit');
});

test('target-based TOML bump preserves source sections, comments and dependencies', async function() {
  var source = '# source settings\n[tool.poetry]\nname = "source"\nversion = "1.0.0"\n\n[tool.poetry.dependencies]\nlib = "2"\n';
  var env = fixture({ source: source, target: '[tool.poetry]\nversion = "2.3.4"\nname = "target"\n', settings: { version_from_target: true, versionFile: 'pyproject.toml', versionPath: 'tool.poetry.version' } });
  await env.finish(env.actions.doVersionBump());
  assert.equal(env.output(), source.replace('version = "1.0.0"', 'version = "2.3.5"'));
});

test('target-based nested JSON bump changes only the configured source field', async function() {
  var env = fixture({ source: '{"tool":{"release":{"version":"1.0.0","flag":true}},"version":"untouched"}', target: '{"tool":{"release":{"version":"3.1.9","flag":false}}}', settings: { version_from_target: true, versionPath: 'tool.release.version', versionStrategy: 'minor' } });
  await env.finish(env.actions.doVersionBump());
  assert.deepEqual(JSON.parse(env.output()), { tool: { release: { version: '3.2.0', flag: true } }, version: 'untouched' });
});

['patch', 'minor', 'major'].forEach(function(strategy, i) {
  test('source-based JSON ' + strategy + ' bump keeps existing behavior without reading target', async function() {
    var env = fixture({ source: '{"version":"1.2.3","keep":true}', settings: { versionStrategy: strategy } });
    await env.finish(env.actions.doVersionBump());
    assert.deepEqual(JSON.parse(env.output()), { version: ['1.2.4', '1.3.0', '2.0.0'][i], keep: true });
    assert.equal(env.requests.filter(function(req) { return req.method === 'GET' && req.path.includes('/repository/files/'); }).length, 1);
  });
});

[false, true].forEach(function(fromTarget) {
  test('plain VERSION file supports ' + (fromTarget ? 'target' : 'source') + ' version base', async function() {
    var env = fixture({ source: '1.2.3\n', target: '4.5.6\n', settings: { versionFile: 'VERSION', version_from_target: fromTarget } });
    await env.finish(env.actions.doVersionBump());
    assert.equal(env.output(), fromTarget ? '4.5.7\n' : '1.2.4\n');
  });
});

test('custom file path, branch and commit template are preserved', async function() {
  var env = fixture({ settings: { versionFile: 'config/release version.json', versionCommitTemplate: 'release {version} / {version}' } });
  await env.finish(env.actions.doVersionBump());
  assert.equal(env.writes[0].path, '/projects/37/repository/files/config%2Frelease%20version.json');
  assert.equal(env.writes[0].body.commit_message, 'release 1.0.1 / 1.0.1');
  assert.equal(env.writes[0].body.encoding, 'base64');
});

test('project profile settings still override the global version configuration', async function() {
  var env = fixture({ settings: { versionStrategy: 'patch', projectProfiles: { 'team/repo': { versionStrategy: 'major', versionCommitTemplate: 'profile {version}' } } } });
  await env.finish(env.actions.doVersionBump());
  assert.equal(JSON.parse(env.output()).version, '2.0.0');
  assert.equal(env.writes[0].body.commit_message, 'profile 2.0.0');
});

[
  { name: 'missing source', source: null, target: '{"version":"2.0.0"}', error: /File not found/ },
  { name: 'missing target', target: null, error: /File not found/ },
  { name: 'invalid source JSON', source: '{broken', error: /JSON|property/i },
  { name: 'invalid target JSON', target: '{broken', error: /JSON|property/i },
  { name: 'missing target version', target: '{"name":"demo"}', error: /Version field/ },
  { name: 'missing source TOML section', source: '[other]\nversion = "1.0.0"\n', target: '[tool.poetry]\nversion = "2.0.0"\n', settings: { versionFile: 'pyproject.toml', versionPath: 'tool.poetry.version' }, error: /Could not find/ },
  { name: 'invalid plain version', source: '1.0.0', target: 'not a version', settings: { versionFile: 'VERSION' }, error: /Invalid version format/ }
].forEach(function(example) {
  test(example.name + ' fails without writing a commit', async function() {
    var env = fixture(Object.assign({}, example, { settings: Object.assign({ version_from_target: true }, example.settings) }));
    await assert.rejects(env.finish(env.actions.doVersionBump()), example.error);
    assert.equal(env.writes.length, 0);
  });
});

test('concurrent source edit is rejected without retrying an outdated write', async function() {
  var env = fixture({ concurrentEdit: true, settings: { version_from_target: true } });
  await assert.rejects(env.finish(env.actions.doVersionBump()), /File changed since it was read/);
  assert.equal(env.writes.length, 1);
});
