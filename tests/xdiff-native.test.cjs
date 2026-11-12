'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {merge}=require('./helpers/xdiff.cjs');
const {root}=require('./helpers/runtime.cjs');

test('packaged xdiff has no host imports and ships corresponding source and license',()=>{
 const module=new WebAssembly.Module(fs.readFileSync(path.join(root,'dist/wasm/xdiff.wasm')));
 assert.deepEqual(WebAssembly.Module.imports(module),[]);
 for(const name of ['bridge.c','git-xdiff.h','xmerge.c','COPYING','README.md','checksums.json'])
  assert.ok(fs.existsSync(path.join(root,'dist/third-party/xdiff',name)));
 assert.match(fs.readFileSync(path.join(root,'dist/THIRD_PARTY_NOTICES.txt'),'utf8'),/xdiff.*LGPL/);
});
test('native merge matches Git for generated repeated-line successes and conflicts',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xdiff-oracle-'));
 let seed=32874;const random=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
 try{for(let i=0;i<128;i++){
  const base=Array.from({length:12},()=>['a','b','c','d','e'][random(5)]+'\n');
  const change=()=>{const lines=[...base];lines.splice(random(lines.length),random(3),...Array.from({length:random(3)},()=>['A','B','C'][random(3)]+'\n'));return lines.join('');};
  const parent=base.join(''),source=change(),target=change();
  for(const [name,text]of Object.entries({parent,source,target}))fs.writeFileSync(path.join(directory,name),text);
  const git=spawnSync('git',['merge-file','-p',path.join(directory,'target'),path.join(directory,'parent'),path.join(directory,'source')],{encoding:'utf8'});
  assert.ok(git.status===0||git.status===1,git.stderr);
  if(git.status===0)assert.equal(merge(parent,source,target),git.stdout,'case '+i);
  else assert.throws(()=>merge(parent,source,target),/Overlapping/,'case '+i);
 }}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
