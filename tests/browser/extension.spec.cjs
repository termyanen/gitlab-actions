const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let context, worker, extensionId, profile;
const runtimeErrors = [];
async function section(page, category) { await page.locator('#settingsNav [data-category="' + category + '"]').click(); }
async function policy(page, id) { const detail = page.locator('details').filter({has:page.locator('#' + id)}); if (!await detail.getAttribute('open').then(v => v !== null)) await detail.locator('summary').click(); }

function fixtureMr(iid, overrides = {}) {
  return {
    id: iid, iid, project_id: 37, title: 'Fixture merge request ' + iid, state: 'opened',
    source_branch: 'feature-' + iid, target_branch: 'main', sha: 'a'.repeat(40),
    source_project_id: 37, target_project_id: 37, merge_status: 'can_be_merged',
    ...overrides,
  };
}

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
      else if (/\/merge_requests\/\d+$/.test(url.pathname)) body = fixtureMr(Number(url.pathname.split('/').pop()));
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
      <div class="mr-widget"><div class="mr-widget-section"></div></div></div><div class="detail-page-description"></div><div class="notes"></div></main>
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

test('settings forms preserve drafts across profile switches and language re-rendering', async () => {
  const keys = ['projectProfiles', 'ai_review_prompt', 'language'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  await worker.evaluate(() => chrome.storage.sync.set({
    projectProfiles: {'team/form-fixture': {versionFile: 'VERSION', versionStrategy: 'major'}},
    ai_review_prompt: 'Saved instruction', language: 'en',
  }));
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#ai_review_prompt')).toHaveValue('Saved instruction');
    await section(page, 'ai');
    await page.locator('#ai_review_prompt').fill('Preserve this edited instruction');
    await section(page, 'actions');
    await page.locator('#profileScope').selectOption('team/form-fixture');
    await expect(page.locator('#profileVersionStrategy')).toHaveValue('major');
    await page.locator('#profileVersionStrategy').selectOption('patch');
    await page.locator('#profileScope').selectOption('default');
    await expect(page.locator('#ai_review_prompt')).toHaveValue('Preserve this edited instruction');
    await section(page, 'general');
    await page.locator('#language').selectOption('ru');
    await expect(page.locator('#language')).toHaveValue('ru');
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get(['ai_review_prompt', 'projectProfiles', 'language']))).toMatchObject({
      ai_review_prompt: 'Preserve this edited instruction', language: 'ru',
      projectProfiles: {'team/form-fixture': {versionFile: 'VERSION', versionStrategy: 'patch'}},
    });
    await page.reload();
    await expect(page.locator('#ai_review_prompt')).toHaveValue('Preserve this edited instruction');
    await section(page, 'actions');
    await page.locator('#profileScope').selectOption('team/form-fixture');
    await expect(page.locator('#profileVersionStrategy')).toHaveValue('patch');
  } finally {
    await page.close();
    await worker.evaluate(async ({keys, previous}) => {
      await chrome.storage.sync.remove(keys);
      await chrome.storage.sync.set(previous);
    }, {keys, previous});
  }
  expect(runtimeErrors).toEqual([]);
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

test('opening settings through the worker completes without a closed-message-port error', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/welcome.html`);
  const opened = context.waitForEvent('page');
  const error = await page.evaluate(() => new Promise(resolve => {
    chrome.runtime.sendMessage({type: 'open-options'}, () => resolve(chrome.runtime.lastError?.message || null));
  }));
  const settings = await opened;
  await settings.waitForLoadState();
  try {
    expect(settings.url()).toBe(`chrome-extension://${extensionId}/popup.html`);
    expect(error).toBeNull();
  } finally {
    await settings.close();
    await page.close();
  }
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

test('SPA navigation replaces Git commands and removes the previous MR failed jobs', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({show_git_commands: true, show_failed_job_view: true}));
  const page = await context.newPage();
  try {
    await page.route('**/api/v4/**', async route => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname.endsWith('/merge_requests/42')) body = fixtureMr(42, {head_pipeline: {id: 100, status: 'failed'}});
      else if (url.pathname.endsWith('/pipelines/100/jobs')) body = [{id: 8, name: 'old-build', stage: 'test'}];
      else if (url.pathname.endsWith('/jobs/8/trace')) return route.fulfill({body: 'old trace'});
      else return route.fallback();
      await route.fulfill({contentType: 'application/json', body: JSON.stringify(body)});
    });
    await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
    await expect(page.locator('.gl-mr-actions-failed-jobs')).toContainText('old-build');
    await expect(page.locator('.gl-mr-ext-git-cmd-btn').first()).toHaveAttribute('title', /feature-42/);
    await page.evaluate(() => history.pushState({}, '', '/team/repo/-/merge_requests/43'));
    await expect(page.locator('.gl-mr-ext-git-cmd-btn').first()).toHaveAttribute('title', /feature-43/);
    await expect(page.locator('.gl-mr-actions-failed-jobs')).toHaveCount(0);
  } finally {
    await page.close();
    await worker.evaluate(() => chrome.storage.sync.remove('show_git_commands'));
  }
});

test('late trace and sensitive-file responses cannot render into another MR', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({show_sensitive_warning: true}));
  const page = await context.newPage();
  let release;
  const held = new Promise(resolve => {release = resolve;});
  let waiting = 0;
  try {
    await page.route('**/api/v4/**', async route => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname.endsWith('/merge_requests/42')) body = fixtureMr(42, {head_pipeline: {id: 100, status: 'failed'}});
      else if (url.pathname.endsWith('/pipelines/100/jobs')) body = [{id: 8, name: 'old-build', stage: 'test'}];
      else if (url.pathname.endsWith('/jobs/8/trace')) {
        waiting++; await held; return route.fulfill({body: 'old trace'});
      } else if (url.pathname.endsWith('/merge_requests/42/diffs')) {
        waiting++; await held; body = [{new_path: '.env', old_path: '.env'}];
      } else return route.fallback();
      await route.fulfill({contentType: 'application/json', body: JSON.stringify(body)});
    });
    await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
    await expect.poll(() => waiting).toBe(2);
    await page.evaluate(() => history.pushState({}, '', '/team/repo/-/merge_requests/43'));
    await page.waitForResponse(response => response.url().endsWith('/merge_requests/43'));
    await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
    release();
    await page.waitForTimeout(300);
    await expect(page.locator('.gl-mr-actions-failed-jobs, .gl-mr-ext-sensitive-warning')).toHaveCount(0);
  } finally {
    release();
    await page.close();
    await worker.evaluate(() => chrome.storage.sync.remove('show_sensitive_warning'));
  }
});

test('SPA navigation closes a palette with actions belonging to the previous MR', async () => {
  const page = await context.newPage();
  const writes = [];
  page.on('request', request => {
    if (request.url().includes('/api/v4/') && request.method() !== 'GET') writes.push(request.url());
  });
  try {
    await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
    await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.gl-cmd-palette-overlay')).toBeVisible();
    await page.locator('.gl-cmd-palette-input').fill(await worker.evaluate(() => chrome.i18n.getMessage('labelMarkDraft')));
    await expect(page.locator('.gl-cmd-palette-item')).toHaveCount(1);
    await page.evaluate(() => {
      history.pushState({}, '', '/team/repo/-/merge_requests/43');
      // Before the route timer runs, a stale Enter must not invoke an MR action.
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    });
    await expect(page.locator('.gl-cmd-palette-overlay')).toHaveCount(0);
    await page.waitForResponse(response => response.url().endsWith('/merge_requests/43'));
    expect(writes).toEqual([]);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.gl-cmd-palette-overlay')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.gl-cmd-palette-overlay')).toHaveCount(0);
  } finally {
    await page.close();
  }
  expect(runtimeErrors).toEqual([]);
});

test('a live job chain survives a real worker restart without replaying its play request', async () => {
  test.setTimeout(60_000);
  const gitlab = await context.newPage();
  const popup = await context.newPage();
  const writes = [];
  let completed = false;
  try {
    await gitlab.route('**/api/v4/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      let body;
      if (url.pathname.endsWith('/merge_requests/42')) body = fixtureMr(42, {head_pipeline: {id: 100, project_id: 37, status: 'running'}});
      else if (url.pathname.endsWith('/pipelines/100/jobs')) body = [{id: 8, name: 'build', status: completed ? 'success' : writes.length ? 'running' : 'manual'}];
      else if (url.pathname.endsWith('/jobs/8/play') && request.method() === 'POST') {
        writes.push(url.pathname); body = {id: 8};
      } else return route.fallback();
      await route.fulfill({contentType: 'application/json', body: JSON.stringify(body)});
    });
    await gitlab.goto('https://gitlab.test/team/repo/-/merge_requests/42');
    await expect(gitlab.locator('.gl-mr-actions-ext')).toHaveCount(1);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const {taskId} = await popup.evaluate(() => chrome.runtime.sendMessage({type: 'start-job-chain', gitlabUrl: 'https://gitlab.test', projectId: 37, mrIid: 42, jobs: ['build']}));
    await expect.poll(() => popup.evaluate(async id => (await chrome.storage.local.get('job_chain_state_v1')).job_chain_state_v1[id]?.phase, taskId)).toBe('waiting');
    expect(writes).toHaveLength(1);
    const cdp = await context.newCDPSession(popup);
    const versions = [];
    cdp.on('ServiceWorker.workerVersionUpdated', event => versions.push(...event.versions));
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versions.find(version => version.scriptURL === `chrome-extension://${extensionId}/background.js`)?.versionId).toBeTruthy();
    completed = true;
    await cdp.send('ServiceWorker.stopWorker', {versionId: versions.find(version => version.scriptURL === `chrome-extension://${extensionId}/background.js`).versionId});
    await expect.poll(() => popup.evaluate(id => chrome.runtime.sendMessage({type: 'get-task-status', taskId: id}), taskId).then(response => response.status), {timeout: 30_000}).toBe('done');
    expect(writes).toEqual(['/api/v4/projects/37/jobs/8/play']);
    [worker] = context.serviceWorkers();
    await cdp.detach();
  } finally {
    await popup.close();
    await gitlab.close();
  }
  expect(runtimeErrors).toEqual([]);
});

test('an in-flight MR action keeps its original target during SPA DOM replacement', async () => {
  const page = await context.newPage();
  let release;
  const held = new Promise(resolve => {release = resolve;});
  let waiting = false;
  const writes = [];
  try {
    await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
    await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
    await page.route('**/api/v4/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'PUT') {
        writes.push(url.pathname);
        return route.fulfill({contentType: 'application/json', body: JSON.stringify(fixtureMr(42))});
      }
      if (url.pathname.endsWith('/merge_requests/42')) {
        waiting = true;
        await held;
        return route.fulfill({contentType: 'application/json', body: JSON.stringify(fixtureMr(42))});
      }
      return route.fallback();
    });
    await page.locator('.gl-mr-actions-ext .btn-draft').click();
    await expect.poll(() => waiting).toBe(true);
    await page.evaluate(() => {
      history.pushState({}, '', '/team/repo/-/merge_requests/43');
      document.querySelector('.gl-mr-actions-ext').remove();
    });
    await expect(page.locator('.gl-mr-actions-ext')).toHaveCount(1);
    release();
    await expect.poll(() => writes).toEqual(['/api/v4/projects/37/merge_requests/42']);
  } finally {
    release();
    await page.close();
  }
});

test('SPA disposal restores native approval badges and removes generated approval badges', async () => {
  await worker.evaluate(() => chrome.storage.sync.set({show_approval_badge: true}));
  const page = await context.newPage();
  try {
    await page.route('**/api/v4/**/approvals', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({approved_by: [{user: {username: 'tester', name: 'Tester'}}]})}));
    await page.route('https://gitlab.test/team/repo/-/merge_requests', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head><meta content="GitLab"></head><body data-page="projects:merge_requests:index" data-project-id="37">
      <ul class="issuable-list">${[42, 43].map(iid => `<li class="merge-request"><span class="merge-request-title-text"><a href="/team/repo/-/merge_requests/${iid}">MR ${iid}</a></span><ul class="controls">${iid === 42 ? '<li><span data-testid="mr-approvals" title="Native title"><span class="gl-badge-content">Approved</span></span></li>' : ''}</ul></li>`).join('')}</ul></body></html>`}));
    await page.goto('https://gitlab.test/team/repo/-/merge_requests');
    await expect(page.locator('.gl-mr-ext-approval-done')).toHaveCount(2);
    await page.evaluate(() => history.pushState({}, '', '/team/repo/-/tree/main'));
    await expect(page.locator('.gl-mr-ext-approval-done')).toHaveCount(0);
    await expect(page.locator('[data-testid="mr-approvals"]')).toHaveAttribute('title', 'Native title');
    await expect(page.locator('.gl-badge-content')).toHaveText('Approved');
    await expect(page.locator('.merge-request').nth(1).locator('.controls > li')).toHaveCount(0);
  } finally {
    await page.close();
    await worker.evaluate(() => chrome.storage.sync.remove('show_approval_badge'));
  }
  expect(runtimeErrors).toEqual([]);
});

test('display preferences save, survive reload and reject invalid policies atomically', async () => {
  const keys = ['language', 'failed_jobs_limit', 'failed_job_trace_lines', 'reviewer_notes_limit', 'mr_size_lines', 'mr_size_files', 'sensitive_file_defaults', 'sensitive_file_patterns', 'sensitive_file_exclusions'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en'}));
    await page.setViewportSize({width:420, height:900});
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await section(page, 'ci');
    const details = page.locator('details').filter({has:page.locator('#failed_jobs_limit')});
    await details.locator('summary').click();
    await page.locator('#failed_jobs_limit').fill('3');
    await page.locator('#failed_job_trace_lines').fill('100');
    await section(page, 'actions');
    await policy(page, 'reviewer_notes_limit');
    await page.locator('#reviewer_notes_limit').fill('25');
    await section(page, 'appearance');
    await policy(page, 'mr_size_lines');
    await page.locator('#mr_size_lines').fill('20, 80, 300');
    await page.locator('#mr_size_files').fill('2, 8, 20');
    await page.locator('#sensitive_file_defaults').uncheck();
    await page.locator('#sensitive_file_patterns').fill('private/*\n*.token');
    await page.locator('#sensitive_file_exclusions').fill('*.example');
    await expect.poll(() => worker.evaluate(keys => chrome.storage.sync.get(keys), keys)).toMatchObject({
      failed_jobs_limit:3, failed_job_trace_lines:100, reviewer_notes_limit:25,
      mr_size_lines:'20, 80, 300', mr_size_files:'2, 8, 20', sensitive_file_defaults:false,
      sensitive_file_patterns:'private/*\n*.token', sensitive_file_exclusions:'*.example',
    });
    await page.reload();
    await section(page, 'ci');
    await details.locator('summary').click();
    await expect(page.locator('#failed_jobs_limit')).toHaveValue('3');
    await expect(page.locator('#sensitive_file_patterns')).toHaveValue('private/*\n*.token');
    await fs.mkdir(path.resolve('.reports'), {recursive:true});
    await expect(page.locator("#status")).toBeVisible();
    await details.screenshot({path:path.resolve('.reports/display-preferences-en.png')});
    await section(page, 'appearance');
    await policy(page, 'mr_size_lines');
    await page.locator('#mr_size_lines').fill('30, 10, 20');
    await page.locator('#settingsSearch').fill('');
    await page.locator('#settingsNav [data-category="ci"]').click();
    await page.locator('#failed_jobs_limit').fill('4');
    await expect(page.locator('#status')).toContainText('three increasing');
    expect(await worker.evaluate(() => chrome.storage.sync.get(['mr_size_lines', 'failed_jobs_limit']))).toEqual({mr_size_lines:'20, 80, 300', failed_jobs_limit:3});
    await section(page, 'appearance');
    await page.locator('#mr_size_lines').fill('30, 60, 90');
    await section(page, 'general');
    await page.locator('#language').selectOption('ru');
    await expect(page.locator('#failed_jobs_limit')).toHaveValue('4');
    await section(page, 'ci');
    await details.locator('summary').click();
    await expect(details.locator('summary')).toHaveText('Правила отображения и ограничения');
    await expect(page.locator("#status")).toBeVisible();
    await details.screenshot({path:path.resolve('.reports/display-preferences-ru.png')});
  } finally {
    await page.close();
    await worker.evaluate(async ({keys, previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys, previous});
  }
});

test('failed-job preview respects job and line limits and links to the complete pipeline', async () => {
  const keys = ['language', 'show_failed_job_view', 'failed_jobs_limit', 'failed_job_trace_lines'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  const traces = [];
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', show_failed_job_view:true, failed_jobs_limit:2, failed_job_trace_lines:10}));
    await page.route('**/api/v4/**', async route => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname.endsWith('/merge_requests/42')) body = fixtureMr(42, {head_pipeline:{id:100, status:'failed'}});
      else if (url.pathname.endsWith('/pipelines/100/jobs')) {
        expect(url.searchParams.get('per_page')).toBe('3');
        body = [1,2,3].map(id => ({id, name:'failed-'+id, stage:'test'}));
      } else if (/\/jobs\/\d+\/trace$/.test(url.pathname)) {
        traces.push(url.pathname);
        return route.fulfill({body:Array.from({length:15}, (_, i) => 'line-'+(i+1)).join('\n\n')});
      } else return route.fallback();
      await route.fulfill({contentType:'application/json', body:JSON.stringify(body)});
    });
    await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
    await expect(page.locator('.gl-mr-actions-failed-job-item')).toHaveCount(2);
    await expect(page.locator('.gl-mr-actions-failed-jobs-title')).toHaveText('Preview: 2 failed job(s) — last 10 non-empty lines');
    const lines = (await page.locator('.gl-mr-actions-failed-job-trace').first().textContent()).split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe('line-6');
    expect(traces).toHaveLength(2);
    await expect(page.locator('a.gl-mr-actions-failed-jobs-more')).toHaveAttribute('href', 'https://gitlab.test/team/repo/-/pipelines/100');
  } finally {
    await page.close();
    await worker.evaluate(async ({keys, previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys, previous});
  }
});

test('sensitive-file rules scan later pages, honor exclusions and disclose API failure', async () => {
  const keys = ['language', 'show_sensitive_warning', 'sensitive_file_defaults', 'sensitive_file_patterns', 'sensitive_file_exclusions', 'show_time_tracker', 'btn_rebase_automerge', 'btn_pipeline_restart', 'btn_pipeline_cancel', 'btn_draft_toggle', 'btn_retry_failed'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  let failSecondPage = false;
  const pages = [];
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', show_sensitive_warning:true, sensitive_file_defaults:false, sensitive_file_patterns:'private/*.txt', sensitive_file_exclusions:'private/public.txt', show_time_tracker:false, btn_rebase_automerge:false, btn_pipeline_restart:false, btn_pipeline_cancel:false, btn_draft_toggle:false, btn_retry_failed:false}));
    await page.route('**/api/v4/**/merge_requests/42/diffs?*', async route => {
      const current = Number(new URL(route.request().url()).searchParams.get('page'));
      pages.push(current);
      if (current === 2 && failSecondPage) return route.fulfill({status:503, body:'Unavailable'});
      const paths = current === 1 ? ['.env', 'private/public.txt', ...Array.from({length:98}, (_, i) => 'src/'+i+'.ts')] : ['private/secret.txt'];
      await route.fulfill({contentType:'application/json', body:JSON.stringify(paths.map(path => ({new_path:path, old_path:path})))});
    });
    await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
    const badge = page.locator('.gl-mr-ext-sensitive-warning');
    await expect(badge).toContainText('1');
    await expect(badge).toBeVisible();
    await expect(page.locator('.gl-mr-actions-ext button')).toHaveCount(0);
    await expect(badge).toHaveAttribute('title', /private\/secret\.txt/);
    expect(await badge.getAttribute('title')).not.toContain('private/public.txt');
    expect(pages).toEqual([1,2]);
    failSecondPage = true;
    await page.reload();
    await expect(badge).toHaveText('Sensitive-file scan incomplete');
    await expect(badge).toHaveAttribute('title', /1000-file scan limit/);
  } finally {
    await page.close();
    await worker.evaluate(async ({keys, previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys, previous});
  }
});

test('pipeline group play skips unrelated columns and recovers when its pipeline disappears', async () => {
  const page = await context.newPage();
  const writes = [];
  try {
    await page.route('https://gitlab.test/team/repo/-/pipelines/100', route => route.fulfill({contentType:'text/html', body:`<!doctype html><html><head><meta content="GitLab"><meta name="csrf-token" content="fixture"></head><body data-page="projects:pipelines:show">
      <div data-testid="stage-column" id="unrelated"><div data-testid="stage-column-title"><span title="test">test</span></div><a href="/team/repo/-/jobs/999">Nested job</a></div>
      <div data-testid="stage-column" id="known"><div data-testid="stage-column-title"><span title="test">test</span></div><a href="/team/repo/-/jobs/8">Manual job</a></div>
      </body></html>`}));
    await page.route('**/api/v4/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET') writes.push(url.pathname);
      const body = url.pathname.endsWith('/pipelines/100/jobs') ? [{id:8, name:'manual-build', status:'manual', stage:'test'}] : [];
      await route.fulfill({contentType:'application/json', body:JSON.stringify(body)});
    });
    await page.goto('https://gitlab.test/team/repo/-/pipelines/100');
    const button = page.locator('#known .gl-group-play-btn');
    await expect(button).toBeVisible();
    await expect(page.locator('#unrelated .gl-group-play-btn')).toHaveCount(0);
    const failed = await page.evaluate(async () => {
      const link = document.querySelector('#known a');
      const original = link.getAttribute('href');
      const button = document.querySelector('#known .gl-group-play-btn');
      link.href = '/team/repo/-/jobs/999';
      button.click();
      // Drain the cached pipeline promise and its failure handler before the graph refresh.
      await new Promise(resolve => setTimeout(resolve, 0));
      const outcome = { error: button.classList.contains('gl-group-play-error'), loading: button.classList.contains('gl-group-play-busy') };
      link.setAttribute('href', original);
      return outcome;
    });
    expect(failed).toEqual({error:true, loading:false});
    expect(writes).toEqual([]);
    await button.click();
    await expect.poll(() => writes).toEqual(['/api/v4/projects/team%2Frepo/jobs/8/play']);
    await expect(button).toHaveClass(/gl-group-play-done/);
    await expect(button).not.toHaveClass(/gl-group-play-error/);
  } finally {
    await page.close();
  }
});

test('all interface languages load, persist and keep AI language independent', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const locales = (await fs.readdir(path.resolve(__dirname, '../../_locales'), {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => entry.name);
    await expect(page.locator('#language option')).toHaveCount(locales.length + 1);
    await expect(page.locator('#ai_review_response_language option')).toHaveCount(locales.length + 1);
    for (const locale of locales) {
      const messages = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../_locales', locale, 'messages.json'), 'utf8'));
      await section(page, 'general');
    await page.locator('#language').selectOption(locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale.replace('_','-'));
      await expect(page.locator('#language option[value="auto"]')).toHaveText(messages.languageAuto.message);
      await expect(page.locator('#settingsNav [data-category="actions"]')).toHaveAccessibleName(messages.settingsActions.message);
      await section(page, 'actions');
      await expect(page.locator('.page-heading h1')).toHaveText(messages.settingsActions.message);
      await section(page, 'general');
      await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.sync.get('language')).language)).toBe(locale);
      await page.reload();
      await expect(page.locator('#language')).toHaveValue(locale);
      if (['it', 'pt_BR', 'pl', 'nl', 'ko', 'hi', 'th', 'el', 'fi'].includes(locale)) await page.screenshot({path: testInfo.outputPath('settings-' + locale + '.png')});
      await expect(page.locator('html')).toHaveAttribute('lang', locale.replace('_','-'));
      await expect(page.locator('#language option[value="auto"]')).toHaveText(messages.languageAuto.message);
      await expect(page.locator('#settingsNav [data-category="actions"]')).toHaveAccessibleName(messages.settingsActions.message);
      await section(page, 'actions');
      await expect(page.locator('.page-heading h1')).toHaveText(messages.settingsActions.message);
      await section(page, 'general');
    }
    await section(page, 'ai');
    await page.locator('#ai_review_response_language').selectOption('pt_BR');
    await expect.poll(async () => worker.evaluate(async () => (await chrome.storage.sync.get('ai_review_response_language')).ai_review_response_language)).toBe('pt_BR');
    await section(page, 'general');
    await page.locator('#language').selectOption('pl');
    await expect(page.locator('#ai_review_response_language')).toHaveValue('pt_BR');

  } finally {
    await worker.evaluate(async () => chrome.storage.sync.set({language: 'en', ai_review_response_language: 'auto'}));
    await page.close();
  }
});

test('settings redesign retains every original control, scopes and editor deletions', async ({}, testInfo) => {
  const inventory = require('../fixtures/settings-control-inventory.json');
  const keys = ['language', 'projectProfiles', 'quickComments', 'cherry_pick_branches', 'buttonOrder'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', projectProfiles:{'team/design':{}}, quickComments:[{label:'LGTM',text:'Looks good'}], cherry_pick_branches:['release/test']}));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#profileScope')).toBeVisible();
    for (const id of inventory.default) {
      await expect(page.locator('#'+id)).toHaveCount(1);
      expect(await page.locator('#'+id).evaluate(node => !!node.closest('.settings-section[data-category]')), id).toBe(true);
    }
    const initialIds = await page.locator('.tab-content input[id], .tab-content select[id], .tab-content textarea[id]').evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(initialIds).size).toBe(initialIds.length);
    await page.locator('#quickCommentsList .remove-btn').click();
    await page.locator('#cherryPickBranchesList .remove-btn').click();
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get(['quickComments','cherry_pick_branches']))).toEqual({quickComments:[],cherry_pick_branches:[]});
    const firstKey = await page.locator('#buttonOrder .btn-item').first().getAttribute('data-key');
    await page.locator('#buttonOrder .btn-item').first().getByRole('button', {name:/Move down/}).click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('buttonOrder')).buttonOrder?.[1])).toBe(firstKey);
    expect(await page.locator('#buttonOrder .btn-item').nth(1).getAttribute('data-key')).toBe(firstKey);
    await page.locator('#profileScope').selectOption('team/design');
    for (const id of inventory.profile) await expect(page.locator('#'+id)).toHaveCount(1);
    await section(page, 'jira');
    await expect(page.locator('#globalOnlyHint')).toBeHidden();
    await expect(page.locator('[data-setting="jira_url"]')).toContainText('All projects');
    await expect(page.locator('#jira_url')).toBeVisible();
    await page.locator('#profileScope').selectOption('default');
    await expect(page.locator('#globalOnlyHint')).toBeHidden();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('#status')).toBeVisible();
    await page.screenshot({path: testInfo.outputPath('jira-light.png'), fullPage:true});
    await page.emulateMedia({colorScheme:'dark'});
    await page.screenshot({path: testInfo.outputPath('jira-dark.png'), fullPage:true});
    for (const category of ['actions','ci','jira','ai','appearance','general','data']) {
      await section(page, category);
      await page.setViewportSize({width:390,height:850});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), category).toBe(true);
    }
    await page.locator('#settingsSearch').fill('Jira');
    await expect(page.locator('#jira_url')).toBeVisible();
    await page.locator('#settingsSearch').fill('zzzzzz-no-setting');
    await expect(page.locator('#settingsNoResults')).toBeVisible();
    await page.locator('#settingsSearch').fill('');
    await section(page, 'actions');
    await page.locator('#profileScope').selectOption('team/design');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', {name:'Remove profile', exact:true}).click();
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get('projectProfiles'))).toEqual({projectProfiles:{}});
    await page.reload();
    await expect(page.locator('#profileScope option')).toHaveCount(1);
  } finally {
    await page.close();
    await worker.evaluate(async ({keys, previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys, previous});
  }
});

test('compact popup keeps global toggles, project links and every locale within Chrome limits', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const keys = ['language','sound_enabled','jira_url','projectProfiles'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  const calls = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) calls.push(request.url()); });
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', sound_enabled:false, jira_url:'', projectProfiles:{}}));
    await page.goto(`chrome-extension://${extensionId}/quick-popup.html`);
    await expect(page.locator('#sound_enabled')).toBeVisible();
    await page.locator('#sound_enabled').check();
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get('sound_enabled'))).toEqual({sound_enabled:true});
    await page.screenshot({path:testInfo.outputPath('popup-light.png')});
    const newPage = context.waitForEvent('page');
    await page.getByRole('button', {name:'All settings', exact:true}).click();
    const opened = await newPage;
    await expect(opened.locator('#profileScope')).toBeVisible();
    await opened.close();
    const locales = (await fs.readdir(path.resolve('_locales'), {withFileTypes:true})).filter(entry => entry.isDirectory()).map(entry => entry.name);
    for (const locale of locales) {
      await worker.evaluate(language => chrome.storage.sync.set({language}), locale);
      await page.reload();
      const messages = JSON.parse(await fs.readFile(path.resolve('_locales',locale,'messages.json'),'utf8'));
      await expect(page.getByRole('button', {name:messages.settingsAll.message,exact:true})).toBeVisible();
      await expect(page.locator('.popup-shortcuts [data-category="actions"]')).toHaveAccessibleName(messages.settingsActions.message);
      const size = await page.locator('#popupRoot').boundingBox();
      expect(size.height).toBeLessThanOrEqual(600);
      expect(await page.evaluate(() => document.body.scrollWidth <= 410)).toBe(true);
      await page.emulateMedia({colorScheme:'dark'});
      if (['ru','de','hi','th'].includes(locale)) await page.locator('#popupRoot').screenshot({path:testInfo.outputPath('popup-'+locale+'-dark.png')});
    }
    expect(calls).toEqual([]);
  } finally {
    await page.close();
    await worker.evaluate(async ({keys, previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys, previous});
  }
});


test('popup preserves release notices and carries commit project context into settings', async () => {
  const keys = ['language','projectProfiles','update_version','update_dismissed'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en',projectProfiles:{'team/commit-project':{}},update_version:'9.9.9',update_dismissed:''}));
    await page.addInitScript(() => {
      // Only the active-tab context is supplied by a fixture; storage remains real.
      chrome.tabs.query = (_query, callback) => callback([{url:'https://gitlab.test/team/commit-project/-/commit/abc123'}]);
    });
    await page.goto(`chrome-extension://${extensionId}/quick-popup.html`);
    await expect(page.locator('.project-card')).toContainText('team/commit-project');
    await expect(page.locator('.update-banner')).toContainText('v9.9.9');
    await expect(page.getByRole('button', {name:'Jira integration', exact:true})).toBeVisible();
    await page.locator('.update-banner').getByRole('button', {name:'Close',exact:true}).click();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('update_dismissed')).update_dismissed)).toBe('9.9.9');
    const pagesBefore = context.pages().length;
    await page.getByRole('button', {name:'MR & commits',exact:true}).click();
    const settings = page.frameLocator('#popupSettingsEditor');
    await expect(settings.locator('#profileScope')).toHaveValue('team/commit-project');
    await expect(settings.locator('#profileVersionStrategy')).toBeVisible();
    await settings.locator('#profileReviewersJob').fill('inline-job');
    for (const section of ['ci','jira','ai','appearance','general','data','actions']) {
      await page.locator('.popup-shortcuts [data-category="'+section+'"]').click();
      await expect(settings.locator('#settingsNav [data-category="'+section+'"]')).toHaveAttribute('aria-current','page');
    }
    await expect(settings.locator('#profileReviewersJob')).toHaveValue('inline-job');
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('projectProfiles')).projectProfiles['team/commit-project'].reviewersJob)).toBe('inline-job');
    expect(context.pages().length).toBe(pagesBefore);
    for (const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      await page.screenshot({path:'.reports/inline-popup-'+colorScheme+'.png',fullPage:true});
      expect(await settings.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.locator('.popup-shortcuts [data-category="actions"]').click();
    await expect(page.locator('#popupSettingsEditor')).toBeHidden();
    await page.locator('.popup-shortcuts [data-category="actions"]').click();
    await expect(settings.locator('#profileReviewersJob')).toHaveValue('inline-job');
    await expect.poll(() => settings.locator('.settings-shell').evaluate(el => Math.ceil(el.getBoundingClientRect().height))).toBeGreaterThan(600);
    await expect.poll(() => settings.locator('body').evaluate(el => el.scrollHeight <= innerHeight + 2)).toBe(true);
    const editorNode = await page.locator('#popupSettingsEditor').elementHandle();
    await worker.evaluate(() => chrome.storage.sync.set({language:'ru'}));
    await expect(page.locator('html')).toHaveAttribute('lang','ru');
    expect(await editorNode.evaluate(node => node.isConnected)).toBe(true);
    await worker.evaluate(() => chrome.storage.sync.set({language:'en'}));
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    const openedGuide = context.waitForEvent('page');
    await page.locator('.popup-shortcuts').getByRole('link', {name:'How it works',exact:true}).click();
    const guide = await openedGuide;
    try {
      await expect(guide.locator('.welcome-card')).toHaveCount(44);
      expect(new URL(guide.url()).pathname).toBe('/welcome.html');
    } finally { await guide.close(); }
    await page.reload();
    await expect(page.locator('.update-banner')).toBeHidden();
  } finally {
    await page.close();
    await worker.evaluate(async ({keys,previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys,previous});
  }
});


test('settings keep failed drafts, wait for storage before switching scope and allow explicit retry', async () => {
  const keys = ['language', 'projectProfiles', 'reviewersList'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', reviewersList:'original', projectProfiles:{'team/save-state':{}}}));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#status')).toHaveText('Changes save automatically.');
    await page.evaluate(() => {
      const set = chrome.storage.sync.set.bind(chrome.storage.sync);
      window.pendingWrites = [];
      chrome.storage.sync.set = (data, callback) => pendingWrites.push({data, callback});
      window.replyWrite = (failed) => {
        const {data, callback} = pendingWrites.shift();
        if (!failed) return set(data, callback);
        Object.defineProperty(chrome.runtime, 'lastError', {configurable:true, get:() => ({message:'Fixture quota failure'})});
        callback();
        delete chrome.runtime.lastError;
      };
    });
    await page.locator('#reviewersList').fill('preserved-draft');
    await expect.poll(() => page.evaluate(() => pendingWrites.length)).toBe(1);
    await expect(page.locator('#status')).toHaveText('Saving…');
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', {cancelable:true})))).toBe(true);
    await page.evaluate(() => replyWrite(true));
    await expect(page.locator('#retrySave')).toBeVisible();
    await page.locator('#profileScope').selectOption('team/save-state');
    await expect.poll(() => page.evaluate(() => pendingWrites.length)).toBe(1);
    await expect(page.locator('#profileScope')).toHaveValue('default');
    await expect(page.locator('#reviewersList')).toHaveValue('preserved-draft');
    await page.evaluate(() => replyWrite(true));
    await expect(page.locator('#profileScope')).toHaveValue('default');
    await expect(page.locator('#status')).toHaveText('Settings could not be saved. Please retry.');
    await expect(page.locator('#retrySave')).toBeVisible();
    await page.getByRole('button', {name:'Retry',exact:true}).click();
    await expect.poll(() => page.evaluate(() => pendingWrites.length)).toBe(1);
    await page.evaluate(() => replyWrite(false));
    await expect(page.locator('#status')).toHaveText('Saved!');
    await expect(page.locator('#retrySave')).toBeHidden();
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', {cancelable:true})))).toBe(false);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('reviewersList')).reviewersList)).toBe('preserved-draft');
    await page.locator('#profileScope').selectOption('team/save-state');
    await expect(page.locator('#profileVersionStrategy')).toBeVisible();
    await expect(page.locator('#profileReviewersList')).toHaveAttribute('placeholder', 'preserved-draft');
    await expect(page.locator('#profileVersionFilePreset option').first()).toContainText('package.json');
    // Search is global, even while the selected project has its own profile.
    await page.locator('#settingsSearch').fill('Jira');
    await expect(page.locator('#jira_url')).toBeVisible();
    await expect(page.locator('#globalOnlyHint')).toBeHidden();
    await expect(page.locator('[data-setting="jira_url"]')).toContainText('All projects');
    await expect(page.locator('#settingsSearch')).toBeFocused();
    await page.locator('#settingsSearch').fill('');
    await expect(page.locator('#profileVersionStrategy')).toBeVisible();
    await expect(page.locator('#profileScope')).toHaveValue('team/save-state');
  } finally {
    await page.close();
    await worker.evaluate(async ({keys, previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys, previous});
  }
});

test('settings read failure leaves editing locked and offers a working reload', async () => {
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('read-failed')) return;
      sessionStorage.setItem('read-failed', 'yes');
      chrome.storage.sync.get = (_keys, callback) => {
        Object.defineProperty(chrome.runtime, 'lastError', {configurable:true, get:() => ({message:'Fixture read failure'})});
        callback({});
        delete chrome.runtime.lastError;
      };
    });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#status')).toHaveClass('status failed');
    await expect(page.locator('#settingsSearch')).toBeDisabled();
    await expect(page.locator('.tab-content input')).toHaveCount(0);
    await page.locator('#retrySave').click();
    await expect(page.locator('#profileScope')).toBeVisible();
    await expect(page.locator('#settingsSearch')).toBeEnabled();
    await expect(page.locator('#retrySave')).toBeHidden();
  } finally { await page.close(); }
});

test('all legacy switches and toolbar buttons round-trip through the redesigned form', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', projectProfiles:{}}));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#profileScope')).toBeVisible();
    const controls = await page.locator('.tab-content input[type="checkbox"]').evaluateAll(inputs => inputs.flatMap(input => {
      const key = input.id || input.closest('[data-key]')?.dataset.key;
      if (!key || input.disabled || key.startsWith('ai_review_rule_')) return [];
      return [{key, checked:!input.checked, category:input.closest('.settings-section').dataset.category}];
    }));
    const expected = {};
    for (const control of controls) {
      await section(page, control.category);
      const input = control.key.startsWith('btn_') ? page.locator('#buttonOrder [data-key="'+control.key+'"] input') : page.locator('#'+control.key);
      const details = input.locator('xpath=ancestor::details');
      for (const detail of await details.all()) if (!await detail.getAttribute('open').then(v => v !== null)) await detail.locator('summary').first().click();
      await input.setChecked(control.checked);
      expected[control.key] = control.checked;
    }
    expect(Object.keys(expected).length).toBeGreaterThan(45);
    await expect.poll(() => worker.evaluate(keys => chrome.storage.sync.get(keys), Object.keys(expected))).toEqual(expected);
    await page.reload();
    await expect(page.locator('#profileScope')).toBeVisible();
    for (const [key, value] of Object.entries(expected)) {
      const input = key.startsWith('btn_') ? page.locator('#buttonOrder [data-key="'+key+'"] input') : page.locator('#'+key);
      await expect(input).toBeChecked({checked:value});
    }
  } finally {
    await page.close();
    await worker.evaluate(async previous => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(previous); }, previous);
  }
});


test('popup changes stay in sync with an open settings form without losing unrelated edits', async () => {
  const keys = ['language','sound_enabled','notifications_enabled','show_jira_details','reviewersList'];
  const previous = await worker.evaluate(keys => chrome.storage.sync.get(keys), keys);
  const page = await context.newPage();
  const popup = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en', sound_enabled:false, notifications_enabled:false, show_jira_details:true, reviewersList:''}));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.goto(`chrome-extension://${extensionId}/quick-popup.html`);
    await expect(page.locator('#reviewersList')).toBeVisible();
    await popup.locator('#sound_enabled').check();
    await popup.locator('#notifications_enabled').check();
    await expect(popup.locator('#show_jira_details')).toHaveCount(0);
    await expect(page.locator('#show_jira_details')).toBeChecked();
    for (const id of ['sound_enabled','notifications_enabled']) await expect(page.locator('#'+id)).toBeChecked();
    await page.locator('#reviewersList').fill('keep-popup-settings');
    await expect(page.locator('#status')).toHaveText('Saved!');
    await expect.poll(() => worker.evaluate(keys => chrome.storage.sync.get(keys), keys)).toMatchObject({sound_enabled:true, notifications_enabled:true, show_jira_details:true, reviewersList:'keep-popup-settings'});
    await section(page, 'general');
    await page.locator('#sound_enabled').uncheck();
    await expect(popup.locator('#sound_enabled')).not.toBeChecked();
  } finally {
    await page.close(); await popup.close();
    await worker.evaluate(async ({keys, previous}) => { await chrome.storage.sync.remove(keys); await chrome.storage.sync.set(previous); }, {keys, previous});
  }
});

test('saving a checkbox in settings updates open MR tabs through real Chrome storage events',async()=>{
 const previous=await worker.evaluate(()=>chrome.storage.sync.get(null));
 const settings=await context.newPage();
 const mr=await context.newPage();
 try{
  await worker.evaluate(()=>chrome.storage.sync.set({language:'en',projectProfiles:{},customJobs:[{label:'Live deploy',jobName:'deploy'}],mrActions:[{id:'live-clear',label:'Live clear',type:'clear_labels',labels:''}]}));
  await mr.goto('https://gitlab.test/team/repo/-/merge_requests/42');
  await expect(mr.locator('.gl-mr-actions-ext').getByRole('button',{name:'Live deploy',exact:true})).toBeVisible();
  await settings.goto(`chrome-extension://${extensionId}/popup.html#section=actions`);
  await expect(settings.locator('#profileScope')).toBeVisible();
  await settings.locator('#profileScope').selectOption('default');
  await section(settings,'actions');
  const job=settings.locator('#buttonOrder').getByRole('checkbox',{name:'Live deploy',exact:true});
  const action=settings.locator('#buttonOrder').getByRole('checkbox',{name:'Live clear',exact:true});
  await job.uncheck();await action.uncheck();
  await expect(mr.locator('.gl-mr-actions-ext .btn-custom-job')).toHaveCount(0);
  await job.check();await action.check();
  await expect(mr.locator('.gl-mr-actions-ext .btn-custom-job')).toHaveText(['Live deploy','Live clear']);
  await expect(mr.locator('.gl-mr-actions-ext')).toHaveCount(1);
  expect(mr.url()).toBe('https://gitlab.test/team/repo/-/merge_requests/42');
 }finally{
  await settings.close();await mr.close();
  await worker.evaluate(async previous=>{await chrome.storage.sync.clear();await chrome.storage.sync.set(previous);},previous);
 }
 expect(runtimeErrors).toEqual([]);
});

test('installed MR toolbar loads matching layout styles under the GitLab page CSP',async()=>{
 const previous=await worker.evaluate(()=>chrome.storage.sync.get(null));
 const page=await context.newPage();
 try{
  await worker.evaluate(()=>chrome.storage.sync.set({language:'ru',projectProfiles:{},show_time_tracker:true,customJobs:[{label:'Удалить все метки',jobName:'test'}],quickComments:[{label:'Плюс',text:'+'},{label:'Позвать ревьюера',text:'Review please'}]}));
  await page.route('**/api/v4/projects/37/merge_requests/42',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(fixtureMr(42,{created_at:'2026-11-06T12:00:00Z'}))}));
  await page.goto('https://gitlab.test/team/repo/-/merge_requests/42');
  await page.evaluate(()=>document.documentElement.classList.add('gl-dark'));
  const toolbar=page.locator('.gl-mr-actions-ext');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveCSS('flex-direction','column');
  await expect(page.locator('.gl-mr-actions-buttons')).toHaveCSS('display','flex');
  await expect(page.locator('.gl-mr-actions-buttons')).toHaveCSS('column-gap','8px');
  await expect(page.locator('.gl-mr-actions-comments')).toHaveCSS('display','flex');
  const positions=await page.evaluate(()=>{
   const actions=document.querySelector('.gl-mr-actions-buttons').getBoundingClientRect();
   const comments=document.querySelector('.gl-mr-actions-comments').getBoundingClientRect();
   const time=document.querySelector('.gl-mr-actions-time');
   return {actionsBottom:actions.bottom,commentsTop:comments.top,emoji:getComputedStyle(time,'::before').content,timeBackground:getComputedStyle(time).backgroundColor,timeBorder:getComputedStyle(time).borderWidth};
  });
  expect(positions.commentsTop).toBeGreaterThan(positions.actionsBottom);
  expect(positions.emoji).toBe('none');
  expect(positions.timeBackground).toBe('rgba(0, 0, 0, 0)');
  expect(positions.timeBorder).toBe('0px');
  await toolbar.screenshot({path:'.reports/toolbar-installed-css.png'});
 }finally{
  await page.close();
  await worker.evaluate(async previous=>{await chrome.storage.sync.clear();await chrome.storage.sync.set(previous);},previous);
 }
 expect(runtimeErrors).toEqual([]);
});

test('popup first reveal waits for Jira access state and keeps the project card below Jira', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en',jira_url:'https://jira.fixture.test',projectProfiles:{'team/stable':{}}}));
    await page.addInitScript(() => {
      chrome.tabs.query = (_query, callback) => callback([{url:'https://gitlab.test/team/stable/-/merge_requests/1'}]);
      chrome.permissions.contains = (_request, callback) => { window.releaseJiraAccess = () => callback(true); };
    });
    await page.goto(`chrome-extension://${extensionId}/quick-popup.html`);
    await expect.poll(() => page.evaluate(() => typeof window.releaseJiraAccess)).toBe('function');
    await expect(page.locator('.project-card')).toBeHidden();
    await page.evaluate(() => window.releaseJiraAccess());
    await expect(page.locator('.project-card')).toBeVisible();
    await expect(page.locator('.jira-access-summary')).toBeVisible();
    const positions = await page.evaluate(async () => {
      const samples=[];
      for(let i=0;i<12;i++) {
        await new Promise(requestAnimationFrame);
        const project=document.querySelector('.project-card').getBoundingClientRect();
        const jira=document.querySelector('.jira-access-summary').getBoundingClientRect();
        samples.push({top:project.top,afterJira:project.top>=jira.bottom});
      }
      return samples;
    });
    expect(positions.every(sample=>sample.afterJira)).toBe(true);
    expect(new Set(positions.map(sample=>sample.top)).size).toBe(1);
  } finally {
    await page.close();
    await worker.evaluate(async previous => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(previous); }, previous);
  }
});

test('release notice appears once in popup sections and remains available in standalone settings', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const popup = await context.newPage();
  const standalone = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'en',update_version:'9.9.9',update_dismissed:''}));
    await popup.goto(`chrome-extension://${extensionId}/quick-popup.html`);
    await standalone.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('.update-banner')).toBeVisible();
    await expect(standalone.locator('#updateBanner')).toBeVisible();
    await expect(standalone.locator('#status')).toHaveText('Changes save automatically.');
    for (const section of ['actions','jira','general']) {
      await popup.locator(`.popup-shortcuts [data-category="${section}"]`).click();
      const editor = popup.frameLocator('#popupSettingsEditor');
      await expect(editor.locator('#profileScope')).toBeVisible();
      await expect(editor.locator('.update-banner')).toHaveCount(0);
      await expect(editor.locator('#status')).toBeEmpty();
      await expect(popup.locator('.update-banner')).toHaveCount(1);
    }
    const editor = popup.frameLocator('#popupSettingsEditor');
    await editor.locator('#sound_enabled').click();
    await expect(editor.locator('#status')).toHaveText('Saved!');
    await popup.locator('.update-banner .update-close').click();
    await expect(popup.locator('.update-banner')).toBeHidden();
    await expect(standalone.locator('#updateBanner')).toBeHidden();
  } finally {
    await popup.close(); await standalone.close();
    await worker.evaluate(async previous => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(previous); }, previous);
  }
});

test('compact controls use readable consistent typography and padding in both themes', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  await page.setViewportSize({width:410,height:600});
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'ru',update_version:'',jira_url:'',projectProfiles:{},customJobs:[{label:'Проверить сборку',jobName:'build'}]}));
    await page.goto(`chrome-extension://${extensionId}/quick-popup.html`);
    const menu=page.locator('.popup-shortcuts [data-category="ci"]');
    await expect(menu).toBeVisible();
    for(const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      await page.screenshot({path:'.reports/compact-menu-'+colorScheme+'.png'});
      const metrics=await menu.evaluate(el=>({font:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight,padding:getComputedStyle(el).padding,height:el.getBoundingClientRect().height}));
      expect(metrics).toMatchObject({font:'14px',line:'20px',padding:'9px 12px'});
      expect(metrics.height).toBeGreaterThanOrEqual(40);
      await menu.click();
      const editor=page.frameLocator('#popupSettingsEditor');
      const button=editor.locator('#addCustomJob');
      await expect(button).toBeVisible();
      expect(await button.evaluate(el=>({font:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight,padding:getComputedStyle(el).padding,height:el.getBoundingClientRect().height}))).toEqual({font:'14px',line:'20px',padding:'7px 12px',height:36});
      expect(await editor.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
      await button.scrollIntoViewIfNeeded();
      await page.screenshot({path:'.reports/compact-editor-'+colorScheme+'.png'});
      await menu.click();
    }
  } finally {
    await page.close();
    await worker.evaluate(async previous=>{await chrome.storage.sync.clear();await chrome.storage.sync.set(previous);},previous);
  }
});

test('compact inheritance icons and Jira removal controls leave room for labels', async () => {
  const previous = await worker.evaluate(() => chrome.storage.sync.get(null));
  const page = await context.newPage();
  await page.setViewportSize({width:410,height:600});
  try {
    await worker.evaluate(() => chrome.storage.sync.set({language:'ru',jira_url:'',update_version:'',projectProfiles:{'team/spacing':{buttons:{btn_pipeline_cancel:false},versionFile:'VERSION'}},jiraQuickActions:[{label:'Версия 3.78',updates:[{field:'fixVersions',operation:'add',value:['Web 3.78']}]}]}));
    await page.goto(`chrome-extension://${extensionId}/quick-popup.html`);
    await page.locator('.popup-shortcuts [data-category="actions"]').click();
    const editor=page.frameLocator('#popupSettingsEditor');
    await editor.locator('#profileScope').selectOption('team/spacing');
    const row=editor.locator('#profileButtonOrder [data-key="btn_pipeline_cancel"]');
    const reset=row.locator('.inherit-reset');
    await expect(reset).toHaveAttribute('title',/Использовать общее/);
    expect(await reset.evaluate(el=>el.getBoundingClientRect().width)).toBe(32);
    await expect(reset.locator('span')).toBeHidden();
    expect(await row.locator('.btn-label').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(100);
    for(const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      await row.screenshot({path:'.reports/inheritance-row-'+colorScheme+'.png'});
    }
    await reset.click();
    await expect(reset).toHaveCount(0);
    await page.locator('.popup-shortcuts [data-category="jira"]').click();
    const jira=editor.locator('.jira-quick-action').first();
    const field=jira.locator('[data-part="field"]');
    const remove=jira.locator('.jqa-change .remove-btn');
    await expect(field).toBeVisible();
    await expect(remove).toBeVisible();
    const fieldBox=await field.boundingBox(), removeBox=await remove.boundingBox();
    expect(Math.abs(fieldBox.y+fieldBox.height/2-removeBox.y-removeBox.height/2)).toBeLessThan(2);
    expect(removeBox.x).toBeGreaterThan(fieldBox.x+fieldBox.width);
    await jira.screenshot({path:'.reports/jira-field-alignment.png'});
    await page.locator('.popup-shortcuts [data-category="data"]').click();
    await expect(editor.locator('#settingsTransferHint')).toBeVisible();
    expect(await editor.locator('#settingsTransferHint').evaluate(el=>el.getBoundingClientRect().top-el.previousElementSibling.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(12);
  } finally {
    await page.close();
    await worker.evaluate(async previous=>{await chrome.storage.sync.clear();await chrome.storage.sync.set(previous);},previous);
  }
});

test('compact Jira and scope sections collapse with keyboard and persist independently', async () => {
  await worker.evaluate(async () => chrome.storage.sync.set({ language: 'ru', jira_url: 'https://jira.fixture.test' }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 410, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/quick-popup.html`);
  const jira = page.locator('[data-popup-disclosure="jira"]');
  const scope = page.locator('[data-popup-disclosure="scope"]');
  await expect(jira).toHaveAttribute('open', '');
  await expect(scope).toHaveAttribute('open', '');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await jira.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(jira).not.toHaveAttribute('open');
    await expect(jira.locator('.jira-access-summary')).toBeHidden();
    await expect(scope).toHaveAttribute('open', '');
    await scope.locator('summary').click();
    await expect(scope).not.toHaveAttribute('open');
    await page.reload();
    await expect(jira.locator('summary')).toBeVisible();
    await expect(jira).not.toHaveAttribute('open');
    await expect(scope).not.toHaveAttribute('open');
    if (theme === 'dark') await page.screenshot({ path: '.reports/popup-disclosure-collapsed.png' });
    await jira.locator('summary').click();
    await scope.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(jira.locator('.jira-access-summary')).toBeVisible();
    await expect(scope).toHaveAttribute('open', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.evaluate(() => { localStorage.removeItem('popup.disclosure.jira'); localStorage.removeItem('popup.disclosure.scope'); });
  await page.close();
});
