'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');

async function inspect(t, sources) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-architecture-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(directory, file);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, source);
  }
  const {checkArchitecture} = await import(pathToFileURL(path.resolve(__dirname, '../scripts/check-architecture.mjs')).href);
  return checkArchitecture(directory);
}

test('architecture accepts downward public APIs and ignores cycles made only of type imports', async t => {
  const violations = await inspect(t, {
    'app/index.ts': 'import {run} from "../features/example";',
    'features/example/index.ts': 'export {run} from "./model/run";',
    'features/example/model/run.ts': 'import type {Other} from "./other"; export function run() {}',
    'features/example/model/other.ts': 'import type {run} from "./run"; export interface Other {}',
  });
  assert.deepEqual(violations, []);
});

test('architecture rejects upward and sibling-slice dependencies', async t => {
  const violations = await inspect(t, {
    'features/a/index.ts': 'import "../../widgets/view"; import "../b";',
    'features/b/index.ts': 'export const value = 1;',
    'widgets/view/index.ts': 'export const view = 1;',
  });
  assert.equal(violations.filter(v => v.includes('forbidden')).length, 2);
});

test('architecture rejects private imports into slices and Shared libraries', async t => {
  const violations = await inspect(t, {
    'app/index.ts': 'import "../features/a/model/private"; import "../shared/lib/text/private";',
    'features/a/model/private.ts': 'export const value = 1;',
    'shared/lib/text/private.ts': 'export const text = "";',
  });
  assert.equal(violations.filter(v => v.includes('use public API')).length, 2);
});

test('architecture detects real runtime cycles inside a slice', async t => {
  const violations = await inspect(t, {
    'features/a/model/a.ts': 'import "./b";',
    'features/a/model/b.ts': 'import "./a";',
  });
  assert.match(violations.join('\n'), /Circular runtime dependency:.*a\.ts.*b\.ts.*a\.ts/);
});

test('architecture forbids wildcard exports and checks import-type boundaries', async t => {
  const violations = await inspect(t, {
    'shared/lib/text/index.ts': 'export * from "./private"; type A = import("../../../features/a").A;',
    'shared/lib/text/private.ts': 'export const value = 1;',
    'features/a/index.ts': 'export interface A {}',
  });
  assert.ok(violations.some(v => v.includes('wildcard')));
  assert.ok(violations.some(v => v.includes('forbidden')));
});

test('architecture requires named timing policies instead of inline numbers or arithmetic', async t => {
  const violations = await inspect(t, {
    'app/index.ts': 'const DELAY_MS = 300; setTimeout(run, DELAY_MS); setTimeout(run, 300); scope.interval(run, 60 * 1000); sleep(1000); window.setTimeout(run, 300);',
  });
  assert.equal(violations.filter(v => v.includes('timer policy')).length, 4);
});

test('architecture allows only the packaged bootstrap as a computed import', async t => {
  const violations = await inspect(t, {
    'app/entrypoints/content_proxy.ts': 'void import(chrome.runtime.getURL("modules/content.js"));',
    'app/content/runtime.ts': 'void import(untrustedUrl);',
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /statically known local module/);
});

test('architecture rejects unbundled imports, JavaScript and blanket typing escapes', async t => {
  const violations = await inspect(t, {
    'app/index.ts': 'import "remote-library"; // @ts-ignore\nconst value: any = null;',
    'app/legacy.js': 'console.log("legacy");',
  });
  for (const expected of ['relative', 'TypeScript', 'suppression', 'explicit any'])
    assert.ok(violations.some(v => v.includes(expected)), expected);
});
