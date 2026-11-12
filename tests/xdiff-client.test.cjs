'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {bundleForTest}=require('./helpers/runtime.cjs');
const harness=require('./helpers/extension.cjs');
const source=bundleForTest('src/features/cherry-pick/model/merge-text.ts',{globalName:'Client'});
function fixture(reply,lastError){
 const requests=[];let errorReads=0;
 const runtime={sendMessage:(message,callback)=>{requests.push(message);callback(reply);},get lastError(){errorReads++;return lastError;}};
 const context=vm.createContext({chrome:{runtime}});vm.runInContext(source,context);
 return {merge:context.Client.mergeText,requests,errorReads:()=>errorReads};
}
test('native merge client reads callback errors and rejects unavailable workers',async()=>{
 const env=fixture(undefined,{message:'worker stopped'});
 await assert.rejects(env.merge('a','b','c'),error=>error.code==='CP_MERGE_UNAVAILABLE');assert.equal(env.errorReads(),1);
});
for(const reply of [undefined,{content:42},{code:'<script>'}])test('native merge client rejects malformed replies: '+JSON.stringify(reply),async()=>{
 await assert.rejects(fixture(reply).merge('a','b','c'),error=>error.code==='CP_MERGE_FAILED');
});
test('native merge rejects binary content without sending it to the worker',async()=>{
 const env=fixture({content:'bad'});await assert.rejects(env.merge('a\0','b','c'),error=>error.code==='CP_BINARY');assert.equal(env.requests.length,0);
});
test('native merge worker rejects foreign senders before loading WASM',async()=>{
 const env=harness.background();
 assert.deepEqual(harness.plain(await env.dispatch({type:'merge-cherry-pick-text',parent:'a',source:'b',target:'c'},{id:'foreign-extension'})),{code:'CP_MERGE_DENIED'});
 assert.equal(env.requests.length,0);
});
