'use strict';
var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
var root = require('./helpers/extension.cjs').root;
function read(file) { return fs.readFileSync(path.join(root, 'docs', file), 'utf8'); }

test('landing page translations cover all static UI keys and promote the review guide in both languages', function() {
  var html = read('index.html');
  Array.from(html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)).forEach(function(match) {
    if (match[0].includes('application/ld+json')) JSON.parse(match[1]);
    else assert.doesNotThrow(function() { new vm.Script(match[1]); });
  });
  var languages = html.slice(html.indexOf('var LANG ='), html.indexOf('var requestedLang ='));
  var context = vm.createContext({}); vm.runInContext(languages, context);
  assert.deepEqual(Object.keys(context.LANG.en).sort(), Object.keys(context.LANG.ru).sort());
  Array.from(html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)).forEach(function(match) {
    ['en', 'ru'].forEach(function(lang) { assert.ok(context.LANG[lang][match[1]], lang + '.' + match[1]); });
  });
  assert.match(html, /id="ai-review"/); assert.match(html, /data-guide-link/);
  assert.doesNotMatch(html, /No data leaves your browser|fonts\.googleapis|fonts\.gstatic|raw\.githubusercontent/);
});

test('guide and privacy pages have unique anchors, local assets and both complete language versions', function() {
  ['review-guide.html', 'privacy.html'].forEach(function(file) {
    var html = read(file);
    var ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), function(match) { return match[1]; });
    assert.equal(new Set(ids).size, ids.length, file + ': duplicate IDs');
    Array.from(html.matchAll(/href="#([^"]+)"/g)).forEach(function(match) { assert.ok(ids.includes(match[1]), file + ': broken anchor ' + match[1]); });
    Array.from(html.matchAll(/(?:src|href)="([^"#]+)"/g)).forEach(function(match) {
      var target = match[1]; if (/^https?:/.test(target)) return;
      assert.ok(fs.existsSync(path.join(root, 'docs', target)), file + ': missing local resource ' + target);
    });
    assert.match(html, /data-language="en"/); assert.match(html, /data-language="ru" hidden/);
    assert.doesNotMatch(html, /<(?:script|img)[^>]+src="https?:|<link[^>]+href="https?:[^>]+(?:stylesheet|preconnect)/);
  });
  var guide = read('review-guide.html');
  ['force push', 'Prepare replies', 'Подготовить ответы', 'Follow-up review', 'Повторное ревью', '10 коммитов', 'Several reviewers'].forEach(function(text) { assert.ok(guide.includes(text), text); });
  var privacy = read('privacy.html');
  ['chrome.storage.local', 'chrome.storage.sync', 'Duplicate-send protection', 'Защита от повторной отправки', 'clipboard', 'буфер'].forEach(function(text) { assert.ok(privacy.includes(text), text); });
  assert.equal(read('CHANGELOG.md'), fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  assert.equal(read('CHANGELOG_RU.md'), fs.readFileSync(path.join(root, 'CHANGELOG_RU.md'), 'utf8'));
});

test('guide language switching updates visibility, accessibility state and links repeatedly without network access', function() {
  function node(attrs) { return { attrs: Object.assign({}, attrs), hidden: false, events: {}, getAttribute: function(key) { return this.attrs[key]; }, setAttribute: function(key, value) { this.attrs[key] = value; }, addEventListener: function(key, fn) { this.events[key] = fn; }, set href(value) { this.attrs.href = value; } }; }
  var sections = [node({ 'data-language': 'en' }), node({ 'data-language': 'ru' })];
  var buttons = [node({ 'data-switch': 'en' }), node({ 'data-switch': 'ru' })];
  var links = [node({ href: './', 'data-en': 'Home', 'data-ru': 'Главная' }), node({ href: 'privacy.html', 'data-en': 'Privacy', 'data-ru': 'Приватность' })];
  var doc = { documentElement: {}, body: node({ 'data-title-en': 'Review', 'data-title-ru': 'Ревью' }), querySelectorAll: function(selector) {
    if (selector === '[data-language]') return sections;
    if (selector === '[data-switch]') return buttons;
    return links;
  } };
  var locations = [];
  var context = vm.createContext({ document: doc, URL: URL, URLSearchParams: URLSearchParams, location: new URL('https://example.test/review-guide.html?lang=ru'), navigator: { language: 'en-US' }, history: { replaceState: function(state, title, url) { locations.push(url.href); } }, fetch: function() { assert.fail('Documentation language switching must not send data'); } });
  vm.runInContext(read('guide.js'), context);
  assert.equal(doc.documentElement.lang, 'ru'); assert.equal(sections[0].hidden, true); assert.equal(sections[1].hidden, false);
  buttons[0].events.click(); assert.equal(doc.documentElement.lang, 'en'); assert.equal(buttons[0].attrs['aria-pressed'], 'true');
  assert.equal(links[1].attrs.href, 'privacy.html?lang=en');
  buttons[1].events.click(); assert.equal(links[1].attrs.href, 'privacy.html?lang=ru'); assert.equal(links[1].textContent, 'Приватность');
  assert.equal(locations.length, 2);
});
