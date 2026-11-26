const { test, expect } = require('@playwright/test');
const { bundleForTest } = require('../helpers/runtime.cjs');
const path = require('node:path');
const messages = require('../../_locales/ru/messages.json');

for (const download of [true, false]) test(`large MR recovery and conversion retain publication retry safety: download=${download}`, async ({page}) => {
  const origin = 'https://gitlab.fixture.test';
  const mr = origin + '/team/repo/-/merge_requests/42';
  const refs = {head_sha:'a'.repeat(40), base_sha:'b'.repeat(40), start_sha:'c'.repeat(40)};
  const files = Array.from({length:18}, (_,i) => ({old_path:`file-${i}.txt`,new_path:`file-${i}.txt`,diff:'@@ -0,0 +1,2 @@\n+first\n+second\n'}));
  const comments = files.map((file,i)=>({id:`R${i+1}`,path:file.new_path,side:'new',line:1,code:'first',body:`Finding ${i+1}`}));
  comments.push({...comments[17],id:'R19',line:2,code:'second',body:'Finding 19'});
  const patch = files.map(file=>`diff --git a/${file.new_path} b/${file.new_path}\n--- /dev/null\n+++ b/${file.new_path}\n${file.diff}`).join('');
  const notes = [], sent = [], errors = [];
  let failed = false, downloads = 0;
  page.on('pageerror', error=>errors.push(error.message));
  await page.route(/^https?:/, async route => {
    const request = route.request(), url = new URL(request.url());
    const json = body => route.fulfill({contentType:'application/json',headers:{'x-next-page':''},body:JSON.stringify(body)});
    if(url.origin!==origin) throw new Error('Unexpected external request');
    if(request.method()==='POST') {
      const body = request.postDataJSON();
      sent.push(body);
      if(body.body==='Finding 2' && !failed){failed=true;return route.fulfill({status:400,body:'Denied by fixture'});}
      const note = {id:200+notes.length,body:body.body,position:body.position,author:{id:7}};
      notes.push(note);
      return json({id:`thread-${note.id}`,notes:[note]});
    }
    if(url.pathname.endsWith('.diff')) {downloads++;return route.fulfill({status:download?200:404,contentType:'text/plain',body:download?patch:''});}
    if(url.pathname.endsWith('/user')) return json({id:7});
    if(url.pathname.endsWith('/diffs')) return json(files.slice(0,6));
    if(url.pathname.endsWith('/changes')) return json({changes:files.slice(0,6),overflow:true});
    if(url.pathname.endsWith('/discussions')) return json(notes.map(note=>({id:`thread-${note.id}`,notes:[note]})));
    if(url.pathname.endsWith('/draft_notes')) return json([]);
    if(url.pathname.includes('/api/v4/') && url.pathname.endsWith('/merge_requests/42')) return json({iid:42,title:'Large MR',sha:refs.head_sha,diff_refs:refs});
    return route.fulfill({contentType:'text/html',body:'<html class="gl-actions-host gl-dark"><head><meta name="csrf-token" content="fixture"></head><body></body></html>'});
  });
  await page.goto(mr);
  await page.addStyleTag({path:path.resolve('content.css')});
  await page.addScriptTag({content:bundleForTest('src/features/review-import/index.ts',{globalName:'Importer'})});
  await page.addScriptTag({content:bundleForTest('src/widgets/review-import-dialog/ui/dialog.ts',{globalName:'Dialog'})});
  await page.evaluate(messages=>{
    const stored = {};
    window.chrome = {runtime:{},storage:{local:{get:(key,done)=>done({[key]:stored[key]}),set:(data,done)=>{Object.assign(stored,data);done();},remove:(key,done)=>{delete stored[key];done();}}}};
    const context = {origin:location.origin,webUrl:location.href,projectPath:'team/repo',kind:'merge_requests',iid:'42',apiRoot:location.origin+'/api/v4'};
    window.dialog = Dialog.createImportDialog(()=>window.importer);
    window.importer = Importer.createReviewImporter();
    window.dialog.open(context,{t:(key,values=[]) => (messages[key]?.message||key).replace(/\$(\d+)/g,(_,n)=>values[n-1])});
  },messages);
  await page.locator('.gl-review-import-input').fill(JSON.stringify({version:1,mr_url:mr,head_sha:refs.head_sha,comments}));
  await page.getByRole('button',{name:messages.aiReviewImportValidate.message,exact:true}).click();
  await expect(page.locator('.gl-review-status')).toHaveText(`Готово к отправке: ${download?19:6} из 19.`);
  expect(downloads).toBe(1);
  expect(sent).toHaveLength(0);
  if(!download){
    await page.locator('[data-import-convert="R19"]').click();
    await expect(page.locator('.gl-review-status')).toHaveText('Готово к отправке: 7 из 19.');
    const updated = JSON.parse(await page.locator('.gl-review-import-input').inputValue()).comments.find(item=>item.id==='R19');
    expect(updated.path).toBeNull();
    expect(updated.body).toBe('    file-17.txt:2\n\nFinding 19');
  }
  const total = download?19:7;
  const publish = page.getByRole('button',{name:messages.aiReviewImportPublish.message,exact:true});
  await publish.click();
  await expect.poll(()=>notes.length).toBe(total-1);
  await expect(publish).toBeEnabled();
  expect(sent).toHaveLength(total);
  await publish.click();
  await expect.poll(()=>notes.length).toBe(total);
  await expect(publish).toBeDisabled();
  expect(sent).toHaveLength(total+1);
  expect(new Set(notes.map(note=>note.body)).size).toBe(total);
  expect(notes.filter(note=>note.position).length).toBe(download?19:6);
  expect(errors).toEqual([]);
});
