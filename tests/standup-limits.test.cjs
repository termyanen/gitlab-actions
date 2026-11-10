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

function activityReport({events = [], created = [], merged = [], active = []} = {}) {
  const env = harness.background({settings:{standup_jira_enrich:false},gitlab:req=>{
    if(req.path==='/user')return {id:7,username:'alice'};
    if(req.path.includes('/events?'))return events;
    if(req.path.includes('created_after='))return created;
    if(req.path.includes('state=merged'))return merged;
    if(req.path.includes('state=opened'))return active;
    if(req.path.startsWith('/projects/'))return {path_with_namespace:'team/repo'};
    return [];
  }});
  return {env,run:date=>env.finish(env.dispatch({type:'generate-standup',gitlabUrl:'https://gitlab.test',date}))};
}

test('documented nullable push/wiki fields and unmerged MRs do not reject the entire day',async()=>{
  const base={project_id:37,created_at:'2026-11-06T12:00:00Z',target_iid:null,target_type:null,target_title:null};
  const {run}=activityReport({
    events:[
      {...base,action_name:'pushed',push_data:{ref:'main',ref_type:'branch',commit_count:2}},
      {...base,action_name:'pushed to',push_data:{ref:null,ref_type:'branch',commit_count:0}},
      {...base,action_name:'created',target_type:'WikiPage::Meta'},
      {...base,action_name:'commented on',note:{id:2,noteable_type:'Commit',noteable_iid:null}},
    ],
    created:[{id:1,iid:7,title:'Created work',created_at:base.created_at,merged_at:null,pipeline:null}],
  });
  const result=await run('2026-11-06');
  assert.equal(result._error,undefined);
  assert.match(result.text,/Created work/);
  assert.match(result.text,/main — 2 commits/);
  assert.doesNotMatch(result.text,/null|undefined/);
});

for(const zone of ['Europe/Samara','America/New_York'])test('daily report respects local midnight and DST: '+zone,async()=>{
  const previous=process.env.TZ;
  process.env.TZ=zone;
  try {
    const start=new Date('2026-11-01T00:00:00');
    const end=new Date('2026-11-02T00:00:00');
    const times=[new Date(+start-1),start,new Date(+end-1),end].map(d=>d.toISOString());
    const {env,run}=activityReport({
      events:times.map((created_at,i)=>({project_id:37,action_name:'pushed',target_iid:null,target_type:null,created_at,push_data:{ref:'branch-'+i,ref_type:'branch',commit_count:1}})),
      created:times.map((created_at,i)=>({id:i,iid:i+1,title:'work-'+i,created_at,merged_at:null})),
    });
    const result=await run('2026-11-01');
    assert.equal(result._error,undefined);
    for(const prefix of ['branch-','work-']){
      assert.ok(result.text.includes(prefix+'1'));assert.ok(result.text.includes(prefix+'2'));
      assert.ok(!result.text.includes(prefix+'0'));assert.ok(!result.text.includes(prefix+'3'));
    }
    const query=new URL(env.requests.find(r=>r.path.includes('created_after')).path,'https://gitlab.test').searchParams;
    assert.equal(query.get('created_after'),start.toISOString());
    assert.equal(query.get('created_before'),end.toISOString());
    const eventsQuery=new URL(env.requests.find(r=>r.path.includes('/events?')).path,'https://gitlab.test').searchParams;
    assert.ok(Date.parse(eventsQuery.get('after')) < +start);
    assert.ok(Date.parse(eventsQuery.get('before')) > +end);
  } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('malformed event identifiers remain rejected rather than silently hiding activity',async()=>{
  const {run}=activityReport({events:[{project_id:37,action_name:'approved',target_type:'MergeRequest',target_iid:'invalid'}]});
  assert.ok((await run('2026-11-06'))._error);
});

test('a later MR update does not hide a merge from its original day',async()=>{
  const {env,run}=activityReport({merged:[{id:1,iid:7,title:'Merged work',created_at:'2026-10-01T12:00:00Z',merged_at:'2026-11-06T12:00:00Z',updated_at:'2026-11-09T12:00:00Z'}]});
  const result=await run('2026-11-06');
  assert.match(result.text,/Merged work/);
  const query=new URL(env.requests.find(r=>r.path.includes('state=merged')).path,'https://gitlab.test').searchParams;
  assert.equal(query.has('updated_before'),false);
});

for (const [field, value, expected] of [
  ['project_id', 'secret-project-name', '[0].project_id'],
  ['push_data', {ref:'SECRET-BRANCH',ref_type:42}, '[0].push_data.ref_type'],
  ['note', {id:1,noteable_type:'MergeRequest',noteable_iid:'SECRET-NOTE'}, '[0].note.noteable_iid'],
]) test('standup reports the invalid event field without disclosing its value: '+field,async()=>{
  const {run}=activityReport({events:[{project_id:37,action_name:'pushed',target_iid:null,created_at:'2026-11-06T12:00:00Z',[field]:value}]});
  const result=await run('2026-11-06');
  assert.ok(result._error.startsWith('Invalid GitLab activity events response:'));
  assert.ok(result._error.includes(expected));
  assert.doesNotMatch(result._error,/SECRET|secret-project-name/);
  assert.equal(result.text,undefined);
});

test('standup distinguishes malformed MR responses from activity responses',async()=>{
  const {run}=activityReport({created:[{id:1,iid:1,title:'PRIVATE TITLE',pipeline:{status:42}}]});
  const result=await run('2026-11-06');
  assert.match(result._error,/Invalid GitLab merge requests response: \[0\].pipeline.status/);
  assert.doesNotMatch(result._error,/PRIVATE TITLE/);
  assert.equal(result.text,undefined);
});
