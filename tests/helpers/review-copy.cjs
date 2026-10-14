'use strict';

var vm = require('node:vm');
var assert = require('node:assert/strict');
var harness = require('./extension.cjs');
var messages = require('../../_locales/en/messages.json');

// This fixture implements only the tree, form controls and events used by the
// copy picker. The shipped initializer and every click handler run unchanged.
function dom() {
  var observers = [];
  var document;
  function mutate(record) {
    observers.forEach(function(observer) {
      if (!observer.target || !observer.options[record.type] || !observer.target.contains(record.target)) return;
      if (record.type === 'attributes' && observer.options.attributeFilter && !observer.options.attributeFilter.includes(record.attributeName)) return;
      observer.records.push(record);
      if (observer.records.length !== 1) return;
      queueMicrotask(function() {
        var records = observer.records.splice(0);
        if (records.length) observer.callback(records);
      });
    });
  }
  function element(tag) {
    var text = '';
    var el = { tagName: tag.toUpperCase(), children: [], parentElement: null, attributes: {}, events: {}, value: '', checked: false, disabled: false, hidden: false, style: {} };
    Object.defineProperties(el, {
      className: { get: function() { return el.attributes.class || ''; }, set: function(value) { el.attributes.class = String(value); } },
      id: { get: function() { return el.attributes.id || ''; }, set: function(value) { el.setAttribute('id', value); } },
      isConnected: { get: function() { return !!document && document.body.contains(el); } },
      textContent: { get: function() { return text + el.children.map(function(child) { return child.textContent; }).join(''); }, set: function(value) { el.replaceChildren(); text = String(value); } }
    });
    el.dataset = new Proxy({}, {
      get: function(_, key) { return el.getAttribute('data-' + key.replace(/[A-Z]/g, function(ch) { return '-' + ch.toLowerCase(); })); },
      set: function(_, key, value) { el.setAttribute('data-' + key.replace(/[A-Z]/g, function(ch) { return '-' + ch.toLowerCase(); }), String(value)); return true; }
    });
    el.classList = {
      add: function(cls) { if (!el.className.split(/\s+/).includes(cls)) el.className += ' ' + cls; },
      remove: function(cls) { el.className = el.className.split(/\s+/).filter(function(item) { return item !== cls; }).join(' '); },
      toggle: function(cls, yes) { if (yes) this.add(cls); else this.remove(cls); }
    };
    el.setAttribute = function(name, value) { el.attributes[name] = String(value); mutate({ type: 'attributes', target: el, attributeName: name }); };
    el.getAttribute = function(name) { return Object.hasOwn(el.attributes, name) ? el.attributes[name] : null; };
    el.contains = function(child) { for (; child; child = child.parentElement) if (child === el) return true; return false; };
    el.matches = function(selectors) {
      return selectors.split(',').some(function(selector) {
        selector = selector.trim();
        var not = selector.match(/:not\(([^)]+)\)/);
        if (not) { if (el.matches(not[1])) return false; selector = selector.replace(not[0], ''); }
        var attrs = Array.from(selector.matchAll(/\[([^\]^=]+)(\^?=)?(?:"([^"]*)")?\]/g));
        if (!attrs.every(function(match) {
          var value = el.getAttribute(match[1]);
          return match[2] === '^=' ? value !== null && value.startsWith(match[3]) : match[2] === '=' ? value === match[3] : value !== null;
        })) return false;
        selector = selector.replace(/\[[^\]]+\]/g, '');
        var id = selector.match(/#([\w-]+)/);
        if (id && el.id !== id[1]) return false;
        selector = selector.replace(/#[\w-]+/, '');
        var parts = selector.split('.');
        return (!parts[0] || parts[0].toUpperCase() === el.tagName) && parts.slice(1).every(function(cls) { return el.className.split(/\s+/).includes(cls); });
      });
    };
    el.closest = function(selector) { for (var node = el; node; node = node.parentElement) if (node.matches(selector)) return node; return null; };
    el.querySelectorAll = function(selector) {
      return el.children.flatMap(function(child) { return (child.matches(selector) ? [child] : []).concat(child.querySelectorAll(selector)); });
    };
    el.querySelector = function(selector) { return el.querySelectorAll(selector)[0] || null; };
    el.appendChild = function(child) {
      if (child.parentElement) child.remove();
      el.children.push(child); child.parentElement = el;
      if (el.tagName === 'SELECT' && el.children.length === 1) el.value = child.value;
      mutate({ type: 'childList', target: el });
      return child;
    };
    el.insertBefore = function(child, reference) {
      if (!reference) return el.appendChild(child);
      if (!el.children.includes(reference)) throw new Error('Reference is not a child');
      if (child === reference) return child;
      if (child.parentElement) child.remove();
      el.children.splice(el.children.indexOf(reference), 0, child);
      child.parentElement = el;
      mutate({ type: 'childList', target: el });
      return child;
    };
    el.replaceChildren = function() {
      text = '';
      el.children.forEach(function(child) { child.parentElement = null; });
      el.children = Array.from(arguments);
      el.children.forEach(function(child) { child.parentElement = el; });
      mutate({ type: 'childList', target: el });
    };
    el.remove = function() {
      var parent = el.parentElement;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(el), 1); el.parentElement = null;
      mutate({ type: 'childList', target: parent });
    };
    el.addEventListener = function(type, fn) { (el.events[type] || (el.events[type] = [])).push(fn); };
    el.removeEventListener = function(type, fn) { el.events[type] = (el.events[type] || []).filter(function(item) { return item !== fn; }); };
    el.dispatch = function(type, props) {
      var stopped = false;
      var event = Object.assign({ target: el, preventDefault: function() {}, stopPropagation: function() { stopped = true; }, stopImmediatePropagation: function() { stopped = true; } }, props);
      for (var node = el; node; node = node.parentElement) {
        (node.events[type] || []).forEach(function(fn) { fn(event); });
        if (stopped) break;
      }
    };
    el.click = function() { if (!el.disabled) el.dispatch('click'); };
    el.focus = function() { document.activeElement = el; };
    el.select = function() { el.selectionStart = 0; el.selectionEnd = el.value.length; };
    el.getClientRects = function() { return el.isConnected && !el.hidden ? [{}] : []; };
    return el;
  }
  document = element('document');
  document.body = element('body');
  document.body.setAttribute('data-page', 'projects:merge_requests:show');
  document.appendChild(document.body);
  document.createElement = element;
  document.getElementById = function(id) { return document.querySelector('#' + id); };
  function MutationObserver(callback) { this.callback = callback; this.records = []; observers.push(this); }
  MutationObserver.prototype.observe = function(target, options) { this.target = target; this.options = options; };
  return { document: document, MutationObserver: MutationObserver };
}

function deferred() {
  var result = {};
  result.promise = new Promise(function(resolve, reject) { result.resolve = resolve; result.reject = reject; });
  return result;
}

async function create(options) {
  options = options || {};
  var tree = dom();
  var document = tree.document;
  var env = { document: document, loads: [], exports: [], freshExports: [], clipboard: [], clipboardRequests: [], manualCopies: [], timers: new Map(), intervals: [], windowEvents: {}, settingsEvents: [], settings: Object.assign({}, options.settings), settingsWrites: [] };
  var runtime = { getURL: function(path) { return path; } };
  var storage = {
    sync: {
      get: function(defaults, cb) { cb(Object.assign({}, defaults, env.settings)); },
      set: function(values, cb) {
        env.settingsWrites.push(harness.plain(values));
        if (options.storageFailure) {
          runtime.lastError = { message: 'Settings could not be saved' };
          if (cb) cb();
          delete runtime.lastError;
          return;
        }
        var changes = {};
        Object.keys(values).forEach(function(key) {
          if (env.settings[key] !== values[key]) changes[key] = { oldValue: env.settings[key], newValue: values[key] };
          env.settings[key] = values[key];
        });
        if (Object.keys(changes).length) env.settingsEvents.forEach(function(fn) { fn(changes, 'sync'); });
        if (cb) cb();
      }
    },
    onChanged: { addListener: function(fn) { env.settingsEvents.push(fn); } }
  };
  var timerId = 0;
  env.context = vm.createContext({
    window: { location: { origin: 'https://gitlab.test', pathname: options.pathname || '/team/repo/-/merge_requests/12' }, GlReviewImportUI: options.importUI, addEventListener: function(type, fn) { env.windowEvents[type] = fn; } },
    document: document, MutationObserver: tree.MutationObserver, AbortController: AbortController, URL: URL,
    setTimeout: function(fn) { env.timers.set(++timerId, fn); return timerId; }, clearTimeout: function(id) { env.timers.delete(id); },
    setInterval: function(fn) { env.intervals.push(fn); },
    navigator: { clipboard: { writeText: function(text) {
      env.clipboard.push(text);
      if (options.deferredClipboard) { var request = deferred(); env.clipboardRequests.push(request); return request.promise; }
      return options.clipboardFailure ? Promise.reject(new Error('Permission denied')) : Promise.resolve();
    } } },
    chrome: { runtime: runtime, i18n: { getMessage: function(key, substitutions) { return (messages[key] && messages[key].message || key).replace(/\$(\d+)/g, function(_, n) { return substitutions[n - 1]; }); } }, storage: storage },
    fetch: function(url, init) {
      if (options.fetch) return options.fetch(url, init);
      throw new Error('Unexpected network request: ' + url);
    }
  });
  document.execCommand = function(command) { env.manualCopies.push({ command: command, value: document.activeElement.value }); return !!options.manualCopySuccess; };
  vm.runInContext(harness.readRuntime('review-export.js'), env.context, { filename: 'review-export.js' });
  var api = env.context.window.GlReviewExport;
  env.api = api;
  var load = api.load;
  var prepare = api.prepareExport;
  var prepareFresh = api.prepareFreshReview;
  api.load = function(context, opts) {
    var request = deferred(); Object.assign(request, { context: context, options: opts }); env.loads.push(request);
    return options.realLoad ? load(context, opts) : request.promise;
  };
  api.prepareExport = function(snapshot, opts) {
    var request = { snapshot: snapshot, options: opts };
    env.exports.push(request);
    if (options.deferredExports) { Object.assign(request, deferred()); return request.promise; }
    return prepare(snapshot, opts);
  };
  api.prepareFreshReview = function(context, opts) {
    var request = { context: context, options: opts };
    env.freshExports.push(request);
    if (options.deferredFreshExports) { Object.assign(request, deferred()); return request.promise; }
    if (options.realFresh) return prepareFresh(context, opts);
    return Promise.resolve({ text: opts.prompt + '\n\nFresh review of ' + context.webUrl, warnings: [] });
  };
  env.addNote = function(id, variant, parent) {
    var root = document.createElement('article');
    if (variant === 'legacy') root.id = 'note-' + id;
    else root.id = 'note_' + id;
    var header = document.createElement('div');
    if (variant === 'modern') header.setAttribute('data-testid', 'note-header'); else header.className = 'note-header';
    root.appendChild(header);
    (parent || document.body).appendChild(root);
    return root;
  };
  env.drain = async function() {
    for (var i = 0; i < 30; i++) {
      await harness.flush();
      if (!env.timers.size) return;
      var callbacks = Array.from(env.timers.values()); env.timers.clear(); callbacks.forEach(function(fn) { fn(); });
    }
    throw new Error('Review UI did not settle');
  };
  env.button = function(key, scope) {
    var button = (scope || document).querySelectorAll('button').find(function(el) { var label = el.getAttribute('aria-label') || el.textContent; return label === messages[key].message || (['aiReviewRepeat', 'aiReviewImportCopyReplyPrompt'].includes(key) && label.startsWith(messages[key].message + ' · ')); });
    assert.ok(button, 'Button exists: ' + key); return button;
  };
  env.click = async function(key, scope) { env.button(key, scope).click(); await env.drain(); };
  env.change = async function(el, value, type) { if (typeof value === 'boolean') el.checked = value; else el.value = value; el.dispatch(type || 'change'); await env.drain(); };
  env.snapshot = function(discussions) { return { context: api.parsePage(env.context.window.location), entity: { title: 'Fix review handling', description: 'Expected behavior', source_branch: 'feature', target_branch: 'main' }, discussions: discussions, warnings: [], complete: true }; };
  env.respond = async function(discussions, index) { env.loads[index === undefined ? env.loads.length - 1 : index].resolve(env.snapshot(discussions)); await env.drain(); };
  env.selected = function() { return document.querySelectorAll('[data-review-note]').filter(function(el) { return el.checked; }).map(function(el) { return el.dataset.reviewNote; }); };
  env.navigate = async function(pathname) { env.context.window.location.pathname = pathname; env.windowEvents.popstate(); await env.drain(); };
  if (options.pageScript) {
    var script = document.createElement('script');
    script.textContent = options.pageScript;
    document.body.appendChild(script);
  }
  vm.runInContext(harness.readRuntime('review-copy.js'), env.context, { filename: 'review-copy.js' });
  await env.drain();
  return env;
}

module.exports = { create: create, deferred: deferred };
