const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {bundleForTest} = require('./helpers/runtime.cjs');
const {settingsController,plain,t} = require('./helpers/settings-controller.cjs');
const context = vm.createContext({TextEncoder,URL,structuredClone,crypto:require('node:crypto').webcrypto});
for(const [name,entry] of [['Config','src/features/manage-settings/index.ts'],['Draft','src/pages/settings/model/draft.ts'],['Scoped','src/shared/api/project-settings/index.ts'],['Policy','src/shared/config/project-settings/index.ts']]) vm.runInContext(bundleForTest(entry,{globalName:name}),context);
const {Config,Draft,Scoped,Policy}=context;
const data=(values={})=>({...structuredClone(Config.DEFAULTS),...values});
const encode=settings=>JSON.stringify({format:'gitlab-mr-actions-settings',formatVersion:1,settings});

test('all project settings are declared defaults and global preferences cannot enter profile overrides',()=>{
  for(const key of Policy.PROJECT_SETTING_KEYS)assert.ok(Object.hasOwn(Config.DEFAULTS,key),key);
  for(const key of ['language','sound_enabled','notifications_enabled','standup_jira_enrich','ai_review_fresh_existing','projectProfiles','unknown']) {
    assert.throws(()=>Config.createSettingsValidation(t).parseSettingsFile(encode({projectProfiles:{'team/repo':{overrides:{[key]:Config.DEFAULTS[key]??true}}}})));
  }
});

test('project overlays preserve false, empty strings and empty lists, and never mutate global settings',()=>{
  const saved={...data({quickComments:[{label:'Global',text:'Global'}],jira_url:'https://jira.global.test',show_cherry_pick:true}),projectProfiles:{}};
  const profiles={'team/repo':{overrides:{quickComments:[],jira_url:'',show_cherry_pick:false,language:'ru'}}};
  const merged=Scoped.applyProjectSettings(saved,profiles,'team/repo');
  assert.equal(merged.show_cherry_pick,false);
  assert.equal(merged.jira_url,'');
  assert.deepEqual(plain(merged.quickComments),[]);
  assert.equal(merged.language,saved.language);
  assert.equal(saved.show_cherry_pick,true);
  assert.deepEqual(plain(Scoped.applyProjectSettings(saved,profiles,'team/other')),plain(saved));
  assert.deepEqual(plain(Scoped.applyProjectSettings(saved,profiles,null)),plain(saved));
});

test('editing one project preference preserves legacy profiles and stores only that override',()=>{
  const legacy={buttons:{btn_version:false},customJobs:[],mrActions:[],versionFile:'VERSION',reviewersJob:'',cherry_pick_branches:['release']};
  const saved=data({show_cherry_pick:true,projectProfiles:{'team/repo':legacy,'team/other':{versionFile:'other.json'}}});
  let draft=Draft.createDraft(saved,'team/repo');
  assert.deepEqual(plain(Draft.serializeDraft(draft,saved,'team/repo',t).projectProfiles),plain(saved.projectProfiles));
  draft=Draft.markProjectChanges(draft,{...draft,fields:{...draft.fields,show_cherry_pick:false}});
  const patch=plain(Draft.serializeDraft(draft,saved,'team/repo',t));
  assert.deepEqual(patch.projectProfiles['team/repo'],{...legacy,overrides:{show_cherry_pick:false}});
  assert.deepEqual(patch.projectProfiles['team/other'],{versionFile:'other.json'});
  assert.equal(patch.show_cherry_pick,undefined);
  const restored=Draft.inheritProjectSetting(draft,'show_cherry_pick');
  assert.equal(restored.fields.show_cherry_pick,true);
  assert.deepEqual(plain(Draft.serializeDraft(restored,saved,'team/repo',t).projectProfiles),plain(saved.projectProfiles));
});

test('project prompt, filters, Jira actions and quick comments round trip and reset independently',()=>{
  const saved=data({projectProfiles:{'team/repo':{}}});
  let draft=Draft.createDraft(saved,'team/repo');
  const next={...draft,fields:{...draft.fields,ai_review_prompt:'Project only prompt',ai_review_filter_ignoreDirs:'vendor',jira_url:'https://jira.project.test'},comments:[{label:'Project',text:'Project comment'}],jiraActions:[]};
  draft=Draft.markProjectChanges(draft,next);
  let patch=plain(Draft.serializeDraft(draft,saved,'team/repo',t));
  assert.deepEqual(Object.keys(patch.projectProfiles['team/repo'].overrides).sort(),['ai_review_file_filter','ai_review_prompt','jira_url','quickComments']);
  const imported=Config.createSettingsValidation(t).parseSettingsFile(encode({...saved,...patch}));
  let reloaded=Draft.createDraft(imported,'team/repo');
  assert.equal(reloaded.fields.ai_review_prompt,'Project only prompt');
  assert.equal(reloaded.fields.ai_review_filter_ignoreDirs,'vendor');
  reloaded=Draft.inheritProjectSetting(reloaded,'ai_review_file_filter');
  patch=plain(Draft.serializeDraft(reloaded,imported,'team/repo',t));
  assert.equal(patch.projectProfiles['team/repo'].overrides.ai_review_file_filter,undefined);
  assert.equal(patch.projectProfiles['team/repo'].overrides.ai_review_prompt,'Project only prompt');
});

test('invalid nested settings are rejected before import, including policies and Jira URLs',()=>{
  for(const overrides of [{failed_jobs_limit:0},{jira_url:'http://jira.test'},{quickComments:[{label:1,text:'x'}]},{jira_ticket_regex:'['},{ai_review_file_filter:'bad'},{ai_review_rule_unknown:{enabled:true,text:''}}]) {
    assert.throws(()=>Config.createSettingsValidation(t).parseSettingsFile(encode({projectProfiles:{'team/repo':{overrides}}})));
  }
});

test('imports reject incomplete editable rows before they can break subsequent saves',()=>{
  const parse=Config.createSettingsValidation(t).parseSettingsFile;
  for(const [key,rows] of [
    ['customJobs',[{}, {label:'Deploy'}, {jobName:'deploy'}]],
    ['quickComments',[{}, {label:'Comment'}, {text:'Comment'}]],
    ['jiraQuickActions',[{}, {status:'Done'}]],
  ]) {
    for(const row of rows) {
      assert.throws(()=>parse(encode({[key]:[row]})),undefined,`${key} global ${JSON.stringify(row)}`);
      const profile=key==='customJobs'?{customJobs:[row]}:{overrides:{[key]:[row]}};
      assert.throws(()=>parse(encode({projectProfiles:{'team/repo':profile}})),undefined,`${key} profile ${JSON.stringify(row)}`);
    }
  }
  assert.throws(()=>parse(encode({projectProfiles:{'team/repo':{versionStrategy:'unsupported'}}})));
  const legacy={customJobs:[{label:'Deploy',jobName:'deploy'}],versionStrategy:'',overrides:{jiraQuickActions:[{label:'Done',status:'Done'}]}};
  assert.deepEqual(plain(parse(encode({projectProfiles:{'team/repo':legacy}})).projectProfiles['team/repo']),legacy,'optional legacy fields stay optional');
});

test('unrelated project edits retain imported values without normalizing their storage shape',()=>{
  for(const branches of [[],[' release/1 ','release/1']]) {
    const legacy={cherry_pick_branches:branches,customJobs:[{label:' Deploy ',jobName:' deploy '}],overrides:{
      jira_url:'https://jira.project.test/jira/',
      jiraQuickActions:[{label:' Done ',status:'Done'}],
      quickComments:[{label:' Comment ',text:' Original text '}],
      commits_jira_field:' status ',
    }};
    const saved=data({projectProfiles:{'team/repo':legacy}});
    let draft=Draft.createDraft(saved,'team/repo');
    assert.deepEqual(plain(Draft.serializeDraft(draft,saved,'team/repo',t).projectProfiles['team/repo']),legacy);
    draft=Draft.markProjectChanges(draft,{...draft,fields:{...draft.fields,show_cherry_pick:false}});
    let result=plain(Draft.serializeDraft(draft,saved,'team/repo',t).projectProfiles['team/repo']);
    assert.deepEqual(result,{...legacy,overrides:{...legacy.overrides,show_cherry_pick:false}});
    draft=Draft.markProjectChanges(draft,{...draft,comments:[{label:' New ',text:' New text '}]});
    result=plain(Draft.serializeDraft(draft,saved,'team/repo',t).projectProfiles['team/repo']);
    assert.deepEqual(result.overrides.quickComments,[{label:'New',text:'New text'}]);
    assert.deepEqual(result.overrides.jiraQuickActions,legacy.overrides.jiraQuickActions);
    draft=Draft.markProjectChanges(draft,{...draft,jiraActions:draft.jiraActions.map(action=>({...action,label:'Changed'}))});
    result=plain(Draft.serializeDraft(draft,saved,'team/repo',t).projectProfiles['team/repo']);
    assert.equal(result.overrides.jiraQuickActions[0].label,'Changed');
    assert.equal(result.overrides.jiraQuickActions[0].status,'Done');
  }
});

test('project scope and search remain local in every editable category',async()=>{
  const env=await settingsController({projectProfiles:{'team/repo':{}}});
  await env.controller.navigate({scope:'team/repo'});
  for(const category of ['actions','ci','jira','ai','appearance','general']) {
    await env.controller.navigate({category});
    assert.ok(env.controller.getSnapshot().draft.inherited,category);
  }
  await env.controller.navigate({search:'Jira'});
  assert.ok(env.controller.getSnapshot().draft.inherited);
  env.controller.dispose();
});

test('the callback reader captures project context before a delayed storage reply',()=>{
  let callback,received;
  const local=vm.createContext({URL,location:new URL('https://gitlab.test/team/first/-/merge_requests/1'),chrome:{storage:{sync:{get(_defaults,reply){callback=reply}}}}});
  vm.runInContext(bundleForTest('src/shared/api/project-settings/index.ts',{globalName:'Api'}),local);
  local.Api.getProjectSettings({show_cherry_pick:true},value=>{received=value});
  local.location=new URL('https://gitlab.test/team/second/-/merge_requests/2');
  callback({show_cherry_pick:true,projectProfiles:{'team/first':{overrides:{show_cherry_pick:false}},'team/second':{overrides:{show_cherry_pick:true}}}});
  assert.equal(received.show_cherry_pick,false);
});

test('an import requests only distinct configured global and project Jira origins',async()=>{
  const env=await settingsController();
  await env.import({jira_url:'https://jira.global.test/path',projectProfiles:{'team/a':{overrides:{jira_url:'https://jira.project.test/jira'}},'team/b':{overrides:{jira_url:'https://jira.project.test/other'}},'team/c':{overrides:{jira_url:''}}}});
  assert.equal(env.stored.projectProfiles['team/a'].overrides.jira_url,'https://jira.project.test/jira');
  // The controller fixture records the actual request arguments.
  assert.deepEqual(env.requests,[{origins:["https://jira.global.test/*","https://jira.project.test/*"]}]);
  env.controller.dispose();
});

test('legacy visibility, order, version and lists can return to inheritance without disturbing other overrides',()=>{
  const saved=data({btn_version:true,customJobs:[{label:'Global',jobName:'global'}],mrActions:[{id:'global',label:'Global',type:'clear_labels',labels:''}],projectProfiles:{'team/repo':{buttons:{btn_version:false,btn_ship:true},buttonOrder:['btn_ship'],customJobs:[],mrActions:[],versionFile:'VERSION',overrides:{show_cherry_pick:false}}}});
  let draft=Draft.createDraft(saved,'team/repo');
  for(const key of ['btn_version','buttonOrder','customJobs','mrActions','versionFile']) draft=Draft.inheritProjectSetting(draft,key);
  let result=plain(Draft.serializeDraft(draft,saved,'team/repo',t)).projectProfiles['team/repo'];
  assert.deepEqual(result,{buttons:{btn_ship:true},overrides:{show_cherry_pick:false}});
  assert.equal(draft.fields.btn_version,true);
  assert.equal(draft.jobs[0].jobName,'global');
  assert.equal(draft.actions[0].id,'global');
  draft=Draft.markProjectChanges(draft,{...draft,fields:{...draft.fields,btn_version:false}});
  result=plain(Draft.serializeDraft(draft,saved,'team/repo',t)).projectProfiles['team/repo'];
  assert.deepEqual(result.buttons,{btn_ship:true,btn_version:false});
});

test('profile context supports legacy routes and deployment prefixes without trusting stale SPA metadata',()=>{
  for(const [url,fullPath,expected,relativeUrlRoot] of [
    ['https://gitlab.test/team/repo/merge_requests/42',undefined,'team/repo'],
    ['https://gitlab.test/team/issues/repo/-/merge_requests/42',undefined,'team/issues/repo'],
    ['https://gitlab.test/tools/gitlab/team/repo/-/commits/main','team/repo','team/repo','/tools/gitlab'],
    ['https://gitlab.test/team/new/-/commits/main','team/old','team/new'],
    ['https://gitlab.test/parent/team/repo/-/commits/main','team/repo','parent/team/repo'],
    ['https://gitlab.test/tools/gitlab/parent/team/repo/-/commits/main','team/repo','parent/team/repo','/tools/gitlab'],
    ['https://gitlab.test/dashboard/merge_requests',undefined,null],
    ['https://gitlab.test/dashboard?return_to=/team/repo/-/merge_requests/2',undefined,null],
  ]) {
    const env=vm.createContext({URL,location:new URL(url),document:{body:{dataset:{projectFullPath:fullPath,relativeUrlRoot}}}});
    vm.runInContext(bundleForTest('src/shared/api/project-settings/index.ts',{globalName:'Api'}),env);
    assert.equal(env.Api.currentProjectPath(),expected,url);
  }
});

test('explicit deployment metadata selects a project profile instead of the similarly named namespace',()=>{
  const env=vm.createContext({URL,location:new URL('https://gitlab.test/tools/gitlab/team/repo/-/merge_requests/1'),document:{body:{dataset:{}},querySelector:()=>({getAttribute:()=>'/tools/gitlab/'})}});
  vm.runInContext(bundleForTest('src/shared/api/project-settings/index.ts',{globalName:'Api'}),env);
  const result=env.Api.applyProjectSettings({show_cherry_pick:true},{'team/repo':{overrides:{show_cherry_pick:false}},'tools/gitlab/team/repo':{overrides:{show_cherry_pick:true}}},env.Api.currentProjectPath());
  assert.equal(result.show_cherry_pick,false);
});

for (const pageScript of ['gon.relative_url_root = "/tools/gitlab";', 'window.gon = {"relative_url_root":"/tools\\/gitlab"};']) {
  test('project scope reads inline deployment root across nested SPA routes: '+pageScript,()=>{
    let scriptReads=0;
    const document={body:{dataset:{projectFullPath:'team/repo'}},querySelector:()=>null,querySelectorAll:()=>{scriptReads++; return [{textContent:pageScript}]}};
    const env=vm.createContext({URL,location:new URL('https://gitlab.test/tools/gitlab/team/repo/-/merge_requests/1'),document});
    vm.runInContext(bundleForTest('src/shared/api/project-settings/index.ts',{globalName:'Api'}),env);
    assert.equal(env.Api.currentProjectPath(),'team/repo');
    env.location=new URL('https://gitlab.test/tools/gitlab/parent/team/repo/-/commits/main');
    assert.equal(env.Api.currentProjectPath(),'parent/team/repo');
    assert.equal(scriptReads,1,'known deployment root is reused without rescanning scripts');
    env.document={body:{dataset:{}},querySelector:()=>null,querySelectorAll:()=>[]};
    env.location=new URL('https://gitlab.test/parent/team/repo/-/commits/main');
    assert.equal(env.Api.currentProjectPath(),'parent/team/repo','another document does not inherit the cached deployment root');
  });
}

test('deployment metadata arriving after the first settings read is not hidden by an empty cache',()=>{
  const document={body:{dataset:{}},querySelector:()=>null,querySelectorAll:()=>[]};
  const env=vm.createContext({URL,location:new URL('https://gitlab.test/tools/gitlab/team/repo/-/merge_requests/1'),document});
  vm.runInContext(bundleForTest('src/shared/api/project-settings/index.ts',{globalName:'Api'}),env);
  assert.equal(env.Api.currentProjectPath(),'tools/gitlab/team/repo');
  document.querySelectorAll=()=>[{textContent:'gon.relative_url_root = "/tools/gitlab";'}];
  assert.equal(env.Api.currentProjectPath(),'team/repo');
});

for (const pageScript of ['gon.relative_url_root = "";', 'window.gon = {"relative_url_root":""};']) {
  test('explicit empty deployment root avoids repeated inline script scans: '+pageScript,()=>{
    let scans=0;
    const env=vm.createContext({URL,location:new URL('https://gitlab.test/team/repo/-/merge_requests/1'),document:{body:{dataset:{}},querySelector:()=>null,querySelectorAll:()=>{scans++;return [{textContent:pageScript}]}}});
    vm.runInContext(bundleForTest('src/shared/api/project-settings/index.ts',{globalName:'Api'}),env);
    assert.equal(env.Api.currentProjectPath(),'team/repo');
    env.location=new URL('https://gitlab.test/parent/team/repo/-/commits/main');
    assert.equal(env.Api.currentProjectPath(),'parent/team/repo');
    assert.equal(scans,1);
  });
}
