'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/extension.cjs');
for (const mode of ['small', 'mr-limit', 'event-limit']) {
  test('standup discloses a possibly truncated selection: ' + mode, async () => {
    const env = harness.background({settings: {standup_jira_enrich:false}, gitlab: req => {
      if (req.path === '/user') return {id:7, username:'alice'};
      if (req.path.includes('/events?')) return mode === 'event-limit' ? Array.from({length:100}, (_, i) => ({project_id:37, action_name:'pushed to', target_type:'Project', created_at:'2026-11-06T12:00:00Z', target_iid:i})) : [];
      if (req.path.startsWith('/merge_requests?') && req.path.includes('created_after')) return Array.from({length:mode === 'mr-limit' ? 50 : 1}, (_, i) => ({id:i, iid:i+1, title:'Work '+i, created_at:'2026-11-06T12:00:00Z'}));
      if (req.path.startsWith('/projects/')) return {path_with_namespace:'team/repo'};
      return [];
    }});
    const result = await env.finish(new Promise(resolve => env.context.generateStandup({type:'generate-standup', gitlabUrl:'https://gitlab.test', date:'2026-11-06'}, {tab:{id:1}}, resolve)));
    assert.equal(result._error, undefined);
    assert.equal(result.text.includes('standupPartialWarning:50,500'), mode !== 'small');
    assert.match(result.text, /Work 0/);
    assert.ok(env.requests.filter(req => req.path.includes('/events?')).length <= 5);
  });
}
