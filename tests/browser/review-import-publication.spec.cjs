const { test, expect } = require('@playwright/test');
const { bundleForTest } = require('../helpers/runtime.cjs');
const path = require('node:path');
const messages = require('../../_locales/ru/messages.json');
for (const width of [1100, 420]) for (const dark of [false, true]) {
  test(`publication preserves card geometry at ${width}, dark=${dark}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://gitlab.fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: `<html class="gl-actions-host ${dark ? 'gl-dark' : ''}"><body></body></html>` }));
    await page.goto('https://gitlab.fixture.test/team/repo/-/merge_requests/42');
    await page.addStyleTag({ path: path.resolve('content.css') });
    await page.addScriptTag({ content: bundleForTest('src/widgets/review-import-dialog/ui/dialog.ts', {globalName:'ImportDialog'}) });
    await page.evaluate(messages => {
      const context = { origin: location.origin, projectPath: 'team/repo', kind: 'merge_requests', iid: '42', webUrl: location.href, apiRoot: '/api/v4' };
      const items = Array.from({length: 10}, (_, i) => ({ id: String(i), status: 'ready', path: 'src/main.ts', side: 'new', line: i+1, code: 'return value;', body: 'Проверить пустое значение.' }));
      window.results = items.map(item => ({id: item.id, status: 'published', message: 'Published.', url: location.href + '#note_' + item.id}));
      window.dialog = ImportDialog.createImportDialog(() => ({
        prepare: async () => ({ context, headSha: 'abc', items, warnings: [] }),
        publish: (_, ids, options) => new Promise(resolve => { window.progress = options.onProgress; window.finish = () => resolve({ items: window.results, warnings: [] }); })
      }));
      window.dialog.open(context, { t: (key, values=[]) => (messages[key]?.message || key).replace(/\$(\d+)/g, (_, n) => values[n-1]) });
    }, messages);
    await expect(page.locator('.gl-review-dialog')).toHaveCSS('background-color', dark ? 'rgb(31, 30, 39)' : 'rgb(255, 255, 255)');
    await page.locator('.gl-review-import-input').fill('{}');
    await page.getByRole('button', { name: messages.aiReviewImportValidate.message, exact: true }).click();
    const cards = page.locator('.gl-review-import-item');
    await expect(cards).toHaveCount(10);
    const measure = () => cards.evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, top: node.offsetTop })));
    await page.locator('.gl-review-list').evaluate(node => { node.scrollTop = 80; });
    const scrollBefore = await page.locator('.gl-review-list').evaluate(node => node.scrollTop);
    const before = await measure();
    await page.getByRole('button', { name: messages.aiReviewImportPublish.message, exact: true }).click();
    await expect(page.locator('.gl-review-status')).toContainText('0 / 10');
    await page.evaluate(() => window.results.slice(0, 3).forEach(item => window.progress({item})));
    await expect(page.locator('.gl-review-status')).toContainText('3 / 10');
    expect(await measure()).toEqual(before);
    await page.evaluate(() => window.results.slice(3).forEach(item => window.progress({item})));
    await expect(cards.first()).toHaveAttribute('data-import-result', 'published');
    expect(await measure()).toEqual(before);
    await page.evaluate(() => window.finish());
    await expect(page.locator('.gl-review-status')).toContainText(`${messages.aiReviewImportPublished.message}: 10 / 10`);
    expect(await measure()).toEqual(before);
    await expect(page.locator('.gl-review-import-message')).toHaveCount(0);
    expect(await page.locator('.gl-review-list').evaluate(node => node.scrollTop)).toBe(scrollBefore);
    if (dark && width === 1100) await page.screenshot({path: '.reports/publication-complete-dark.png'});
  });
}
