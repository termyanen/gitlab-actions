const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { bundleForTest, root } = require('../helpers/runtime.cjs');

const pageErrors = new WeakMap();
test.beforeEach(({page}) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({page}) => expect(pageErrors.get(page)).toEqual([]));

async function mountSettings(page, {url = '', granted = false} = {}) {
  await page.goto('about:blank');
  await page.clock.install();
  await page.setContent(fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
  await page.evaluate(({url, granted}) => {
    window.saved = {jira_url: url, language: 'auto'};
    window.writes = [];
    window.requests = [];
    window.grants = new Set(granted ? [new URL(url).origin + '/*'] : []);
    window.errorReads = 0;
    window.chrome = {
      runtime: {},
      i18n: {getMessage: key => key},
      tabs: {query: (_query, callback) => callback([])},
      storage: {sync: {
        get: (keys, callback) => callback(Array.isArray(keys) ? {...saved} : {...keys, ...saved}),
        set: (settings, callback) => { writes.push(settings); Object.assign(saved, settings); callback?.(); },
      }},
      permissions: {
        contains: ({origins}, callback) => callback(origins.every(origin => grants.has(origin))),
        request: (permissions, callback) => requests.push({permissions, callback, userGesture: navigator.userActivation.isActive}),
      },
    };
    window.replyPermission = (granted, error = false) => {
      const request = requests[requests.length - 1];
      if (granted && !error) request.permissions.origins.forEach(origin => grants.add(origin));
      if (error) Object.defineProperty(chrome.runtime, 'lastError', {configurable: true, get: () => { errorReads++; return {message: 'Permission API unavailable'}; }});
      request.callback(granted);
      delete chrome.runtime.lastError;
    };
  }, {url, granted});
  await page.addScriptTag({content: bundleForTest('src/pages/settings/index.ts', {globalName: 'Settings'})});
  await page.evaluate(() => {
    Settings.startSettings();
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });
  await expect(page.locator('#jira_url')).toBeVisible();
}

test('Jira URL autosave preserves the context path and unrelated settings without requesting permission', async ({page}) => {
  await mountSettings(page);
  await page.locator('#jira_url').fill('https://jira.test/jira/');
  await page.locator('#sound_enabled').check();
  await page.clock.runFor(600);
  expect(await page.evaluate(() => ({url: saved.jira_url, sound: saved.sound_enabled, requests: requests.length})))
    .toEqual({url: 'https://jira.test/jira', sound: true, requests: 0});
  await expect(page.locator('#jiraAccessStatus')).toHaveText('jiraErrorPermission');
  await page.locator('#jiraGrantAccess').click();
  expect(await page.evaluate(() => requests.map(({permissions, userGesture}) => ({permissions, userGesture}))))
    .toEqual([{permissions: {origins: ['https://jira.test/*']}, userGesture: true}]);
  await expect(page.locator('#jiraGrantAccess')).toBeDisabled();
  await page.locator('#jiraGrantAccess').dispatchEvent('click');
  expect(await page.evaluate(() => requests.length)).toBe(1);
  await page.evaluate(() => replyPermission(true));
  await expect(page.locator('#jiraAccessStatus')).toHaveText('jiraAccessGranted');
  await expect(page.locator('#jiraGrantAccess')).toBeEnabled();
});

test('unchanged saved Jira URL can recover revoked access; denial and runtime errors stay visible', async ({page}) => {
  await mountSettings(page, {url: 'https://jira.test/jira'});
  const status = page.locator('#jiraAccessStatus');
  const button = page.locator('#jiraGrantAccess');
  await expect(status).toHaveText('jiraErrorPermission');
  await button.click();
  await page.evaluate(() => replyPermission(false));
  await expect(status).toHaveText('jiraErrorPermission');
  await expect(button).toBeEnabled();
  await button.click();
  await page.evaluate(() => replyPermission(false, true));
  await expect(status).toHaveText('jiraErrorPermission');
  expect(await page.evaluate(() => errorReads)).toBe(1);
  await button.click();
  await page.evaluate(() => replyPermission(true));
  await expect(status).toHaveText('jiraAccessGranted');
  expect(await page.evaluate(() => ({url: saved.jira_url, writes: writes.length, requests: requests.length})))
    .toEqual({url: 'https://jira.test/jira', writes: 0, requests: 3});
  await page.evaluate(() => grants.clear());
  await page.locator('#jira_url').focus();
  await expect(status).toHaveText('jiraErrorPermission');
});

test('invalid Jira base URLs neither request access nor replace saved configuration', async ({page}) => {
  await mountSettings(page, {url: 'https://jira.test/jira', granted: true});
  const input = page.locator('#jira_url');
  const invalid = ['jira.test', 'http://jira.test', 'https:example.test', 'https://user:secret@jira.test', 'https://jira.test/jira?q=1', 'https://jira.test/jira#fragment', 'https://jira.test/jira?', 'https://jira.test/\\other.test', 'https://*.test', 'https://%2A.test', 'https://*'];
  for (const value of invalid) {
    await test.step(value, async () => {
      await input.fill(value);
      await page.locator('#jiraGrantAccess').click();
      await expect(page.locator('#jiraAccessStatus')).toHaveText('jiraUrlInvalid');
      await page.clock.runFor(600);
      await expect(page.locator('#status')).toHaveText('jiraUrlInvalid');
    });
  }
  expect(await page.evaluate(() => ({url: saved.jira_url, requests: requests.length, writes: writes.length})))
    .toEqual({url: 'https://jira.test/jira', requests: 0, writes: 0});
  await input.fill('');
  await page.clock.runFor(600);
  expect(await page.evaluate(() => saved.jira_url)).toBe('');
  await expect(page.locator('#jiraAccessStatus')).toBeEmpty();
});

test('permission replies for an edited or replaced form cannot mark another Jira site as granted', async ({page}) => {
  await mountSettings(page, {url: 'https://jira.test/jira'});
  await page.locator('#jiraGrantAccess').click();
  await page.locator('#jira_url').fill('https://other.test/context');
  await page.evaluate(() => replyPermission(true));
  await expect(page.locator('#jiraAccessStatus')).toHaveText('jiraErrorPermission');
  await expect(page.locator('#jiraGrantAccess')).toBeEnabled();
  await page.locator('#jiraGrantAccess').click();
  await page.locator('#jira_url').evaluate(input => input.closest('.field').remove());
  await page.evaluate(() => replyPermission(false, true));
  expect(await page.evaluate(() => errorReads)).toBe(1);
  expect(await page.evaluate(() => requests.map(request => request.permissions.origins)))
    .toEqual([['https://jira.test/*'], ['https://other.test/*']]);
});
