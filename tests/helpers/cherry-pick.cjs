'use strict';

var vm = require('node:vm');
var assert = require('node:assert/strict');
var harness = require('./extension.cjs');

// A small control/row fixture, not a browser DOM or a GitLab selector test.
// It drives the original modal's click handlers and observes rendered outcomes.
function element() {
  var html = '';
  var el = { children: [], className: '', checked: false, disabled: false, dataset: {}, events: {} };
  Object.defineProperty(el, 'innerHTML', {
    get: function() { return html; },
    set: function(value) {
      html = value;
      el.children = [];
      var re = /<[a-z][^>]*\bclass="([^"]+)"[^>]*>/g;
      var match;
      while ((match = re.exec(value))) {
        var child = element();
        child.className = match[1];
        child.checked = /\schecked(?:\s|>)/.test(match[0]);
        var idx = match[0].match(/data-idx="(\d+)"/);
        if (idx) child.dataset.idx = idx[1];
        el.appendChild(child);
      }
    }
  });
  el.appendChild = function(child) { child.parentElement = el; el.children.push(child); return child; };
  el.querySelectorAll = function(selector) {
    assert.match(selector, /^\.[\w-]+$/);
    var found = [];
    el.children.forEach(function(child) {
      if (child.className.split(/\s+/).includes(selector.slice(1))) found.push(child);
      found = found.concat(child.querySelectorAll(selector));
    });
    return found;
  };
  el.querySelector = function(selector) { return el.querySelectorAll(selector)[0] || null; };
  el.addEventListener = function(name, fn) { el.events[name] = fn; };
  el.click = function() { return el.events.click({ target: el, preventDefault: function() {}, stopPropagation: function() {} }); };
  el.focus = function() {};
  el.remove = function() {
    if (el.parentElement) el.parentElement.children = el.parentElement.children.filter(function(child) { return child !== el; });
  };
  return el;
}

module.exports = function(options) {
  var env = harness.environment(options);
  var document = env.context.document;
  var query = document.querySelector;
  document.body = element();
  document.createElement = element;
  document.removeEventListener = function() {};
  document.querySelector = function(selector) {
    return selector === 'meta[name="csrf-token"]' ? query(selector) : document.body.querySelector(selector);
  };
  document.querySelectorAll = function(selector) { return document.body.querySelectorAll(selector); };
  var source = harness.readRuntime('content_proxy.js');
  var start = source.indexOf('        function openCherryPickModal(');
  var end = source.indexOf('        function showToast(', start);
  assert.ok(start > 0 && end > start, 'Original cherry-pick modal must be found');
  // The modal normally closes over the project path inside the settings callback.
  // Expose its unchanged function body in the test VM, retaining real API/parsers.
  var modalSource = source.slice(start, end).trim();
  var marker = 'if (!isGitLab()) return;';
  assert.ok(source.includes(marker));
  source = source.replace(marker, function() {
    return 'GITLAB_URL = window.location.origin; var encodedProject = "team%2Frepo";\n' +
      'function showToast() {}\n' +
      'globalThis.openCherryPickModal = ' + modalSource + '; return;';
  });
  vm.runInContext(source, env.context, { filename: 'content_proxy.js' });
  env.open = function(settings, sha) {
    env.context.openCherryPickModal(sha, 'Fix Unicode: исправление', settings);
    env.start = document.body.querySelector('.gl-cherry-pick-start');
    env.branchList = document.body.querySelector('.gl-cherry-pick-branches');
  };
  env.rows = function() {
    return env.branchList.children.map(function(row) { return { status: row.className.split('gl-cherry-pick-status-')[1], html: row.innerHTML }; });
  };
  env.settle = async function() {
    for (var i = 0; i < 100; i++) {
      await harness.flush();
      if (!env.start.disabled) return env.rows();
    }
    throw new Error('Cherry-pick did not finish');
  };
  env.run = function() { env.start.click(); return env.settle(); };
  return env;
};
