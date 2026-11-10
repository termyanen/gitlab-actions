const {test,expect} = require('@playwright/test');
const path = require('node:path');

for (const marker of ['class="gl-dark"','data-theme="dark"']) for (const onRoot of [false,true]) {
  test(`injected controls share dark fallback tokens: ${marker}, root=${onRoot}`,async ({page})=>{
    await page.setContent(`<html class="gl-actions-host ${onRoot && marker.startsWith('class')?'gl-dark':''}" ${onRoot && marker.startsWith('data')?marker:''}><body ${onRoot?'':marker}>
      <button id="native" style="color:rgb(10,20,30);background:rgb(240,241,242)">GitLab</button>
      <button class="gl-mr-ext-git-cmd-btn">Git command</button>
      <button class="gl-group-play-btn">Play</button>
      <button class="gl-group-play-btn gl-group-play-done">Done</button>
      <button class="gl-group-play-btn gl-group-play-error">Error</button>
      <div class="gl-review-launcher"><button class="gl-review-button">Review</button></div>
      <div class="gl-review-inline"><button class="gl-review-button">Reply</button></div>
      <div class="gl-review-overlay"><section class="gl-review-dialog"><button class="gl-review-button">Close</button></section></div>
    </body></html>`);
    await page.addStyleTag({path:path.resolve('content.css')});
    for (const scope of ['.gl-review-launcher','.gl-review-inline','.gl-review-overlay']) {
      await expect(page.locator(scope+' .gl-review-button')).toHaveCSS('background-color','rgb(31, 30, 39)');
      await expect(page.locator(scope+' .gl-review-button')).toHaveCSS('color','rgb(236, 236, 239)');
    }
    await expect(page.locator('.gl-mr-ext-git-cmd-btn')).toHaveCSS('background-color','rgb(31, 31, 31)');
    await expect(page.locator('.gl-group-play-btn').first()).toHaveCSS('background-color','rgb(40, 39, 45)');
    await expect(page.locator('.gl-group-play-done')).toHaveCSS('color','rgb(16, 133, 72)');
    await expect(page.locator('.gl-group-play-error')).toHaveCSS('color','rgb(221, 43, 14)');
    await expect(page.locator('#native')).toHaveCSS('color','rgb(10, 20, 30)');
    await expect(page.locator('#native')).toHaveCSS('background-color','rgb(240, 241, 242)');
    // Changing GitLab's theme in place must update every surface without rerendering.
    await page.evaluate(()=>{
      document.documentElement.classList.remove('gl-dark');
      document.documentElement.removeAttribute('data-theme');
      document.body.classList.remove('gl-dark');
      document.body.removeAttribute('data-theme');
    });
    for (const scope of ['.gl-review-launcher','.gl-review-inline','.gl-review-overlay']) {
      await expect(page.locator(scope+' .gl-review-button')).toHaveCSS('background-color','rgb(255, 255, 255)');
      await expect(page.locator(scope+' .gl-review-button')).toHaveCSS('color','rgb(48, 48, 48)');
    }
  });
}
