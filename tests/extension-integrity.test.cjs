'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var root = require('./helpers/extension.cjs').root;

test('all shipped JavaScript parses', function() {
  ['background.js', 'content.js', 'content_proxy.js', 'review-workflow.js', 'review-export.js', 'review-import.js', 'review-import-ui.js', 'review-copy.js', 'popup.js', 'welcome.js'].forEach(function(file) {
    assert.doesNotThrow(function() { new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }); });
  });
});

test('all seven locales have the same message keys', function() {
  var locales = ['en', 'ru', 'de', 'fr', 'es', 'ja', 'zh_CN'];
  var keys;
  locales.forEach(function(locale) {
    var messages = JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json')));
    var currentKeys = Object.keys(messages).sort();
    if (!keys) keys = currentKeys;
    assert.deepEqual(currentKeys, keys, 'Locale keys differ: ' + locale);
    currentKeys.forEach(function(key) { assert.equal(typeof messages[key].message, 'string', locale + '.' + key); });
  });
});

test('manifest references existing scripts, styles, popup and icons', function() {
  var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  var files = [manifest.background.service_worker, manifest.action.default_popup];
  manifest.content_scripts.forEach(function(entry) { files = files.concat(entry.js || [], entry.css || []); });
  Object.keys(manifest.icons).forEach(function(size) { files.push(manifest.icons[size]); });
  files.forEach(function(file) { assert.ok(fs.existsSync(path.join(root, file)), 'Missing extension resource: ' + file); });
});

test('website software version matches the extension manifest', function() {
  var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  var website = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  var structuredData = website.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(structuredData, 'Website must include software metadata');
  var metadata = JSON.parse(structuredData[1]);
  assert.equal(metadata['@type'], 'SoftwareApplication');
  assert.equal(metadata.softwareVersion, manifest.version);
});

test('both changelogs document the manifest release and share the same version history', function() {
  var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  var histories = ['CHANGELOG.md', 'CHANGELOG_RU.md'].map(function(file) {
    var changelog = fs.readFileSync(path.join(root, file), 'utf8');
    // Permit an Unreleased section during development; compare published releases.
    var releases = (changelog.match(/^## \d+\.\d+\.\d+(?:\.\d+)?\s*$/gm) || []).map(function(heading) {
      return heading.slice(3).trim();
    });
    assert.equal(releases[0], manifest.version, file + ' must document the current version first');
    return releases;
  });
  assert.deepEqual(histories[0], histories[1]);
});

test('locale substitutions and store descriptions remain valid in all seven languages', function() {
  var english = JSON.parse(fs.readFileSync(path.join(root, '_locales/en/messages.json')));
  ['en', 'ru', 'de', 'fr', 'es', 'ja', 'zh_CN'].forEach(function(locale) {
    var text = fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8');
    var messages = JSON.parse(text);
    var declared = Array.from(text.matchAll(/^  "([^"]+)":/gm), function(match) { return match[1]; });
    assert.equal(new Set(declared).size, declared.length, 'Duplicate locale keys: ' + locale);
    assert.ok(messages.extDescription.message.length <= 132, 'Store description too long: ' + locale);
    Object.keys(messages).forEach(function(key) {
      var placeholders = function(value) { return (value.match(/\$(?:\d+|[A-Za-z_]+\$)/g) || []).sort(); };
      assert.deepEqual(placeholders(messages[key].message), placeholders(english[key].message), 'Missing substitution: ' + locale + '.' + key);
      assert.deepEqual(Object.keys(messages[key].placeholders || {}).sort(), Object.keys(english[key].placeholders || {}).sort(), 'Placeholder definitions differ: ' + locale + '.' + key);
    });
  });
});
