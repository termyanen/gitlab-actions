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

function jiraStandup({settings = {}, jira, count = 1} = {}) {
  const env = harness.background({settings:{jira_url:'https://jira.test/jira', standup_jira_enrich:true, ...settings}, jira, gitlab:req => {
    if(req.path==='/user')return {id:7, username:'alice'};
    if(req.path.includes('/events?'))return [];
    if(req.path.startsWith('/merge_requests?')&&req.path.includes('created_after'))return [{id:1,iid:1,title:Array.from({length:count},(_,i)=>'PROJ-'+(i+1)).join(' ')+' Work',created_at:'2026-11-06T12:00:00Z'}];
    if(req.path.startsWith('/projects/'))return {path_with_namespace:'team/repo'};
    return [];
  }});
  return {env, run:()=>env.finish(env.dispatch({type:'generate-standup',gitlabUrl:'https://gitlab.test',date:'2026-11-06'}))};
}

test('standup preserves the GitLab report with Jira failure metadata', async()=>{
  const {env,run}=jiraStandup({jira:()=>{throw new TypeError('offline');}});
  const result=await run();
  assert.match(result.text,/PROJ-1 Work/);
  assert.equal(result._error,undefined);
  assert.equal(result._jiraFailure._errorKind,'network');
  assert.equal(result._jiraUrl,'https://jira.test/jira');
  assert.equal(env.requests.filter(req=>req.url).length,1);
});

for(const settings of [{jira_url:''},{standup_jira_enrich:false}]) {
  test('standup does not contact Jira when enrichment is unavailable: '+JSON.stringify(settings),async()=>{
    const {env,run}=jiraStandup({settings,jira:()=>{throw new Error('must not fetch');}});
    const result=await run();
    assert.match(result.text,/PROJ-1 Work/);
    assert.equal(result._jiraFailure,undefined);
    assert.equal(result._jiraUrl,undefined);
    assert.equal(env.requests.filter(req=>req.url).length,0);
  });
}

test('standup stops additional Jira batches on auth failure while preserving concurrent successes',async()=>{
  const {env,run}=jiraStandup({count:12,jira:req=>req.url.includes('/PROJ-1?')?{fields:{summary:'Already loaded'}}:harness.response(401,{})});
  const result=await run();
  assert.match(result.text,/PROJ-12 Work/);
  assert.match(result.text,/\[PROJ-1: Already loaded\]/);
  assert.equal(result._jiraFailure._errorKind,'auth');
  assert.equal(env.requests.filter(req=>req.url).length,5);
});

test('standup permission denial preserves the report without making Jira requests',async()=>{
  const {env,run}=jiraStandup({count:8,jira:()=>{throw new Error('must not fetch');}});
  env.chrome.permissions={contains:async()=>false};
  const result=await run();
  assert.match(result.text,/PROJ-8 Work/);
  assert.equal(result._jiraFailure._errorKind,'permission');
  assert.equal(result._error,undefined);
  assert.equal(env.requests.filter(req=>req.url).length,0);
});

test('standup keeps later allowed Jira summaries after an issue-level 403',async()=>{
  const {env,run}=jiraStandup({count:8,jira:req=>req.url.includes('/PROJ-1?')?harness.response(403,{}):{fields:{summary:'Allowed'}}});
  const result=await run();
  assert.match(result.text,/\[PROJ-8: Allowed\]/);
  assert.equal(result._jiraFailure._errorKind,'forbidden');
  assert.equal(env.requests.filter(req=>req.url).length,8);
});
