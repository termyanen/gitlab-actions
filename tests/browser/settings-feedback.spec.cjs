const {test,expect,chromium} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
let context,profile,worker,extensionId;
const errors=[];
test.beforeAll(async () => {
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'gitlab-settings-feedback-'));
  const extension=path.resolve(__dirname,'../../dist');
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page => page.on('pageerror',error => errors.push(error.message)));
  await context.route(/^https?:/,route => route.abort());
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId=new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.sync.set({language:'en'}));
});
test.afterAll(async () => {
  if(context) await context.close();
  if(profile) await fs.rm(profile,{recursive:true,force:true});
});
test.afterEach(() => expect(errors).toEqual([]));

test('accordion chevrons preserve keyboard toggling in both themes and narrow layouts',async ({},testInfo) => {
  const page=await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html#section=jira`);
    const details=page.locator('details').filter({has:page.locator('#jira_ticket_regex')});
    const summary=details.locator('summary');
    for(const theme of ['light','dark']) {
      for(const width of [1280,360]) {
        await page.setViewportSize({width,height:900});
        await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
        await summary.focus();
        await summary.press('Enter');
        await expect(details).toHaveAttribute('open','');
        await expect(page.locator('#jira_ticket_regex')).toBeVisible();
        const openStyle=await summary.evaluate(node => {
          const css=getComputedStyle(node,'::before');
          return {transform:css.transform,transition:css.transitionDuration,marker:getComputedStyle(node).listStyleType};
        });
        expect(openStyle.marker).toBe('none');
        expect(openStyle.transition).toBe('0s');
        await summary.scrollIntoViewIfNeeded();
        await page.screenshot({path:testInfo.outputPath(`accordion-${theme}-${width}.png`)});
        await summary.press('Space');
        await expect(details).not.toHaveAttribute('open');
        await expect(page.locator('#jira_ticket_regex')).toBeHidden();
        const closedTransform=await summary.evaluate(node => getComputedStyle(node,'::before').transform);
        expect(closedTransform).not.toBe(openStyle.transform);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  } finally {await page.close();}
});

test('successful settings import feedback disappears while the imported data remains saved',async () => {
  const page=await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html#section=data`);
    await expect(page.locator('#importSettings')).toBeEnabled();
    await page.locator('#settingsImportFile').setInputFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'gitlab-mr-actions-settings',formatVersion:1,settings:{language:'en',reviewersJob:'import-feedback-check'}}))});
    await expect(page.locator('#applySettingsImport')).toBeVisible();
    await page.locator('#applySettingsImport').click();
    await expect(page.locator('#status')).toHaveText(require('../../_locales/en/messages.json').settingsImported.message);
    await expect(page.locator('#settingsImportPreview')).toBeHidden();
    await expect(page.locator('#status')).toBeHidden({timeout:12000});
    expect(await worker.evaluate(async () => (await chrome.storage.sync.get('reviewersJob')).reviewersJob)).toBe('import-feedback-check');
    await page.reload();
    await expect(page.locator('#reviewersJob')).toHaveValue('import-feedback-check');
  } finally {await page.close();}
});
