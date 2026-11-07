const {test, expect, chromium} = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const {execFileSync} = require('node:child_process');

const JIRA_HOST = 'jira.test';
const GITLAB_HOST = 'gitlab.test';
const ISSUE_PATH = '/jira/rest/api/2/issue/PROJ-1';
const USER = {name: 'fixture-user', key: 'fixture-key', displayName: 'Fixture User'};
const SESSION_COOKIES = [
  ['JSESSIONID', 'fixture-session', 'Lax'],
  ['STRICT_SESSION', 'fixture-strict', 'Strict'],
  ['NONE_SESSION', 'fixture-none', 'None'],
];

// cookie_controls_mode is a profile-wide setting, unlike a page-only CDP override.
// Keep the allowed baseline: a missing cookie alone would not prove blocking works.
for (const cookieMode of [0, 1]) {
  test(`GitLab UI reads and writes cross-site Jira with third-party cookies ${cookieMode ? 'blocked' : 'allowed'}`, async ({}, testInfo) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlab-jira-cross-site-'));
    const profile = path.join(temporary, 'profile');
    let context;
    let server;
    const requests = [];
    const serverErrors = [];
    const externalRequests = [];
    const pageErrors = [];
    const issue = {assignee: 'Previous User', fixVersions: [], status: 'Open', comments: []};
    try {
      const key = path.join(temporary, 'key.pem');
      const cert = path.join(temporary, 'cert.pem');
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=jira.test',
        '-addext', `subjectAltName=DNS:${JIRA_HOST},DNS:${GITLAB_HOST}`], {stdio: 'pipe'});
      server = https.createServer({key: await fs.readFile(key), cert: await fs.readFile(cert)}, (req, res) => {
        const host = req.headers.host.split(':')[0];
        const url = new URL(req.url, 'https://' + req.headers.host);
        let text = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { text += chunk; });
        req.on('end', () => {
          function reply(status, body) {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(body === undefined ? undefined : JSON.stringify(body));
          }
          try {
            const body = text ? JSON.parse(text) : undefined;
            const cookie = req.headers.cookie || '';
            requests.push({host, path: url.pathname, method: req.method, body, cookie});
            if (url.pathname === '/favicon.ico') return reply(204);
            if (host === GITLAB_HOST && url.pathname === '/team/repo/-/merge_requests') {
              res.setHeader('Content-Type', 'text/html');
              res.end('<!doctype html><html><head><meta content="GitLab"><meta name="csrf-token" content="fixture"><title>Local GitLab fixture</title></head>' +
                '<body data-page="projects:merge_requests:index"><ul data-testid="issuable-list"><li data-testid="issuable-item-wrapper">' +
                '<div data-testid="issuable-title"><a data-testid="issuable-title-link" href="/team/repo/-/merge_requests/42">PROJ-1 Fixture MR</a></div>' +
                '</li></ul></body></html>');
              return;
            }
            if (host !== JIRA_HOST) return reply(404, {error: 'Unexpected fixture host/path'});
            if (url.pathname === '/') {
              res.setHeader('Content-Type', 'text/html');
              res.end('<!doctype html><title>Local Jira fixture</title><h1>Local Jira fixture</h1>');
              return;
            }
            if (url.pathname === '/cookie-probe') {
              // This ordinary web request must remain subject to browser cookie policy.
              res.setHeader('Access-Control-Allow-Origin', `https://${GITLAB_HOST}:${server.address().port}`);
              res.setHeader('Access-Control-Allow-Credentials', 'true');
              reply(200, {cookie});
              return;
            }
            if (!cookie.split(/;\s*/).includes('JSESSIONID=fixture-session'))
              return reply(401, {errorMessages: ['Session required']});
            if (req.method === 'GET') {
              if (url.pathname === '/jira/rest/api/2/myself') return reply(200, USER);
              if (url.pathname === '/jira/rest/api/2/field') return reply(200, []);
              if (url.pathname === '/jira/rest/api/2/user/assignable/search') return reply(200, [USER]);
              if (url.pathname === '/jira/rest/api/2/project/PROJ/versions')
                return reply(200, [{name: '1.2.3', released: false, archived: false}]);
              if (url.pathname === ISSUE_PATH) return reply(200, {
                key: 'PROJ-1', fields: {
                  summary: 'Fixture issue', description: 'Cross-site fixture description',
                  status: {name: issue.status, statusCategory: {key: issue.status === 'Open' ? 'new' : 'indeterminate'}},
                  assignee: {name: issue.assignee, displayName: issue.assignee},
                  fixVersions: issue.fixVersions.map(name => ({name})),
                },
              });
              if (url.pathname === ISSUE_PATH + '/transitions') return reply(200, {transitions: [
                {id: '31', name: 'Start', to: {name: 'In Progress', statusCategory: {key: 'indeterminate'}}},
              ]});
              if (url.pathname === ISSUE_PATH + '/comment') return reply(200, {comments: issue.comments, total: issue.comments.length});
            }
            if (req.method === 'PUT' && url.pathname === ISSUE_PATH && body?.fields?.assignee?.name === USER.name) {
              issue.assignee = USER.displayName;
              return reply(204);
            }
            if (req.method === 'PUT' && url.pathname === ISSUE_PATH && Array.isArray(body?.fields?.fixVersions)) {
              issue.fixVersions = body.fields.fixVersions.map(version => version.name);
              return reply(204);
            }
            if (req.method === 'POST' && url.pathname === ISSUE_PATH + '/transitions' && body?.transition?.id === '31') {
              issue.status = 'In Progress';
              return reply(204);
            }
            if (req.method === 'POST' && url.pathname === ISSUE_PATH + '/comment' && typeof body?.body === 'string') {
              const comment = {id: '42', body: body.body, author: USER, created: '2026-11-07T12:00:00.000Z'};
              issue.comments.push(comment);
              return reply(201, comment);
            }
            if (req.method === 'DELETE' && url.pathname === ISSUE_PATH + '/comment/42' && issue.comments.length === 1) {
              issue.comments = [];
              return reply(204);
            }
            reply(400, {errorMessages: ['Unsupported fixture request']});
          } catch (error) {
            serverErrors.push(error.message);
            reply(500, {error: 'Fixture failure'});
          }
        });
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const port = server.address().port;
      const jiraOrigin = `https://${JIRA_HOST}:${port}`;
      const gitlabOrigin = `https://${GITLAB_HOST}:${port}`;
      await fs.mkdir(path.join(profile, 'Default'), {recursive: true});
      await fs.writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({profile: {cookie_controls_mode: cookieMode}}));
      const extension = path.join(temporary, 'extension');
      await fs.cp(path.resolve(__dirname, '../../dist'), extension, {recursive: true});
      const manifestPath = path.join(extension, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      expect(manifest.permissions).not.toContain('cookies');
      expect(manifest.host_permissions).toBeUndefined();
      // Only the Jira grant is supplied by the fixture. Content scripts and all
      // executable files remain the exact production build; no test bridge/hooks.
      manifest.host_permissions = [`https://${JIRA_HOST}/*`];
      await fs.writeFile(manifestPath, JSON.stringify(manifest));
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
          '--ignore-certificate-errors', '--disable-background-networking', '--no-proxy-server',
          `--host-resolver-rules=MAP ${JIRA_HOST} 127.0.0.1, MAP ${GITLAB_HOST} 127.0.0.1`],
      });
      context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
      // Do not intercept local traffic: read final cookies at the HTTPS server.
      await context.route(url => /^https?:$/.test(url.protocol) && ![jiraOrigin, gitlabOrigin].includes(url.origin), async route => {
        externalRequests.push(route.request().url());
        await route.abort();
      });
      await context.addCookies([
        ...SESSION_COOKIES.map(([name, value, sameSite]) => ({name, value, sameSite, url: jiraOrigin + '/', httpOnly: true, secure: true})),
        {name: 'GITLAB_SESSION', value: 'fixture-gitlab', url: gitlabOrigin + '/', httpOnly: true, secure: true, sameSite: 'Lax'},
      ]);
      let [worker] = context.serviceWorkers();
      worker ||= await context.waitForEvent('serviceworker');
      await worker.evaluate(async jiraUrl => chrome.storage.sync.set({
        jira_url: jiraUrl, jira_ticket_regex: 'PROJ-\\d+', skip_confirmations: true,
        show_jira_details: false, jiraQuickActions: [], show_branches: false,
        highlight_own_mrs: false, show_only_mine: false, show_needs_review: false,
        show_reviewer_badge: false, show_threads_badge: false, show_size_badge: false,
        show_conflicts_badge: false, show_approval_badge: false,
      }), jiraOrigin + '/jira');
      const permissions = await worker.evaluate(async () => chrome.permissions.getAll());
      expect(permissions.permissions).not.toContain('cookies');

      const settings = await context.newPage();
      await settings.goto('chrome://settings/cookies');
      const livePref = await settings.evaluate(() => new Promise(resolve => chrome.settingsPrivate.getPref('profile.cookie_controls_mode', resolve)));
      expect(livePref.value).toBe(cookieMode);
      await settings.close();
      const firstParty = await context.newPage();
      await firstParty.goto(jiraOrigin);
      const firstPartyCookies = await firstParty.evaluate(async () => (await fetch('/cookie-probe', {credentials: 'include'})).json());
      for (const [name, value] of SESSION_COOKIES) expect(firstPartyCookies.cookie).toContain(name + '=' + value);
      await firstParty.close();

      const page = await context.newPage();
      await page.goto(gitlabOrigin + '/team/repo/-/merge_requests');
      const thirdPartyCookies = await page.evaluate(async url => (await fetch(url, {credentials: 'include'})).json(), jiraOrigin + '/cookie-probe');
      expect(thirdPartyCookies.cookie).toBe(cookieMode ? '' : 'NONE_SESSION=fixture-none');
      // Real production controls trigger content-script messages to the worker.
      await page.locator('.gl-jira-badge[data-jira-ticket="PROJ-1"]').click();
      const sidebar = page.locator('.gl-jira-sidebar[data-ticket="PROJ-1"]');
      await expect(sidebar.locator('.gl-jira-sidebar-title')).toHaveText('Fixture issue');
      await expect(sidebar.locator('.gl-jira-sidebar-desc')).toHaveText('Cross-site fixture description');
      // Finish the initial identity/comments read before starting mutations.
      await expect(sidebar.locator('.gl-jira-sidebar-comments-empty')).toBeVisible();
      await sidebar.locator('#gl-jira-sidebar-assignee').click();
      await sidebar.locator('.gl-jira-sidebar-assignee-input').fill('fixture');
      await sidebar.locator('.gl-jira-sidebar-assignee-item[data-key="fixture-user"]').click();
      await expect(sidebar.locator('#gl-jira-sidebar-assignee')).toContainText(USER.displayName);
      expect(issue.assignee).toBe(USER.displayName);
      await sidebar.locator('#gl-jira-sidebar-fixversions').click();
      await sidebar.locator('#gl-jira-sidebar-fixversions-list input[data-name="1.2.3"]').check();
      await expect(sidebar.locator('#gl-jira-sidebar-fixversions')).toContainText('1.2.3');
      expect(issue.fixVersions).toEqual(['1.2.3']);
      await sidebar.locator('#gl-jira-sidebar-fixversions').click();
      await sidebar.locator('.gl-jira-sidebar-transition[data-id="31"]').click();
      await expect(sidebar.locator('#gl-jira-sidebar-status')).toHaveText('In Progress');
      expect(issue.status).toBe('In Progress');
      const commentText = 'Междоменная запись проверена ✅';
      await sidebar.locator('#gl-jira-sidebar-comment-input').fill(commentText);
      await sidebar.locator('#gl-jira-sidebar-comment-submit').click();
      const comment = sidebar.locator('.gl-jira-sidebar-comment[data-comment-id="42"]');
      await expect(comment).toContainText(commentText);
      expect(issue.comments).toHaveLength(1);
      await comment.locator('.gl-jira-sidebar-comment-delete').click();
      await expect(comment).toHaveCount(0);
      expect(issue.comments).toEqual([]);
      const jiraRequests = requests.filter(request => request.host === JIRA_HOST && request.path.startsWith('/jira/rest/'));
      const writes = jiraRequests.filter(request => request.method !== 'GET');
      expect(writes.map(({method, path, body}) => ({method, path, body}))).toEqual([
        {method: 'PUT', path: ISSUE_PATH, body: {fields: {assignee: {name: USER.name}}}},
        {method: 'PUT', path: ISSUE_PATH, body: {fields: {fixVersions: [{name: '1.2.3'}]}}},
        {method: 'POST', path: ISSUE_PATH + '/transitions', body: {transition: {id: '31'}}},
        {method: 'POST', path: ISSUE_PATH + '/comment', body: {body: commentText}},
        {method: 'DELETE', path: ISSUE_PATH + '/comment/42', body: undefined},
      ]);
      expect(jiraRequests.some(request => request.method === 'GET' && request.path === ISSUE_PATH)).toBe(true);
      for (const request of jiraRequests) {
        for (const [name, value] of SESSION_COOKIES) expect(request.cookie, request.method + ' ' + request.path).toContain(name + '=' + value);
        expect(request.cookie).not.toContain('GITLAB_SESSION');
      }
      for (const request of requests.filter(request => request.host === GITLAB_HOST)) expect(request.cookie).not.toContain('JSESSIONID');
      expect(serverErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(externalRequests).toEqual([]);
      const evidence = testInfo.outputPath('cookie-policy-evidence.json');
      await fs.writeFile(evidence, JSON.stringify({chromium: context.browser().version(),
        cookieMode: livePref.value, jiraOrigin, gitlabOrigin,
        cookiesPermission: permissions.permissions.includes('cookies'),
        firstPartyCookies, thirdPartyCookies, reads: jiraRequests.length - writes.length,
        writes, externalRequests}, null, 2));
      await testInfo.attach('cookie-policy-evidence', {contentType: 'application/json', path: evidence});
    } finally {
      try {
        if (context) await context.close();
      } finally {
        try {
          if (server) await new Promise(resolve => server.close(resolve));
        } finally {
          await fs.rm(temporary, {recursive: true, force: true});
        }
      }
    }
  });
}
