'use strict';

var vm = require('node:vm');
var assert = require('node:assert/strict');
var harness = require('./extension.cjs');

// Minimal tree fixture for list lifecycle tests. Mutation callbacks are delivered
// asynchronously and only for observed, attached subtrees, as in the browser.
function listDom() {
  var observers = [];
  function mutate(record) {
    observers.forEach(function(observer) {
      if (!observer.target || !observer.options[record.type]) return;
      if (record.type === 'attributes' && observer.options.attributeFilter &&
          !observer.options.attributeFilter.includes(record.attributeName)) return;
      if (record.target !== observer.target &&
          !(observer.options.subtree && observer.target.contains(record.target))) return;
      observer.records.push(record);
      if (observer.records.length !== 1) return;
      queueMicrotask(function() {
        var records = observer.records.splice(0);
        if (records.length) observer.callback(records);
      });
    });
  }

  function textNode(value) {
    var node = { nodeType: 3, parentNode: null };
    Object.defineProperty(node, 'textContent', {
      get: function() { return value; },
      set: function(next) { value = next; mutate({ type: 'characterData', target: node }); }
    });
    Object.defineProperty(node, 'parentElement', { get: function() { return node.parentNode; } });
    return node;
  }

  function element(tag) {
    var el = { nodeType: 1, tagName: tag.toUpperCase(), className: '', dataset: {}, style: {}, childNodes: [], parentNode: null, events: {}, attributes: {} };
    Object.defineProperties(el, {
      children: { get: function() { return el.childNodes.filter(function(node) { return node.nodeType === 1; }); } },
      parentElement: { get: function() { return el.parentNode; } },
      firstChild: { get: function() { return el.childNodes[0] || null; } },
      nextSibling: { get: function() { return el.parentNode ? el.parentNode.childNodes[el.parentNode.childNodes.indexOf(el) + 1] || null : null; } },
      isConnected: { get: function() { return body.contains(el); } },
      textContent: {
        get: function() { return el.childNodes.map(function(node) { return node.textContent; }).join(''); },
        set: function(value) { el.replaceChildren(textNode(String(value))); }
      },
      innerHTML: { set: function(value) { el.textContent = value; } },
      href: {
        get: function() { return el.attributes.href || ''; },
        set: function(value) { el.setAttribute('href', value); }
      }
    });
    el.contains = function(node) {
      for (; node; node = node.parentNode) { if (node === el) return true; }
      return false;
    };
    el.matches = function(selectors) {
      return selectors.split(',').some(function(selector) {
        selector = selector.trim();
        var relation = selector.match(/^(.*?)\s+(>\s+)?([^\s]+)$/);
        if (relation) {
          if (!el.matches(relation[3])) return false;
          return !!el.parentNode && (relation[2] ? el.parentNode.matches(relation[1]) : !!el.parentNode.closest(relation[1]));
        }
        var attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attr) return attr[2] === undefined ? el.getAttribute(attr[1]) !== null : el.getAttribute(attr[1]) === attr[2];
        var parts = selector.split('.');
        return (!parts[0] || parts[0].toUpperCase() === el.tagName) &&
          parts.slice(1).every(function(cls) { return el.className.split(/\s+/).includes(cls); });
      });
    };
    el.closest = function(selector) {
      for (var node = el; node; node = node.parentNode) { if (node.matches(selector)) return node; }
      return null;
    };
    el.querySelectorAll = function(selector) {
      var found = [];
      el.children.forEach(function(child) {
        if (child.matches(selector)) found.push(child);
        found = found.concat(child.querySelectorAll(selector));
      });
      return found;
    };
    el.querySelector = function(selector) { return el.querySelectorAll(selector)[0] || null; };
    el.setAttribute = function(name, value) {
      el.attributes[name] = value;
      mutate({ type: 'attributes', target: el, attributeName: name });
    };
    el.getAttribute = function(name) { return Object.hasOwn(el.attributes, name) ? el.attributes[name] : null; };
    el.insertBefore = function(child, before) {
      if (child.parentNode) child.remove();
      var index = before ? el.childNodes.indexOf(before) : el.childNodes.length;
      assert.ok(index >= 0, 'insertBefore reference belongs to the parent');
      el.childNodes.splice(index, 0, child);
      child.parentNode = el;
      mutate({ type: 'childList', target: el, addedNodes: [child], removedNodes: [] });
      return child;
    };
    el.appendChild = function(child) { return el.insertBefore(child, null); };
    el.replaceChildren = function() {
      var removed = el.childNodes;
      removed.forEach(function(child) { child.parentNode = null; });
      el.childNodes = Array.from(arguments);
      el.childNodes.forEach(function(child) { child.parentNode = el; });
      mutate({ type: 'childList', target: el, addedNodes: el.childNodes, removedNodes: removed });
    };
    el.remove = function() {
      if (!el.parentNode) return;
      var parent = el.parentNode;
      parent.childNodes.splice(parent.childNodes.indexOf(el), 1);
      el.parentNode = null;
      mutate({ type: 'childList', target: parent, addedNodes: [], removedNodes: [el] });
    };
    el.addEventListener = function(name, fn) { el.events[name] = fn; };
    el.classList = { add: function(cls) { el.className += ' ' + cls; } };
    return el;
  }

  function MutationObserver(callback) {
    this.callback = callback;
    this.records = [];
    observers.push(this);
  }
  MutationObserver.prototype.observe = function(target, options) { this.target = target; this.options = options; };
  MutationObserver.prototype.disconnect = function() { this.target = null; this.records = []; };

  var body = element('body');
  return { body: body, element: element, MutationObserver: MutationObserver };
}

module.exports = async function(options) {
  options = options || {};
  var env = harness.environment(Object.assign({}, options, {
    settings: Object.assign({ jira_url: 'https://jira.test', show_jira_details: true, show_branches: false }, options.settings)
  }));
  var dom = listDom();
  var document = env.context.document;
  var originalQuery = document.querySelector;
  document.body = dom.body;
  document.createElement = dom.element;
  document.querySelector = function(selector) {
    if (selector === 'meta[content="GitLab"]') return {};
    return originalQuery(selector) || dom.body.querySelector(selector);
  };
  document.querySelectorAll = function(selector) { return dom.body.querySelectorAll(selector); };
  env.context.MutationObserver = dom.MutationObserver;
  env.context.window.location = { origin: 'https://gitlab.test', pathname: '/team/repo/-/merge_requests', search: '', href: 'https://gitlab.test/team/repo/-/merge_requests' };
  env.context.window.addEventListener = function(name, callback) { env.listeners[name] = callback; };
  env.chrome.storage.local = {
    get: function(key, callback) { var data = {}; data[key] = 'alice'; callback(data); }
  };
  env.batches = [];
  env.chrome.runtime.sendMessage = function(message, callback) {
    if (message.type === 'fetch-jira-statuses') env.batches.push({ message: harness.plain(message), respond: callback });
    else if (callback) callback([]);
  };
  env.row = function(title, iid) {
    var row = dom.element('li');
    var wrap = dom.element('span');
    var link = dom.element('a');
    if (options.legacy) {
      row.className = 'issue';
      wrap.className = 'issue-title-text';
    } else {
      row.setAttribute('data-testid', 'issuable-item-wrapper');
      wrap.setAttribute('data-testid', 'issuable-title');
      link.setAttribute('data-testid', 'issuable-title-link');
    }
    link.textContent = title;
    link.href = 'https://gitlab.test/team/repo/-/merge_requests/' + iid;
    wrap.appendChild(link);
    row.appendChild(wrap);
    var info = dom.element('div');
    info.className = 'issuable-info';
    row.appendChild(info);
    row.titleLink = link;
    row.titleWrap = wrap;
    return row;
  };
  env.list = function(rows) {
    var list = dom.element('ul');
    if (options.legacy) list.className = 'issuable-list';
    else list.setAttribute('data-testid', 'issuable-list');
    rows.forEach(function(row) { list.appendChild(row); });
    return list;
  };
  env.host = dom.element('main');
  dom.body.appendChild(env.host);
  env.host.appendChild(env.list((options.titles || ['PROJ-1 First MR']).map(function(title, i) { return env.row(title, i + 1); })));
  env.document = document;
  env.drain = async function() {
    for (var i = 0; i < 30; i++) { if (!await env.clock.next()) return; }
    throw new Error('List refresh did not settle within 30 timers');
  };
  env.respond = function(index, statuses) { env.batches[index].respond({ statuses: statuses }); };
  env.badges = function() {
    return document.querySelectorAll('.gl-jira-badge').map(function(badge) { return [badge.dataset.jiraTicket, badge.textContent]; });
  };

  // Run the real list initializer, selectors, fetch/cache and render functions.
  // Skip unrelated features below it; no production test hooks are introduced.
  var source = harness.readRuntime('content_proxy.js');
  var end = source.indexOf('  // MR detail page: Jira badges in title');
  assert.ok(end > 0, 'MR list initializer must precede the detail-page section');
  vm.runInContext(source.slice(0, end) + '\n})();', env.context, { filename: 'content_proxy.js' });
  await harness.flush();
  return env;
};
