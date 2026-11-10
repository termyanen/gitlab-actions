const {test, expect, chromium} = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let context, worker, extensionId, profile;
const errors = [];
const networkRequests = [];
const section = (page, category) => page.locator('#settingsNav [data-category="'+category+'"]').click();

test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlab-react-editors-'));
  const extension = path.resolve(__dirname, '../../dist');
  context = await chromium.launchPersistentContext(profile, {
    channel:'chromium', headless:true,
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  // These are extension-owned forms: no server requests are needed or permitted.
  await context.route(/^https?:/, route => {
    networkRequests.push(route.request().url());
    return route.abort();
  });
  [worker] = context.serviceWorkers();
  worker ||= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  if (context) await context.close();
  if (profile) await fs.rm(profile, {recursive:true,force:true});
});
test.afterEach(() => {
  expect(errors).toEqual([]);
  expect(networkRequests).toEqual([]);
});

test('React editors preserve typed-row focus, reindex deleted jobs and isolate project actions', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({
      language:'en', projectProfiles:{'team/editor-fixture':{}},
      customJobs:[{label:'First',jobName:'first'},{label:'Second',jobName:'second'},{label:'Third',jobName:'third'}],
      buttonOrder:['custom_2','custom_0','custom_1'],
      mrActions:[{id:'global-action',label:'Clear labels',type:'clear_labels',labels:''}],
    }));
    await page.goto(`chrome-extension://${extensionId}/popup.html#section=ci`);
    const jobs = page.locator('#customJobsList .custom-job');
    await expect(jobs).toHaveCount(3);
    const secondLabel = jobs.nth(1).locator('[data-field="label"]');
    const originalNode = await secondLabel.elementHandle();
    await secondLabel.focus();
    await secondLabel.press('End');
    for (const letter of ' edited') {
      await secondLabel.pressSequentially(letter);
      await expect(secondLabel).toBeFocused();
    }
    await expect(secondLabel).toHaveValue('Second edited');
    expect(await originalNode.evaluate(node => node.isConnected)).toBe(true);
    await jobs.first().getByRole('button', {name:'Remove',exact:true}).click();
    await expect(jobs).toHaveCount(2);
    expect(await originalNode.evaluate(node => node.isConnected)).toBe(true);
    await expect(jobs.first().locator('[data-field="label"]')).toHaveValue('Second edited');
    await expect.poll(() => worker.evaluate(async () => {
      const data = await chrome.storage.sync.get(['customJobs','buttonOrder']);
      return {jobs:data.customJobs, customOrder:data.buttonOrder.filter(key => key.startsWith('custom_'))};
    })).toEqual({jobs:[{label:'Second edited',jobName:'second'},{label:'Third',jobName:'third'}],customOrder:['custom_1','custom_0']});

    await section(page,'actions');
    const third = page.locator('#buttonOrder [data-key="custom_1"]');
    await third.getByRole('button', {name:'Move down: Third',exact:true}).click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('buttonOrder')).buttonOrder.slice(0,2))).toEqual(['custom_0','custom_1']);
    expect(await third.evaluate(node => node.contains(document.activeElement))).toBe(true);

    await page.locator('#profileScope').selectOption('team/editor-fixture');
    await expect(page.locator('#profileMrActionsList .mr-action')).toHaveCount(1);
    await expect(page.locator('#profileMrActionsList [data-field="label"]')).toHaveValue('Clear labels');
    await section(page,'ci');
    await expect(page.locator('#profileCustomJobsList .custom-job')).toHaveCount(2);
    await page.locator('#profileCustomJobsList .remove-btn').first().click();
    await page.locator('#profileCustomJobsList .remove-btn').first().click();
    await expect(page.locator('#profileCustomJobsList .custom-job')).toHaveCount(0);
    await page.locator('#profileAddCustomJob').click();
    await page.locator('#profileCustomJobsList [data-field="label"]').fill('Project check');
    await page.locator('#profileCustomJobsList [data-field="jobName"]').fill('project-check');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/editor-fixture'].customJobs)).toEqual([{label:'Project check',jobName:'project-check'}]);
    await section(page,'actions');
    await page.locator('#profileMrActionsList .remove-btn').click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/editor-fixture'].mrActions)).toEqual([]);
    await page.locator('#profileScope').selectOption('default');
    await expect(page.locator('#mrActionsList .mr-action')).toHaveCount(1);
    await section(page,'ci');
    await expect(jobs).toHaveCount(2);
    await page.reload();
    await expect(jobs.first().locator('[data-field="label"]')).toHaveValue('Second edited');
  } finally {
    await page.close();
    await worker.evaluate(async previous => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(previous); }, previous);
  }
});

test('React Jira editor preserves list operations and invalid JSON/date drafts until correction', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en',projectProfiles:{},jiraQuickActions:[]}));
    await page.goto(`chrome-extension://${extensionId}/popup.html#section=jira`);
    await page.locator('#addJiraQuickAction').click();
    const action = page.locator('#jiraQuickActionsList .jira-quick-action');
    await action.locator('[data-field="label"]').fill('Release ready');
    await action.locator('.jqa-change [data-part="value"]').fill('Done');
    await action.locator('.jqa-add-field').click();
    const fields = action.locator('.jqa-change');
    await fields.nth(1).locator('[data-part="value"]').fill(' reviewed, release, reviewed ');
    await fields.nth(1).locator('[data-part="operation"]').selectOption('remove');
    await action.locator('.jqa-add-field').click();
    await fields.nth(2).locator('[data-part="field"]').selectOption('custom');
    await fields.nth(2).locator('[data-part="custom"]').fill('customfield_12345');
    await fields.nth(2).locator('[data-part="value"]').fill('{"value":"Ready","flags":[true,false]}');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('jiraQuickActions')).jiraQuickActions)).toEqual([{
      label:'Release ready',status:'Done',assignee:'',updates:[
        {field:'labels',operation:'remove',value:['reviewed','release']},
        {field:'customfield_12345',operation:'set',value:{value:'Ready',flags:[true,false]}},
      ],
    }]);
    await action.locator('.jqa-add-field').click();
    await fields.nth(3).locator('[data-part="field"]').selectOption('duedate');
    await fields.nth(3).locator('[data-part="value"]').fill('2027-02-29');
    await expect(page.locator('#status')).toHaveClass('status failed');
    expect(await worker.evaluate(async () => (await chrome.storage.sync.get('jiraQuickActions')).jiraQuickActions[0].updates.length)).toBe(2);
    await expect(fields.nth(3).locator('[data-part="value"]')).toHaveValue('2027-02-29');
    await fields.nth(3).locator('[data-part="value"]').fill('2028-02-29');
    await expect(page.locator('#status')).toHaveText('Saved!');
    await fields.nth(2).locator('[data-part="value"]').fill('{unfinished');
    await expect(page.locator('#status')).toHaveClass('status failed');
    await section(page,'actions');
    await section(page,'jira');
    await expect(fields.nth(2).locator('[data-part="value"]')).toHaveValue('{unfinished');
    await fields.nth(2).locator('[data-part="value"]').fill('{"value":"Ready","flags":[true,false]}');
    await expect(page.locator('#status')).toHaveText('Saved!');
    await page.reload();
    await expect(fields).toHaveCount(4);
    await expect(fields.nth(1).locator('[data-part="operation"]')).toHaveValue('remove');
    // Chrome storage may reorder object keys; JSON semantics must survive.
    expect(JSON.parse(await fields.nth(2).locator('[data-part="value"]').inputValue())).toEqual({value:'Ready',flags:[true,false]});
    await expect(fields.nth(3).locator('[data-part="value"]')).toHaveValue('2028-02-29');
  } finally {
    await page.close();
    await worker.evaluate(async previous => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(previous); }, previous);
  }
});

test('custom job and MR-action checkboxes persist visibility without deleting definitions',async()=>{
 const previous=await worker.evaluate(()=>chrome.storage.sync.get(null));
 const page=await context.newPage();
 try{
  await worker.evaluate(()=>chrome.storage.sync.set({language:'en',customJobs:[{label:'First',jobName:'first'},{label:'Deploy',jobName:'build, deploy'}],mrActions:[{id:'clear',label:'Clear labels',type:'clear_labels',labels:''}],buttonOrder:['custom_1','custom_0','mr_action_clear'],projectProfiles:{'team/toggles':{customJobs:[{label:'Project deploy',jobName:'deploy'}],mrActions:[{id:'project-clear',label:'Project clear',type:'clear_labels',labels:''}]}}}));
  await page.goto(`chrome-extension://${extensionId}/popup.html#section=actions`);
  const job=page.locator('#buttonOrder').getByRole('checkbox',{name:'Deploy',exact:true});
  const action=page.locator('#buttonOrder').getByRole('checkbox',{name:'Clear labels',exact:true});
  await expect(job).toBeChecked();await expect(job).toBeEnabled();
  await job.uncheck();await action.uncheck();
  await page.locator('#buttonOrder').screenshot({path:'.reports/custom-buttons-light.png'});
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('#buttonOrder').screenshot({path:'.reports/custom-buttons-dark.png'});
  await page.emulateMedia({colorScheme:'light'});
  await expect.poll(()=>worker.evaluate(async()=>{const data=await chrome.storage.sync.get(['customJobs','mrActions']);return [data.customJobs[1].enabled,data.mrActions[0].enabled];})).toEqual([false,false]);
  await page.reload();await expect(job).not.toBeChecked();await expect(action).not.toBeChecked();
  await section(page,'ci');
  await expect(page.locator('#customJobsList .custom-job')).toHaveCount(2);
  await page.locator('#customJobsList .custom-job').first().getByRole('button',{name:'Remove',exact:true}).click();
  await section(page,'actions');
  await expect(job).not.toBeChecked();
  await expect.poll(()=>worker.evaluate(async()=> (await chrome.storage.sync.get('customJobs')).customJobs)).toEqual([{label:'Deploy',jobName:'build, deploy',enabled:false}]);
  await page.locator('#buttonOrder [data-key="custom_0"] .btn-label').click();
  await expect(job).toBeChecked();
  await expect.poll(()=>worker.evaluate(async()=> (await chrome.storage.sync.get('customJobs')).customJobs[0].enabled)).toBe(true);
  await page.locator('#profileScope').selectOption('team/toggles');
  await page.locator('#profileButtonOrder').getByRole('checkbox',{name:'Project deploy',exact:true}).uncheck();
  await page.locator('#profileButtonOrder').getByRole('checkbox',{name:'Project clear',exact:true}).uncheck();
  await expect.poll(()=>worker.evaluate(async()=>{const p=(await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/toggles'];return [p.customJobs[0].enabled,p.mrActions[0].enabled];})).toEqual([false,false]);
  await page.locator('#profileScope').selectOption('default');
  await expect(job).toBeChecked();await expect(action).not.toBeChecked();
 }finally{await page.close();await worker.evaluate(async previous=>{await chrome.storage.sync.clear();await chrome.storage.sync.set(previous);},previous);}
});

for (const theme of ['light','dark']) test(`project cherry-pick branches explain inheritance and persist independently (${theme})`, async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  try {
    await page.emulateMedia({colorScheme:theme});
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', cherry_pick_branches:['release/global'], projectProfiles:{'team/cherry':{},'team/other':{cherry_pick_branches:['release/other']}}}));
    await page.goto(`chrome-extension://${extensionId}/popup.html#section=actions`);
    await page.locator('#profileScope').selectOption('team/cherry');
    await expect(page.getByText('Set branches for this project.',{exact:false})).toBeVisible();
    await expect(page.locator('#cherryPickBranchesList input')).toHaveCount(0);
    await expect(page.locator('#cherryPickBranchesSource')).toContainText('release/global');
    await page.locator('#addCherryPickBranch').click();
    await page.locator('#cherryPickBranchesList input').fill('release/project');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/cherry'].cherry_pick_branches)).toEqual(['release/project']);
    await expect(page.locator('#cherryPickBranchesSource')).toContainText('release/project');
    await page.reload();
    await page.locator('#profileScope').selectOption('team/cherry');
    await expect(page.locator('#cherryPickBranchesList input')).toHaveValue('release/project');
    await page.locator('#cherryPickBranchesList .remove-btn').click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/cherry'].cherry_pick_branches)).toBeUndefined();
    await expect(page.locator('#cherryPickBranchesSource')).toContainText('release/global');
    for(const width of [1280,360]) {
      await page.setViewportSize({width,height:900});
      const block = page.locator('.settings-section').filter({has:page.locator('#cherryPickBranchesSource')});
      await block.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await block.screenshot({path:`.reports/cherry-pick-profile-${theme}-${width}.png`});
    }
    await page.locator('#profileScope').selectOption('team/other');
    await expect(page.locator('#cherryPickBranchesList input')).toHaveValue('release/other');
    await page.locator('#profileScope').selectOption('default');
    await expect(page.locator('#cherryPickBranchesList input')).toHaveValue('release/global');
    const longBranch = 'release/' + 'long-branch-'.repeat(20);
    await page.locator('#cherryPickBranchesList input').fill(longBranch);
    await page.locator('#profileScope').selectOption('team/cherry');
    await expect(page.locator('#cherryPickBranchesSource')).toContainText(longBranch);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('#profileScope').selectOption('default');
    await page.locator('#cherryPickBranchesList .remove-btn').click();
    await page.locator('#profileScope').selectOption('team/cherry');
    await expect(page.locator('#cherryPickBranchesSource')).toContainText('No branches configured.');
  } finally {
    await page.close();
    await worker.evaluate(async old => {await chrome.storage.sync.clear();await chrome.storage.sync.set(old);},previous);
  }
});

test('project settings cover every category, retain old values and restore global inheritance', async () => {
  const previous=await worker.evaluate(()=>chrome.storage.sync.get(null));
  const page=await context.newPage();
  try {
    const legacy={buttons:{btn_version:false},mrActions:[],customJobs:[],versionFile:'VERSION',reviewersJob:''};
    await worker.evaluate(legacy=>chrome.storage.sync.set({language:'en',dim_drafts:true,quickComments:[{label:'Global',text:'Global comment'}],projectProfiles:{'team/scoped':legacy,'team/untouched':{versionFile:'other.json'}}}),legacy);
    await page.goto(`chrome-extension://${extensionId}/popup.html?project=team/scoped#section=appearance`);
    await expect(page.locator('#profileScope')).toHaveValue('team/scoped');
    const dim=page.locator('[data-setting="dim_drafts"]');
    await expect(dim).toContainText('All projects');
    await page.locator('#dim_drafts').uncheck();
    await expect(dim).toContainText('Project value');
    await expect.poll(()=>worker.evaluate(async()=> (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/scoped'].overrides)).toEqual({dim_drafts:false});
    await section(page,'ci');
    await page.locator('#show_group_play').uncheck();
    await section(page,'jira');
    await page.locator('#jira_url').fill('https://jira.project.test');
    await section(page,'ai');
    await page.locator('#ai_review_prompt').fill('Review this project carefully.');
    await page.locator('#ai_review_filter_ignoreDirs').fill('vendor');
    await section(page,'actions');
    await page.locator('#show_cherry_pick').uncheck();
    await expect.poll(()=>worker.evaluate(async()=> (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/scoped'].overrides?.show_cherry_pick)).toBe(false);
    const stored=await worker.evaluate(()=>chrome.storage.sync.get(['projectProfiles','dim_drafts','jira_url']));
    expect(stored.dim_drafts).toBe(true);
    expect(stored.jira_url||'').not.toBe('https://jira.project.test');
    expect(stored.projectProfiles['team/untouched']).toEqual({versionFile:'other.json'});
    const {overrides,...unchanged}=stored.projectProfiles['team/scoped'];
    expect(unchanged).toEqual(legacy);
    expect(overrides).toMatchObject({dim_drafts:false,show_group_play:false,show_cherry_pick:false,jira_url:'https://jira.project.test',ai_review_prompt:'Review this project carefully.',ai_review_file_filter:{ignoreDirs:'vendor'}});
    await page.reload();
    await section(page,'appearance');
    await expect(page.locator('#dim_drafts')).not.toBeChecked();
    await dim.getByRole('button',{name:'Use global value',exact:true}).click();
    await expect(page.locator('#dim_drafts')).toBeChecked();
    await expect.poll(()=>worker.evaluate(async()=> (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/scoped'].overrides?.dim_drafts)).toBeUndefined();
    await page.locator('#settingsSearch').fill('Jira');
    await expect(page.locator('#profileScope')).toHaveValue('team/scoped');
    await expect(page.locator('#jira_url')).toHaveValue('https://jira.project.test');
    await page.locator('#settingsSearch').fill('');
    await section(page,'general');
    await expect(page.locator('#language')).toHaveCount(0);
    await expect(page.locator('#skip_confirmations')).toBeVisible();
    for(const theme of ['light','dark'])for(const width of [1280,360]) {
      await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width,height:900});
      await section(page,'jira');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`.reports/project-settings-${theme}-${width}.png`,fullPage:true});
    }
  } finally {await page.close();await worker.evaluate(async old=>{await chrome.storage.sync.clear();await chrome.storage.sync.set(old);},previous);}
});

test('legacy project buttons, order and lists can return to global values without changing other overrides', async () => {
  const previous=await worker.evaluate(()=>chrome.storage.sync.get(null));
  const page=await context.newPage();
  try {
    await worker.evaluate(()=>chrome.storage.sync.set({language:'en',btn_version:true,buttonOrder:['btn_version'],customJobs:[{label:'Global deploy',jobName:'deploy'}],mrActions:[{id:'global-clear',label:'Global clear',type:'clear_labels',labels:''}],projectProfiles:{'team/reset':{buttons:{btn_version:false,btn_ship:true},buttonOrder:['btn_ship'],versionFile:'VERSION',customJobs:[],mrActions:[],overrides:{show_cherry_pick:false}}}}));
    await page.goto(`chrome-extension://${extensionId}/popup.html?project=team/reset#section=actions`);
    const version=page.locator('#profileButtonOrder [data-key="btn_version"]');
    await expect(version.getByRole('checkbox')).not.toBeChecked();
    await version.getByRole('button',{name:/Use global value/}).click();
    await expect(version.getByRole('checkbox')).toBeChecked();
    await page.locator('[data-setting="buttonOrder"] > .setting-inheritance-status').getByRole('button',{name:'Use global value',exact:true}).click();
    await page.locator('[data-setting="mrActions"] > .setting-inheritance-status').getByRole('button',{name:'Use global value',exact:true}).click();
    await expect(page.locator('#profileMrActionsList [data-field="label"]')).toHaveValue('Global clear');
    await section(page,'ci');
    await page.locator('[data-setting="customJobs"] > .setting-inheritance-status').getByRole('button',{name:'Use global value',exact:true}).click();
    await expect(page.locator('#profileCustomJobsList [data-field="label"]')).toHaveValue('Global deploy');
    await expect.poll(()=>worker.evaluate(async()=> (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/reset'])).toEqual({buttons:{btn_ship:true},versionFile:'VERSION',overrides:{show_cherry_pick:false}});
    await section(page,'actions');
    await page.locator('#profileVersionFilePreset').selectOption('');
    const fileSetting = page.locator('[data-setting="versionFilePreset"]');
    await expect(fileSetting).toContainText('All projects');
    await expect(fileSetting.getByRole('button',{name:'Use global value',exact:true})).toHaveCount(0);
    await page.emulateMedia({colorScheme:'dark'});
    await page.setViewportSize({width:360,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#profileButtonOrder').screenshot({path:'.reports/project-settings-legacy-inheritance-dark-360.png'});
  } finally {await page.close();await worker.evaluate(async old=>{await chrome.storage.sync.clear();await chrome.storage.sync.set(old);},previous);}
});

test('two settings windows preserve project edits, inherited changes and imported profiles', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const first = await context.newPage();
  const second = await context.newPage();
  try {
    await worker.evaluate(async () => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set({language:'en',reviewersJob:'shared-job',projectProfiles:{'team/a':{},'team/b':{}}});
    });
    await Promise.all([first,second].map(page => page.goto(`chrome-extension://${extensionId}/popup.html#section=actions`)));
    await first.locator('#profileScope').selectOption('team/a');
    await second.locator('#profileScope').selectOption('team/b');
    await Promise.all([
      first.locator('#profileReviewersJob').fill('project-a'),
      second.locator('#profileReviewersJob').fill('project-b'),
    ]);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles)).toEqual({
      'team/a':{reviewersJob:'project-a'},'team/b':{reviewersJob:'project-b'},
    });
    await second.locator('#profileScope').selectOption('team/a');
    await expect(second.locator('#profileReviewersJob')).toHaveValue('project-a');
    await Promise.all([
      first.locator('#profileReviewersJob').fill('updated-a'),
      second.locator('#profileReviewersList').fill(' alice,bob '),
    ]);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/a'])).toEqual({reviewersJob:'updated-a',reviewersList:'alice,bob'});
    await expect(first.locator('#profileReviewersList')).toHaveValue('alice,bob');
    await expect(second.locator('#profileReviewersJob')).toHaveValue('updated-a');
    // Acknowledged raw input must not become a new edit when another window
    // replaces its normalized stored value.
    await first.locator('#profileReviewersList').fill('carol');
    await expect(second.locator('#profileReviewersList')).toHaveValue('carol');
    await second.locator('#profileReviewersJob').fill('updated-again');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/a'])).toEqual({reviewersJob:'updated-again',reviewersList:'carol'});

    await section(second,'data');
    await second.locator('#settingsImportFile').setInputFiles({name:'legacy-settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({
      format:'gitlab-mr-actions-settings',formatVersion:1,settings:{language:'en',reviewersJob:'imported-global',projectProfiles:{'team/imported':{buttons:{btn_rebase:false},customJobs:[],versionFile:'VERSION'}}},
    }))});
    await second.locator('#applySettingsImport').click();
    await expect(first.locator('#profileScope')).toHaveValue('default');
    await expect(first.locator('#reviewersJob')).toHaveValue('imported-global');
    await first.locator('#profileScope').selectOption('team/imported');
    await first.locator('#profileReviewersJob').fill('after-import');
    await first.locator('#profileScope').selectOption('default');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles)).toEqual({
      'team/imported':{buttons:{btn_rebase:false},customJobs:[],versionFile:'VERSION',reviewersJob:'after-import'},
    });
  } finally {
    await first.close(); await second.close();
    await worker.evaluate(async previous => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(previous); }, previous);
  }
});

test('creating a new project profile inherits existing CI buttons without materializing overrides', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  try {
    await worker.evaluate(async () => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set({language:'en',customJobs:[{label:'Shared deploy',jobName:'deploy'}],projectProfiles:{}});
    });
    await page.goto(`chrome-extension://${extensionId}/popup.html?project=team/new#section=ci`);
    await page.locator('#addProfile').click();
    await expect(page.locator('#profileScope')).toHaveValue('team/new');
    await expect(page.locator('#profileCustomJobsList [data-field="label"]')).toHaveValue('Shared deploy');
    await page.locator('#profileScope').selectOption('default');
    await page.locator('#profileScope').selectOption('team/new');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles)).toEqual({'team/new':{}});
  } finally {
    await page.close();
    await worker.evaluate(async previous => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(previous); }, previous);
  }
});
