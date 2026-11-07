const {test, expect} = require('@playwright/test');
const {bundleForTest} = require('../helpers/runtime.cjs');

async function mount(page, tickets = ['PROJ-1']) {
  await page.route('https://gitlab.test/**', route => route.fulfill({contentType:'text/html',body:'<html class="gl-actions-host"><body></body></html>'}));
  await page.goto('https://gitlab.test/team/repo/-/merge_requests');
  await page.evaluate(tickets => {
    document.body.innerHTML = '<ul>' + tickets.map(ticket => `<li data-testid="issuable-item-wrapper"><span data-testid="issuable-title"><a data-testid="issuable-title-link">${ticket} Work</a></span></li>`).join('') + '</ul>';
    window.pending = [];
    window.chrome = {i18n:{getMessage:key=>key},runtime:{sendMessage:(message,callback)=>pending.push({message,callback})}};
    window.reply = response => pending.shift().callback(response);
  }, tickets);
  for (const [entry, name] of [['src/shared/lib/lifecycle/index.ts','Lifecycle'],['src/entities/jira-issue/index.ts','Jira'],['src/widgets/mr-list/ui/jira-badges.ts','Badges']]) {
    await page.addScriptTag({content:bundleForTest(entry,{globalName:name})});
  }
  await page.evaluate(() => {
    window.scope = Lifecycle.createLifecycle();
    window.state = Jira.createJiraState();
    window.badges = Badges.createListJiraBadges(state, scope, () => {}, title=>title.match(/[A-Z]+-\d+/g)||[]);
    window.load = () => badges.fetchAndRenderJiraStatuses('https://jira.test', false);
    load();
  });
}

test('expired Jira session shows sign-in guidance, pauses reads and recovers on explicit retry', async ({page}) => {
  await mount(page);
  await page.evaluate(() => reply({statuses:{_authError:401},_failure:{_error:'401',_errorKind:'auth',_httpStatus:401}}));
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('jiraErrorAuth');
  await expect(alert.getByRole('link')).toHaveAttribute('href','https://jira.test/');
  await expect(alert.getByRole('link')).toHaveAttribute('rel','noopener noreferrer');
  await page.evaluate(() => { load(); load(); });
  expect(await page.evaluate(() => pending.length)).toBe(0);
  await alert.getByRole('button',{name:'jiraRetryRead'}).click();
  expect(await page.evaluate(() => pending.length)).toBe(1);
  await page.evaluate(() => reply({statuses:{'PROJ-1':{name:'Open',categoryKey:'new'}}}));
  await expect(page.locator('.gl-jira-badge')).toHaveText('Open');
  await expect(alert).toHaveCount(0);
  expect(await page.evaluate(() => state.authFailed)).toBe(false);
});

test('one forbidden Jira issue preserves other badges and does not mark the whole session expired', async ({page}) => {
  await mount(page,['PROJ-1','PROJ-2']);
  await page.evaluate(() => reply({statuses:{'PROJ-2':{name:'Done',categoryKey:'done'}},_failure:{_error:'403',_errorKind:'forbidden',_httpStatus:403}}));
  await expect(page.getByRole('alert')).toContainText('jiraErrorForbidden');
  await expect(page.locator('.gl-jira-badge')).toHaveText('Done');
  expect(await page.evaluate(() => state.authFailed)).toBe(false);
  await page.evaluate(() => load());
  expect(await page.evaluate(() => pending[0].message.tickets)).toEqual(['PROJ-1']);
});

test('offline Jira has one dismissible notice, does not loop reads, and releases UI on route disposal', async ({page}) => {
  await mount(page);
  await page.evaluate(() => reply({_error:'Network failed',_errorKind:'network'}));
  await expect(page.getByRole('alert')).toContainText('jiraErrorNetwork');
  await page.evaluate(() => { load(); load(); });
  await expect(page.getByRole('alert')).toHaveCount(1);
  expect(await page.evaluate(() => pending.length)).toBe(0);
  await page.getByRole('button',{name:'jiraDismissError'}).click();
  await page.evaluate(() => load());
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => scope.dispose());
  await expect(page.locator('.gl-jira-connection-notice')).toHaveCount(0);
});

test('commit Jira badges recover after an explicit auth retry without caching failed reads as empty fields', async ({page}) => {
  await mount(page);
  await page.addScriptTag({content:bundleForTest('src/widgets/commit-actions/ui/jira.ts',{globalName:'Commits'})});
  await page.evaluate(() => {
    scope.dispose();
    pending.length = 0;
    history.replaceState({}, '', '/team/repo/-/commits/main');
    document.body.innerHTML = '<div class="commit"><span class="commit-row-message">PROJ-1 Work</span><div class="commit-sha-group"><span data-clipboard-text="abcdef1234567">abcdef</span></div></div>';
    chrome.storage = {sync:{get:(defaults,callback)=>callback({...defaults,jira_url:'https://jira.test',commits_jira_field:'status'})}};
    window.scope = Lifecycle.createLifecycle();
    window.state = Jira.createJiraState();
    Commits.startCommitJira(state, () => {}, scope);
    reply({values:{_authError:401},_failure:{_error:'401',_errorKind:'auth',_httpStatus:401}});
  });
  await expect(page.getByRole('alert')).toContainText('jiraErrorAuth');
  await expect(page.locator('.gl-commit-jira-loader')).toHaveCount(0);
  await page.getByRole('button',{name:'jiraRetryRead'}).click();
  expect(await page.evaluate(() => pending[0].message.type)).toBe('fetch-jira-field-values');
  await page.evaluate(() => reply({values:{'PROJ-1':{values:['Open'],categoryKey:'new'}}}));
  await expect(page.locator('.gl-commit-jira-badge')).toHaveText('Open');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => scope.dispose());
});

test('commit Jira badges finish partially cached fields after the session recovers elsewhere', async ({page}) => {
  await mount(page);
  await page.addScriptTag({content:bundleForTest('src/widgets/commit-actions/ui/jira.ts',{globalName:'Commits'})});
  await page.evaluate(() => {
    scope.dispose();
    pending.length = 0;
    history.replaceState({}, '', '/team/repo/-/commits/main');
    document.body.innerHTML = '<div class="commit"><span class="commit-row-message">PROJ-1 Work</span><div class="commit-sha-group"><span data-clipboard-text="abcdef1234567">abcdef</span></div></div>';
    chrome.storage = {sync:{get:(defaults,callback)=>callback({...defaults,jira_url:'https://jira.test',commits_jira_field:'fixVersions,status'})}};
    window.scope = Lifecycle.createLifecycle();
    window.state = Jira.createJiraState();
    Commits.startCommitJira(state, () => {}, scope);
    reply({values:{'PROJ-1':{values:['1.0']}}});
    reply({values:{_authError:401},_failure:{_error:'401',_errorKind:'auth',_httpStatus:401}});
  });
  await expect(page.locator('.gl-commit-jira-badge')).toHaveText('1.0');
  await expect(page.getByRole('alert')).toContainText('jiraErrorAuth');
  await page.evaluate(() => {
    // A successful independent issue read clears the shared failure state.
    state.authFailed = false;
    delete state.failure;
    document.body.appendChild(document.createElement('div'));
  });
  await expect.poll(() => page.evaluate(() => pending.length)).toBe(1);
  expect(await page.evaluate(() => pending[0].message.tickets)).toEqual(['PROJ-1']);
  await page.evaluate(() => {
    reply({values:{'PROJ-1':{values:['1.0']}}});
    reply({values:{'PROJ-1':{values:['Open'],categoryKey:'new'}}});
  });
  await expect(page.locator('.gl-commit-jira-badge')).toHaveText(['1.0','Open']);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => scope.dispose());
});
