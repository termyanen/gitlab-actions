'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const cache = new Map();

// Test-only module bundles run in each test's isolated VM. Production builds
// never export test hooks or depend on this adapter.
function bundleForTest(entry, { globalName = 'TestModule', footer = '', exposeBindings = false } = {}) {
  const key = JSON.stringify([entry, globalName, footer, exposeBindings]);
  if (!cache.has(key)) {
    let input = { entryPoints: [entry] };
    if (exposeBindings) {
      const file = path.join(root, entry);
      let source = fs.readFileSync(file, 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const bindings = new Map();
      function binding(name, writable) {
        if (ts.isIdentifier(name)) bindings.set(name.text, writable);
        else if (ts.isObjectBindingPattern(name)) name.elements.forEach(part => binding(part.name, writable));
      }
      for (const node of ast.statements) {
        if (ts.isFunctionDeclaration(node) && node.name) binding(node.name, true);
        if (ts.isVariableStatement(node)) node.declarationList.declarations.forEach(decl => binding(decl.name, !(node.declarationList.flags & ts.NodeFlags.Const)));
        if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
          const imports = node.importClause?.namedBindings;
          if (imports && ts.isNamedImports(imports)) imports.elements.filter(part => !part.isTypeOnly).forEach(part => binding(part.name, false));
        }
      }
      source += '\nObject.defineProperties(globalThis, {' + [...bindings].map(([name, writable]) => JSON.stringify(name) + ': {configurable: true, get: () => ' + name + (writable ? ', set: value => { ' + name + ' = value; }' : '') + '}').join(',') + '});';
      input = {stdin: {contents: source, resolveDir: path.dirname(file), sourcefile: file, loader: 'ts'}};
    }
    const result = buildSync({
      absWorkingDir: root,
      ...input,
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
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'popup.js') return bundleForTest('src/pages/settings/ui/settings.ts', {exposeBindings: true, footer: 'for (const key of Object.keys(SettingsConfigModule)) if (!(key in globalThis)) globalThis[key] = SettingsConfigModule[key]; startSettings();'}) .replace(/^/, bundleForTest('src/features/manage-settings/index.ts', {globalName: 'SettingsConfigModule'}));
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'welcome.js') return bundleForTest('src/app/entrypoints/welcome.ts');
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'content_proxy.js') return bundleForTest('src/app/entrypoints/content_proxy.ts');
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'content.js') {
    return bundleForTest('src/app/entrypoints/content.ts');
  }
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'review-copy.js') {
    return bundleForTest('src/widgets/review-dialog/index.ts', {
      globalName: 'ReviewCopyModule',
      footer: `if (!window.__glReviewCopyLoaded && window.GlReviewExport && document.querySelector('meta[content="GitLab"], body[data-page]')) { window.__glReviewCopyLoaded = true; ReviewCopyModule.startReviewControls(window.GlReviewExport, () => window.GlReviewWorkflow || null, () => window.GlReviewImport, () => window.GlReviewImportUI); }`,
    });
  }
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'review-import-ui.js') {
    return bundleForTest('src/widgets/review-import-dialog/index.ts', {
      globalName: 'ReviewImportUiModule',
      footer: 'window.GlReviewImportUI ||= ReviewImportUiModule.createImportDialog(() => window.GlReviewImport);',
    });
  }
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'review-import.js') {
    return bundleForTest('src/features/review-import/index.ts', {
      globalName: 'ReviewImportModule',
      footer: 'window.GlReviewImport = ReviewImportModule.createReviewImporter(window.GlReviewWorkflow || null);',
    });
  }
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'review-export.js') {
    return bundleForTest('src/features/review-export/index.ts', {
      globalName: 'ReviewExportModule',
      footer: `window.GlReviewExport = Object.fromEntries(Object.entries(ReviewExportModule.createReviewExporter(null)).map(([key, value]) => [key, typeof value === 'function' ? function(...args) { return ReviewExportModule.createReviewExporter(window.GlReviewWorkflow || null)[key](...args); } : value]));`,
    });
  }
  if (!process.env.EXTENSION_TEST_SOURCE_DIR && file === 'review-workflow.js') {
    return bundleForTest('src/entities/review/index.ts', {
      globalName: 'ReviewWorkflowModule',
      footer: 'window.GlReviewWorkflow = { ...ReviewWorkflowModule };',
    });
  }
  return fs.readFileSync(path.join(process.env.EXTENSION_TEST_SOURCE_DIR || root, file), 'utf8');
}

module.exports = { root, readRuntime, bundleForTest };
