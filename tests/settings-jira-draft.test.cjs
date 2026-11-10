'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {bundleForTest} = require('./helpers/runtime.cjs');

const model = vm.runInNewContext(
  bundleForTest('src/pages/settings/model/jira-actions.ts', {globalName:'DraftModel'}) + '; DraftModel;',
);
const plain = value => JSON.parse(JSON.stringify(value));
const t = key => key;

test('Jira editor drafts preserve Server/DC status, assignee, list operations and custom JSON', () => {
  const saved = [{label:'Release ready', status:'Done', assignee:'user.name', updates:[
    {field:'labels',operation:'add',value:['release','reviewed']},
    {field:'fixVersions',operation:'remove',value:['Old version']},
    {field:'customfield_12345',operation:'set',value:{value:'Ready',nested:[true,4]}},
    {field:'priority',operation:'set',value:'High'},
    {field:'duedate',operation:'set',value:'2028-02-29'},
  ]}];
  const drafts = model.jiraActionsToDraft(saved);
  assert.equal(new Set([drafts[0].id, ...drafts[0].fields.map(field => field.id)]).size, 8);
  assert.deepEqual(plain(model.serializeJiraActions(drafts,t)), saved);
});

test('Jira list fields trim and deduplicate entries without modifying editable draft text', () => {
  const draft = model.createJiraActionDraft({label:'  Tag  '});
  const field = model.createJiraFieldDraft({field:'labels',operation:'add',value:[]});
  field.value = ' one, two,one,  ,two ';
  draft.fields = [field];
  assert.deepEqual(plain(model.serializeJiraActions([draft],t)), [{label:'Tag',status:'',assignee:'',updates:[{field:'labels',operation:'add',value:['one','two']}]}]);
  assert.equal(field.value, ' one, two,one,  ,two ');
});

test('invalid custom Jira JSON and identifiers remain in the draft and cannot be saved', () => {
  const draft = model.createJiraActionDraft({label:'Custom'});
  const field = model.createJiraFieldDraft({field:'customfield_12345',value:{name:'Saved'}});
  draft.fields = [field];
  field.value = '{unfinished';
  assert.throws(() => model.serializeJiraActions([draft],t), /jiraQuickActionInvalid/);
  assert.equal(field.value, '{unfinished');
  field.value = 'false';
  field.custom = 'customfield_bad';
  assert.throws(() => model.serializeJiraActions([draft],t), /jiraQuickActionInvalid/);
  field.custom = 'customfield_12345';
  assert.deepEqual(plain(model.serializeJiraActions([draft],t)[0].updates), [{field:'customfield_12345',operation:'set',value:false}]);
});

test('Jira editor rejects duplicate populated fields and invalid calendar dates', () => {
  const draft = model.createJiraActionDraft({label:'Transition',status:'Done'});
  draft.fields.push(model.createJiraFieldDraft({field:'status',value:'Open'}));
  assert.throws(() => model.serializeJiraActions([draft],t), /jiraQuickActionDuplicate/);
  draft.fields[1].value = '';
  assert.equal(model.serializeJiraActions([draft],t)[0].status, 'Done');
  draft.fields = [model.createJiraFieldDraft({field:'duedate',value:'2027-02-29'})];
  assert.throws(() => model.serializeJiraActions([draft],t), /jiraQuickActionInvalid/);
  draft.fields[0].value = '2028-02-29';
  assert.equal(model.serializeJiraActions([draft],t)[0].updates[0].value, '2028-02-29');
});

test('unfinished Jira action rows remain editable but do not create empty stored actions', () => {
  const blank = model.createJiraActionDraft();
  blank.label = 'Not finished';
  assert.equal(model.serializeJiraActions([blank],t).length, 0);
  blank.fields[0].value = 'Done';
  blank.label = '';
  assert.equal(model.serializeJiraActions([blank],t).length, 0);
  blank.label = 'Complete';
  const result = model.serializeJiraActions([blank],t)[0];
  assert.equal(result.label, 'Complete');
  assert.equal('id' in result, false, 'React row identity must not change the storage format');
  assert.equal('fields' in result, false);
});
