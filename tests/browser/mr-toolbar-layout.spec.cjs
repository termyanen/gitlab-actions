const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {bundleForTest}=require('../helpers/runtime.cjs');
const root=path.resolve(__dirname,'../..');

async function mount(page,{shape='modern',dark=false,width=960,settings={},mr={},hostStyles=true}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height:800});
 const darkOnHtml=shape==='modern'&&dark;
 await page.route(/^https?:/,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html class="gl-actions-host ${darkOnHtml?'gl-dark':''}"><head><meta content="GitLab"></head><body data-project-id="37" class="${shape==='legacy'&&dark?'gl-dark':''}"><main><h1>Merge request !42</h1><div ${shape==='modern'?'data-testid="mr-widget-content"':'class="mr-widget-section"'}></div><button id="native" class="btn btn-default gl-button">Merge</button><button id="native-small" class="btn btn-sm btn-default gl-button">Small native control</button></main></body></html>`}));
 await page.goto('https://gitlab.fixture.test/team/repo/-/merge_requests/42');
 await page.addStyleTag({content:`html{font-family:system-ui,sans-serif;font-size:16px;background:${dark?'#1f1e27':'#fff'};color:${dark?'#ececef':'#303030'}}body{margin:0}main{max-width:900px;margin:auto}h1{font-size:20px;padding:16px}#native,#native-small{margin:16px;background:rgb(7,90,80);color:white}`});
 await page.addStyleTag({path:path.join(root,'content.css')});
 // GitLab UI's default button is 32px; btn-sm is 24px. Load host rules last,
 // matching asynchronously loaded GitLab styles; the doubled .gl-button selector
 // reproduces the specificity that previously overrode our medium-size fallback.
 // Source: gitlab-org/gitlab-ui src/components/base/button/button.scss.
 const nativeSelector=shape==='modern'?'.gl-button.gl-button':'.btn';
 if(hostStyles)await page.addStyleTag({content:`${nativeSelector}{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:0;padding:8px 12px;font-family:inherit;font-size:14px;line-height:16px;min-height:32px;border-radius:4px;box-shadow:inset 0 0 0 1px ${dark?'#535158':'#bfbfc3'}}${nativeSelector}.btn-sm{padding:4px 8px;min-height:24px}`});
 const messages=JSON.parse(fs.readFileSync(path.join(root,'_locales/ru/messages.json'),'utf8'));
 await page.evaluate(({settings,mr,messages})=>{
  window.settings={language:'ru',btn_copy_mr:true,btn_version:true,btn_reviewers:true,btn_rebase:true,btn_rebase_force:true,btn_pipeline_cancel:true,show_sensitive_warning:true,show_failed_job_view:false,customJobs:[{label:'Развернуть на тестовом стенде',jobName:'deploy'}],quickComments:[{label:'Готово к проверке',text:'Ready for review'},{label:'Нужны изменения',text:'Please revise'}],...settings};
  const listeners=new Set();
  window.changeSettings=changes=>{
   Object.assign(window.settings,changes);
   listeners.forEach(listener=>listener(Object.fromEntries(Object.keys(changes).map(key=>[key,{newValue:changes[key]}])),'sync'));
  };
  window.chrome={runtime:{id:'fixture',getURL:file=>'https://gitlab.fixture.test/'+file,onMessage:{addListener(){},removeListener(){}}},i18n:{getMessage:(key,args=[])=>{let value=messages[key]?.message||key;args.forEach((arg,i)=>value=value.replace('$'+(i+1),arg));return value;}},storage:{sync:{get:(defaults,cb)=>cb({...defaults,...window.settings})},onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
  window.fetch=async(url)=>{
   const body=url.includes('messages.json')?messages:url.includes('/diffs?')?[{new_path:'.env',old_path:'.env'}]:url.endsWith('/merge_requests/42')?{id:42,iid:42,project_id:37,state:'opened',title:'Fixture MR',created_at:new Date(Date.now()-183900000).toISOString(),...mr}:{id:37,merge_method:'ff'};
   return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
 },{settings,mr,messages});
 await page.addScriptTag({content:bundleForTest('src/shared/lib/lifecycle/index.ts',{globalName:'Lifecycle'})});
 await page.addScriptTag({content:bundleForTest('src/widgets/mr-toolbar/index.ts',{globalName:'Toolbar'})});
 await page.evaluate(()=>{window.scope=Lifecycle.createLifecycle();window.toolbar=Toolbar.startMrToolbar({origin:location.origin,projectId:null,mrIid:null,projectPath:null},{updateTrackerItem(){},pollTaskStatus(){}},scope);});
 await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
 return errors;
}

for(const shape of ['modern','legacy'])for(const dark of [false,true])for(const width of [960,360]){
 test(`toolbar separates metadata, actions and comments: ${shape}, ${dark?'dark':'light'}, ${width}px`,async({page})=>{
  const errors=await mount(page,{shape,dark,width});
  await expect(page.locator('.gl-mr-actions-time')).toContainText('Время с создания MR: 2 дн. 3 ч');
  await expect(page.locator('.gl-mr-actions-status .gl-mr-ext-sensitive-warning')).toBeVisible();
  await expect(page.getByRole('group',{name:'Действия с MR',exact:true})).toBeVisible();
  await expect(page.getByRole('group',{name:'Быстрые комментарии',exact:true})).toBeVisible();
  expect(await page.locator('.gl-mr-actions-time').evaluate(el=>el.closest('[role="group"]'))).toBeNull();
  const sizes=await page.locator('.gl-mr-actions-button').evaluateAll(buttons=>buttons.map(button=>({font:getComputedStyle(button).fontSize,height:button.getBoundingClientRect().height})));
  expect(new Set(sizes.map(s=>s.font))).toEqual(new Set(['14px']));
  const nativeHeight=await page.locator('#native').evaluate(el=>el.getBoundingClientRect().height);
  expect(nativeHeight).toBe(32);
  expect(await page.locator('#native-small').evaluate(el=>el.getBoundingClientRect().height)).toBe(24);
  expect(sizes.every(s=>s.height>=nativeHeight)).toBe(true);
  expect(await page.locator('.gl-mr-actions-button').first().evaluate(el=>el.getBoundingClientRect().height)).toBe(nativeHeight);
  // Compare horizontal breathing room as well as the overall click target.
  expect(await page.locator('.gl-mr-actions-button').first().evaluate(el=>getComputedStyle(el).paddingInlineStart)).toBe('12px');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('#native').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(7, 90, 80)');
  await page.locator('.gl-mr-actions-button').first().focus();
  await expect(page.locator('.gl-mr-actions-button').first()).toBeFocused();
  expect(await page.locator('.gl-mr-actions-button').first().evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Tab');
  await expect(page.locator('.gl-mr-actions-button').nth(1)).toBeFocused();
  await page.evaluate(()=>changeSettings({customJobs:[{label:'ОченьДлинноеНазваниеПользовательскогоЗаданияБезПробеловЧтобыПроверитьПереносТекста',jobName:'deploy'}]}));
  await expect(page.locator('.btn-custom-job')).toContainText('ОченьДлинное');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.gl-mr-actions-status .gl-mr-ext-sensitive-warning')).toHaveCount(1);
  await page.evaluate(()=>changeSettings({customJobs:[{label:'Развернуть на тестовом стенде',jobName:'deploy'}]}));
  await expect(page.locator('.btn-custom-job')).toHaveText('Развернуть на тестовом стенде');
  await page.locator('.gl-mr-actions-button').nth(1).evaluate(button=>button.blur());
  if(shape==='modern')await page.locator('.gl-mr-actions-ext').screenshot({path:`.reports/toolbar-${dark?'dark':'light'}-${width}.png`});
  expect(errors).toEqual([]);
 });
}

test('warnings remain visible without action buttons; empty groups and invalid age stay hidden',async({page})=>{
 const errors=await mount(page,{settings:{btn_copy_mr:false,btn_version:false,btn_reviewers:false,btn_rebase:false,btn_rebase_force:false,btn_pipeline_cancel:false,customJobs:[],quickComments:[]},mr:{has_conflicts:true,created_at:'not-a-date'}});
 await expect(page.locator('.gl-mr-actions-ext')).toBeVisible();
 for(const group of await page.locator('.gl-mr-actions-group').all())await expect(group).toBeHidden();
 await expect(page.locator('.gl-mr-actions-time')).toHaveCount(0);
 await expect(page.locator('.gl-mr-actions-status .gl-mr-actions-conflict-badge')).toBeVisible();
 await expect(page.locator('.gl-mr-actions-status .gl-mr-ext-sensitive-warning')).toBeVisible();
 await page.evaluate(()=>changeSettings({btn_copy_mr:true}));
 await expect(page.locator('.gl-mr-actions-buttons button')).toHaveCount(1);
 await expect(page.locator('.gl-mr-actions-status span')).toHaveCount(2);
 expect(errors).toEqual([]);
});


test('toolbar keeps medium-size fallbacks when GitLab button CSS is unavailable',async({page})=>{
 const errors=await mount(page,{hostStyles:false,width:360});
 const button=page.locator('.gl-mr-actions-button').first();
 expect(await button.evaluate(el=>({height:el.getBoundingClientRect().height,padding:getComputedStyle(el).padding,lineHeight:getComputedStyle(el).lineHeight}))).toEqual({height:32,padding:'7px 12px',lineHeight:'16px'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
