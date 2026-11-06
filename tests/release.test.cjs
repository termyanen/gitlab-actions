'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {transformSync} = require('esbuild');
const {root} = require('./helpers/runtime.cjs');
const baseline = require('./fixtures/refactor-baseline.json');
const manifestSource = require('../manifest.json');

function graph() {
  const report = JSON.parse(fs.readFileSync(path.join(root, '.reports/build.json')));
  const outputs = report.metafile.outputs;
  function entry(source) {
    const found = Object.entries(outputs).find(([, output]) => output.entryPoint === source);
    assert.ok(found, 'Missing built entry: ' + source);
    return found[0];
  }
  function staticGraph(roots) {
    const seen = new Set();
    function visit(file) {
      if (seen.has(file)) return;
      assert.ok(outputs[file], 'Missing bundled dependency: ' + file);
      seen.add(file);
      for (const dependency of outputs[file].imports) if (dependency.kind === 'import-statement') visit(dependency.path);
    }
    roots.forEach(visit);
    return seen;
  }
  const bytes = files => [...files].reduce((sum, file) => sum + outputs[file].bytes, 0);
  return {outputs, entry, staticGraph, bytes};
}

test('release graph keeps heavy features lazy and stays within initial loading budgets', () => {
  const {outputs, entry, staticGraph, bytes} = graph();
  const bootstrap = entry('src/app/entrypoints/content_proxy.ts');
  const common = entry('src/app/content/runtime.ts');
  const mr = staticGraph([bootstrap, common, entry('src/widgets/mr-toolbar/index.ts'), entry('src/widgets/mr-list/index.ts'), entry('src/app/content/review.ts')]);
  const ordinaryBytes = bytes(staticGraph([bootstrap]));
  const commonBytes = bytes(staticGraph([bootstrap, common]));
  const mrBytes = bytes(mr);
  assert.ok(ordinaryBytes < 2048, 'All-HTTPS bootstrap must remain below 2 KiB');
  assert.ok(commonBytes < 20000, 'Shared GitLab startup must remain below 20 KB');
  assert.ok(mrBytes < 160000, 'Initial MR graph must remain below 160 KB');
  for (const source of ['src/features/review-export/index.ts', 'src/features/review-import/index.ts', 'src/widgets/review-import-dialog/index.ts', 'src/widgets/jira-panel/index.ts', 'src/widgets/cherry-pick-dialog/index.ts', 'src/widgets/standup/index.ts', 'src/widgets/command-palette/index.ts']) {
    assert.equal(mr.has(entry(source)), false, source + ' must load on demand');
  }
  const loadedInputs = new Set([...mr].flatMap(file => Object.keys(outputs[file].inputs)));
  assert.equal(loadedInputs.has('src/features/review-export/model/export.ts'), false);
  assert.equal(loadedInputs.has('src/features/review-import/model/import.ts'), false);
  const performance = {
    note: 'Uncompressed production bytes; these are not CPU, memory or browser-latency measurements.',
    baselineCommit: baseline.baselineCommit,
    baseline: {ordinaryHttpsJs: baseline.contentScripts[1].builtJsBytes, mrInitialJs: baseline.contentScripts.reduce((n, group) => n + group.builtJsBytes, 0), css: baseline.contentScripts[1].cssBytes},
    current: {ordinaryHttpsJs: ordinaryBytes, gitlabCommonJs: commonBytes, mrInitialJs: mrBytes, css: fs.statSync(path.join(root, 'dist/content.css')).size, allPackagedJs: Object.values(outputs).reduce((sum, output) => sum + output.bytes, 0)},
  };
  fs.writeFileSync(path.join(root, '.reports/performance.json'), JSON.stringify(performance, null, 2) + '\n');
});

test('all packaged ESM dependencies resolve locally and content CSS parses', () => {
  const {outputs} = graph();
  for (const [file, output] of Object.entries(outputs)) {
    for (const dependency of output.imports) {
      assert.equal(dependency.external, undefined, 'Runtime dependencies must be bundled: ' + dependency.path);
      assert.ok(outputs[dependency.path], 'Missing runtime dependency: ' + dependency.path);
    }
    const result = transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {loader: 'js', format: file.includes('/modules/') ? 'esm' : 'iife', target: 'chrome' + manifestSource.minimum_chrome_version});
    assert.deepEqual(result.warnings, [], file);
  }
  const css = fs.readFileSync(path.join(root, 'dist/content.css'), 'utf8');
  assert.deepEqual(transformSync(css, {loader: 'css'}).warnings, []);
  assert.ok(css.includes(':where(html.gl-actions-host) .gl-mr-actions-ext'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json')));
  assert.ok(Number(manifest.minimum_chrome_version) >= 110, 'The worker lifetime and CSS/API baseline requires Chrome 110+');
  assert.deepEqual(manifest.permissions, ['storage', 'notifications', 'tabs', 'cookies', 'alarms']);
  assert.deepEqual(manifest.content_scripts.map(group => group.js), [['content_proxy.js']]);
  assert.ok(manifest.web_accessible_resources.some(group => group.resources.includes('modules/chunks/*.js')));
});
