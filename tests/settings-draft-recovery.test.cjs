'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {bundleForTest} = require('./helpers/runtime.cjs');

const {model, config} = vm.runInNewContext(
  bundleForTest('src/features/manage-settings/index.ts',{globalName:'Config'}) +
  bundleForTest('src/pages/settings/model/draft.ts',{globalName:'DraftModel'}) +
  '; ({model:DraftModel,config:Config});',
  {TextEncoder, structuredClone, crypto:webcrypto},
);
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = () => structuredClone(config.DEFAULTS);

test('a malformed stored AI instruction remains recoverable through default and profile settings', () => {
  const data = defaults();
  const block = config.AI_REVIEW_RULES[0];
  const key = 'ai_review_rule_' + block.id;
  data[key] = {enabled:'broken',text:null};
  data.projectProfiles = {'team/project':{}};
  for (const scope of ['default','team/project']) {
    const draft = model.createDraft(data, scope);
    assert.equal(draft.fields[key], block.text);
    assert.equal(draft.fields[key+'_enabled'], true);
  }
  assert.deepEqual(data[key], {enabled:'broken',text:null}, 'loading must not silently write/reset stored data');
  const draft = model.createDraft(data);
  draft.fields[key] = 'x'.repeat(config.AI_REVIEW_PROMPT_MAX_LENGTH+1);
  assert.throws(() => model.serializeDraft(draft,data,'default',key=>key), /aiReviewPromptTooLong/);
});

test('empty global values display legacy defaults while empty profile values keep inheritance', () => {
  const data = defaults();
  for (const key of ['versionFile','versionPath','versionStrategy','versionCommitTemplate','reviewersJob','commits_jira_field','language']) data[key] = '';
  data.projectProfiles = {'team/project':{}};
  const global = model.createDraft(data);
  assert.equal(global.fields.versionFilePreset, config.DEFAULTS.versionFile);
  for (const key of ['versionPath','versionStrategy','versionCommitTemplate','reviewersJob','commits_jira_field','language']) assert.equal(global.fields[key], config.DEFAULTS[key], key);
  const profile = model.createDraft(data, 'team/project');
  for (const key of ['versionFilePreset','versionFile','versionPath','versionStrategy','versionCommitTemplate','reviewersJob','reviewersList']) assert.equal(profile.fields[key], '', key);
  const saved = model.serializeDraft(profile,data,'team/project',key=>key).projectProfiles['team/project'];
  for (const key of ['versionFile','versionPath','versionStrategy','versionCommitTemplate','reviewersJob','reviewersList']) assert.equal(saved[key], undefined, key);
});

test('project profiles keep false button overrides and explicit empty action lists', () => {
  const data = defaults();
  data.btn_version = true;
  data.mrActions = [{id:'global-action',label:'Global action',type:'clear_labels',labels:''}];
  data.projectProfiles = {'team/project':{buttons:{btn_version:false},mrActions:[]}};
  const draft = model.createDraft(data,'team/project');
  assert.equal(draft.fields.btn_version,false);
  assert.deepEqual(plain(draft.actions),[]);
});

test('unfinished job drafts do not misalign persisted toolbar order', () => {
  const data = defaults();
  data.customJobs = [{label:'First',jobName:'first'}, {label:'',jobName:''}, {label:'Third',jobName:'third'}];
  data.buttonOrder = ['custom_2','btn_version','custom_0','custom_1'];
  const draft = model.createDraft(data);
  const saved = model.serializeDraft(draft,data,'default',key=>key);
  assert.deepEqual(plain(saved.customJobs),[{label:'First',jobName:'first'},{label:'Third',jobName:'third'}]);
  assert.deepEqual(plain(saved.buttonOrder.slice(0,3)),['custom_1','btn_version','custom_0']);
  assert.equal(draft.jobs.length,3,'incomplete row remains available for editing');
  assert.equal('rowKeys' in saved,false);
});

test('custom button visibility survives serialization, row compaction and profile isolation', () => {
 const data=defaults();
 data.customJobs=[{label:'',jobName:''},{label:'Deploy',jobName:'build, deploy'}];
 data.mrActions=[{id:'clear',label:'Clear labels',type:'clear_labels',labels:''}];
 data.projectProfiles={'team/project':{customJobs:[{label:'Project job',jobName:'test'}]}};
 let draft=model.createDraft(data);
 draft=model.setButtonEnabled(draft,'custom_1',false);
 draft=model.setButtonEnabled(draft,'mr_action_clear',false);
 const saved=model.serializeDraft(draft,data,'default',key=>key);
 assert.deepEqual(plain(saved.customJobs),[{label:'Deploy',jobName:'build, deploy',enabled:false}]);
 assert.equal(saved.mrActions[0].enabled,false);
 assert.ok(saved.buttonOrder.includes('custom_0'));
 assert.ok(!saved.buttonOrder.includes('custom_1'));
 const restored=model.createDraft({...data,...saved});
 assert.equal(restored.jobs[0].enabled,false);
 const enabled=model.serializeDraft(model.setButtonEnabled(restored,'custom_0',true),data,'default',key=>key);
 assert.equal(enabled.customJobs[0].enabled,true);
 let profile=model.createDraft(data,'team/project');
 profile=model.setButtonEnabled(profile,'custom_0',false);
 profile=model.setButtonEnabled(profile,'mr_action_clear',false);
 const project=model.serializeDraft(profile,data,'team/project',key=>key).projectProfiles['team/project'];
 assert.equal(project.customJobs[0].enabled,false);
 assert.equal(project.mrActions[0].enabled,false);
 assert.equal(data.customJobs[1].enabled,undefined);
 assert.equal(data.mrActions[0].enabled,undefined);
});
