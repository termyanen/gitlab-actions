const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bundleForTest } = require('./helpers/runtime.cjs');

const context = vm.createContext({});
vm.runInContext(bundleForTest('src/shared/lib/version/index.ts'), context);
const version = context.TestModule;

test('typed version library preserves TOML formatting and unrelated content', () => {
  const source = '# header\n[tool.poetry]\nname = "пример"\nversion = "1.2.3"\n[other]\nversion = "9.0.0"\n';
  const data = version.parseToml(source);
  assert.equal(version.getNestedValue(data, 'tool.poetry.version'), '1.2.3');
  assert.equal(version.updateTomlVersion(source, 'tool.poetry.version', version.bumpVersion('1.2.3', 'minor')), source.replace('"1.2.3"', '"1.3.0"'));
  assert.throws(() => version.updateTomlVersion(source, 'missing.version', '2.0.0'), /Could not find/);
});

test('typed version library retains current short-version and nested JSON behavior', () => {
  assert.equal(version.bumpVersion('7', 'patch'), '8');
  assert.equal(version.bumpVersion('7', 'minor'), '7.1');
  const data = { metadata: { keep: 'unchanged' } };
  version.setNestedValue(data, 'metadata.release.version', '2.0.0');
  assert.equal(version.getNestedValue(data, 'metadata.release.version'), '2.0.0');
  assert.equal(data.metadata.keep, 'unchanged');
  assert.equal(version.getNestedValue(data, 'missing.version'), undefined);
});
