const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

// A previous content.css combined with the new toolbar DOM reproduces the
// reported inline headings, touching buttons and duplicate clock exactly.
const oldStyles=String.raw`
html.gl-actions-host .gl-mr-actions-ext{display:flex;padding:20px;gap:6px;align-items:center;flex-wrap:wrap;width:100%;box-sizing:border-box}
html.gl-actions-host .gl-mr-actions-ext button{height:30px;padding:4px 12px;border:1px solid #626168;border-radius:6px;background:#626168;color:#ececef;font-size:14px}
html.gl-actions-host .gl-mr-actions-time{display:inline-flex;height:30px;align-items:center;padding:4px 10px;border:1px solid #555;border-radius:6px;background:#26262c;color:#666;font-size:12px;white-space:nowrap}
html.gl-actions-host .gl-mr-actions-time::before{content:"\1F552 ";margin-right:4px}
`;
const hostStyles=`html{font:16px system-ui;background:#17171b;color:#ececef;--gl-background-color-default:#26262c;--gl-background-color-subtle:#333238;--gl-border-color-default:#4a4856;--gl-text-color-default:#ececef;--gl-text-color-secondary:#b5b4be;--gl-button-default-primary-background-color-default:#26262c;--gl-button-default-primary-foreground-color-default:#ececef;--gl-button-default-primary-border-color-default:#4a4856}body{margin:32px}main{max-width:1280px;margin:auto}.mr-widget{background:#38373d;border-radius:6px;overflow:hidden}.native-header{padding:16px;font-size:14px;font-weight:600;border-bottom:1px solid #17171b}.native-details{padding:24px;background:#26262c;font-size:14px}.gl-button.btn-default{font-family:inherit}`;

test('an installed extension update replaces legacy toolbar CSS at the same extension version',async()=>{
 const staging=await fs.mkdtemp(path.join(os.tmpdir(),'gitlab-toolbar-style-update-'));
 const extension=path.join(staging,'extension');
 const profile=path.join(staging,'profile');
 const dist=path.resolve('dist');
 let context;
 try{
  await fs.cp(dist,extension,{recursive:true});
  const current=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
  const legacy=structuredClone(current);
  legacy.content_scripts[0].css=['content.css'];
  await fs.writeFile(path.join(extension,'content.css'),oldStyles);
  await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(legacy));
  async function openBrowser(){
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1380,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route(/^https?:/,async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:hostStyles});
   if(url.pathname.includes('/api/v4/')){
    const body=url.pathname.endsWith('/merge_requests/42')?{id:42,iid:42,project_id:37,state:'opened',title:'Fixture MR',source_branch:'feature',target_branch:'main',created_at:'2026-11-06T12:00:00Z'}:url.pathname.endsWith('/projects/37')?{id:37,merge_method:'ff'}:[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   }
   return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'none'; style-src 'self'; connect-src 'self'"},body:'<!doctype html><html class="gl-dark"><head><meta content="GitLab"><link rel="stylesheet" href="/fixture.css"></head><body data-project-id="37"><main><div class="mr-widget"><div class="native-header">Merge blocked: 1 check failed</div><div class="native-details">Fast forward merge is not possible. Please rebase.<p>Merge details</p><ul><li>The source branch is 2 commits behind the target branch.</li><li>1 commit will be added to develop.</li><li>The source branch will be deleted.</li></ul></div><div data-testid="mr-widget-content"></div></div><h2>Activity</h2></main></body></html>'});
  });
  }
  await openBrowser();
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.sync.set({language:'ru',show_time_tracker:true,show_failed_job_view:false,btn_version:true,btn_reviewers:true,btn_ship:true,btn_force_ship:true,btn_draft_toggle:true,btn_copy_mr:false,mrActions:[{id:'clear',label:'Удалить все метки',type:'clear_labels',labels:''}],quickComments:[{label:'Плюс',text:'+'},{label:'Позвать ревьюера',text:'Review please'},{label:'VOEX',text:'Fixture'}]}));
  let page=await context.newPage();
  await page.goto('https://gitlab.fixture.test/team/repo/-/merge_requests/42');
  let toolbar=page.locator('.gl-mr-actions-ext');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveCSS('flex-direction','row');
  expect(await page.locator('.gl-mr-actions-time').evaluate(el=>getComputedStyle(el,'::before').content)).not.toBe('none');
  await toolbar.screenshot({path:'.reports/toolbar-legacy-css-reproduction.png'});

  // Reopen the same persistent browser profile after updating the unpacked
  // directory. Preserve extension id, saved settings, version and disk cache;
  // this exercises an existing installation rather than a clean profile.
  const extensionId=await worker.evaluate(()=>chrome.runtime.id);
  await context.close();
  await fs.cp(dist,extension,{recursive:true});
  await openBrowser();
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  expect(await worker.evaluate(()=>chrome.runtime.id)).toBe(extensionId);
  expect(await worker.evaluate(()=>chrome.runtime.getManifest().version)).toBe(legacy.version);
  expect(await worker.evaluate(()=>chrome.runtime.getManifest().content_scripts[0].css)).toEqual(current.content_scripts[0].css);
  expect(await worker.evaluate(async()=>(await chrome.storage.sync.get('quickComments')).quickComments[0].label)).toBe('Плюс');
  page=await context.newPage();
  await page.goto('https://gitlab.fixture.test/team/repo/-/merge_requests/42');
  toolbar=page.locator('.gl-mr-actions-ext');
  await expect(toolbar).toHaveCSS('flex-direction','column');
  await expect(page.locator('.gl-mr-actions-buttons')).toHaveCSS('column-gap','8px');
  await expect(page.locator('.gl-mr-actions-comments')).toHaveCSS('display','flex');
  const time=page.locator('.gl-mr-actions-time');
  expect(await time.evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
  await expect(time).toHaveCSS('border-width','0px');
  await expect(time).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  const actions=await page.locator('.gl-mr-actions-buttons').boundingBox();
  const comments=await page.locator('.gl-mr-actions-comments').boundingBox();
  expect(comments.y).toBeGreaterThan(actions.y+actions.height);
  await toolbar.screenshot({path:'.reports/toolbar-updated-installation-dark.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{
  if(context)await context.close();
  await fs.rm(staging,{recursive:true,force:true});
 }
});
