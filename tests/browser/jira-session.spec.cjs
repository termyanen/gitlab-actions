const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

test('production Jira reads and writes use the browser session without Cookies API permission', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlab-jira-session-'));
  let context;
  let server;
  try {
    const keyPath = path.join(temporary, 'key.pem');
    const certPath = path.join(temporary, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    ], {stdio: 'pipe'});
    const requests = [];
    const issuePath = '/jira/rest/api/2/issue/PROJ-1';
    const issue = {assignee: 'previous-user', fixVersions: [], status: 'Open', comments: []};
    server = https.createServer({key: await fs.readFile(keyPath), cert: await fs.readFile(certPath)}, (request, response) => {
      let rawBody = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { rawBody += chunk; });
      request.on('end', () => {
        function reply(status, value) {
          response.statusCode = status;
          response.setHeader('Content-Type', 'application/json');
          response.end(value === undefined ? undefined : JSON.stringify(value));
        }
        let body;
        try {
          body = rawBody ? JSON.parse(rawBody) : undefined;
        } catch {
          reply(400, {errorMessages: ['Malformed JSON']});
          return;
        }
        requests.push({path: request.url, method: request.method, body, cookie: request.headers.cookie, atlassianToken: request.headers['x-atlassian-token']});
        if (!(request.headers.cookie || '').split(/;\s*/).includes('JSESSIONID=fixture-only-session')) {
          reply(401, {errorMessages: ['Session required']});
          return;
        }
        if (request.method === 'GET' && request.url === '/jira/rest/api/2/myself') {
          reply(200, {name: 'fixture-user', displayName: 'Fixture User'});
        } else if (request.method === 'PUT' && request.url === issuePath && typeof body?.fields?.assignee?.name === 'string') {
          issue.assignee = body.fields.assignee.name;
          reply(204);
        } else if (request.method === 'PUT' && request.url === issuePath && Array.isArray(body?.fields?.fixVersions) && body.fields.fixVersions.every(version => typeof version.name === 'string')) {
          issue.fixVersions = body.fields.fixVersions.map(version => version.name);
          reply(204);
        } else if (request.method === 'POST' && request.url === issuePath + '/transitions' && body?.transition?.id === '31') {
          issue.status = 'In Progress';
          reply(204);
        } else if (request.method === 'POST' && request.url === issuePath + '/comment' && typeof body?.body === 'string') {
          const comment = {id: '42', body: body.body, author: {name: 'fixture-user', displayName: 'Fixture User'}, created: '2026-11-07T12:00:00.000Z'};
          issue.comments.push(comment);
          reply(201, comment);
        } else if (request.method === 'DELETE' && request.url === issuePath + '/comment/42' && issue.comments.some(comment => comment.id === '42')) {
          issue.comments = issue.comments.filter(comment => comment.id !== '42');
          reply(204);
        } else {
          reply(400, {errorMessages: ['Unsupported fixture request']});
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const jiraOrigin = `https://127.0.0.1:${server.address().port}`;
    const jiraPermission = 'https://127.0.0.1/*';
    const extension = path.join(temporary, 'extension');
    await fs.cp(path.resolve(__dirname, '../../dist'), extension, {recursive: true});
    const manifestPath = path.join(extension, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    expect(manifest.permissions).not.toContain('cookies');
    // Supply only the fixture host grant. The shipped manifest keeps Jira access
    // optional; this test does not automate Chrome's native permission prompt.
    expect(manifest.host_permissions).toBeUndefined();
    manifest.host_permissions = [jiraPermission];
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
      channel: 'chromium',
      headless: true,
      ignoreHTTPSErrors: true,
      // The certificate bypass is confined to this disposable local fixture.
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--ignore-certificate-errors', '--disable-background-networking'],
    });
    const blockedRequests = [];
    await context.route(url => /^https?:$/.test(url.protocol) && url.origin !== jiraOrigin, async route => {
      blockedRequests.push(route.request().url());
      await route.abort();
    });
    // Do not intercept the local server: Playwright's pre-network headers omit
    // Lax/Strict cookies that Chrome adds to extension requests with a host grant.
    await context.addCookies([
      {name: 'JSESSIONID', value: 'fixture-only-session', url: jiraOrigin + '/', httpOnly: true, secure: true, sameSite: 'Lax'},
      {name: 'STRICT_SESSION', value: 'strict-fixture-session', url: jiraOrigin + '/', httpOnly: true, secure: true, sameSite: 'Strict'},
      {name: 'NONE_SESSION', value: 'none-fixture-session', url: jiraOrigin + '/', httpOnly: true, secure: true, sameSite: 'None'},
      {name: 'OTHER_SESSION', value: 'unrelated-fixture', url: 'https://unrelated.test/', httpOnly: true, secure: true, sameSite: 'None'},
    ]);
    let [worker] = context.serviceWorkers();
    worker ||= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await test.step('GET reads the authenticated identity', async () => {
      const result = await page.evaluate(async ({jiraOrigin, jiraPermission}) => {
        const permissions = await chrome.permissions.getAll();
        return {
          cookiesPermission: permissions.permissions.includes('cookies'),
          jiraHost: await chrome.permissions.contains({origins: [jiraPermission]}),
          myself: await chrome.runtime.sendMessage({type: 'fetch-jira-myself', jiraUrl: jiraOrigin + '/jira'}),
        };
      }, {jiraOrigin, jiraPermission});
      expect(result).toEqual({cookiesPermission: false, jiraHost: true, myself: {id: 'fixture-user'}});
      expect(requests).toHaveLength(1);
    });
    async function send(message) {
      return page.evaluate(message => chrome.runtime.sendMessage(message), {jiraUrl: jiraOrigin + '/jira', ticket: 'PROJ-1', ...message});
    }
    await test.step('PUT updates assignee and fix versions', async () => {
      expect(await send({type: 'set-jira-assignee', username: 'fixture-user'})).toEqual({success: true});
      expect(issue.assignee).toBe('fixture-user');
      expect(await send({type: 'set-jira-fix-versions', versions: ['1.2', '1.3']})).toEqual({success: true});
      expect(issue.fixVersions).toEqual(['1.2', '1.3']);
    });
    await test.step('POST transitions the issue and creates a comment', async () => {
      expect(await send({type: 'do-jira-transition', transitionId: '31'})).toEqual({success: true});
      expect(issue.status).toBe('In Progress');
      const text = 'Проверено локально ✅';
      const posted = await send({type: 'post-jira-comment', text});
      expect(posted.comment).toMatchObject({id: '42', body: text, author: 'Fixture User', authorId: 'fixture-user', created: '2026-11-07T12:00:00.000Z'});
      expect(issue.comments).toHaveLength(1);
      expect(issue.comments[0].body).toBe(text);
    });
    await test.step('DELETE removes the created comment', async () => {
      expect(await send({type: 'delete-jira-comment', commentId: '42'})).toEqual({success: true});
      expect(issue.comments).toEqual([]);
    });
    // Exact ordering/count also detects duplicate writes or automatic replays.
    expect(requests.map(({method, path, body}) => ({method, path, body}))).toEqual([
      {method: 'GET', path: '/jira/rest/api/2/myself', body: undefined},
      {method: 'PUT', path: issuePath, body: {fields: {assignee: {name: 'fixture-user'}}}},
      {method: 'PUT', path: issuePath, body: {fields: {fixVersions: [{name: '1.2'}, {name: '1.3'}]}}},
      {method: 'POST', path: issuePath + '/transitions', body: {transition: {id: '31'}}},
      {method: 'POST', path: issuePath + '/comment', body: {body: 'Проверено локально ✅'}},
      {method: 'DELETE', path: issuePath + '/comment/42', body: undefined},
    ]);
    for (const request of requests) {
      expect(request.cookie, request.method + ' ' + request.path).toContain('JSESSIONID=fixture-only-session');
      expect(request.cookie).toContain('STRICT_SESSION=strict-fixture-session');
      expect(request.cookie).toContain('NONE_SESSION=none-fixture-session');
      expect(request.cookie).not.toContain('OTHER_SESSION');
      if (request.path.includes('/comment')) expect(request.atlassianToken).toBe('no-check');
    }
    expect(blockedRequests).toEqual([]);
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
