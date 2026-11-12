'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {merge}=require('./helpers/xdiff.cjs');
const examples=[
 {name:'independent deletions in repeated lines preserve both deletions',parent:'c\nb\na\na\nb\nd\nc\nc\nc\nc\nd\nd\n',source:'c\nb\na\na\nb\nd\nc\nc\nc\nd\nd\n',target:'c\nb\na\na\nb\nc\nc\nc\nd\nd\n',expected:'c\nb\na\na\nb\nc\nc\nd\nd\n'},

 {name:'target edits a context line',parent:'first\ncontext-one\ncontext-two\nold\nlast\n',source:'first\ncontext-one\ncontext-two\nnew\nlast\n',target:'target-first\ncontext-one\ncontext-two\nold\nlast\n',expected:'target-first\ncontext-one\ncontext-two\nnew\nlast\n'},
 {name:'independent insertion and deletion',parent:'a\nb\nc\nd\ne\n',source:'a\nb\nadded\nc\nd\ne\n',target:'a\nb\nc\nd\n',expected:'a\nb\nadded\nc\nd\n'},
 {name:'source edit already applied with independent target change',parent:'a\nb\nc\nd\ne\n',source:'A\nb\nc\nd\ne\n',target:'A\nb\nc\nd\nE\n',expected:'A\nb\nc\nd\nE\n'},
 {name:'independent edits without terminal newline',parent:'a\nb\nc\nd\ne',source:'A\nb\nc\nd\ne',target:'a\nb\nc\nd\nE',expected:'A\nb\nc\nd\nE'},
 {name:'CRLF content',parent:'a\r\nb\r\nc\r\nd\r\ne\r\n',source:'A\r\nb\r\nc\r\nd\r\ne\r\n',target:'a\r\nb\r\nc\r\nd\r\nE\r\n',expected:'A\r\nb\r\nc\r\nd\r\nE\r\n'}
];
for(const example of examples) test('three-way merge matches Git: '+example.name,()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cherry-merge-'));
 try {
  for(const key of ['parent','source','target']) fs.writeFileSync(path.join(directory,key),example[key]);
  const git=spawnSync('git',['merge-file','-p',path.join(directory,'target'),path.join(directory,'parent'),path.join(directory,'source')],{encoding:'utf8'});
  assert.equal(git.status,0,git.stderr);
  assert.equal(git.stdout,example.expected);
  assert.equal(merge(example.parent,example.source,example.target),git.stdout);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('three-way merge refuses actual overlapping edits',()=>{
 assert.throws(()=>merge('a\nb\nc\n','a\nsource\nc\n','a\ntarget\nc\n'),/Overlapping/);
 assert.throws(()=>merge('a\nb\nc\n','a\nsource\nb\nc\n','a\ntarget\nb\nc\n'),/Overlapping/);
});
test('three-way merge bounds work on highly divergent content',()=>{
 const content=prefix=>Array.from({length:21000},(_,i)=>prefix+i+'\n').join('');
 assert.throws(()=>merge(content('base'),content('source'),content('target')),/limit/);
});
test('repeated context cannot hide a replacement behind a shared deletion',()=>{
 assert.throws(()=>merge('e\nb\nb\nc\ne\nc\ne\nb\na\nd\ne\ne\n','e\nb\nb\nc\nA\ne\nb\na\nd\ne\ne\n','e\nb\nb\nc\ne\nb\na\nd\ne\ne\n'),/Ambiguous|Overlapping/);
});
test('adjacent insertion and replacement remain a conflict, matching Git',()=>{
 assert.throws(()=>merge('old\n','new\n','prefix\nold\nsuffix\n'),/Overlapping/);
});
test('WASM rejects binary and oversized inputs before native allocation',()=>{
 assert.throws(()=>merge('a\0','b','c'),/Binary/);
 assert.throws(()=>merge('a'.repeat(4_000_001),'b','c'),/size limit/);
});
