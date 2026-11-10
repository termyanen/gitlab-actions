const {test, expect, chromium} = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const inventory = require('../fixtures/welcome-content-inventory.json');
const root = path.resolve(__dirname, '../..');
let context, profile, worker, extensionId;
const errors = [];

test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlab-welcome-react-'));
  const extension = path.join(root,'dist');
  context = await chromium.launchPersistentContext(profile, {
    channel:'chromium',headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  context.on('page', page => page.on('pageerror',error => errors.push(error.message)));
  await context.route(/^https?:/,route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => {
  if (context) await context.close();
  if (profile) await fs.rm(profile,{recursive:true,force:true});
});
test.afterEach(() => expect(errors).toEqual([]));
const welcomeUrl = () => `chrome-extension://${extensionId}/welcome.html`;
const renderedCopy = page => page.locator('[data-i18n]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.i18n,node.textContent.trim()])));

test('welcome preserves every original text in all 27 languages in light/dark and narrow layouts', async ({},testInfo) => {
  test.setTimeout(60_000);
  const locales = (await fs.readdir(path.join(root,'_locales'),{withFileTypes:true})).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  expect(locales).toHaveLength(27);
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'ru'}));
    await page.goto(welcomeUrl());
    await expect(page.locator('html')).toHaveAttribute('lang','ru');
    for (const locale of locales) {
      const messages = JSON.parse(await fs.readFile(path.join(root,'_locales',locale,'messages.json'),'utf8'));
      const expected = Object.fromEntries(inventory.map(key => [key,messages[key].message]));
      await worker.evaluate(language => chrome.storage.sync.set({language}),locale);
      await expect.poll(() => renderedCopy(page)).toEqual(expected);
      await expect(page.locator('html')).toHaveAttribute('lang',locale.replace('_','-'));
      await expect(page).toHaveTitle(messages.welcomeTitle.message);
      for (const [theme,width] of [['light',1280],['dark',1280],['light',320],['dark',320]]) {
        await page.emulateMedia({colorScheme:theme});
        await page.setViewportSize({width,height:900});
        const layout = await page.evaluate(() => ({
          overflow:document.documentElement.scrollWidth > innerWidth,
          textSize:parseFloat(getComputedStyle(document.querySelector('.welcome-card p')).fontSize),
          scheme:getComputedStyle(document.documentElement).colorScheme,
          clipped:[...document.querySelectorAll('.welcome-main [data-i18n], .welcome-sidebar a')].filter(node => node.scrollWidth > node.clientWidth+1 && getComputedStyle(node).display !== 'inline').map(node => node.dataset.i18n || node.textContent),
        }));
        expect(layout.overflow,locale+' '+theme).toBe(false);
        expect(layout.clipped,locale+' '+theme).toEqual([]);
        expect(layout.textSize).toBeGreaterThanOrEqual(16);
        expect(layout.scheme).toBe(theme);
        if (['en','ru'].includes(locale)) await page.screenshot({path:testInfo.outputPath(`welcome-${locale}-${theme}-${width}.png`)});
      }
    }
    // Auto is native browser localization, not the most recently fetched catalogue.
    await worker.evaluate(() => chrome.storage.sync.set({language:'auto'}));
    const native = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key,chrome.i18n.getMessage(key)])),inventory);
    await expect.poll(() => renderedCopy(page)).toEqual(native);
  } finally { await page.close(); }
});

test('welcome links preserve settings and guide destinations and keyboard navigation', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({language:'en'}));
  const page = await context.newPage();
  try {
    await page.goto(welcomeUrl());
    await expect(page.locator('.welcome-card')).toHaveCount(44);
    const guide = page.getByRole('link',{name:/AI review guide/});
    await expect(guide).toHaveAttribute('href','https://termyanen.github.io/gitlab-actions/review-guide.html');
    await expect(guide).toHaveAttribute('rel','noopener noreferrer');
    const how = page.locator('nav a[href="#welcomeHowItWorks"]');
    await how.focus();
    await how.press('Enter');
    await expect(page).toHaveURL(welcomeUrl()+'#welcomeHowItWorks');
    await expect(page.locator('#welcomeHowItWorks')).toBeInViewport();
    for (const link of [page.locator('#openSettings'),page.locator('.welcome-hero .settings-button')]) {
      const next = context.waitForEvent('page');
      await link.focus();
      await link.press('Enter');
      const settings = await next;
      try {
        await settings.waitForLoadState();
        expect(settings.url()).toBe(`chrome-extension://${extensionId}/popup.html`);
        await expect(settings.locator('#exportSettings')).toBeEnabled();
      } finally { await settings.close(); }
    }
  } finally { await page.close(); }
});

test('welcome ignores stale initial language reads and releases subscriptions on pagehide', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({language:'en'}));
  const page = await context.newPage();
  await page.addInitScript(() => {
    const get = chrome.storage.sync.get.bind(chrome.storage.sync);
    chrome.storage.sync.get = (keys,callback) => get(keys,data => {
      window.releaseWelcomeRead = () => callback(data);
    });
    const add = chrome.storage.onChanged.addListener.bind(chrome.storage.onChanged);
    const remove = chrome.storage.onChanged.removeListener.bind(chrome.storage.onChanged);
    window.welcomeListeners = new Set();
    window.welcomeCallbacks = [];
    chrome.storage.onChanged.addListener = callback => { window.welcomeListeners.add(callback); window.welcomeCallbacks.push(callback); add(callback); };
    chrome.storage.onChanged.removeListener = callback => { window.welcomeListeners.delete(callback); remove(callback); };
  });
  try {
    await page.goto(welcomeUrl());
    await expect.poll(() => page.evaluate(() => typeof window.releaseWelcomeRead)).toBe('function');
    await worker.evaluate(() => chrome.storage.sync.set({language:'ru'}));
    await expect(page.locator('html')).toHaveAttribute('lang','ru');
    await page.evaluate(() => window.releaseWelcomeRead());
    await expect(page.locator('[data-i18n="welcomeQuickStart"]')).toHaveText(require('../../_locales/ru/messages.json').welcomeQuickStart.message);
    expect(await page.evaluate(() => window.welcomeListeners.size)).toBe(1);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(page.locator('#welcomeRoot')).toBeEmpty();
    expect(await page.evaluate(() => window.welcomeListeners.size)).toBe(0);
    await page.evaluate(() => {
      window.releaseWelcomeRead();
      window.welcomeCallbacks.forEach(callback => callback({language:{newValue:'en'}},'sync'));
    });
    await expect(page.locator('#welcomeRoot')).toBeEmpty();
  } finally { await page.close(); }
});

test('welcome read failures retain the guide and recover the selected language on retry', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({language:'ru'}));
  const page = await context.newPage();
  await page.addInitScript(() => {
    const get = chrome.storage.sync.get.bind(chrome.storage.sync);
    let fail = true;
    chrome.storage.sync.get = (keys,callback) => {
      if (!fail) return get(keys,callback);
      fail = false;
      Object.defineProperty(chrome.runtime,'lastError',{configurable:true,value:{message:'Local fixture failure'}});
      callback({});
      delete chrome.runtime.lastError;
    };
  });
  try {
    await page.goto(welcomeUrl());
    await expect(page.locator('.welcome-load-error')).toBeVisible();
    await expect(page.locator('.welcome-card')).toHaveCount(44);
    await page.locator('.welcome-load-error button').click();
    await expect(page.locator('.welcome-load-error')).toHaveCount(0);
    await expect(page.locator('[data-i18n="welcomeQuickStart"]')).toHaveText(require('../../_locales/ru/messages.json').welcomeQuickStart.message);
  } finally { await page.close(); }
});
