const { test, expect } = require('@playwright/test');
const { bundleForTest } = require('../helpers/runtime.cjs');

const errors = new WeakMap();
test.beforeEach(({page}) => {
  const messages = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
});
test.afterEach(async ({page}) => {
  await page.evaluate(() => window.scope?.dispose());
  expect(errors.get(page)).toEqual([]);
});

async function mountJira(page) {
  await page.goto('about:blank');
  await page.evaluate(() => {
    window.pending = [];
    window.sent = [];
    window.chrome = {
      i18n: {getMessage: key => key},
      runtime: {sendMessage: (message, callback) => {
        sent.push(message);
        pending.push({message, callback});
      }},
      storage: {sync: {get: (_keys, callback) => pending.push({message: {type: 'storage'}, callback})}},
    };
    window.reply = (type, response) => {
      const index = pending.findIndex(p => p.message.type === type);
      if (index < 0) throw new Error('Missing request: ' + type);
      pending.splice(index, 1)[0].callback(response);
    };
  });
  await page.addScriptTag({content: bundleForTest('src/shared/lib/lifecycle/index.ts', {globalName: 'Lifecycle'})});
  await page.addScriptTag({content: bundleForTest('src/widgets/jira-panel/index.ts', {globalName: 'Widget'})});
  await page.evaluate(() => {
    window.scope = Lifecycle.createLifecycle();
    window.invalidated = [];
    window.jiraState = {cache: {}, myselfCache: {}, url: 'https://jira.test', skipConfirmations: true, invalidateCommitTicket: ticket => invalidated.push(ticket)};
    window.panel = Widget.createJiraPanel(jiraState, scope);
    window.issue = (status = 'Open') => ({key: 'TEAM-1', summary: 'A ticket', status, statusCategoryKey: status === 'Open' ? 'new' : 'done', description: '', assignee: 'Original assignee', reporter: '', priority: '', type: '', created: '', updated: '', resolution: '', epicLink: '', sprint: '', labels: [], attachments: {}, attachmentList: [], components: [], versions: [], fixVersions: []});
    panel.openJiraSidebar('TEAM-1', 'https://jira.test');
    reply('fetch-jira-issue', issue());
  });
}

async function loadEmptyComments(page) {
  await page.evaluate(() => {
    reply('fetch-jira-myself', {id: '7'});
    reply('fetch-jira-comments', {comments: [], total: 0});
  });
}

test('expired Jira identity and comment reads show sign-in guidance and recover through a read retry', async ({page}) => {
  await mountJira(page);
  await page.evaluate(() => {
    reply('fetch-jira-myself', {_error: '401 Unauthorized', _errorKind: 'auth', _httpStatus: 401});
    reply('fetch-jira-comments', {_error: '401 Unauthorized', _errorKind: 'auth', _httpStatus: 401});
  });
  const list = page.locator('#gl-jira-sidebar-comments-list');
  await expect(list.getByRole('alert')).toContainText('jiraErrorAuth');
  await expect(list.getByRole('link', {name: 'jiraOpenSite'})).toHaveAttribute('href', 'https://jira.test/');
  await expect(list).not.toContainText('jiraSidebarCommentError');
  await list.getByRole('button', {name: 'jiraRetryRead'}).click();
  await page.evaluate(() => {
    reply('fetch-jira-myself', {id: '7'});
    reply('fetch-jira-comments', {comments: [{id: '1', author: 'Me', authorId: '7', body: 'Recovered comment', created: ''}], total: 1});
  });
  await expect(list.getByRole('alert')).toHaveCount(0);
  await expect(list.locator('.gl-jira-sidebar-comment')).toHaveText(/Recovered comment/);
  await expect(list.locator('.gl-jira-sidebar-comment-delete')).toHaveCount(1);
  expect(await page.evaluate(() => sent.filter(message => message.type === 'fetch-jira-myself').length)).toBe(2);
});

test('comment failures keep the draft, prevent duplicate keyboard writes and do not automatically replay a mutation', async ({page}) => {
  await mountJira(page);
  await loadEmptyComments(page);
  const input = page.locator('#gl-jira-sidebar-comment-input');
  const submit = page.locator('#gl-jira-sidebar-comment-submit');
  await input.fill('First draft');
  await submit.click();
  await input.press('Control+Enter');
  await input.fill('Revised while sending');
  await input.press('Control+Enter');
  expect(await page.evaluate(() => sent.filter(message => message.type === 'post-jira-comment').length)).toBe(1);
  await page.evaluate(() => reply('post-jira-comment', {_error: 'Network lost', _errorKind: 'network'}));
  const failure = page.locator('#gl-jira-sidebar-comment-error');
  await expect(failure.getByRole('alert')).toContainText('jiraErrorNetwork');
  await expect(failure.getByRole('alert')).toContainText('jiraErrorWriteUncertain');
  await expect(failure.getByRole('button')).toHaveCount(0);
  await expect(input).toHaveValue('Revised while sending');
  await expect(submit).toBeEnabled();
  expect(await page.evaluate(() => sent.filter(message => message.type === 'post-jira-comment').length)).toBe(1);
  await submit.click();
  await input.fill('Next unsent draft');
  await page.evaluate(() => reply('post-jira-comment', {comment: {id: '2', author: 'Me', authorId: '7', body: 'Revised while sending', created: ''}}));
  await expect(input).toHaveValue('Next unsent draft');
  await expect(submit).toBeEnabled();
  await expect(page.locator('.gl-jira-sidebar-comment')).toHaveText(/Revised while sending/);
});

test('signing in as another Jira user refreshes comment ownership after a failed later page', async ({page}) => {
  await mountJira(page);
  await page.evaluate(() => {
    reply('fetch-jira-myself', {id: '7'});
    reply('fetch-jira-comments', {comments: [{id: '1', author: 'First user', authorId: '7', body: 'Original comment', created: ''}], total: 2});
  });
  await page.locator('.gl-jira-sidebar-load-more').click();
  await page.evaluate(() => reply('fetch-jira-comments', {_error: '401 Unauthorized', _errorKind: 'auth'}));
  await page.locator('#gl-jira-sidebar-comments-list').getByRole('button', {name: 'jiraRetryRead'}).click();
  await page.evaluate(() => {
    reply('fetch-jira-myself', {id: '8'});
    reply('fetch-jira-comments', {comments: [
      {id: '1', author: 'First user', authorId: '7', body: 'Original comment', created: ''},
      {id: '2', author: 'Second user', authorId: '8', body: 'New owner comment', created: ''},
    ], total: 2});
  });
  await expect(page.locator('.gl-jira-sidebar-comment')).toHaveCount(2);
  await expect(page.locator('[data-comment-id="1"] .gl-jira-sidebar-comment-delete')).toHaveCount(0);
  await expect(page.locator('[data-comment-id="2"] .gl-jira-sidebar-comment-delete')).toHaveCount(1);
  expect(await page.evaluate(() => sent.filter(message => message.type === 'fetch-jira-comments').map(message => message.startAt))).toEqual([0, 1, 0]);
});

test('assignee search distinguishes failure from no results and assignment failures reenable controls', async ({page}) => {
  await mountJira(page);
  await page.locator('#gl-jira-sidebar-assignee').click();
  const input = page.locator('.gl-jira-sidebar-assignee-input');
  const results = page.locator('.gl-jira-sidebar-assignee-results');
  const unassign = page.locator('.gl-jira-sidebar-unassign');
  await input.fill('Alice');
  await expect.poll(() => page.evaluate(() => pending.some(p => p.message.type === 'search-jira-assignable'))).toBe(true);
  await page.evaluate(() => reply('search-jira-assignable', {_error: '403 Forbidden', _errorKind: 'forbidden', _httpStatus: 403}));
  await expect(results.getByRole('alert')).toContainText('jiraErrorForbidden');
  await expect(results).not.toContainText('jiraSidebarNoUsers');
  await results.getByRole('button', {name: 'jiraRetryRead'}).click();
  await page.evaluate(() => reply('search-jira-assignable', {users: [{key: 'alice', name: 'Alice', avatar: ''}]}));
  await results.locator('.gl-jira-sidebar-assignee-item').click();
  await expect(unassign).toBeDisabled();
  await unassign.evaluate(button => button.click());
  expect(await page.evaluate(() => sent.filter(message => message.type === 'set-jira-assignee').length)).toBe(1);
  await page.evaluate(() => reply('set-jira-assignee', {_error: 'Network lost', _errorKind: 'network'}));
  await expect(results.getByRole('alert')).toContainText('jiraErrorNetwork');
  await expect(results.getByRole('alert')).toContainText('jiraErrorWriteUncertain');
  await expect(input).toBeEnabled();
  await expect(unassign).toBeEnabled();
  await expect(page.locator('#gl-jira-sidebar-assignee')).toContainText('Original assignee');
  await unassign.click();
  await page.evaluate(() => reply('set-jira-assignee', {_error: '403 Forbidden', _errorKind: 'forbidden'}));
  await expect(results.getByRole('alert')).toContainText('jiraErrorForbidden');
  await expect(unassign).toBeEnabled();
  expect(await page.evaluate(() => sent.filter(message => message.type === 'set-jira-assignee').length)).toBe(2);
  await unassign.click();
  await page.evaluate(() => reply('set-jira-assignee', {_error: '400 The assignee is required by this workflow', _errorKind: 'unknown', _httpStatus: 400}));
  await expect(results.getByRole('alert')).toContainText('The assignee is required by this workflow');
  await expect(unassign).toBeEnabled();
});

test('version reads can be retried and failed updates restore selection without concurrent replacement writes', async ({page}) => {
  await mountJira(page);
  await page.locator('#gl-jira-sidebar-fixversions').click();
  const list = page.locator('#gl-jira-sidebar-fixversions-list');
  await page.evaluate(() => reply('fetch-jira-versions', {_error: '503 Unavailable', _errorKind: 'unavailable', _httpStatus: 503}));
  await expect(list.getByRole('alert')).toContainText('jiraErrorUnavailable');
  await list.getByRole('button', {name: 'jiraRetryRead'}).click();
  await page.evaluate(() => reply('fetch-jira-versions', {versions: [{name: 'One', released: false}, {name: 'Two', released: false}]}));
  const first = list.locator('input[data-name="One"]');
  const second = list.locator('input[data-name="Two"]');
  await first.check();
  await expect(second).toBeDisabled();
  await second.evaluate(checkbox => { checkbox.checked = true; checkbox.dispatchEvent(new Event('change', {bubbles: true})); });
  expect(await page.evaluate(() => sent.filter(message => message.type === 'set-jira-fix-versions').length)).toBe(1);
  await page.evaluate(() => reply('set-jira-fix-versions', {_error: '403 Forbidden', _errorKind: 'forbidden'}));
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await expect(first).toBeEnabled();
  await expect(second).toBeEnabled();
  await expect(page.locator('#gl-jira-sidebar-fixversions-error').getByRole('alert')).toContainText('jiraErrorForbidden');
});

test('forbidden transitions keep field-only quick actions and failed transition writes remain visible', async ({page}) => {
  await mountJira(page);
  await page.evaluate(() => {
    reply('storage', {jiraQuickActions: [{label: 'Assign', assignee: 'me'}, {label: 'Finish', status: 'Done'}]});
    reply('fetch-jira-transitions', {_error: '403 Forbidden', _errorKind: 'forbidden'});
  });
  const transitions = page.locator('#gl-jira-sidebar-transitions');
  await expect(transitions.getByRole('alert')).toContainText('jiraErrorForbidden');
  await expect(transitions.getByRole('button', {name: /Assign/})).toBeEnabled();
  await expect(transitions.getByRole('button', {name: /Finish/})).toHaveCount(0);
  await transitions.getByRole('button', {name: 'jiraRetryRead'}).click();
  await page.evaluate(() => reply('fetch-jira-transitions', {transitions: [{id: '9', name: 'Done', statusName: 'Done', statusCategoryKey: 'done'}]}));
  await transitions.locator('.gl-jira-sidebar-transition').click();
  await page.evaluate(() => reply('do-jira-transition', {_error: '401 Unauthorized', _errorKind: 'auth'}));
  await expect(page.locator('.gl-jira-quick-action-error')).toContainText('jiraErrorAuth');
  await expect(page.locator('.gl-jira-quick-action-error').getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => sent.filter(message => message.type === 'do-jira-transition').length)).toBe(1);
});

test('partial quick-action failure remains actionable after refresh and preserves an unsent comment', async ({page}) => {
  await mountJira(page);
  await loadEmptyComments(page);
  await page.evaluate(() => {
    reply('storage', {jiraQuickActions: [{label: 'Finish and assign', status: 'Done', assignee: 'me'}]});
    reply('fetch-jira-transitions', {transitions: [{id: '9', name: 'Done', statusName: 'Done', statusCategoryKey: 'done'}]});
  });
  await page.locator('#gl-jira-sidebar-comment-input').fill('Unsent comment');
  await page.getByRole('button', {name: /Finish and assign/}).click();
  await page.evaluate(() => reply('execute-jira-quick-action', {_error: 'Fields rejected', _errorKind: 'forbidden', completed: {transition: true}}));
  const failure = page.locator('.gl-jira-quick-action-error');
  await expect(failure).toContainText('jiraQuickActionPartial');
  await expect(failure).toContainText('jiraErrorForbidden');
  await expect(page.locator('#gl-jira-sidebar-status')).toHaveText('Done');
  await page.evaluate(() => reply('fetch-jira-issue', issue('Done')));
  await expect(page.locator('#gl-jira-sidebar-comment-input')).toHaveValue('Unsent comment');
  await expect(failure).toContainText('jiraQuickActionPartial');
  await expect(failure.getByRole('link', {name: 'jiraOpenSite'})).toHaveAttribute('href', 'https://jira.test/');
  await expect(failure.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => sent.filter(message => message.type === 'execute-jira-quick-action').length)).toBe(1);
});

test('a failed issue refresh after a confirmed quick action is reported as a read failure', async ({page}) => {
  await mountJira(page);
  await page.evaluate(() => {
    reply('storage', {jiraQuickActions: [{label: 'Assign', assignee: 'me'}]});
    reply('fetch-jira-transitions', {transitions: []});
  });
  await page.getByRole('button', {name: /Assign/}).click();
  await page.evaluate(() => {
    reply('execute-jira-quick-action', {success: true, completed: {fields: true}});
    reply('fetch-jira-issue', {_error: 'Network lost', _errorKind: 'network'});
  });
  const failure = page.locator('.gl-jira-quick-action-error');
  await expect(failure).toContainText('jiraQuickActionRefreshFailed');
  await expect(failure).toContainText('jiraErrorNetwork');
  await expect(failure).not.toContainText('jiraErrorWriteUncertain');
  expect(await page.evaluate(() => sent.filter(message => message.type === 'execute-jira-quick-action').length)).toBe(1);
});
