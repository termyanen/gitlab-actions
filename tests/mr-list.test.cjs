'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var mrList = require('./helpers/mr-list.cjs');
var harness = require('./helpers/extension.cjs');

function status(name) {
  return { name: name, categoryKey: 'indeterminate', type: 'Bug', typeIcon: 'bug.svg', priority: 'High', priorityIcon: 'high.svg' };
}

[false, true].forEach(function(legacy) {
  test('MR pagination replaces the list and reloads Jira statuses/details (' + (legacy ? 'legacy' : 'data-testid') + ')', async function() {
    var env = await mrList({ legacy: legacy });
    env.respond(0, { 'PROJ-1': status('In progress') });
    await env.drain();
    assert.deepEqual(env.badges(), [['PROJ-1', 'In progress']]);

    env.host.replaceChildren(env.list([env.row('PROJ-2 Second MR', 2)]));
    await env.drain();
    assert.equal(env.batches.length, 2);
    assert.deepEqual(env.batches[1].message.tickets, ['PROJ-2']);
    assert.equal(env.batches[1].message.showDetails, true);
    env.respond(1, { 'PROJ-2': status('In QA') });
    await env.drain();
    assert.deepEqual(env.badges(), [['PROJ-2', 'In QA']]);
    assert.deepEqual(env.document.querySelectorAll('.gl-jira-list-icon').map(function(icon) { return icon.src; }), ['bug.svg', 'high.svg']);
    assert.equal(env.document.querySelectorAll('.gl-jira-loader').length, 0);

    env.host.replaceChildren(env.list([env.row('PROJ-1 First MR', 1)]));
    await env.drain();
    assert.equal(env.batches.length, 2, 'returning to a cached page does not fetch again');
    assert.deepEqual(env.badges(), [['PROJ-1', 'In progress']]);
  });
});

test('rapid pagination during a Jira request fetches only the latest visible page next', async function() {
  var env = await mrList();
  var list = env.host.firstChild;
  list.replaceChildren(env.row('PROJ-2 Second MR', 2));
  await env.drain();
  list.replaceChildren(env.row('PROJ-3 Latest MR', 3));
  await env.drain();
  assert.equal(env.batches.length, 1, 'one batch is in flight');

  env.respond(0, { 'PROJ-1': status('Done') });
  await env.drain();
  assert.equal(env.batches.length, 2);
  assert.deepEqual(env.batches[1].message.tickets, ['PROJ-3']);
  env.respond(1, { 'PROJ-3': status('In QA') });
  await env.drain();
  assert.deepEqual(env.badges(), [['PROJ-3', 'In QA']]);
  assert.equal(env.batches.length, 2);
});

test('a list arriving after the initial loading window still loads Jira', async function() {
  var env = await mrList({ titles: [] });
  env.host.replaceChildren();
  await env.drain();
  env.host.appendChild(env.list([env.row('PROJ-2 Delayed MR', 2)]));
  await env.drain();
  assert.equal(env.batches.length, 1);
  assert.deepEqual(env.batches[0].message.tickets, ['PROJ-2']);
});

test('a reused MR row restores cached Jira badges after its title subtree is replaced', async function() {
  var env = await mrList();
  env.respond(0, { 'PROJ-1': status('In progress') });
  await env.drain();
  var row = env.host.firstChild.firstChild;
  var replacement = env.row('PROJ-1 First MR', 1);
  row.titleWrap.remove();
  row.appendChild(replacement.titleWrap);
  await env.drain();
  assert.deepEqual(env.badges(), [['PROJ-1', 'In progress']]);
  assert.equal(env.batches.length, 1);
});

test('editing title text on a reused row refreshes tickets and clears badges when no ticket remains', async function() {
  var env = await mrList();
  env.respond(0, { 'PROJ-1': status('In progress') });
  await env.drain();
  var title = env.host.firstChild.firstChild.titleLink;
  title.firstChild.textContent = 'PROJ-2 Updated title';
  await env.drain();
  assert.equal(env.batches.length, 2);
  env.respond(1, { 'PROJ-2': status('In QA') });
  await env.drain();
  assert.deepEqual(env.badges(), [['PROJ-2', 'In QA']]);
  title.textContent = 'Maintenance without a Jira ticket';
  await env.drain();
  assert.deepEqual(env.badges(), []);
});

test('partial Jira cache results render every ticket after the remaining response', async function() {
  var env = await mrList();
  env.respond(0, { 'PROJ-1': status('Done') });
  await env.drain();
  env.host.replaceChildren(env.list([env.row('PROJ-1 and PROJ-2 Combined', 2)]));
  await env.drain();
  assert.deepEqual(env.badges(), [['PROJ-1', 'Done']]);
  assert.deepEqual(env.batches[1].message.tickets, ['PROJ-2']);
  env.respond(1, { 'PROJ-2': status('In QA') });
  await env.drain();
  assert.deepEqual(env.badges(), [['PROJ-1', 'Done'], ['PROJ-2', 'In QA']]);
});

[{ statuses: {} }, { _error: 'Jira unavailable' }].forEach(function(response) {
  test('rendering loaders does not retry an empty or failed Jira response: ' + JSON.stringify(response), async function() {
    var env = await mrList();
    env.batches[0].respond(response);
    await env.drain();
    assert.equal(env.batches.length, 1);
    assert.equal(env.document.querySelectorAll('.gl-jira-loader').length, 0);
  });
});

test('a failed old-page request still drains a pending refresh for the new page', async function() {
  var env = await mrList();
  env.host.firstChild.replaceChildren(env.row('PROJ-2 New page', 2));
  await env.drain();
  env.batches[0].respond({ _error: 'Jira unavailable' });
  await env.drain();
  assert.equal(env.batches.length, 2);
  assert.deepEqual(env.batches[1].message.tickets, ['PROJ-2']);
});

test('Jira authentication failure stops pending pagination requests', async function() {
  var env = await mrList();
  env.host.replaceChildren(env.list([env.row('PROJ-2 New page', 2)]));
  await env.drain();
  env.respond(0, { _authError: 401 });
  await env.drain();
  assert.equal(env.batches.length, 1);
});

test('MR metadata and reviewer badges also resume after pagination during their requests', async function() {
  var responses = [];
  var env = await mrList({ settings: { jira_url: '', show_branches: true, show_reviewer_badge: true }, gitlab: function(req) {
    return new Promise(function(resolve) { responses.push({ path: req.path, resolve: resolve }); });
  } });
  assert.equal(responses.length, 2);
  env.host.firstChild.replaceChildren(env.row('PROJ-2 New page', 2));
  await env.drain();
  responses.slice().forEach(function(response) {
    response.resolve(response.path.includes('/notes?') ? [{ body: 'Reviewer: @alice' }] : { source_branch: 'old', target_branch: 'main' });
  });
  await env.drain();
  assert.equal(responses.length, 4);
  responses.slice(2).forEach(function(response) {
    assert.match(response.path, /\/merge_requests\/2(?:\?|\/)/);
    response.resolve(response.path.includes('/notes?') ? [{ body: 'Reviewer: @alice' }] : { source_branch: 'new', target_branch: 'main' });
  });
  await env.drain();
  assert.equal(env.document.querySelectorAll('.gl-reviewer-badge').length, 1);
  assert.deepEqual(env.document.querySelectorAll('.ref-name').map(function(el) { return el.textContent; }), ['new', 'main']);
});

test('unrelated DOM changes and unloading do not fetch another list page', async function() {
  var env = await mrList();
  env.respond(0, { 'PROJ-1': status('Done') });
  await env.drain();
  var unrelated = env.document.createElement('div');
  unrelated.textContent = 'Unrelated UI update';
  env.document.body.appendChild(unrelated);
  await env.drain();
  assert.equal(env.batches.length, 1);
  env.host.replaceChildren(env.list([env.row('PROJ-2 New page', 2)]));
  await harness.flush();
  env.listeners.beforeunload();
  await env.drain();
  assert.equal(env.batches.length, 1);
});
