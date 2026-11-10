'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {transformSync} = require('esbuild');
const {root} = require('./helpers/runtime.cjs');
const baseline = require('./fixtures/refactor-baseline.json');
const manifestSource = require('../manifest.json');
const builtManifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json')));
const contentStyles = builtManifest.content_scripts.flatMap(entry => entry.css || []);
assert.equal(contentStyles.length, 1);
const contentStylesPath = path.join(root, 'dist', contentStyles[0]);

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
  // MR size is informational; retain it below for comparison with the baseline.
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
    current: {ordinaryHttpsJs: ordinaryBytes, gitlabCommonJs: commonBytes, mrInitialJs: mrBytes, css: fs.statSync(contentStylesPath).size, allPackagedJs: Object.values(outputs).reduce((sum, output) => sum + output.bytes, 0)},
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
    const result = transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {loader: 'js', format: 'esm', target: 'chrome' + manifestSource.minimum_chrome_version});
    assert.deepEqual(result.warnings, [], file);
  }
  const css = fs.readFileSync(contentStylesPath, 'utf8');
  assert.deepEqual(transformSync(css, {loader: 'css'}).warnings, []);
  assert.ok(css.includes(':where(html.gl-actions-host) .gl-mr-actions-ext'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json')));
  assert.ok(Number(manifest.minimum_chrome_version) >= 110, 'The worker lifetime and CSS/API baseline requires Chrome 110+');
  assert.deepEqual(manifest.permissions, ['storage', 'notifications', 'tabs', 'alarms']);
  assert.deepEqual(manifest.content_scripts.map(group => group.js), [['content_proxy.js']]);
  assert.ok(manifest.web_accessible_resources.some(group => group.resources.includes('modules/chunks/*.js')));
});

test('React pages share a production runtime while compact popup application code stays small', () => {
  const {outputs, entry, staticGraph, bytes} = graph();
  const popupGraph = staticGraph([entry('src/app/entrypoints/quick-popup.ts')]);
  const settingsGraph = staticGraph([entry('src/app/entrypoints/popup.ts')]);
  const welcomeGraph = staticGraph([entry('src/app/entrypoints/welcome.ts')]);
  const allUi = new Set([...popupGraph, ...settingsGraph, ...welcomeGraph]);
  const inputs = files => [...files].flatMap(file => Object.entries(outputs[file].inputs));
  const attributedBytes = (files, vendor) => inputs(files)
    .filter(([file]) => file.startsWith('node_modules/') === vendor)
    .reduce((sum, [, input]) => sum + input.bytesInOutput, 0);
  const popupApplicationBytes = attributedBytes(popupGraph, false);
  const sharedVendorBytes = attributedBytes(allUi, true);
  // The authorized React migration adds one shared React/React DOM runtime.
  // Pinned 19.3.1 measures ~221 KB minified without gzip. Its separate 225 KB
  // ceiling does not relax the original 16 KB popup application-code budget.
  assert.ok(popupApplicationBytes < 16000, 'Quick popup application JS must stay below 16 KB');
  assert.ok(sharedVendorBytes < 225000, 'Shared production React runtime must stay below 225 KB');
  assert.equal(inputs(popupGraph).some(([file]) => file.startsWith('src/entities/review/') || file.startsWith('src/pages/settings/') || file.startsWith('src/pages/welcome/')), false);
  assert.equal(inputs(welcomeGraph).some(([file]) => file.startsWith('src/entities/review/') || file.startsWith('src/pages/settings/') || file.startsWith('src/pages/popup/')), false, 'Welcome must not load settings or popup implementation');
  assert.equal(inputs(allUi).some(([file]) => file.includes('.development.')), false, 'Development React must not ship');
  const rendererFiles = [...allUi].filter(file => Object.keys(outputs[file].inputs).some(input => /node_modules\/react-dom\/.*react-dom-client\.production\.js$/.test(input)));
  assert.equal(rendererFiles.length, 1, 'The renderer must be packaged once');
  assert.ok(rendererFiles.every(file => popupGraph.has(file) && settingsGraph.has(file) && welcomeGraph.has(file)), 'All three pages must use the shared renderer chunk');
  assert.ok(rendererFiles.every(file => file.includes('/ui/chunks/')), 'React chunks must stay separate from content-script chunks');
  const licenses = fs.readFileSync(path.join(root, 'dist/THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const name of ['react', 'react-dom', 'scheduler']) assert.ok(licenses.includes(name + ' '));
  assert.ok(licenses.includes('Copyright (c) Meta Platforms'));
  assert.equal(manifestSource.web_accessible_resources.some(group => group.resources.some(resource => resource.startsWith('ui/'))), false, 'Extension page runtime does not need web-accessible exposure');
  for (const [file, output] of Object.entries(outputs)) {
    if (allUi.has(file)) continue;
    assert.equal(Object.keys(output.inputs).some(input => /^node_modules\/(?:react(?:-dom)?|scheduler)\//.test(input)), false, 'React must not enter background/content output: ' + file);
  }
  for (const page of ['popup.html', 'quick-popup.html', 'welcome.html']) {
    const html = fs.readFileSync(path.join(root, 'dist', page), 'utf8');
    assert.match(html, /<script\b[^>]*type=["']module["']/);
  }
  fs.writeFileSync(path.join(root, '.reports/react-ui-size.json'), JSON.stringify({
    note: 'Uncompressed minified production bytes; not browser startup latency or memory measurements.',
    popupApplicationBytes,
    settingsApplicationBytes: attributedBytes(settingsGraph, false),
    welcomeApplicationBytes: attributedBytes(welcomeGraph, false),
    sharedVendorBytes,
    popupInitialBytes: bytes(popupGraph),
    settingsInitialBytes: bytes(settingsGraph),
    welcomeInitialBytes: bytes(welcomeGraph),
    sharedRendererFiles: rendererFiles,
  }, null, 2) + '\n');
  assert.deepEqual(transformSync(fs.readFileSync(path.join(root, 'dist/settings.css'), 'utf8'), {loader:'css'}).warnings, []);
});
