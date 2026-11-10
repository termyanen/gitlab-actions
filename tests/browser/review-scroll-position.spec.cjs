const { test, expect } = require('@playwright/test');
const { bundleForTest } = require('../helpers/runtime.cjs');
const path = require('node:path');
const messages = require('../../_locales/ru/messages.json');
for (const width of [1100, 420]) for (const dark of [false, true]) for (const failure of [false,true]) {
  test(`bulk toggles and publication preserve the visible comment at ${width}, dark=${dark}, failure=${failure}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://gitlab.fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: `<html class="gl-actions-host ${dark ? 'gl-dark' : ''}"><body></body></html>` }));
    await page.goto('https://gitlab.fixture.test/team/repo/-/merge_requests/42');
    await page.addStyleTag({ path: path.resolve('content.css') });
    await page.addScriptTag({ content: bundleForTest('src/widgets/review-import-dialog/ui/dialog.ts', {globalName:'ImportDialog'}) });
    await page.evaluate(messages => {
      const context = { origin: location.origin, projectPath: 'team/repo', kind: 'merge_requests', iid: '42', webUrl: location.href, apiRoot: '/api/v4' };
      const items = Array.from({length: 10}, (_, i) => ({ id: String(i), status: 'ready', path: 'src/main.ts', side: 'new', line: i+1, code: 'return value;', type: 'reply', discussion_id: 'thread-' + i, note_id: i+1, replyTo: {body: 'Длинный исходный комментарий.\n'.repeat(80), author: 'Reviewer', resolvable: true, resolved: false}, body: 'Ответ на замечание.' }));
      window.results = items.map(item => ({id: item.id, status: 'published', message: 'Published.', url: location.href + '#note_' + item.id}));
      window.dialog = ImportDialog.createImportDialog(() => ({
        prepare: async () => ({ context, headSha: 'abc', items, warnings: [] }),
        publish: (_, ids, options) => new Promise(resolve => { window.progress = options.onProgress; window.finish = () => resolve({ items: window.results, warnings: [] }); })
      }));
      window.dialog.open(context, { t: (key, values=[]) => (messages[key]?.message || key).replace(/\$(\d+)/g, (_, n) => values[n-1]) });
    }, messages);
    await expect(page.locator('.gl-review-dialog')).toHaveCSS('background-color', dark ? 'rgb(31, 30, 39)' : 'rgb(255, 255, 255)');
    await page.locator('.gl-review-import-input').fill('{}\n'.repeat(100));
    await page.getByRole('button', { name: messages.aiReviewImportValidate.message, exact: true }).click();
    const cards = page.locator('.gl-review-import-item');
    await expect(cards).toHaveCount(10);
    const scroller = page.locator(width > 720 ? '.gl-review-list' : '.gl-review-import-columns');
    const anchor = cards.nth(5);
    const offset = () => anchor.evaluate(node => node.getBoundingClientRect().top);
    await scroller.evaluate((node) => {
      const card = node.querySelectorAll('.gl-review-import-item')[5];
      node.scrollTop += card.getBoundingClientRect().top - node.getBoundingClientRect().top + 15;
    });
    const before = await offset();
    const toggle = page.locator('.gl-review-comments-toggle-all');
    await toggle.evaluate(node => node.click());
    await expect(toggle).toHaveText(messages.aiReviewCollapseAll.message);
    await expect.poll(async () => Math.abs(await offset() - before)).toBeLessThanOrEqual(1);
    await toggle.evaluate(node => node.click());
    await expect(toggle).toHaveText(messages.aiReviewExpandAll.message);
    await expect.poll(async () => Math.abs(await offset() - before)).toBeLessThanOrEqual(1);
    // Keep a mixed state and verify that publication cannot reset it or the viewport.
    await anchor.locator('.gl-review-comment-toggle').first().evaluate(node => node.click());
    const mixedBefore = await offset();
    await page.locator('.gl-review-import-input').evaluate(node => {node.scrollTop=120;});
    if (failure) await page.evaluate(() => {window.results[0]={id:'0',status:'failed',message:'Permission denied.\nPlease check your access before retrying.'};});
    const inputScroll = await page.locator('.gl-review-import-input').evaluate(node => node.scrollTop);
    await page.getByRole('button', {name:messages.aiReviewImportPublish.message,exact:true}).evaluate(node => node.click());
    await expect.poll(() => page.evaluate(() => typeof window.progress)).toBe('function');
    for (const index of [0,5,9]) {
      await page.evaluate(index => window.progress({item:window.results[index]}),index);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(anchor.locator('.gl-review-comment').first()).toHaveAttribute('data-expanded','true');
      await expect(cards.first().locator('.gl-review-comment').first()).toHaveAttribute('data-expanded','false');
      await expect.poll(async () => Math.abs(await offset() - mixedBefore)).toBeLessThanOrEqual(1);
    }
    await page.evaluate(() => window.finish());
    await expect(page.locator('.gl-review-status')).toContainText(failure ? '9 / 10' : '10 / 10');
    await expect(anchor.locator('.gl-review-comment').first()).toHaveAttribute('data-expanded','true');
    await expect.poll(async () => Math.abs(await offset() - mixedBefore)).toBeLessThanOrEqual(1);
    expect(await page.locator('.gl-review-import-input').evaluate(node => node.scrollTop)).toBe(inputScroll);
  });
}
