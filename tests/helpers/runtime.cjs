'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const cache = new Map();

// Test-only module bundles run in each test's isolated VM. Production builds
// never export test hooks or depend on this adapter.
function bundleForTest(entry, { globalName = 'TestModule', footer = '' } = {}) {
  const key = JSON.stringify([entry, globalName, footer]);
  if (!cache.has(key)) {
    const result = buildSync({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'iife',
      globalName,
      platform: 'browser',
      target: 'chrome88',
      footer: { js: footer },
      logLevel: 'silent',
    });
    cache.set(key, result.outputFiles[0].text);
  }
  return cache.get(key);
}

function readRuntime(file) {
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'review-workflow.js') {
    return bundleForTest('src/entities/review/index.ts', {
      globalName: 'ReviewWorkflowModule',
      footer: 'window.GlReviewWorkflow = { ...ReviewWorkflowModule };',
    });
  }
  return fs.readFileSync(path.join(process.env.EXTENSION_TEST_SOURCE_DIR || root, file), 'utf8');
}

module.exports = { root, readRuntime, bundleForTest };
