const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let context, worker, extensionId, profile;
const runtimeErrors = [];

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
    await page.locator('#ai_review_prompt').fill('Preserve this edited instruction');
    await page.locator('#tabs [data-tab="team/form-fixture"]').click();
    await expect(page.locator('#profileVersionStrategy')).toHaveValue('major');
    await page.locator('#profileVersionStrategy').selectOption('patch');
    await page.locator('#tabs [data-tab="default"]').click();
    await expect(page.locator('#ai_review_prompt')).toHaveValue('Preserve this edited instruction');
    await page.locator('#language').selectOption('ru');
    await expect(page.locator('#language')).toHaveValue('ru');
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get(['ai_review_prompt', 'projectProfiles', 'language']))).toMatchObject({
      ai_review_prompt: 'Preserve this edited instruction', language: 'ru',
      projectProfiles: {'team/form-fixture': {versionFile: 'VERSION', versionStrategy: 'patch'}},
    });
    await page.reload();
    await expect(page.locator('#ai_review_prompt')).toHaveValue('Preserve this edited instruction');
    await page.locator('#tabs [data-tab="team/form-fixture"]').click();
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
    const details = page.locator('details').filter({has:page.locator('#failed_jobs_limit')});
    await details.locator('summary').click();
    await page.locator('#failed_jobs_limit').fill('3');
    await page.locator('#failed_job_trace_lines').fill('100');
    await page.locator('#reviewer_notes_limit').fill('25');
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
    await details.locator('summary').click();
    await expect(page.locator('#failed_jobs_limit')).toHaveValue('3');
    await expect(page.locator('#sensitive_file_patterns')).toHaveValue('private/*\n*.token');
    await fs.mkdir(path.resolve('.reports'), {recursive:true});
    await expect(page.locator("#status")).not.toBeVisible();
    await details.screenshot({path:path.resolve('.reports/display-preferences-en.png')});
    await page.locator('#mr_size_lines').fill('30, 10, 20');
    await page.locator('#failed_jobs_limit').fill('4');
    await expect(page.locator('#status')).toContainText('three increasing');
    expect(await worker.evaluate(() => chrome.storage.sync.get(['mr_size_lines', 'failed_jobs_limit']))).toEqual({mr_size_lines:'20, 80, 300', failed_jobs_limit:3});
    await page.locator('#mr_size_lines').fill('30, 60, 90');
    await page.locator('#language').selectOption('ru');
    await expect(page.locator('#failed_jobs_limit')).toHaveValue('4');
    await details.locator('summary').click();
    await expect(details.locator('summary')).toHaveText('Правила отображения и ограничения');
    await expect(page.locator("#status")).not.toBeVisible();
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
