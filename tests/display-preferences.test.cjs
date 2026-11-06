'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bundleForTest } = require('./helpers/runtime.cjs');
const harness = require('./helpers/extension.cjs');
const context = vm.createContext({});
vm.runInContext(bundleForTest('src/entities/settings/index.ts', { globalName: 'Settings' }), context);
vm.runInContext(bundleForTest('src/widgets/mr-toolbar/model/sensitive-files.ts', { globalName: 'Sensitive' }), context);
const { DISPLAY_DEFAULTS, readDisplayPreferences, validDisplayPreferences } = context.Settings;

// Storage can contain invalid values even though UI/import validation rejects them.
for (const [key, value] of [
  ['failed_jobs_limit', 0], ['failed_jobs_limit', 21], ['failed_jobs_limit', 1.5],
  ['failed_job_trace_lines', Infinity], ['reviewer_notes_limit', '100'],
  ['mr_size_lines', '50, 20, 100'], ['mr_size_files', '1, 2'],
  ['sensitive_file_defaults', 'false'], ['sensitive_file_patterns', 'x'.repeat(1501)],
]) {
  test('unsafe stored preference falls back without discarding other values: ' + key + ' ' + String(value).slice(0, 25), () => {
    const candidate = { ...DISPLAY_DEFAULTS, sensitive_file_exclusions: '*.example', [key]: value };
    assert.equal(validDisplayPreferences(candidate), false);
    const normalized = readDisplayPreferences(candidate);
    assert.equal(normalized[key], DISPLAY_DEFAULTS[key]);
    assert.equal(normalized.sensitive_file_exclusions, '*.example');
  });
}

test('legacy storage retains previous thresholds, preview and reviewer defaults', () => {
  assert.deepEqual(harness.plain(readDisplayPreferences({})), {
    failed_jobs_limit: 5, failed_job_trace_lines: 50, reviewer_notes_limit: 10,
    mr_size_lines: '50, 200, 500', mr_size_files: '5, 15, 30',
    sensitive_file_defaults: true, sensitive_file_patterns: '', sensitive_file_exclusions: '',
  });
});

test('sensitive patterns preserve built-ins and allow replacements and exclusions', () => {
  const builtIn = context.Sensitive.createSensitiveFileMatcher(DISPLAY_DEFAULTS);
  for (const path of ['.env', 'app/.ENV.local', 'Dockerfile.prod', '.github/workflows/build.yml', 'auth/credentials/config.txt', 'secrets.toml', '.ssh/config', 'config/client.KEY']) assert.equal(builtIn(path), true, path);
  for (const path of ['src/index.ts', 'env.txt', 'app/secret.txt']) assert.equal(builtIn(path), false, path);
  const custom = context.Sensitive.createSensitiveFileMatcher({ ...DISPLAY_DEFAULTS,
    sensitive_file_defaults: false, sensitive_file_patterns: 'private/*.txt\n*.token\nconfig/key?.json\n[a-z].txt',
    sensitive_file_exclusions: 'private/public*\n*.example.token',
  });
  for (const path of ['private/nested/SECRET.txt', 'auth/access.token', 'config/key1.json', '[a-z].txt']) assert.equal(custom(path), true, path);
  for (const path of ['.env', 'private/public.txt', 'auth/demo.example.token', 'config/key12.json', 'a.txt']) assert.equal(custom(path), false, path);
});
