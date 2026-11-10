const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
let context,profile,worker,id;
const requests=[],errors=[];
const site='https://jira.fixture.test/company/jira';
test.beforeAll(async()=>{
 profile=await fs.mkdtemp(path.join(os.tmpdir(),'gitlab-jira-link-'));
 const extension=path.resolve(__dirname,'../../dist');
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route(/^https?:/,route=>{
  requests.push(route.request().url());
  return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local Jira fixture</title>'});
 });
 await context.addInitScript(()=>{
  if(location.protocol==='chrome-extension:') chrome.permissions.contains=(_query,callback)=>callback(true);
 });
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');id=new URL(worker.url()).host;
 await worker.evaluate(jira_url=>chrome.storage.sync.set({jira_url,language:'ru'}),site+'/');
});
test.afterAll(async()=>{if(context)await context.close();if(profile)await fs.rm(profile,{recursive:true,force:true});});
test.afterEach(()=>expect(errors).toEqual([]));

test('permission status does not claim sign-in failure and both surfaces link to the configured Jira context',async()=>{
 const popup=await context.newPage(),settings=await context.newPage();
 try {
  await popup.goto(`chrome-extension://${id}/quick-popup.html`);
  await settings.goto(`chrome-extension://${id}/popup.html#section=jira`);
  await expect(settings.locator('#jiraAccessStatus')).toHaveText('Расширению разрешён доступ к jira.fixture.test.');
  await expect(popup.locator('.jira-access-summary')).toContainText('Расширению разрешён доступ к jira.fixture.test.');
  await expect(popup.locator('.jira-access-summary')).not.toContainText('Войдите');
  // Opening either surface checks permissions only, without an authentication probe.
  expect(requests).toEqual([]);
  const links=[popup.locator('.jira-access-summary a'),settings.locator('.jira-connection-actions a')];
  for(const link of links){
   await expect(link).toHaveText('Открыть Jira');
   await expect(link).toHaveAttribute('href',site);
   await expect(link).toHaveAttribute('target','_blank');
   await expect(link).toHaveAttribute('rel','noopener noreferrer');
   const opened=context.waitForEvent('page');await link.click();const jira=await opened;
   try{await jira.waitForLoadState();expect(jira.url()).toBe(site);}finally{await jira.close();}
  }
  expect(requests).toEqual([site,site]);
  await worker.evaluate(()=>chrome.storage.sync.set({language:'en'}));
  await expect(popup.locator('.jira-access-summary')).toContainText('The extension is allowed to access jira.fixture.test.');
  await expect(popup.locator('.jira-access-summary a')).toHaveText('Open Jira');
 }finally{await popup.close();await settings.close();}
});

test('Jira links follow valid settings and disappear for empty or unsafe URLs',async()=>{
 await worker.evaluate(jira_url=>chrome.storage.sync.set({jira_url,language:'en'}),site);
 const popup=await context.newPage(),settings=await context.newPage();
 try{
  await popup.goto(`chrome-extension://${id}/quick-popup.html`);
  await settings.goto(`chrome-extension://${id}/popup.html#section=jira`);
  for(const value of ['', 'javascript:alert(1)', 'https://user:password@jira.fixture.test/jira']){
   await settings.locator('#jira_url').fill(value);
   await expect(settings.locator('.jira-connection-actions a')).toHaveCount(0);
   await worker.evaluate(jira_url=>chrome.storage.sync.set({jira_url}),value);
   await expect(popup.locator('.jira-access-summary a')).toHaveCount(0);
  }
  await settings.locator('#jira_url').fill('https://other-jira.fixture.test/nested/context/');
  await expect(settings.locator('.jira-connection-actions a')).toHaveAttribute('href','https://other-jira.fixture.test/nested/context');
  await expect(settings.locator('#jiraAccessStatus')).toHaveText('The extension is allowed to access other-jira.fixture.test.');
  await expect.poll(()=>worker.evaluate(async()=> (await chrome.storage.sync.get('jira_url')).jira_url)).toBe('https://other-jira.fixture.test/nested/context');
  await expect(popup.locator('.jira-access-summary a')).toHaveAttribute('href','https://other-jira.fixture.test/nested/context');
  await expect(popup.locator('.jira-access-summary')).toContainText('The extension is allowed to access other-jira.fixture.test.');
 }finally{await popup.close();await settings.close();}
});

test('all 27 locales and the browser locale substitute the Jira host in both surfaces',async()=>{
 test.setTimeout(60_000);
 const popup=await context.newPage(),settings=await context.newPage();
 const host='jira.fixture.test:8443';
 try{
  for(const language of [...(await fs.readdir(path.resolve(__dirname,'../../_locales'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort(),'auto']){
   await popup.goto('about:blank');
   await settings.goto('about:blank');
   await worker.evaluate(({language,url})=>chrome.storage.sync.set({language,jira_url:url}),{language,url:`https://${host}/company/jira`});
   await popup.goto(`chrome-extension://${id}/quick-popup.html`);
   await settings.goto(`chrome-extension://${id}/popup.html#section=jira`);
   const translated=await popup.evaluate(()=>chrome.i18n.getMessage('jiraAccessGranted',['jira.fixture.test:8443']));
   const expected=language==='auto'?translated:JSON.parse(await fs.readFile(path.resolve(__dirname,`../../_locales/${language}/messages.json`),'utf8')).jiraAccessGranted.message.replace('$1',host);
   expect(expected).toContain(host);
   expect(expected).not.toContain('$1');
   await expect(settings.locator('#jiraAccessStatus')).toHaveText(expected);
   await expect(popup.locator('.jira-access-summary')).toContainText(expected);
   await expect(popup.locator('.jira-access-summary a')).toHaveAttribute('href',`https://${host}/company/jira`);
  }
 }finally{await popup.close();await settings.close();}
});

test('long Jira hosts wrap in light and dark compact layouts',async()=>{
 const page=await context.newPage();
 const host=`${'jira'.repeat(15)}.${'internal'.repeat(7)}.test`;
 try{
  await worker.evaluate(jira_url=>chrome.storage.sync.set({language:'ru',jira_url}),`https://${host}/jira`);
  await page.setViewportSize({width:360,height:900});
  for(const theme of ['light','dark']){
   await page.emulateMedia({colorScheme:theme});
   for(const surface of ['quick-popup.html','popup.html#section=jira']){
    await page.setViewportSize({width:surface.startsWith('quick')?410:360,height:900});
    await page.goto(`chrome-extension://${id}/${surface}`);
    const status=page.locator(surface.startsWith('quick')?'.jira-access-summary':'#jiraAccessStatus');
    await expect(status).toContainText(host);
    expect(await status.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await status.scrollIntoViewIfNeeded();
    await page.screenshot({path:`.reports/jira-host-${theme}-${surface.startsWith('quick')?'popup':'settings'}.png`});
   }
  }
 }finally{await page.close();}
});
