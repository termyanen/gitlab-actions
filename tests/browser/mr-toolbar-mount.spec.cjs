const {test,expect}=require('@playwright/test');
const {bundleForTest}=require('../helpers/runtime.cjs');

async function mount(page,{project='',delay=false,mr={},settings={}}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https?:/,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta content="GitLab"></head><body ${project}><main><div data-testid="mr-widget-content"></div></main></body></html>`}));
 await page.goto('https://gitlab.fixture.test/team/repo/-/merge_requests/42');
 await page.evaluate(({delay,mr,settings})=>{
  window.fixtureSettings=settings;
  window.storageListeners=new Set();
  window.settingsReads=[];
  window.deferSettings=false;
  window.changeSettings=(changes,area='sync')=>{
   if(area==='sync')Object.assign(window.fixtureSettings,changes);
   const event=Object.fromEntries(Object.entries(changes).map(([key,newValue])=>[key,{newValue}]));
   storageListeners.forEach(listener=>listener(event,area));
  };
  window.reads=[];window.pending=[];
  window.chrome={runtime:{id:'fixture',onMessage:{addListener(){},removeListener(){}}},i18n:{getMessage:key=>key},storage:{onChanged:{addListener:listener=>storageListeners.add(listener),removeListener:listener=>storageListeners.delete(listener)},sync:{get:(defaults,cb)=>{
   const snapshot={...defaults,language:'auto',btn_copy_mr:true,show_failed_job_view:false,...window.fixtureSettings};
   if(window.deferSettings)settingsReads.push(()=>cb(snapshot));else cb(snapshot);
  }}}};
  window.fetch=async(url,options)=>{
   reads.push({url,method:options.method});
   const body=url.endsWith('/merge_requests/42')?{id:42,iid:42,project_id:37,state:'opened',title:'Fixture MR',...mr}:{id:37,merge_method:'merge'};
   if(delay)await new Promise(resolve=>pending.push(resolve));
   return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
 },{delay,mr,settings});
 await page.addScriptTag({content:bundleForTest('src/shared/lib/lifecycle/index.ts',{globalName:'Lifecycle'})});
 await page.addScriptTag({content:bundleForTest('src/widgets/mr-toolbar/index.ts',{globalName:'Toolbar'})});
 await page.evaluate(()=>{
  window.scope=Lifecycle.createLifecycle();
  window.toolbar=Toolbar.startMrToolbar({origin:location.origin,projectId:null,mrIid:null,projectPath:null},{updateTrackerItem(){},pollTaskStatus(){}},scope);
 });
 return errors;
}
for(const shape of ['inserted element','body attribute']){
 test(`MR toolbar mounts when project ID arrives later as ${shape}`,async({page})=>{
  const errors=await mount(page);
  expect(await page.evaluate(()=>reads)).toEqual([]);
  await page.evaluate(shape=>{
   if(shape==='body attribute')document.body.setAttribute('data-project-id','37');
   else{const node=document.createElement('div');node.dataset.projectId='37';document.querySelector('main').append(node);}
  },shape);
  await expect(page.locator('.gl-mr-actions-ext button')).toHaveText('btnCopyMr');
  await page.evaluate(()=>{for(let i=0;i<20;i++)document.querySelector('main').append(document.createElement('span'));});
  await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
  expect(await page.evaluate(()=>reads)).toHaveLength(2);
  await page.evaluate(()=>{scope.dispose();document.querySelector('.gl-mr-actions-ext').remove();document.body.dataset.projectId='38';});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(0);
  expect(await page.evaluate(()=>reads)).toHaveLength(2);
  expect(errors).toEqual([]);
 });
}

test('invalid project ID placeholders do not hide a valid project ID',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="loading"'});
 await page.evaluate(()=>{const node=document.createElement('div');node.dataset.projectId='37';document.querySelector('main').append(node);});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText('btnCopyMr');
 expect(await page.evaluate(()=>reads.every(request=>request.url.includes('/projects/37')))).toBe(true);
 expect(errors).toEqual([]);
});

test('MR toolbar uses the current widget when GitLab replaces it during API reads',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"',delay:true});
 await expect.poll(()=>page.evaluate(()=>pending.length)).toBe(2);
 await page.evaluate(()=>{
  const previous=document.querySelector('[data-testid="mr-widget-content"]');
  previous.replaceWith(previous.cloneNode(false));
 });
 await page.evaluate(()=>pending.splice(0).forEach(resolve=>resolve()));
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText('btnCopyMr');
 await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
 expect(await page.evaluate(()=>reads)).toHaveLength(2);
 expect(errors).toEqual([]);
});


test('MR toolbar accepts GitLab’s nullable source-branch removal flag',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"',mr:{should_remove_source_branch:null}});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText('btnCopyMr');
 expect(errors).toEqual([]);
});


test('invalid MR responses remain rejected and are diagnosed without repeating identical console errors',async({page})=>{
 const messages=[];
 page.on('console',message=>{if(message.type()==='error')messages.push(message.text());});
 const errors=await mount(page,{project:'data-project-id="37"',mr:{should_remove_source_branch:'false'}});
 await expect.poll(()=>messages.length).toBe(1);
 expect(messages[0]).toContain('[GitLab Actions]');
 expect(messages[0]).toContain('Invalid ActiveMergeRequest response');
 await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(0);
 await page.evaluate(()=>document.querySelector('main').append(document.createElement('span')));
 await expect.poll(()=>page.evaluate(()=>reads.length)).toBe(3);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 expect(messages).toHaveLength(1);
 expect(errors).toEqual([]);
});


for(const profile of [false,true]){
 test(`disabled custom buttons stay out of the toolbar and palette (${profile?'project':'global'})`,async({page})=>{
  const custom={customJobs:[{label:'Hidden deploy',jobName:'deploy',enabled:false},{label:'Legacy job',jobName:'test'},{label:'Enabled job',jobName:'build',enabled:true}],mrActions:[{id:'hidden',label:'Hidden action',type:'clear_labels',enabled:false},{id:'legacy',label:'Legacy action',type:'clear_labels'}],buttonOrder:['custom_2','mr_action_hidden','custom_0','custom_1','mr_action_legacy']};
  const settings=profile?{customJobs:[{label:'Global job',jobName:'global'}],projectProfiles:{'team/repo':custom}}:custom;
  const errors=await mount(page,{project:'data-project-id="37"',settings});
  await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
  await expect(page.locator('.gl-mr-actions-ext .btn-custom-job')).toHaveText(['Enabled job','Legacy job','Legacy action']);
  expect(await page.evaluate(()=>toolbar.getPaletteActions().filter(a=>a.id.startsWith('custom-job-')||a.id.startsWith('mr_action_')).map(a=>a.id))).toEqual(['custom-job-2','custom-job-1','mr_action_legacy']);
  await page.evaluate(()=>{toolbar.runPaletteAction('custom-job-0');toolbar.runPaletteAction('mr_action_hidden');});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  expect(await page.evaluate(()=>reads)).toHaveLength(2);
  expect(errors).toEqual([]);
 });
}

for(const profile of [false,true]){
 test(`toolbar updates visibility, labels and order live (${profile?'project':'global'})`,async({page})=>{
  const custom={customJobs:[{label:'Deploy',jobName:'deploy'}],mrActions:[{id:'labels',label:'Labels',type:'clear_labels'}]};
  const errors=await mount(page,{project:'data-project-id="37"',settings:profile?{projectProfiles:{'team/repo':custom}}:custom});
  await expect(page.locator('.gl-mr-actions-ext button')).toHaveText(['btnCopyMr','Deploy','Labels']);
  await page.evaluate(profile=>{
   const hidden={customJobs:[{label:'Deploy',jobName:'deploy',enabled:false}],mrActions:[{id:'labels',label:'Labels',type:'clear_labels',enabled:false}]};
   changeSettings(profile?{projectProfiles:{'team/repo':{...hidden,buttons:{btn_copy_mr:false}}}}:{...hidden,btn_copy_mr:false});
  },profile);
  await expect(page.locator('.gl-mr-actions-ext button')).toHaveCount(0);
  await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
  expect(await page.evaluate(()=>toolbar.getPaletteActions())).toEqual([]);
  await page.evaluate(()=>{toolbar.runPaletteAction('mr-copy');toolbar.runPaletteAction('mr_action_labels');toolbar.runPaletteAction('custom-job-0');});
  await page.evaluate(profile=>{
   const shown={customJobs:[{label:'New deploy',jobName:'new-deploy',enabled:true}],mrActions:[{id:'labels',label:'New labels',type:'clear_labels',enabled:true}],buttonOrder:['mr_action_labels','custom_0','btn_copy_mr']};
   changeSettings(profile?{projectProfiles:{'team/repo':{...shown,buttons:{btn_copy_mr:true}}}}:{...shown,btn_copy_mr:true});
  },profile);
  await expect(page.locator('.gl-mr-actions-ext button')).toHaveText(['New labels','New deploy','btnCopyMr']);
  expect(await page.evaluate(()=>toolbar.getPaletteActions().map(a=>a.label))).toEqual(['New labels','New deploy','btnCopyMr']);
  expect(await page.evaluate(()=>reads)).toHaveLength(2);
  expect(await page.evaluate(()=>storageListeners.size)).toBe(1);
  await page.evaluate(()=>{scope.dispose();changeSettings({btn_version:true});});
  expect(await page.evaluate(()=>storageListeners.size)).toBe(0);
  expect(await page.evaluate(()=>toolbar.getPaletteActions())).toEqual([]);
  expect(errors).toEqual([]);
 });
}

test('live settings ignore unrelated writes and stale reads, preserve focus, and stop after navigation',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"'});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText('btnCopyMr');
 await page.evaluate(()=>{
  window.originalToolbar=document.querySelector('.gl-mr-actions-ext');
  window.copyButton=originalToolbar.querySelector('button');copyButton.focus();
  changeSettings({trackerTasks:[]},'local');
  changeSettings({jira_url:'https://jira.fixture.test'});
  changeSettings({projectProfiles:{other:{buttons:{btn_copy_mr:false}}}});
 });
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 expect(await page.evaluate(()=>originalToolbar===document.querySelector('.gl-mr-actions-ext'))).toBe(true);
 await page.evaluate(()=>{deferSettings=true;changeSettings({btn_version:true});changeSettings({btn_version:false,btn_draft_toggle:true});settingsReads.pop()();});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText(['labelMarkDraft','btnCopyMr']);
 expect(await page.evaluate(()=>document.activeElement===copyButton)).toBe(true);
 await page.evaluate(()=>settingsReads.shift()());
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText(['labelMarkDraft','btnCopyMr']);
 await page.evaluate(()=>{changeSettings({btn_version:true});history.pushState({},'', '/team/repo/-/merge_requests/43');settingsReads.shift()();});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText(['labelMarkDraft','btnCopyMr']);
 expect(await page.evaluate(()=>reads)).toHaveLength(2);
 expect(errors).toEqual([]);
});

test('settings changed during initial MR reads are applied after mounting',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"',delay:true});
 await expect.poll(()=>page.evaluate(()=>pending.length)).toBe(2);
 await page.evaluate(()=>{changeSettings({btn_copy_mr:false,btn_version:true});pending.splice(0).forEach(resolve=>resolve());});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText('btnVersion');
 expect(await page.evaluate(()=>reads)).toHaveLength(2);
 expect(errors).toEqual([]);
});

test('live refresh preserves pending comments and does not duplicate requests or handlers',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"',settings:{quickComments:[{label:'Comment',text:'Looks good'}]}});
 await expect(page.locator('.btn-quick-comment')).toHaveText('Comment');
 await page.evaluate(()=>{
  const originalFetch=fetch;
  window.commentWrites=0;
  window.fetch=async(url,options)=>{
   if(options.method==='POST'){
    commentWrites++;
    await new Promise(resolve=>window.finishComment=resolve);
    return new Response('{}',{headers:{'content-type':'application/json'}});
   }
   return originalFetch(url,options);
  };
 });
 await page.locator('.btn-quick-comment').click();
 await expect.poll(()=>page.evaluate(()=>commentWrites)).toBe(1);
 await page.evaluate(()=>{window.busyButton=document.querySelector('.btn-quick-comment');changeSettings({btn_version:true});});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveCount(3);
 expect(await page.evaluate(()=>document.querySelector('.btn-quick-comment')===busyButton)).toBe(true);
 await expect(page.locator('.btn-quick-comment')).toBeDisabled();
 await page.evaluate(()=>{toolbar.runPaletteAction('quick-comment-0');changeSettings({quickComments:[]});});
 await expect(page.locator('.btn-quick-comment')).toHaveCount(0);
 await page.evaluate(()=>changeSettings({quickComments:[{label:'Comment',text:'Looks good'}]}));
 await expect(page.locator('.btn-quick-comment')).toBeDisabled();
 await page.evaluate(()=>toolbar.runPaletteAction('quick-comment-0'));
 expect(await page.evaluate(()=>commentWrites)).toBe(1);
 await page.evaluate(()=>finishComment());
 await expect(page.locator('.btn-quick-comment')).toBeEnabled();
 for(let i=0;i<10;i++){
  await page.evaluate(i=>changeSettings({btn_version:i%2===0}),i);
 }
 await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
 await page.locator('.btn-quick-comment').click();
 await expect.poll(()=>page.evaluate(()=>commentWrites)).toBe(2);
 await page.evaluate(()=>{finishComment();scope.dispose();});
 expect(errors).toEqual([]);
});

test('hiding and restoring a running MR action preserves its busy state and palette guard',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"',settings:{skip_confirmations:true,mrActions:[{id:'labels',label:'Labels',type:'clear_labels'}]}});
 await expect(page.locator('[data-mr-action-id="labels"]')).toBeVisible();
 await page.evaluate(()=>{
  const originalFetch=fetch;
  window.actionWrites=0;
  window.fetch=async(url,options)=>{
   if(options.method==='PUT'){
    actionWrites++;
    await new Promise(resolve=>window.finishAction=resolve);
    return new Response('{}',{headers:{'content-type':'application/json'}});
   }
   return originalFetch(url,options);
  };
  toolbar.runPaletteAction('mr_action_labels');
 });
 await expect.poll(()=>page.evaluate(()=>actionWrites)).toBe(1);
 await expect(page.locator('[data-mr-action-id="labels"]')).toBeDisabled();
 await page.evaluate(()=>changeSettings({mrActions:[{id:'labels',label:'Labels',type:'clear_labels',enabled:false}]}));
 await expect(page.locator('[data-mr-action-id="labels"]')).toHaveCount(0);
 await page.evaluate(()=>changeSettings({mrActions:[{id:'labels',label:'Labels',type:'clear_labels',enabled:true}]}));
 await expect(page.locator('[data-mr-action-id="labels"]')).toBeDisabled();
 await page.evaluate(()=>toolbar.runPaletteAction('mr_action_labels'));
 expect(await page.evaluate(()=>actionWrites)).toBe(1);
 await page.evaluate(()=>{finishAction();scope.dispose();});
 expect(errors).toEqual([]);
});

test('repeated live updates release removed controls and retain only one storage subscription',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"',settings:{customJobs:[{label:'Job 0',jobName:'job-0'}]}});
 await expect(page.locator('.btn-custom-job')).toHaveText('Job 0');
 const cdp=await page.context().newCDPSession(page);
 async function counters(){
  // Blink can retain detached layout nodes until paint even after a V8 GC.
  // Measure after rendering settles, as in the dialog lifecycle regressions.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await cdp.send('HeapProfiler.collectGarbage');
  return cdp.send('Memory.getDOMCounters');
 }
 // Compare steady-state batches, excluding one-time browser/locator setup.
 let before=await counters();
 for(let i=1;i<=60;i++){
  await page.evaluate(i=>changeSettings({customJobs:[{label:'Job '+i,jobName:'job-'+i}],buttonOrder:i%2?['custom_0','btn_copy_mr']:['btn_copy_mr','custom_0']}),i);
  await expect(page.locator('.btn-custom-job')).toHaveText('Job '+i);
  if(i===10)before=await counters();
 }
 const after=await counters();
 await test.info().attach('live-toolbar-memory',{body:JSON.stringify({before,after}),contentType:'application/json'});
 expect(after.nodes-before.nodes).toBeLessThanOrEqual(10);
 expect(after.jsEventListeners-before.jsEventListeners).toBeLessThanOrEqual(5);
 expect(await page.evaluate(()=>storageListeners.size)).toBe(1);
 expect(await page.evaluate(()=>reads)).toHaveLength(2);
 expect(errors).toEqual([]);
 await cdp.detach();
});

test('settings changes cannot resurrect cached actions while a replaced widget loads a closed MR',async({page})=>{
 const errors=await mount(page,{project:'data-project-id="37"'});
 await expect(page.locator('.gl-mr-actions-ext button')).toHaveText('btnCopyMr');
 await page.evaluate(()=>{
  const originalFetch=fetch;
  window.fetch=async(url,options)=>{
   if(url.endsWith('/merge_requests/42')){
    await new Promise(resolve=>window.finishClosedRead=resolve);
    return new Response(JSON.stringify({id:42,iid:42,project_id:37,state:'closed',title:'Closed MR'}),{headers:{'content-type':'application/json'}});
   }
   return originalFetch(url,options);
  };
  const widget=document.querySelector('[data-testid="mr-widget-content"]');
  widget.replaceWith(widget.cloneNode(false));
 });
 await expect.poll(()=>page.evaluate(()=>typeof finishClosedRead)).toBe('function');
 await page.evaluate(()=>changeSettings({btn_version:true}));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(0);
 expect(await page.evaluate(()=>toolbar.getPaletteActions())).toEqual([]);
 await page.evaluate(()=>finishClosedRead());
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(0);
 expect(errors).toEqual([]);
});
