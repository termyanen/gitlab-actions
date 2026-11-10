'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {bundleForTest} = require('./helpers/runtime.cjs');
const {settingsController, plain, settle} = require('./helpers/settings-controller.cjs');
const context = vm.createContext({TextEncoder, URL, structuredClone, crypto:require('node:crypto').webcrypto});
vm.runInContext(bundleForTest('src/pages/settings/model/draft.ts',{globalName:'Draft'}), context);
const {Draft} = context;

test('remote Jira actions refresh in global and project drafts without creating an override', async () => {
  for (const scope of ['default','team/repo']) {
    const env=await settingsController({jiraQuickActions:[{label:'Before',status:'Open'}],projectProfiles:{'team/repo':{}}});
    try {
      await env.controller.navigate({scope});
      const ids=env.snapshot().draft.jiraActions.map(action=>action.id);
      env.emit({dim_drafts:{newValue:false}});
      assert.deepEqual(plain(env.snapshot().draft.jiraActions.map(action=>action.id)),plain(ids),'unrelated changes retain row identities');
      env.update({show_group_play:false});
      env.emit({jiraQuickActions:{newValue:[{label:'After',status:'Done'}]}});
      assert.equal(env.snapshot().draft.jiraActions[0].label,'After');
      assert.ok(!env.snapshot().draft.overrides?.includes('jiraQuickActions'));
      assert.equal(await env.controller.save(),true);
      assert.deepEqual(env.stored.jiraQuickActions,[{label:'After',status:'Done'}]);
      assert.equal(env.stored.projectProfiles['team/repo'].overrides?.jiraQuickActions,undefined);
    } finally { env.controller.dispose(); }
  }
});

test('unfinished project Jira action input survives remote updates and saves only to that project', async () => {
  const env=await settingsController({jiraQuickActions:[{label:'Before',status:'Open'}],projectProfiles:{'team/repo':{}}});
  try {
    await env.controller.navigate({scope:'team/repo'});
    const draft=env.snapshot().draft;
    env.controller.updateDraft({...draft,jiraActions:draft.jiraActions.map(action=>({...action,label:'Local'}))});
    env.emit({jiraQuickActions:{newValue:[{label:'Remote',status:'Done'}]}});
    assert.equal(env.snapshot().draft.jiraActions[0].label,'Local');
    assert.equal(await env.controller.save(),true);
    assert.equal(env.stored.projectProfiles['team/repo'].overrides.jiraQuickActions[0].label,'Local');
    assert.equal(env.stored.jiraQuickActions[0].label,'Remote');
  } finally { env.controller.dispose(); }
});

test('editing a legacy setting after resetting it survives the next storage refresh', async () => {
  const env=await settingsController({projectProfiles:{'team/repo':{versionFile:'VERSION'}}});
  try {
    await env.controller.navigate({scope:'team/repo'});
    env.controller.updateDraft(Draft.inheritProjectSetting(env.snapshot().draft,'versionFile'));
    env.update({versionFilePreset:'__custom__',versionFile:'NEW_VERSION'});
    env.emit({dim_drafts:{newValue:false}});
    assert.equal(env.snapshot().draft.fields.versionFile,'NEW_VERSION');
    assert.ok(!env.snapshot().draft.resetLegacy.includes('versionFile'));
    assert.equal(await env.controller.save(),true);
    assert.equal(env.stored.projectProfiles['team/repo'].versionFile,'NEW_VERSION');
  } finally { env.controller.dispose(); }
});

test('pending inheritance resets follow new global values without freezing them in a profile', async () => {
  const env=await settingsController({btn_version:true,customJobs:[{label:'Before',jobName:'before'}],projectProfiles:{'team/repo':{buttons:{btn_version:false},customJobs:[]}}});
  try {
    await env.controller.navigate({scope:'team/repo'});
    for(const key of ['btn_version','customJobs'])
      env.controller.updateDraft(Draft.inheritProjectSetting(env.snapshot().draft,key));
    env.emit({btn_version:{newValue:false},customJobs:{newValue:[{label:'After',jobName:'after'}]}});
    assert.equal(env.snapshot().draft.fields.btn_version,false);
    assert.equal(env.snapshot().draft.jobs[0].jobName,'after');
    assert.equal(await env.controller.save(),true);
    assert.deepEqual(env.stored.projectProfiles['team/repo'],{});
  } finally { env.controller.dispose(); }
});

test('first overrides merge with concurrent overrides before their storage event arrives', async () => {
  for(const [field,remote,expected] of [
    ['show_cherry_pick',{overrides:{show_group_play:false}},{overrides:{show_group_play:false,show_cherry_pick:false}}],
    ['btn_version',{buttons:{btn_ship:false}},{buttons:{btn_ship:false,btn_version:false}}],
  ]) {
    const env=await settingsController({btn_version:true,projectProfiles:{'team/repo':{}}});
    try {
      await env.controller.navigate({scope:'team/repo'});
      env.update({[field]:false});
      env.stored.projectProfiles['team/repo']=remote;
      assert.equal(await env.controller.save(),true);
      assert.deepEqual(env.stored.projectProfiles['team/repo'],expected);
    } finally { env.controller.dispose(); }
  }
});

test('resetting the last local override retains a concurrent override in the same container', async () => {
  for(const [field,initial,remote,expected] of [
    ['show_cherry_pick',{overrides:{show_cherry_pick:false}},{overrides:{show_cherry_pick:false,show_group_play:false}},{overrides:{show_group_play:false}}],
    ['btn_version',{buttons:{btn_version:false}},{buttons:{btn_version:false,btn_ship:false}},{buttons:{btn_ship:false}}],
  ]) {
    const env=await settingsController({projectProfiles:{'team/repo':initial}});
    try {
      await env.controller.navigate({scope:'team/repo'});
      env.controller.updateDraft(Draft.inheritProjectSetting(env.snapshot().draft,field));
      env.stored.projectProfiles['team/repo']=remote;
      assert.equal(await env.controller.save(),true);
      assert.deepEqual(env.stored.projectProfiles['team/repo'],expected);
    } finally { env.controller.dispose(); }
  }
});

test('explicit profile removal still removes the whole profile after concurrent edits', async () => {
  const env=await settingsController({projectProfiles:{'team/repo':{overrides:{show_cherry_pick:false}}}});
  try {
    await env.controller.navigate({scope:'team/repo'});
    env.stored.projectProfiles['team/repo'].overrides.show_group_play=false;
    await env.controller.removeProfile();
    assert.deepEqual(env.stored.projectProfiles,{});
  } finally { env.controller.dispose(); }
});

test('acknowledged untrimmed text does not overwrite later remote edits', async () => {
  for(const scope of ['default','team/repo']) {
    for(const editBeforeRemote of [false,true]) {
      const env=await settingsController({reviewersList:'Initial',projectProfiles:{'team/repo':{reviewersList:'Initial'}}});
      try {
        await env.controller.navigate({scope});
        env.update({reviewersList:' Local '});
        assert.equal(await env.controller.save(),true);
        assert.equal(env.snapshot().draft.fields.reviewersList,' Local ','autosave retains typed text');
        env.emit({dim_drafts:{newValue:false}});
        assert.equal(env.snapshot().draft.fields.reviewersList,' Local ','unrelated storage changes retain typed text');
        if(editBeforeRemote)env.update({show_time_tracker:false});
        env.emit(scope==='default'?{reviewersList:{newValue:'Remote'}}:{projectProfiles:{newValue:{'team/repo':{reviewersList:'Remote'}}}});
        assert.equal(env.snapshot().draft.fields.reviewersList,'Remote');
        if(!editBeforeRemote)env.update({show_time_tracker:false});
        assert.equal(await env.controller.save(),true);
        assert.equal((scope==='default'?env.stored:env.stored.projectProfiles[scope]).reviewersList,'Remote');
      } finally {env.controller.dispose();}
    }
  }
});

test('acknowledged normalized collections accept remote replacements without losing local row focus', async () => {
  const env=await settingsController({quickComments:[{label:'Before',text:'Before'}]});
  try {
    const draft=env.snapshot().draft;
    const rowKeys=plain(draft.rowKeys.comments);
    env.controller.updateDraft({...draft,comments:[{label:' Local ',text:' Text '}]});
    assert.equal(await env.controller.save(),true);
    assert.deepEqual(plain(env.snapshot().draft.rowKeys.comments),rowKeys);
    assert.equal(env.snapshot().draft.comments[0].label,' Local ');
    env.update({dim_drafts:false});
    env.emit({quickComments:{newValue:[{label:'Remote',text:'Remote'}]}});
    assert.equal(env.snapshot().draft.comments[0].label,'Remote');
    assert.equal(await env.controller.save(),true);
    assert.deepEqual(env.stored.quickComments,[{label:'Remote',text:'Remote'}]);
  } finally {env.controller.dispose();}
});

test('a save acknowledgement preserves newer input even when it reverts to the old persisted value', async () => {
  const env=await settingsController({reviewersList:'Original'});
  try {
    env.delayWrites=true;
    env.update({reviewersList:'Temporary'});
    const saving=env.controller.save();
    await settle();
    env.update({reviewersList:'Original'});
    await env.replyWrite();
    assert.equal(await saving,true);
    assert.equal(env.snapshot().draft.fields.reviewersList,'Original');
    assert.equal(env.snapshot().dirty,true);
    env.delayWrites=false;
    assert.equal(await env.controller.save(),true);
    assert.equal(env.stored.reviewersList,'Original');
  } finally {env.controller.dispose();}
});
