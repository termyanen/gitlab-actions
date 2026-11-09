const {test,expect}=require('@playwright/test');
const path=require('node:path');

for(const target of ['html','body'])for(const marker of ['class','data-theme']){
 test(`commit version badges follow light/dark changes on ${target} via ${marker}`,async({page})=>{
  await page.setContent('<html class="gl-actions-host"><body><div id="fixture"><p><span class="gl-commit-version-badge gl-commit-version-changed">1.14.0</span>fix: bump version</p><p><span class="gl-commit-version-badge">1.13.3</span>refactor: simplify settings</p></div><span id="native">Native control</span></body></html>');
  await page.addStyleTag({content:'html{font:14px system-ui;background:#fff;color:#303030}body{margin:24px}html.gl-dark,html[data-theme="dark"],body.gl-dark,body[data-theme="dark"]{background:#1f1e27;color:#ececef}#fixture{padding:8px}#native{color:rgb(1,2,3)}'});
  await page.addStyleTag({path:path.resolve('content.css')});
  const plain=page.locator('.gl-commit-version-badge:not(.gl-commit-version-changed)');
  const changed=page.locator('.gl-commit-version-changed');
  async function colors(){return changed.evaluate(el=>{const s=getComputedStyle(el);return {fg:s.color,bg:s.backgroundColor,border:s.borderColor};});}
  const light=await colors();
  expect(light.bg).toBe('rgb(233, 243, 252)');
  const lightPlain=await plain.evaluate(el=>getComputedStyle(el).color);
  await page.evaluate(({target,marker})=>{const el=document.querySelector(target);if(marker==='class')el.classList.add('gl-dark');else el.dataset.theme='dark';},{target,marker});
  const dark=await colors();
  expect(dark.bg).toBe('rgb(36, 54, 74)');
  expect(dark.fg).toBe('rgb(157, 199, 241)');
  expect(await plain.evaluate(el=>getComputedStyle(el).color)).toBe('rgb(181, 180, 190)');
  expect(await page.locator('#native').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(1, 2, 3)');
  if(target==='html'&&marker==='class')await page.locator('#fixture').screenshot({path:'.reports/commit-versions-dark.png'});
  await page.evaluate(({target,marker})=>{const el=document.querySelector(target);if(marker==='class')el.classList.remove('gl-dark');else delete el.dataset.theme;},{target,marker});
  expect(await colors()).toEqual(light);
  expect(await plain.evaluate(el=>getComputedStyle(el).color)).toBe(lightPlain);
  if(target==='html'&&marker==='class')await page.locator('#fixture').screenshot({path:'.reports/commit-versions-light.png'});
  // The host's semantic colors must win over compatibility fallbacks.
  await page.evaluate(()=>document.documentElement.style.setProperty('--gl-background-color-info-subtle','rgb(30, 40, 50)'));
  expect((await colors()).bg).toBe('rgb(30, 40, 50)');
 });
}
