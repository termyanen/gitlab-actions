const { test, expect } = require('@playwright/test');
const { bundleForTest } = require('../helpers/runtime.cjs');
const path = require('node:path');
const messages = require('../../_locales/ru/messages.json');
for (const width of [1100, 420]) for (const dark of [false, true]) {
  test(`long comments allow column scrolling at ${width}, dark=${dark}`, async ({ page }) => {
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
    const allToggle = page.locator('.gl-review-comments-toggle-all');
    await expect(allToggle).toHaveText(messages.aiReviewExpandAll.message);
    await allToggle.click();
    await expect(page.locator('.gl-review-comment[data-expanded="false"]')).toHaveCount(0);
    await expect(allToggle).toHaveText(messages.aiReviewCollapseAll.message);
    await page.locator('.gl-review-import-original .gl-review-comment-toggle').first().click();
    await expect(allToggle).toHaveText(messages.aiReviewExpandAll.message);
    await allToggle.click();
    await expect(allToggle).toHaveText(messages.aiReviewCollapseAll.message);
    await allToggle.click();
    await expect(page.locator('.gl-review-comment[data-expanded="true"]')).toHaveCount(0);
    await expect(allToggle).toHaveText(messages.aiReviewExpandAll.message);
    await expect(page.locator('.gl-review-list')).toHaveCSS('padding-inline-end','4px');
    const input = page.locator('.gl-review-import-input');
    await input.scrollIntoViewIfNeeded();
    const inputBox = await input.boundingBox();
    await page.mouse.move(inputBox.x + 40, inputBox.y + 40);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => input.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const scroller = page.locator(width > 720 ? '.gl-review-list' : '.gl-review-import-columns');
    const original = page.locator('.gl-review-import-original .gl-review-note-text').first();
    await original.scrollIntoViewIfNeeded();
    await expect(original).toHaveCSS('overflow-y', 'clip');
    expect(await original.evaluate(node => node.clientHeight / parseFloat(getComputedStyle(node).lineHeight))).toBeLessThanOrEqual(5.1);
    const compactBefore = await scroller.evaluate(node => node.scrollTop);
    const compactBox = await original.boundingBox();
    await page.mouse.move(compactBox.x + 25, compactBox.y + 25);
    await page.mouse.wheel(0, 150);
    await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(compactBefore);
    expect(await original.evaluate(node => node.scrollTop)).toBe(0);
    const toggle = original.locator('..').getByRole('button');
    await expect(toggle).toHaveText(messages.aiReviewShowFull.message);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText(messages.aiReviewShowLess.message);
    await expect(original).toHaveCSS('overflow-y', 'visible');
    await expect(original).toHaveCSS('max-height', 'none');
    const before = await scroller.evaluate(node => node.scrollTop);
    const bounds = await original.boundingBox();
    const clip = await scroller.boundingBox();
    await page.mouse.move(bounds.x + 30, Math.max(bounds.y, clip.y) + 35);
    await page.mouse.wheel(0, 350);
    await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(before);
    expect(await original.evaluate(node => node.scrollTop)).toBe(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    for (const selector of ['.gl-review-list', '.gl-review-output', '.gl-review-import-input']) {
      await expect(page.locator(selector)).toHaveCSS('scrollbar-gutter', 'stable');
      await expect(page.locator(selector)).toHaveCSS('scrollbar-width', 'auto');
    }
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(original).toHaveCSS('overflow-y', 'clip');
    if (width === 1100) expect(await scroller.evaluate(node => node.offsetWidth - node.clientWidth)).toBeGreaterThanOrEqual(14);
    if (width === 1100 && dark) await page.screenshot({path: '.reports/review-scroll-dark.png'});
  });
}
