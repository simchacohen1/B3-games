'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root='b3Games/workspaces/b3-2026/';
function harness(identity,rows){
  const reads=[];
  const snap=value=>({exists:()=>value!=null,val:()=>value??null,child:key=>snap(key.split('/').reduce((v,k)=>v?.[k],value))});
  const admin={apps:[{}],auth:()=>({verifyIdToken:async(token,revoked)=>{assert.equal(token,'synthetic-token');assert.equal(revoked,true);return identity;}}),database:()=>({ref:key=>({get:async()=>{reads.push(key);return snap(rows[key]);}})})};
  const mod={exports:{}};
  new Function('require','module','exports',fs.readFileSync(path.join(__dirname,'../backend/functions/class-gallery-read.js'),'utf8'))(name=>name==='firebase-admin'?admin:name==='node:crypto'?require('node:crypto'):{onRequest:(options,handler)=>handler},mod,mod.exports);
  return async(classId,authenticated=true,since='')=>{
    let code=200,body;
    const res={set(){},status(value){code=value;return this;},json(value){body=value;return this;}};
    await mod.exports.classGalleryRead({method:'GET',headers:authenticated?{authorization:'Bearer synthetic-token'}:{},query:{classId,...(since?{since}:{})}},res);
    return {code,body,reads};
  };
}
for(const cls of ['et','wt'])test(`synthetic ${cls} student reload preserves approved work and isolates pending posts`,async()=>{
  const other=cls==='et'?'wt':'et';
  const posts={legacy:{className:cls==='et'?'B3 ET':'B3 WT',status:'approved',image:'data:image/jpeg;base64,example'},own:{classId:cls,studentId:'one',status:'pending'},peer:{classId:cls,studentId:'two',status:'pending'},foreign:{classId:other,status:'approved'}};
  const run=harness({uid:'synthetic',b3StudentRole:'student',b3ClassId:cls,b3StudentId:'one'},{[root+'classes/'+cls]:{active:true},[root+'classes/'+cls+'/members/one']:{active:true},'classGallery/posts':posts});
  const first=await run(cls),reload=await run(cls);
  assert.equal(first.code,200);assert.deepEqual(Object.keys(first.body.posts),['legacy','own']);assert.deepEqual(reload.body,first.body);
  assert.equal((await run(other)).code,403);assert.equal((await run(cls,false)).code,401);
  assert.deepEqual(posts.own.status,'pending');
});
test('synthetic assigned teacher sees legacy pending queue; unassigned teacher is denied',async()=>{
  const run=harness({uid:'teacher',firebase:{sign_in_provider:'google.com'}},{[root+'classes/et']:{active:true},[root+'classes/wt']:{active:true},[root+'teachers/teacher']:{active:true,classIds:{et:true}},'classGallery/posts':{pending:{className:'B3 ET',status:'pending'},other:{className:'B3 WT',status:'pending'}}});
  assert.deepEqual((await run('et')).body.posts,{pending:{className:'B3 ET',status:'pending'}});
  assert.equal((await run('wt')).code,403);
});

test('unchanged poll returns a tiny hash-only reply; changed or other-viewer hashes get full posts',async()=>{
  const rows={[root+'classes/et']:{active:true},[root+'classes/et/members/one']:{active:true},'classGallery/posts':{a:{className:'B3 ET',status:'approved',image:'data:image/jpeg;base64,AAAA'},p:{classId:'et',studentId:'one',status:'pending'}}};
  const run=harness({uid:'s',b3StudentRole:'student',b3ClassId:'et',b3StudentId:'one'},rows);
  const first=await run('et');
  assert.match(first.body.hash,/^[a-f0-9]{64}$/);assert.ok(first.body.posts);
  const same=await run('et',true,first.body.hash);
  assert.deepEqual(same.body,{unchanged:true,hash:first.body.hash});
  rows['classGallery/posts'].a.status='removed';
  const changed=await run('et',true,first.body.hash);
  assert.ok(changed.body.posts);assert.notEqual(changed.body.hash,first.body.hash);
  assert.ok((await run('et',true,'not-a-hash')).body.posts);
});
