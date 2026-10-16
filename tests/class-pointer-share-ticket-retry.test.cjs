'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../backend/functions/class-pointer-share-auth.js','utf8');

// Exercise the deployed handler with a deterministic in-memory Firebase mock.
// No production credentials, database writes or browser permission prompts.
function fixture(){
  const room='class-pointer-12345678-1234-1234-1234-123456789abc';
  const base='b3Games/workspaces/b3-2026/classes/et';
  const rows=new Map([
    [base,{active:true,members:{arik:{active:true}}}],
    [base+'/members/arik',{active:true}],
    [base+'/classPointerSessions/'+room,{roomId:room,createdAt:Date.now(),studentScreenSharing:true,teacherUid:'teacher-et'}],
    ['b3Games/students/arik/profile',{name:'Arik',active:true}]
  ]);
  const ref=path=>({
    once:async()=>({val:()=>rows.get(path)??null}),
    set:async value=>{rows.set(path,value)},
    transaction:async callback=>{
      const before=rows.get(path)??null,after=callback(before);
      if(after===undefined)return{committed:false,snapshot:{val:()=>before}};
      if(after===null)rows.delete(path);else rows.set(path,after);
      return{committed:true,snapshot:{val:()=>after}};
    }
  });
  const db={ref};
  const admin={apps:[{}],database:()=>db,auth:()=>({verifyIdToken:async token=>({uid:token})})};
  let handler;
  const sandbox={module:{exports:{}},exports:{},require:name=>{
    if(name==='firebase-functions/v2/https')return{onRequest:(_options,fn)=>{handler=fn;return fn}};
    if(name==='firebase-admin')return admin;
    if(name==='node:crypto')return require('node:crypto');
    if(name==='./student-passcodes.cjs')return{readPasscode:async()=>({passcode:'123456'}),key:s=>typeof s==='string'&&/^[a-z0-9_-]+$/i.test(s),equal:(a,b)=>a===b};
    throw Error(name);
  },Buffer,Date,console};
  vm.runInNewContext(source,sandbox);
  async function post(body,uid){
    const result={statusCode:200,body:null};
    const response={set(){return this},status(code){result.statusCode=code;return this},json(value){result.body=value;return this}};
    await handler({method:'POST',body,ip:'127.0.0.1',headers:uid?{authorization:'Bearer '+uid}:{}},response);
    return result;
  }
  return{room,rows,post};
}
test('same teacher can verify a screen ticket twice during connection setup',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  assert.equal(issue.statusCode,200,JSON.stringify(issue.body));
  const args={action:'verify',classId:'et',room:f.room,token:issue.body.token};
  const first=await f.post(args,'teacher-et'),second=await f.post(args,'teacher-et');
  assert.equal(first.statusCode,200,JSON.stringify(first.body));
  assert.equal(second.statusCode,200,JSON.stringify(second.body));
});
test('a ticket cannot be verified by a different teacher',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  const result=await f.post({action:'verify',classId:'et',room:f.room,token:issue.body.token},'other-teacher');
  assert.equal(result.statusCode,403);
});
test('an ET ticket cannot be replayed against the WT class session',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  const base='b3Games/workspaces/b3-2026/classes/wt';
  f.rows.set(base,{active:true,members:{arik:{active:true}}});
  f.rows.set(base+'/members/arik',{active:true});
  f.rows.set(base+'/classPointerSessions/'+f.room,{roomId:f.room,createdAt:Date.now(),studentScreenSharing:true,teacherUid:'teacher-et'});
  const result=await f.post({action:'verify',classId:'wt',room:f.room,token:issue.body.token},'teacher-et');
  assert.equal(result.statusCode,403);
});
test('expired tickets remain invalid',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  const crypto=require('node:crypto'),digest=crypto.createHash('sha256').update(issue.body.token).digest('hex');
  const path='b3Private/classPointerShareTickets/'+digest;
  f.rows.get(path).expiresAt=Date.now()-1;
  const result=await f.post({action:'verify',classId:'et',room:f.room,token:issue.body.token},'teacher-et');
  assert.equal(result.statusCode,403);
});
