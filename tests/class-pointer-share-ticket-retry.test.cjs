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
    [base+'/classPointerSessions/'+room,{roomId:room,createdAt:Date.now(),studentScreenSharing:true,teacherUid:'teacher-et',destinationRequest:{mode:'screens',at:Date.now()}}],
    ['b3Games/workspaces/b3-2026/teachers/teacher-et',{active:true,classIds:{et:true}}],
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
test('a teacher whose class assignment was revoked cannot verify an issued ticket',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  f.rows.set('b3Games/workspaces/b3-2026/teachers/teacher-et',{active:true,classIds:{et:false}});
  const result=await f.post({action:'verify',classId:'et',room:f.room,token:issue.body.token},'teacher-et');
  assert.equal(result.statusCode,403);
  assert.match(result.body.error,/no longer active or assigned/);
});
test('an inactive teacher cannot verify an issued ticket',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  f.rows.set('b3Games/workspaces/b3-2026/teachers/teacher-et',{active:false,classIds:{et:true}});
  const result=await f.post({action:'verify',classId:'et',room:f.room,token:issue.body.token},'teacher-et');
  assert.equal(result.statusCode,403);
});
test('screen-sharing denial is read from the private per-student policy on issue and verify',async()=>{
  const f=fixture(),policy='b3Private/classPointerSharePermissions/b3-2026/et/'+f.room+'/arik';
  f.rows.set(policy,{screenSharingDenied:true});
  const deniedIssue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  assert.equal(deniedIssue.statusCode,403);
  f.rows.delete(policy);
  const issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  assert.equal(issue.statusCode,200);
  f.rows.set(policy,{screenSharingDenied:true});
  const deniedVerify=await f.post({action:'verify',classId:'et',room:f.room,token:issue.body.token},'teacher-et');
  assert.equal(deniedVerify.statusCode,403);
  assert.match(deniedVerify.body.error,/turned off your screen sharing/);
});
test('student permission check verifies the PIN and returns only that student’s private flags',async()=>{
  const f=fixture();
  f.rows.set('b3Private/classPointerSharePermissions/b3-2026/et/'+f.room+'/arik',{screenSharingDenied:true});
  f.rows.set('b3Private/classPointerSharePermissions/b3-2026/et/'+f.room+'/peer',{screenSharingDenied:false,whiteboardDenied:true});
  const allowed=await f.post({action:'permissions',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  assert.equal(allowed.statusCode,200,JSON.stringify(allowed.body));
  assert.deepEqual({...allowed.body},{ok:true,screenSharingDenied:true,whiteboardDenied:false});
  const badPin=await f.post({action:'permissions',studentId:'arik',pin:'wrong',classId:'et',room:f.room});
  assert.equal(badPin.statusCode,401);
  assert.equal(Object.keys(allowed.body).some(key=>key==='peer'||key==='whiteboardDenied'&&allowed.body.whiteboardDenied!==false),false);
});
test('an ET ticket cannot be replayed against the WT class session',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  const base='b3Games/workspaces/b3-2026/classes/wt';
  f.rows.set(base,{active:true,members:{arik:{active:true}}});
  f.rows.set(base+'/members/arik',{active:true});
  f.rows.set(base+'/classPointerSessions/'+f.room,{roomId:f.room,createdAt:Date.now(),studentScreenSharing:true,teacherUid:'teacher-et'});
  f.rows.set('b3Games/workspaces/b3-2026/teachers/teacher-et',{active:true,classIds:{et:true,wt:false}});
  const result=await f.post({action:'verify',classId:'wt',room:f.room,token:issue.body.token},'teacher-et');
  assert.equal(result.statusCode,403);
});
test('tickets are invalid at and after their expiry time',async()=>{
  const f=fixture(),issue=await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  const crypto=require('node:crypto'),digest=crypto.createHash('sha256').update(issue.body.token).digest('hex');
  const path='b3Private/classPointerShareTickets/'+digest;
  f.rows.get(path).expiresAt=Date.now();
  const result=await f.post({action:'verify',classId:'et',room:f.room,token:issue.body.token},'teacher-et');
  assert.equal(result.statusCode,403);
});
// Sharing enabled with no teacher request: a student may share on his own, so his own permission must be answerable.
test('permission check answers once sharing is enabled, without a teacher request',async()=>{
  const f=fixture(),key='b3Games/workspaces/b3-2026/classes/et/classPointerSessions/'+f.room;
  f.rows.set(key,{roomId:f.room,createdAt:Date.now(),studentScreenSharing:true,teacherUid:'teacher-et'});
  const ask=()=>f.post({action:'permissions',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  let r=await ask();
  assert.equal(r.statusCode,200,JSON.stringify(r.body));
  assert.equal(r.body.screenSharingDenied,false);
  // An authorized student can still share.
  assert.equal((await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room})).statusCode,200);
  // The teacher turns him off: the check says so, and sharing is refused.
  f.rows.set('b3Private/classPointerSharePermissions/b3-2026/et/'+f.room+'/arik',{screenSharingDenied:true});
  r=await ask();
  assert.equal(r.statusCode,200);
  assert.equal(r.body.screenSharingDenied,true);
  assert.equal((await f.post({action:'issue',studentId:'arik',pin:'123456',classId:'et',room:f.room})).statusCode,403);
  // Wrong passcode still gets nothing.
  assert.equal((await f.post({action:'permissions',studentId:'arik',pin:'wrong',classId:'et',room:f.room})).statusCode,401);
});
test('permission check still refuses when sharing is off and there is no request, or the boy is not in the class',async()=>{
  const f=fixture(),key='b3Games/workspaces/b3-2026/classes/et/classPointerSessions/'+f.room;
  f.rows.set(key,{roomId:f.room,createdAt:Date.now(),studentScreenSharing:false,teacherUid:'teacher-et'});
  const off=await f.post({action:'permissions',studentId:'arik',pin:'123456',classId:'et',room:f.room});
  assert.equal(off.statusCode,403);
  assert.match(off.body.error,/no active student activity request/);
  f.rows.set(key,{roomId:f.room,createdAt:Date.now(),studentScreenSharing:true,teacherUid:'teacher-et'});
  const outsider=await f.post({action:'permissions',studentId:'wes',pin:'123456',classId:'et',room:f.room});
  assert.equal(outsider.statusCode,403);
  assert.equal(outsider.body.screenSharingDenied,undefined);
});
