const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const en=require('../../_locales/en/messages.json');
let context,profile,worker,id;
const url='https://jira.fixture.test/company/jira';
const errors=[];
test.beforeAll(async()=>{
 profile=await fs.mkdtemp(path.join(os.tmpdir(),'gitlab-jira-connection-'));
 const extension=path.resolve(__dirname,'../../dist');
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route(/^https?:/,route=>route.abort());
 await context.addInitScript(()=>{
  if(location.protocol!=='chrome-extension:')return;
  window.__access=true;
  const added=new Set(),removed=new Set();
  chrome.permissions.contains=(_query,callback)=>callback(window.__access);
  chrome.permissions.onAdded.addListener=cb=>added.add(cb);
  chrome.permissions.onAdded.removeListener=cb=>added.delete(cb);
  chrome.permissions.onRemoved.addListener=cb=>removed.add(cb);
  chrome.permissions.onRemoved.removeListener=cb=>removed.delete(cb);
  window.__permission=allowed=>{window.__access=allowed;(allowed?added:removed).forEach(cb=>cb({origins:['https://jira.fixture.test/*']}));};
 });
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 id=new URL(worker.url()).host;
 await worker.evaluate(()=>{
  globalThis.__requests=[];
  globalThis.__mode='ok';
  globalThis.__workerPermission=true;
  chrome.permissions.contains=async()=>globalThis.__workerPermission;
  // Keep the production worker, transport, response decoder and message channel.
  // Only the remote Jira server is replaced; no live Jira or credentials are used.
  globalThis.fetch=async(input,options)=>{
   globalThis.__requests.push({url:String(input),method:options.method,credentials:options.credentials,cache:options.cache});
   const mode=globalThis.__mode;
   if(mode==='network')throw new TypeError('Fixture offline');
   if(mode==='pending')return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Fixture aborted','AbortError'));
    options.signal.addEventListener('abort',abort,{once:true});
    globalThis.__finishPending=()=>{options.signal.removeEventListener('abort',abort);resolve(new Response(JSON.stringify({name:'fixture-user',displayName:'Fixture User'}),{headers:{'content-type':'application/json'}}));};
   });
   if(mode==='html')return new Response('<html><form id="login-form">Sign in</form></html>',{headers:{'content-type':'text/html'}});
   if(mode==='malformed')return new Response('{bad json',{headers:{'content-type':'application/json'}});
   if(mode==='missing')return new Response(JSON.stringify({displayName:'No identity'}),{headers:{'content-type':'application/json'}});
   if(typeof mode==='number')return new Response('{}',{status:mode,headers:{'content-type':'application/json'}});
   return new Response(JSON.stringify({name:'fixture-user',displayName:'Fixture User'}),{headers:{'content-type':'application/json'}});
  };
 });
});
test.beforeEach(async()=>{
 await worker.evaluate(jira_url=>{globalThis.__mode='ok';globalThis.__workerPermission=true;globalThis.__requests=[];return chrome.storage.sync.set({jira_url,language:'en'});},url);
});
test.afterEach(()=>expect(errors).toEqual([]));
test.afterAll(async()=>{await context?.close();if(profile)await fs.rm(profile,{recursive:true,force:true});});

for(const file of ['quick-popup.html','popup.html#section=jira']){
 test(`${file}: explicit session check, failure recovery, login link and no writes`,async()=>{
  const page=await context.newPage();
  try{
   await page.goto(`chrome-extension://${id}/${file}`);
   const panel=page.locator('.jira-connection-check'),status=panel.getByRole('status'),check=panel.getByRole('button');
   await expect(status).toHaveText(en.jiraConnectionUnchecked.message);
   expect(await worker.evaluate(()=>globalThis.__requests)).toEqual([]);
   await check.click();
   await expect(status).toContainText(en.jiraConnectionConnected.message.replace('$1','jira.fixture.test'));
   await expect(status.locator('time')).toHaveAttribute('datetime',/T/);
   expect(await worker.evaluate(()=>globalThis.__requests)).toEqual([{url:url+'/rest/api/2/myself',method:'GET',credentials:'include',cache:'no-store'}]);
   for(const [mode,key,auth] of [[401,'jiraErrorAuth',true],['html','jiraErrorAuth',true],[403,'jiraErrorForbidden',false],[404,'jiraErrorResponse',false],[429,'jiraErrorUnavailable',false],[503,'jiraErrorUnavailable',false],['network','jiraErrorNetwork',false],['malformed','jiraErrorResponse',false],['missing','jiraErrorResponse',false]]){
    await worker.evaluate(mode=>globalThis.__mode=mode,mode);
    await check.click();
    await expect(status).toContainText(en[key].message);
    const login=panel.getByRole('link',{name:en.jiraConnectionSignIn.message});
    await expect(login).toHaveCount(auth?1:0);
    if(auth){await expect(login).toHaveAttribute('href',url);await expect(login).toHaveAttribute('rel','noopener noreferrer');await expect(login).toHaveAttribute('target','_blank');}
   }
   const before=await worker.evaluate(()=>globalThis.__requests.length);
   await worker.evaluate(()=>globalThis.__workerPermission=false);
   await check.click();
   await expect(status).toContainText(en.jiraErrorPermission.message);
   expect(await worker.evaluate(()=>globalThis.__requests.length)).toBe(before);
   await worker.evaluate(()=>{globalThis.__workerPermission=true;globalThis.__mode='ok';});
   await check.click();
   await expect(status).toContainText(en.jiraConnectionConnected.message.replace('$1','jira.fixture.test'));
   await page.evaluate(()=>window.__permission(false));
   await expect(panel).toHaveCount(0);
   await page.evaluate(()=>window.__permission(true));
   await expect(status).toHaveText(en.jiraConnectionUnchecked.message);
   expect(await worker.evaluate(()=>globalThis.__requests.every(req=>req.method==='GET'))).toBe(true);
  }finally{await page.close();}
 });
}

test('connection checks ignore duplicate clicks, changed URLs, late timeout replies and page teardown',async()=>{
 const page=await context.newPage();
 try{
  await page.clock.install();
  await page.goto(`chrome-extension://${id}/quick-popup.html`);
  const panel=page.locator('.jira-connection-check'),status=panel.getByRole('status'),check=panel.getByRole('button');
  await expect(check).toBeEnabled();
  await worker.evaluate(()=>globalThis.__mode='pending');
  await check.click();
  await expect(check).toBeDisabled();
  await check.dispatchEvent('click');
  await expect.poll(()=>worker.evaluate(()=>globalThis.__requests.length)).toBe(1);
  await expect(status).toContainText(en.jiraConnectionChecking.message.replace('$1','jira.fixture.test'));
  await worker.evaluate(()=>chrome.storage.sync.set({jira_url:'https://other-jira.fixture.test/context'}));
  await expect(status).toHaveText(en.jiraConnectionUnchecked.message);
  await worker.evaluate(()=>globalThis.__finishPending());
  await expect(status).toHaveText(en.jiraConnectionUnchecked.message);
  await check.click();
  await expect.poll(()=>worker.evaluate(()=>globalThis.__requests.length)).toBe(2);
  await page.clock.runFor(20_001);
  await expect(status).toContainText(en.jiraErrorNetwork.message);
  await expect(check).toBeEnabled();
  await worker.evaluate(()=>globalThis.__finishPending());
  await expect(status).toContainText(en.jiraErrorNetwork.message);
  await check.click();
  await expect.poll(()=>worker.evaluate(()=>globalThis.__requests.length)).toBe(3);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#popupRoot')).toBeEmpty();
  await worker.evaluate(()=>globalThis.__finishPending());
  await expect(page.locator('#popupRoot')).toBeEmpty();
 }finally{await page.close();}
});

test('connection messages and login actions work in all 27 locales',async()=>{
 test.setTimeout(60_000);
 const page=await context.newPage();
 try{
  const locales=(await fs.readdir(path.resolve(__dirname,'../../_locales'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
  expect(locales).toHaveLength(27);
  for(const language of locales){
   await page.goto('about:blank');
   await worker.evaluate(language=>{globalThis.__mode='ok';return chrome.storage.sync.set({language});},language);
   await page.goto(`chrome-extension://${id}/quick-popup.html`);
   const messages=JSON.parse(await fs.readFile(path.resolve(__dirname,`../../_locales/${language}/messages.json`),'utf8'));
   const panel=page.locator('.jira-connection-check'),status=panel.getByRole('status');
   await expect(status).toHaveText(messages.jiraConnectionUnchecked.message);
   await panel.getByRole('button',{name:messages.jiraConnectionCheck.message}).click();
   await expect(status).toContainText(messages.jiraConnectionConnected.message.replace('$1','jira.fixture.test'));
   await worker.evaluate(()=>globalThis.__mode=401);
   await panel.getByRole('button').click();
   await expect(status).toContainText(messages.jiraErrorAuth.message);
   await expect(panel.getByRole('link')).toHaveText(messages.jiraConnectionSignIn.message);
  }
 }finally{await page.close();}
});

test('connection feedback stays readable in both themes and compact layouts',async()=>{
 const page=await context.newPage();
 try{
  await worker.evaluate(()=>chrome.storage.sync.set({language:'ru'}));
  for(const theme of ['light','dark']){
   await page.emulateMedia({colorScheme:theme});
   for(const file of ['quick-popup.html','popup.html#section=jira']){
    const popup=file.startsWith('quick');
    await page.setViewportSize({width:popup?410:360,height:900});
    await page.goto(`chrome-extension://${id}/${file}`);
    const panel=page.locator('.jira-connection-check');
    for(const mode of ['ok',401]){
     await worker.evaluate(mode=>globalThis.__mode=mode,mode);
     await panel.getByRole('button').click();
     await expect(panel.getByRole('status')).toContainText(mode==='ok'?'вход выполнен':'войди');
     await panel.scrollIntoViewIfNeeded();
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
     await panel.screenshot({path:`.reports/jira-connection-${theme}-${popup?'popup':'settings'}-${mode}.png`});
    }
   }
  }
 }finally{await page.close();}
});
