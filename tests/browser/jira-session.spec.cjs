const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

test('production Jira requests use the browser session without Cookies API permission', async () => {
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
    server = https.createServer({key: await fs.readFile(keyPath), cert: await fs.readFile(certPath)}, (request, response) => {
      requests.push({path: request.url, method: request.method, cookie: request.headers.cookie});
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({name: 'fixture-user', displayName: 'Fixture User'}));
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
    expect(requests[0].path).toBe('/jira/rest/api/2/myself');
    expect(requests[0].method).toBe('GET');
    expect(requests[0].cookie).toContain('JSESSIONID=fixture-only-session');
    expect(requests[0].cookie).toContain('STRICT_SESSION=strict-fixture-session');
    expect(requests[0].cookie).toContain('NONE_SESSION=none-fixture-session');
    expect(requests[0].cookie).not.toContain('OTHER_SESSION');
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
