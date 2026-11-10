'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const { root } = require('./helpers/runtime.cjs');

test('production manifest resources exist and shipped scripts parse', () => {
  const dist = path.join(root, 'dist');
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json')));
  const scripts = new Set([manifest.background.service_worker]);
  const modules = new Set();
  const assets = [manifest.action.default_popup, ...Object.values(manifest.icons)];
  for (const entry of manifest.content_scripts) {
    for (const file of entry.js || []) scripts.add(file);
    assets.push(...entry.css || []);
  }
  for (const html of ['popup.html', 'quick-popup.html', 'welcome.html']) {
    const content = fs.readFileSync(path.join(dist, html), 'utf8');
    for (const match of content.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)) {
      scripts.add(match[1]);
      if (/\btype=["']module["']/.test(match[0])) modules.add(match[1]);
    }
  }
  for (const file of assets) assert.ok(fs.existsSync(path.join(dist, file)), file);
  for (const file of scripts) assert.doesNotThrow(() => {
    const source = fs.readFileSync(path.join(dist, file), 'utf8');
    if (modules.has(file)) transformSync(source, {loader:'js', format:'esm', target:'chrome'+manifest.minimum_chrome_version});
    else new vm.Script(source, {filename:file});
  });
  assert.equal(manifest.content_scripts.every((entry) => entry.run_at === 'document_idle'), true);
  assert.equal(manifest.content_scripts.some((entry) => entry.world === 'MAIN'), false);
});

test('build does not add host access or weaken the production CSP', () => {
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const actual = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json')));
  for (const key of ['permissions', 'host_permissions', 'optional_host_permissions', 'content_security_policy']) {
    assert.deepEqual(actual[key], expected[key], key);
  }
  const files = fs.readdirSync(path.join(root, 'dist'), { recursive: true });
  assert.equal(files.some((file) => /\.(?:map|ts|tsx)$/.test(file)), false);
  assert.equal(files.some((file) => /(^|\/)(node_modules|tests|src|scripts)(\/|$)/.test(file)), false);
});

test('packaged content CSS is addressed by its actual content and matches the source',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/manifest.json')));
  const styles=manifest.content_scripts.flatMap(entry=>entry.css||[]);
  const source=fs.readFileSync(path.join(root,'content.css'));
  const hash=require('node:crypto').createHash('sha256').update(source).digest('hex').slice(0,16);
  assert.deepEqual(styles,[`content-${hash}.css`]);
  assert.deepEqual(fs.readFileSync(path.join(root,'dist',styles[0])),source);
  assert.equal(fs.existsSync(path.join(root,'dist/content.css')),false);
});
