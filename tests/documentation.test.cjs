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

test('homepage renders the current patch, unified 1.13 and older sectioned releases in both languages', function() {
  var html = read('index.html');
  var code = html.slice(html.indexOf('    function parseChangelog('), html.indexOf('    function loadChangelog('));
  ['en', 'ru'].forEach(function(lang) {
    var container = { innerHTML: '', children: [], appendChild: function(node) { this.children.push(node); } };
    var context = vm.createContext({ currentLang: lang, LANG: { en: {}, ru: {} }, document: {
      getElementById: function(id) { assert.equal(id, 'changelogContent'); return container; },
      createElement: function() { return { innerHTML: '', querySelector: function() { return { addEventListener: function() {} }; } }; }
    } });
    vm.runInContext(code, context);
    var markdown = read(lang === 'ru' ? 'CHANGELOG_RU.md' : 'CHANGELOG.md');
    var versions = context.parseChangelog(markdown);
    var currentVersion = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    assert.equal(versions[0].version, currentVersion);
    assert.equal(versions[0].sections.length, 1);
    assert.equal(versions[0].sections[0].title, '');
    var currentItems = versions[0].sections[0].items;
    assert.ok(currentItems.length > 0);
    assert.match(currentItems[0].bold, lang === 'ru' ? /Догрузка diff/ : /AI review diff recovery/);
    assert.ok(currentItems.some(function(item) { return (lang === 'ru' ? /Обмен настройками/ : /Share settings/).test(item.bold); }));
    assert.ok(currentItems.some(function(item) { return (lang === 'ru' ? /Настройки в отдельной вкладке/ : /Settings in a separate tab/).test(item.bold); }));
    var previousPatch = versions.find(function(release) { return release.version === '1.13.1'; });
    assert.equal(previousPatch.sections[0].items.length, 1);
    assert.match(previousPatch.sections[0].items[0].bold, lang === 'ru' ? /Быстрые действия Jira/i : /Jira quick actions/);
    var unifiedIndex = versions.findIndex(function(release) { return release.version === '1.13.0'; });
    assert.ok(unifiedIndex > 0);
    assert.equal(versions[unifiedIndex].sections[0].items.length, 9);
    assert.match(versions[unifiedIndex].sections[0].items[0].bold, lang === 'ru' ? /Ревью с ИИ/ : /AI-assisted review/);
    assert.ok(versions[unifiedIndex + 1].sections[0].title, 'older releases keep explicit section headings');
    context.renderChangelog(versions);
    assert.equal(container.children.length, versions.length);
    assert.equal((container.children[0].innerHTML.match(/class="changelog-item"/g) || []).length, currentItems.length);
    assert.doesNotMatch(container.children[0].innerHTML, /class="changelog-section-title/);
    assert.equal((container.children[unifiedIndex].innerHTML.match(/class="changelog-item"/g) || []).length, 9);
    assert.match(container.children[unifiedIndex + 1].innerHTML, /class="changelog-section-title/);
  });
});

test('changelog keeps plain and bold items before or after explicit sections without leaking between releases', function() {
  var html = read('index.html');
  var code = html.slice(html.indexOf('    function parseChangelog('), html.indexOf('    function renderChangelog('));
  var context = vm.createContext({}); vm.runInContext(code, context);
  var versions = context.parseChangelog('- Intro outside releases\n## 2.0.0\n- Plain item\n- **Feature** — Description\n### Fixes\n- **Fix** — Detail\n---\n## 1.0.0\n- Earlier item');
  assert.equal(versions.length, 2);
  assert.equal(versions[0].sections.length, 2);
  assert.equal(versions[0].sections[0].items[0].text, 'Plain item');
  assert.equal(versions[0].sections[0].items[1].bold, 'Feature');
  assert.equal(versions[0].sections[0].items[1].text, 'Description');
  assert.equal(versions[0].sections[1].title, 'Fixes');
  assert.equal(versions[0].sections[1].items.length, 1);
  assert.equal(versions[1].sections[0].items.length, 1);
  assert.equal(versions[1].sections[0].items[0].text, 'Earlier item');
});

test('homepage omits unreleased changes without leaking their items into published releases', function() {
  var html = read('index.html');
  var code = html.slice(html.indexOf('    function parseChangelog('), html.indexOf('    function renderChangelog('));
  var context = vm.createContext({}); vm.runInContext(code, context);
  var versions = context.parseChangelog('## Unreleased\n- **Upcoming** — New feature\n### Fixes\n- Pending fix\n## 1.0.0\n- Published change');
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, '1.0.0');
  assert.equal(versions[0].sections.length, 1);
  assert.equal(versions[0].sections[0].items.length, 1);
  assert.equal(versions[0].sections[0].items[0].text, 'Published change');
});
