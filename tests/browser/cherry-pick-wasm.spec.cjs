const {test,expect,chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

test('packaged worker merges with xdiff under production CSP and keeps native files private',async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'gitlab-xdiff-browser-'));
 let context;
 try {
  const extension=path.resolve(__dirname,'../../dist');
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  await context.route(/^https?:/,route=>route.abort());
  let [worker]=context.serviceWorkers();worker ||= await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const page=await context.newPage();await page.goto(`chrome-extension://${id}/popup.html`);
  await worker.evaluate(()=>{const original=globalThis.fetch;globalThis.xdiffLoads=0;globalThis.failXdiffOnce=true;globalThis.fetch=(...args)=>{if(String(args[0]).endsWith('/wasm/xdiff.wasm')){globalThis.xdiffLoads++;if(globalThis.failXdiffOnce){globalThis.failXdiffOnce=false;return Promise.resolve(new Response('invalid wasm'));}}return original(...args);};});
  expect(await worker.evaluate(()=>globalThis.xdiffLoads)).toBe(0);
  const samples=await page.evaluate(async()=>{
   const send=data=>chrome.runtime.sendMessage({type:'merge-cherry-pick-text',...data});
   const input={parent:'c\nb\na\na\nb\nd\nc\nc\nc\nc\nd\nd\n',source:'c\nb\na\na\nb\nd\nc\nc\nc\nd\nd\n',target:'c\nb\na\na\nb\nc\nc\nc\nd\nd\n'};
   const unavailable=await send(input);
   const before=performance.now();const cold=await send(input);const coldMs=performance.now()-before;
   const warm=[];for(let i=0;i<20;i++){const start=performance.now();await send(input);warm.push(performance.now()-start);}
   const largeParent=Array.from({length:5000},(_,i)=>i%4===0?'':`line ${i}`).join('\n')+'\n';
   const largeInput={parent:largeParent,source:largeParent.replace('line 101\n','source 101\n'),target:largeParent.replace('line 4901\n','target 4901\n')};
   const large=[];let largeResult;for(let i=0;i<30;i++){const start=performance.now();largeResult=await send(largeInput);large.push(performance.now()-start);}
   return {large,largeCorrect:largeResult.content===largeInput.source.replace('line 4901\n','target 4901\n'),unavailable,cold,coldMs,warm,conflict:await send({parent:'old\n',source:'new\n',target:'other\n'}),invalid:await send({parent:42}),binary:await send({parent:'a\0',source:'b',target:'c'})};
  });
  expect(samples.largeCorrect).toBe(true);
  expect(samples.cold).toEqual({content:'c\nb\na\na\nb\nc\nc\nd\nd\n'});
  expect(samples.unavailable).toEqual({code:'CP_MERGE_FAILED'});
  expect(samples.conflict).toEqual({code:'CP_OVERLAP'});
  expect(samples.invalid).toEqual({_error:'Invalid extension message'});
  expect(samples.binary).toEqual({code:'CP_BINARY'});
  expect(await worker.evaluate(()=>globalThis.xdiffLoads)).toBe(2);
  const manifest=await page.evaluate(()=>chrome.runtime.getManifest());
  expect(manifest.content_security_policy.extension_pages).toContain("'wasm-unsafe-eval'");
  expect(manifest.content_security_policy.extension_pages).not.toContain("'unsafe-eval'");
  expect(manifest.web_accessible_resources.flatMap(x=>x.resources).some(x=>/wasm|third-party/.test(x))).toBe(false);
  await fs.mkdir(path.resolve(__dirname,'../../.reports'),{recursive:true});
  await fs.writeFile(path.resolve(__dirname,'../../.reports/xdiff-browser-performance.json'),JSON.stringify(samples,null,2));
 }finally{if(context)await context.close();await fs.rm(profile,{recursive:true,force:true});}
});
