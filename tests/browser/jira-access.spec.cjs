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

async function mountSettings(page, {url = '', granted = false, delayContains = false} = {}) {
  // Settings use Web Locks, available on the extension's secure origin.
  await page.route('https://extension.test/**', route => route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  await page.goto('https://extension.test/popup.html');
  await page.clock.install();
  await page.setContent(fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
  await page.evaluate(({url, granted, delayContains}) => {
    window.saved = {jira_url: url, language: 'auto', projectProfiles: {'team/fixture': {}}};
    window.writes = [];
    window.requests = [];
    window.grants = new Set(granted ? [new URL(url).origin + '/*'] : []);
    window.errorReads = 0;
    window.permissionChecks = [];
    const storageListeners = new Set();
    window.chrome = {
      runtime: {getURL: path => 'https://extension.test/' + path, getManifest: () => ({version: '1.0.0'})},
      i18n: {getMessage: key => key, getUILanguage: () => 'en'},
      tabs: {query: (_query, callback) => callback([])},
      action: {setBadgeText: (_details, callback) => callback?.()},
      storage: {onChanged: {addListener: listener => storageListeners.add(listener), removeListener: listener => storageListeners.delete(listener)}, sync: {
        get: (keys, callback) => callback(Array.isArray(keys) || keys === null ? {...saved} : {...keys, ...saved}),
        set: (settings, callback) => {
          writes.push(settings);
          const changes = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, {oldValue: saved[key], newValue: value}]));
          Object.assign(saved, settings);
          storageListeners.forEach(listener => listener(changes, 'sync'));
          callback?.();
        },
      }},
      permissions: {
        contains: ({origins}, callback) => {
          const granted = origins.every(origin => grants.has(origin));
          if (delayContains) permissionChecks.push({callback, granted});
          else callback(granted);
        },
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
    window.replyChecks = () => permissionChecks.splice(0).forEach(({callback, granted}) => callback(granted));
  }, {url, granted, delayContains});
  await page.addScriptTag({content: bundleForTest('src/pages/settings/index.ts', {globalName: 'Settings'})});
  await page.evaluate(() => Settings.startSettings());
  await expect(page.locator('#profileScope')).toBeVisible();
  await expect(page.locator('#settingsSearch')).toBeEnabled();
  await page.locator('#settingsNav [data-category="jira"]').click();
  await expect(page.locator('#jira_url')).toBeVisible();
}

test('Jira URL autosave preserves the context path and unrelated settings without requesting permission', async ({page}) => {
  await mountSettings(page);
  await page.locator('#jira_url').fill('https://jira.test/jira/');
  await page.locator('#settingsNav [data-category="general"]').click();
  await page.locator('#sound_enabled').check();
  await page.locator('#settingsNav [data-category="jira"]').click();
  await page.clock.runFor(600);
  await expect.poll(() => page.evaluate(() => ({url: saved.jira_url, sound: saved.sound_enabled, requests: requests.length})))
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
  await expect.poll(() => page.evaluate(() => saved.jira_url)).toBe('');
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
  // Replace the React form through the real scope transition, rather than
  // removing a node behind React's back and leaving its component mounted.
  const oldInput = await page.locator('#jira_url').elementHandle();
  await page.locator('#settingsNav [data-category="actions"]').click();
  await page.locator('#profileScope').selectOption('team/fixture');
  await expect.poll(() => oldInput.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.locator('#jira_url')).toHaveCount(1);
  await page.evaluate(() => replyPermission(false, true));
  expect(await page.evaluate(() => errorReads)).toBe(1);
  expect(await page.evaluate(() => requests.map(request => request.permissions.origins)))
    .toEqual([['https://jira.test/*'], ['https://other.test/*']]);
});

test('late permission checks cannot overwrite an explicit Jira grant for the same URL', async ({page}) => {
  await mountSettings(page, {url:'https://jira.test/jira', delayContains:true});
  const status = page.locator('#jiraAccessStatus');
  await expect.poll(() => page.evaluate(() => permissionChecks.length)).toBe(1);
  await page.locator('#jiraGrantAccess').click();
  // A focus read can begin while the browser's permission request is pending.
  await page.locator('#jira_url').focus();
  await expect.poll(() => page.evaluate(() => permissionChecks.length)).toBe(2);
  await page.evaluate(() => replyPermission(true));
  await expect(status).toHaveText('jiraAccessGranted');
  await page.evaluate(() => replyChecks());
  await expect(status).toHaveText('jiraAccessGranted');
  // Fresh checks must still detect a later revocation.
  await page.evaluate(() => grants.clear());
  await page.locator('#settingsSearch').focus();
  await page.locator('#jira_url').focus();
  await expect.poll(() => page.evaluate(() => permissionChecks.length)).toBe(1);
  await page.evaluate(() => replyChecks());
  await expect(status).toHaveText('jiraErrorPermission');
  expect(await page.evaluate(() => requests.length)).toBe(1);
});
