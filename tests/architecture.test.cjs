'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');

async function inspect(t, sources, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-architecture-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(directory, file);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, source);
  }
  const {checkArchitecture} = await import(pathToFileURL(path.resolve(__dirname, '../scripts/check-architecture.mjs')).href);
  return checkArchitecture(directory, options);
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

test('architecture catches a cycle introduced by importing the slice barrel from its implementation', async t => {
  const violations = await inspect(t, {
    'features/a/index.ts': 'export {run} from "./model/run"; export {value} from "./model/value";',
    'features/a/model/run.ts': 'import {value} from ".."; export const run = () => value;',
    'features/a/model/value.ts': 'export const value = 1;',
  });
  assert.match(violations.join('\n'), /Circular runtime dependency:.*index\.ts.*run\.ts.*index\.ts/);
});

test('architecture checks runtime edges in mixed type/value imports and exports', async t => {
  const violations = await inspect(t, {
    'features/a/index.ts': 'export {type Model, value} from "./model";',
    'features/a/model.ts': 'import {type Model as Alias, value as other} from "./index"; export interface Model {} export const value = other;',
  });
  assert.ok(violations.some(v => v.includes('Circular runtime dependency')));
});

test('architecture omits inline type-only edges from cycles but still checks their boundaries', async t => {
  const violations = await inspect(t, {
    'features/a/index.ts': 'export {type Model} from "./model";',
    'features/a/model.ts': 'import {type Model as Alias} from "./index"; import type {Other} from "../b"; export interface Model {}',
    'features/b/index.ts': 'export interface Other {}',
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /forbidden features\/a → features\/b/);
});

test('architecture checks literal lazy imports for private access and runtime cycles', async t => {
  const violations = await inspect(t, {
    'app/index.ts': 'import("../features/a/model/run");',
    'features/a/model/run.ts': 'export const run = () => import("./other");',
    'features/a/model/other.ts': 'import {run} from "./run";',
  });
  assert.ok(violations.some(v => v.includes('use public API')));
  assert.ok(violations.some(v => v.includes('Circular runtime dependency')));
});

test('architecture rejects CommonJS loads that would bypass the ESM graph', async t => {
  const violations = await inspect(t, {
    'features/a/index.ts': 'const first = require("../b"); const second = require(path); import third = require("../b");',
    'features/b/index.ts': 'export const value = 1;',
  });
  assert.equal(violations.filter(v => v.includes('CommonJS require')).length, 3);
});

test('architecture rejects source extensions not covered by the TypeScript configuration', async t => {
  const violations = await inspect(t, {
    'features/a/view.tsx': 'export const view = <div/>;',
    'features/a/module.mts': 'export const value = 1;',
    'features/a/module.cts': 'export const value = 1;',
  });
  assert.equal(violations.length, 3);
  assert.ok(violations.every(v => v.includes('TypeScript .ts')));
});

test('architecture permits Shared units to compose through public APIs but detects their cycles', async t => {
  const sources = {
    'shared/lib/a/index.ts': 'import {b} from "../b"; export const a = () => b;',
    'shared/lib/b/index.ts': 'export const b = 1;',
  };
  assert.deepEqual(await inspect(t, sources), []);
  sources['shared/lib/b/index.ts'] = 'import {a} from "../a"; export const b = a;';
  const violations = await inspect(t, sources);
  assert.ok(violations.some(v => v.includes('Circular runtime dependency')));
  assert.equal(violations.filter(v => v.includes('forbidden')).length, 0);
});

test('architecture rejects symlink files and directories instead of skipping their dependencies', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-architecture-links-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  await fs.mkdir(path.join(directory, 'shared/lib/text'), {recursive:true});
  await fs.mkdir(path.join(directory, 'features/a'), {recursive:true});
  await fs.writeFile(path.join(directory, 'shared/lib/text/index.ts'), 'export const text = "";');
  await fs.writeFile(path.join(directory, 'features/a/index.ts'), 'import "./linked"; import "./linked-directory";');
  await fs.symlink(path.join(directory, 'shared/lib/text/index.ts'), path.join(directory, 'features/a/linked.ts'), 'file');
  await fs.symlink(path.join(directory, 'shared/lib/text'), path.join(directory, 'features/a/linked-directory'), 'junction');
  const {checkArchitecture} = await import(pathToFileURL(path.resolve(__dirname, '../scripts/check-architecture.mjs')).href);
  const violations = checkArchitecture(directory);
  assert.equal(violations.filter(v => v.includes('must not use symlinks')).length, 2);
  assert.equal(violations.filter(v => v.includes('outside the checked source graph')).length, 2);
});

test('architecture rejects detached modules even when they reference each other', async t => {
  const violations = await inspect(t, {
    'app/index.ts': 'export {};',
    'features/old/index.ts': 'export {run} from "./run";',
    'features/old/run.ts': 'import "./index"; export const run = () => {};',
  }, {entryPoints: ['app/index.ts']});
  const detached = violations.filter(v => v.includes('not reachable'));
  assert.equal(detached.length, 2);
  assert.ok(detached.some(v => v.startsWith('features/old/index.ts:')));
  assert.ok(detached.some(v => v.startsWith('features/old/run.ts:')));
  assert.ok(violations.some(v => v.includes('Circular runtime dependency')));
});

test('architecture follows public APIs, lazy and type-only imports and ambient declarations for reachability', async t => {
  const violations = await inspect(t, {
    'app/index.ts': 'import("../features/example"); import type {Model} from "../entities/model";',
    'features/example/index.ts': 'export {run} from "./run";',
    'features/example/run.ts': 'export const run = () => {};',
    'entities/model/index.ts': 'export interface Model {}',
    'app/browser.d.ts': 'import type {Context} from "../shared/lib/context"; declare global { interface Window { context: Context; } }',
    'shared/lib/context/index.ts': 'export interface Context {}',
  }, {entryPoints: ['app/index.ts']});
  assert.deepEqual(violations, []);
});

test('architecture reports a missing build entry point', async t => {
  const violations = await inspect(t, {'app/index.ts': 'export {};'}, {
    entryPoints: ['app/index.ts', 'app/missing.ts'],
  });
  assert.deepEqual(violations, ['app/missing.ts: entry point is outside the checked source graph']);
});
