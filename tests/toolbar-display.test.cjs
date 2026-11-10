const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {bundleForTest}=require('./helpers/runtime.cjs');
const context=vm.createContext({Date,Intl});
vm.runInContext(bundleForTest('src/widgets/mr-toolbar/ui/display.ts'),context);
const {formatElapsed}=context.TestModule;

test('MR age uses localized units in every supported language, clamps future dates and rejects invalid dates',()=>{
 const created=new Date(Date.now()-183900000).toISOString();
 for(const locale of fs.readdirSync('_locales',{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name)){
  const language=locale.replace('_','-');
  assert.ok(formatElapsed(created,language)?.length>0);
 }
 assert.equal(formatElapsed(created,'en'),'2 days 3 hr');
 assert.equal(formatElapsed(created,'ru'),'2 дн. 3 ч');
 assert.equal(formatElapsed('invalid','ru'),null);
 assert.equal(formatElapsed(new Date(Date.now()+600000).toISOString(),'en'),'0 min');
 assert.equal(formatElapsed(new Date(Date.now()-7500000).toISOString(),'en'),'2 hr 5 min');
});
