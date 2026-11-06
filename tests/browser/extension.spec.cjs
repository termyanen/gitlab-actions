const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let context, worker, extensionId, profile;
const runtimeErrors = [];

test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlab-extension-browser-'));
  const extension = path.resolve(__dirname, '../../dist');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.on('page', (page) => page.on('pageerror', (error) => runtimeErrors.push(error.message)));
  [worker] = context.serviceWorkers();
  worker ||= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  // Every HTTP(S) request is intercepted; no real GitLab/Jira is contacted.
  await context.route(/^https?:/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/v4/')) {
      let body = {};
      if (url.pathname.endsWith('/user')) body = { id: 7, username: 'tester' };
      else if (url.pathname.endsWith('/merge_requests/42')) body = {
        id: 42, iid: 42, project_id: 37, title: 'Fixture merge request', state: 'opened',
        source_branch: 'feature', target_branch: 'main', sha: 'a'.repeat(40),
        source_project_id: 37, target_project_id: 37, merge_status: 'can_be_merged',
      };
      else if (url.pathname.endsWith('/projects/37')) body = { id: 37, path_with_namespace: 'team/repo', merge_method: 'merge' };
      else body = [];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: { 'x-next-page': '' } });
      return;
    }
    const gitlab = url.hostname === 'gitlab.test';
    await route.fulfill({ contentType: 'text/html', headers: gitlab ? {'Content-Security-Policy': "default-src 'self'; script-src 'none'; style-src 'none'; img-src 'self' data:; connect-src 'self'"} : {}, body: `<!doctype html><html><head>
      ${gitlab ? '<meta content="GitLab"><meta name="csrf-token" content="fixture">' : ''}
      <title>Extension fixture</title></head><body ${gitlab ? 'data-page="projects:merge_requests:show" data-project-id="37"' : ''}>
      <main><h1>Fixture</h1><div class="merge-request-details"><div class="detail-page-header"></div>
      <div class="mr-widget"><div class="mr-widget-section"></div></div></div><div class="notes"></div></main>
      </body></html>` });
  });
});

test.afterAll(async () => {
  if (context) await context.close();
  if (profile) await fs.rm(profile, { recursive: true, force: true });
});

test('installed production worker and settings page use real Chrome APIs', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator('#exportSettings')).toBeEnabled();
  await expect(page.locator('#importSettings')).toBeEnabled();
  await expect(page.locator('#versionFilePreset')).toHaveValue('package.json');
  const saved = await worker.evaluate(async () => await chrome.storage.sync.get('btn_rebase_automerge'));
  expect(saved.btn_rebase_automerge).toBe(true);
  await page.locator('#versionStrategy').selectOption('minor');
  await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.sync.get('versionStrategy')).versionStrategy)).toBe('minor');
  await page.reload();
  await expect(page.locator('#versionStrategy')).toHaveValue('minor');
  await page.close();
});

test('a non-GitLab HTTPS page receives no extension controls or API requests', async () => {
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('https://ordinary.test/example');
  await page.waitForTimeout(1200);
  await expect(page.locator('[class*="gl-review"], .gl-mr-actions-ext, .gl-tracker-fab')).toHaveCount(0);
  expect(requests.filter((url) => url.includes('/api/v4/') || url.includes('/rest/api/') || url.includes('/modules/'))).toEqual([]);
  await expect(page.locator('html')).not.toHaveClass(/gl-actions-host/);
  await page.close();
});

test('review controls mount once on GitLab and tolerate repeated DOM updates', async () => {
  const page = await context.newPage();
  await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
  await expect(page.locator('.gl-review-launcher:not(.gl-review-import-launcher)')).toHaveCount(1);
  await page.evaluate(() => {
    for (let i = 0; i < 25; i++) document.querySelector('main').append(document.createElement('span'));
  });
  await expect(page.locator('.gl-review-launcher:not(.gl-review-import-launcher)')).toHaveCount(1);
  await page.close();
  expect(runtimeErrors).toEqual([]);
});

test('page messages cannot invoke merge request actions', async () => {
  const page = await context.newPage();
  const mutations = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v4/') && request.method() !== 'GET') mutations.push(request.url());
  });
  await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
  await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
  await page.evaluate(() => window.postMessage({type: 'gl-mr-ext-palette-action', actionId: 'mr-pipeline-restart'}, '*'));
  await page.waitForTimeout(250);
  expect(mutations).toEqual([]);
  await page.close();
});

test('installed worker restores task status after Chromium stops the service worker', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator('#exportSettings')).toBeEnabled();
  await worker.evaluate(async () => chrome.storage.local.set({job_chain_state_v1: {
    'task-browser-recovery': {gitlabUrl: 'https://gitlab.test', projectId: 37, mrIid: 42, jobs: ['build'], currentIndex: 0, pipelineId: 100, status: 'error', error: 'Cancelled by user', _cancelled: true, phase: 'waiting'}
  }}));
  const cdp = await context.newCDPSession(page);
  const versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', event => versions.push(...event.versions));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.find(version => version.scriptURL === `chrome-extension://${extensionId}/background.js`)?.versionId).toBeTruthy();
  const version = versions.find(version => version.scriptURL === `chrome-extension://${extensionId}/background.js`);
  await cdp.send('ServiceWorker.stopWorker', {versionId: version.versionId});
  const response = await page.evaluate(async () => chrome.runtime.sendMessage({type: 'get-task-status', taskId: 'task-browser-recovery'}));
  expect(response).toEqual({status: 'error', error: 'Cancelled by user'});
  [worker] = context.serviceWorkers();
  await cdp.detach();
  await page.close();
  expect(runtimeErrors).toEqual([]);
});


test('SPA navigation disposes route UI and remounts it without duplicates', async () => {
  const page = await context.newPage();
  await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
  await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => history.pushState({}, '', '/team/repo/-/tree/main'));
    await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(0);
    await expect(page.locator('.gl-review-launcher')).toHaveCount(0);
    await page.evaluate(() => history.pushState({}, '', '/team/repo/-/merge_requests/42'));
    await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
    await expect(page.locator('.gl-review-launcher:not(.gl-review-import-launcher)')).toHaveCount(1);
  }
  await page.close();
  expect(runtimeErrors).toEqual([]);
});

test('packaged lazy dialogs and palette work under a restrictive page CSP', async () => {
  const page = await context.newPage();
  const scripts = [];
  page.on('request', request => {if (request.url().includes('/modules/')) scripts.push(request.url());});
  await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
  const launcher = page.locator('.gl-review-launcher:not(.gl-review-import-launcher)');
  await expect(launcher).toHaveCount(1);
  const initial = scripts.length;
  await launcher.click();
  await expect(page.locator('.gl-review-overlay')).toBeVisible();
  await expect(page.locator('.gl-review-overlay')).toHaveCSS('position', 'fixed');
  await expect.poll(() => scripts.length).toBeGreaterThan(initial);
  await page.keyboard.press('Escape');
  await expect(page.locator('.gl-review-overlay')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await expect(page.locator('.gl-cmd-palette-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gl-cmd-palette-overlay')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await expect(page.locator('.gl-cmd-palette-overlay')).toHaveCount(1);
  await page.close();
  expect(runtimeErrors).toEqual([]);
});
