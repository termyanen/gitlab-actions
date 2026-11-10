const { test, expect } = require('@playwright/test');
const { bundleForTest } = require('../helpers/runtime.cjs');

async function mount(page, entry, setup) {
  await page.goto('about:blank');
  await page.evaluate(() => {
    window.pending = [];
    window.chrome = {
      i18n: {getMessage: key => key},
      runtime: {sendMessage: (message, callback) => pending.push({message, callback})},
      storage: {sync: {get: (keys, callback) => pending.push({message: {type: 'storage'}, callback})}},
    };
    window.reply = (type, response, ticket) => {
      const index = pending.findIndex(p => p.message.type === type && (!ticket || p.message.ticket === ticket));
      if (index < 0) throw new Error('Missing request: ' + type);
      pending.splice(index, 1)[0].callback(response);
    };
  });
  await page.addScriptTag({content: bundleForTest('src/shared/lib/lifecycle/index.ts', {globalName: 'Lifecycle'})});
  await page.addScriptTag({content: bundleForTest(entry, {globalName: 'Widget'})});
  await page.evaluate(setup);
}

test('standup ignores out-of-order reports and replies after closing', async ({page}) => {
  await mount(page, 'src/widgets/standup/index.ts', () => {
    window.scope = Lifecycle.createLifecycle();
    window.dialog = Widget.createStandupDialog(scope);
    dialog.open();
  });
  await page.locator('.gl-standup-prev').click();
  await page.evaluate(() => {
    pending[1].callback({text: 'Selected date'});
    pending[0].callback({text: 'Stale report'});
    pending.length = 0;
  });
  await expect(page.locator('.gl-standup-content')).toHaveText('Selected date');
  await page.locator('.gl-standup-prev').click();
  await page.locator('.gl-standup-close').click();
  await page.evaluate(() => { reply('generate-standup', {text: 'Closed report'}); dialog.open(); });
  await expect(page.locator('.gl-standup-content')).toHaveCount(0);
  await page.evaluate(() => dialog.open());
  await expect(page.locator('.gl-standup-overlay')).toHaveCount(0);
  await page.evaluate(() => { dialog.open(); scope.dispose(); });
  await expect(page.locator('.gl-standup-overlay')).toHaveCount(0);
});

test('standup clipboard denial is handled and a later copy can succeed', async ({page}) => {
  const errors = [], diagnostics = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await mount(page, 'src/widgets/standup/index.ts', () => {
    let attempts = 0;
    window.copied = [];
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
      writeText: text => {
        if (++attempts === 1) return Promise.reject(new Error('Clipboard denied'));
        copied.push(text);
        return Promise.resolve();
      }
    }});
    window.scope = Lifecycle.createLifecycle();
    window.dialog = Widget.createStandupDialog(scope);
    dialog.open();
    reply('generate-standup', {text: 'Daily report'});
  });
  const copy = page.locator('.gl-standup-copy');
  await copy.click();
  await expect.poll(() => diagnostics.join('\n')).toContain('Clipboard denied');
  await expect(copy).toHaveText('standupCopy');
  await copy.click();
  await expect(copy).toContainText('standupCopied');
  expect(await page.evaluate(() => copied)).toEqual(['Daily report']);
  expect(errors).toEqual([]);
  await page.evaluate(() => scope.dispose());
});

test('standup preserves GitLab activity and offers a read retry when configured Jira enrichment fails', async ({page}) => {
  await mount(page, 'src/widgets/standup/index.ts', () => {
    window.scope = Lifecycle.createLifecycle();
    window.dialog = Widget.createStandupDialog(scope);
    dialog.open();
    reply('generate-standup', {text:'Completed GitLab work', _jiraUrl:'https://jira.test/jira', _jiraFailure:{_error:'401', _errorKind:'auth', _httpStatus:401}});
  });
  await expect(page.locator('.gl-standup-content')).toHaveText('Completed GitLab work');
  await expect(page.getByRole('alert')).toContainText('jiraErrorAuth');
  await page.getByRole('button', {name:'jiraRetryRead'}).click();
  await page.evaluate(() => reply('generate-standup', {text:'Completed GitLab work with Jira details'}));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.gl-standup-content')).toHaveText('Completed GitLab work with Jira details');
  await page.evaluate(() => scope.dispose());
});

async function mountJira(page) {
  await mount(page, 'src/widgets/jira-panel/index.ts', () => {
    window.scope = Lifecycle.createLifecycle();
    window.invalidated = [];
    window.jiraState = {cache: {}, myselfCache: {}, url: 'https://wrong.test', skipConfirmations: true, invalidateCommitTicket: ticket => invalidated.push(ticket)};
    window.panel = Widget.createJiraPanel(jiraState, scope);
    window.openTicket = ticket => panel.openJiraSidebar(ticket, 'https://jira.test');
    window.issue = key => ({key, summary: key, status: 'Open', statusCategoryKey: 'new', description: '', assignee: '', reporter: '', priority: '', type: '', created: '', updated: '', resolution: '', epicLink: '', sprint: '', labels: [], attachments: {}, attachmentList: [], components: [], versions: [], fixVersions: []});
  });
}

test('switching Jira tickets isolates pending comments and settings callbacks', async ({page}) => {
  await mountJira(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    openTicket('ABC-1'); reply('fetch-jira-issue', issue('ABC-1'));
  });
  await page.locator('#gl-jira-sidebar-comment-input').fill('Old ticket comment');
  await page.locator('#gl-jira-sidebar-comment-submit').click();
  await page.evaluate(() => {
    openTicket('ABC-2'); reply('fetch-jira-issue', issue('ABC-2'));
    reply('post-jira-comment', {comment: {id: '42', author: 'Tester', authorId: '7', body: 'Old ticket comment', created: ''}});
    reply('storage', {jiraQuickActions: []}); // Settings request from ABC-1.
  });
  await expect(page.locator('.gl-jira-sidebar-comment')).toHaveCount(0);
  await expect(page.locator('.gl-jira-sidebar-header a')).toHaveAttribute('href', 'https://jira.test/browse/ABC-2');
  expect(await page.evaluate(() => pending.filter(p => p.message.type === 'fetch-jira-transitions' && p.message.ticket === 'ABC-1').length)).toBe(0);
  expect(errors).toEqual([]);
});

test('closing Jira cancels view callbacks while completed mutations still invalidate issue data', async ({page}) => {
  await mountJira(page);
  await page.evaluate(() => {
    openTicket('ABC-1'); reply('fetch-jira-issue', issue('ABC-1'));
    reply('storage', {jiraQuickActions: [{label: 'Assign', assignee: 'tester'}]});
    jiraState.cache['ABC-1'] = {name: 'Open'};
  });
  await page.locator('.gl-jira-sidebar-quick-action').click();
  await page.evaluate(() => {
    openTicket('ABC-2'); reply('fetch-jira-issue', issue('ABC-2'));
    reply('execute-jira-quick-action', {success: true});
  });
  expect(await page.evaluate(() => ({cached: 'ABC-1' in jiraState.cache, invalidated}))).toEqual({cached: false, invalidated: ['ABC-1']});
  await expect(page.locator('.gl-jira-sidebar-title')).toHaveText('ABC-2');
  await page.evaluate(() => openTicket('ABC-2'));
  await expect(page.locator('.gl-jira-sidebar')).toHaveCount(0);
});

test('Jira comments handle first-page loading, posting into a nonempty list and deleting the last comment', async ({page}) => {
  await mountJira(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    openTicket('ABC-1'); reply('fetch-jira-issue', issue('ABC-1'));
    reply('fetch-jira-myself', {id: '7'});
    reply('fetch-jira-comments', {comments: [{id: '1', author: 'Tester', authorId: '7', body: 'First', created: ''}], total: 1});
  });
  await expect(page.locator('.gl-jira-sidebar-comment')).toHaveCount(1);
  await expect(page.locator('.gl-jira-sidebar-load-more')).toHaveCount(0);
  await page.locator('#gl-jira-sidebar-comment-input').fill('Second');
  await page.locator('#gl-jira-sidebar-comment-submit').click();
  await page.evaluate(() => reply('post-jira-comment', {comment: {id: '2', author: 'Tester', authorId: '7', body: 'Second', created: ''}}));
  await expect(page.locator('.gl-jira-sidebar-comment')).toHaveCount(2);
  await expect(page.locator('#gl-jira-sidebar-comments-header')).toContainText('(2)');
  for (let remaining = 1; remaining >= 0; remaining--) {
    await page.locator('.gl-jira-sidebar-comment-delete').first().click();
    await page.evaluate(() => reply('delete-jira-comment', {success: true}));
    await expect(page.locator('.gl-jira-sidebar-comment')).toHaveCount(remaining);
  }
  await expect(page.locator('.gl-jira-sidebar-comments-empty')).toHaveText('jiraSidebarNoComments');
  await expect(page.locator('#gl-jira-sidebar-comments-header')).toContainText('(0)');
  expect(errors).toEqual([]);
  await page.evaluate(() => scope.dispose());
});

test('reusing the Jira panel keeps one media handler and releases it on disposal', async ({page}) => {
  await mountJira(page);
  await page.evaluate(() => {
    window.lightboxes = 0;
    const append = document.body.appendChild;
    document.body.appendChild = function (node) {
      if (node.classList.contains('gl-jira-lightbox')) lightboxes++;
      return append.call(this, node);
    };
    for (let i = 0; i < 40; i++) {
      openTicket('ABC-' + i);
      reply('fetch-jira-issue', issue('ABC-' + i));
    }
    document.querySelector('.gl-jira-sidebar-body').innerHTML = '<img class="gl-jira-sidebar-img" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';
    document.querySelector('img').click();
  });
  expect(await page.evaluate(() => lightboxes)).toBe(1);
  await page.evaluate(() => scope.dispose());
  await expect(page.locator('.gl-jira-sidebar, .gl-jira-lightbox')).toHaveCount(0);
});

test('Jira assignee search ignores older results, including after clearing the input', async ({page}) => {
  await mountJira(page);
  await page.evaluate(() => {openTicket('ABC-1'); reply('fetch-jira-issue', issue('ABC-1'));});
  await page.locator('#gl-jira-sidebar-assignee').click();
  const input = page.locator('.gl-jira-sidebar-assignee-input');
  await input.fill('First');
  await expect.poll(() => page.evaluate(() => pending.filter(p => p.message.type === 'search-jira-assignable').length)).toBe(1);
  await input.fill('Second');
  await expect.poll(() => page.evaluate(() => pending.filter(p => p.message.type === 'search-jira-assignable').length)).toBe(2);
  await page.evaluate(() => {
    const requests = pending.filter(p => p.message.type === 'search-jira-assignable');
    requests[1].callback({users: [{key: 'second', name: 'Second user', avatar: ''}]});
    requests[0].callback({users: [{key: 'first', name: 'First user', avatar: ''}]});
    pending = pending.filter(p => p.message.type !== 'search-jira-assignable');
  });
  await expect(page.locator('.gl-jira-sidebar-assignee-results')).toHaveText('Second user');
  await input.fill('Third');
  await expect.poll(() => page.evaluate(() => pending.some(p => p.message.type === 'search-jira-assignable'))).toBe(true);
  await input.fill('');
  await page.evaluate(() => reply('search-jira-assignable', {users: [{key: 'third', name: 'Third user', avatar: ''}]}));
  await expect(page.locator('.gl-jira-sidebar-assignee-results')).toBeEmpty();
});

test('pending standup requests do not retain closed dialog DOM', async ({page, context}) => {
  await mount(page, 'src/widgets/standup/index.ts', () => {
    window.scope = Lifecycle.createLifecycle();
    window.dialog = Widget.createStandupDialog(scope);
  });
  const cdp = await context.newCDPSession(page);
  async function sample() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return cdp.send('Memory.getDOMCounters');
  }
  await page.evaluate(() => {dialog.open(); dialog.open();});
  const before = await sample();
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) {dialog.open(); dialog.open();}
  });
  const after = await sample();
  expect(await page.evaluate(() => pending.length)).toBe(101); // Replies deliberately remain undelivered.
  expect(after.nodes - before.nodes).toBeLessThanOrEqual(10);
  expect(after.jsEventListeners - before.jsEventListeners).toBe(0);
  await cdp.detach();
});

test('pending Jira reads do not retain the views of previous tickets', async ({page, context}) => {
  await mountJira(page);
  const cdp = await context.newCDPSession(page);
  async function sample() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return cdp.send('Memory.getDOMCounters');
  }
  await page.evaluate(() => {openTicket('ABC-0'); reply('fetch-jira-issue', issue('ABC-0'));});
  const before = await sample();
  await page.evaluate(() => {
    for (let i = 1; i <= 100; i++) {openTicket('ABC-' + i); reply('fetch-jira-issue', issue('ABC-' + i));}
  });
  const after = await sample();
  expect(after.nodes - before.nodes).toBeLessThanOrEqual(10);
  expect(after.jsEventListeners - before.jsEventListeners).toBe(0);
  await cdp.detach();
});
