'use strict';
// Issue 410: a damaged teacher record must self-heal from the invitation, and a
// failed check must report the real error instead of looking like "not authorized".
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../site-settings.js'),'utf8');
const start=source.indexOf('function readUserAccessFromFirebase(user)');
const end=source.indexOf('function readUserAccess(user)');
assert.ok(start>0&&end>start,'access reader not found');
const readerSource=source.slice(start,end);
const ROOT='b3Games/workspaces/b3-2026';

function load({data,claim,readError}){
 const calls={claim:0};
 const db={ref:key=>({once:async()=>{
  if(readError)throw new Error(readError);
  return {val:()=>data[key]===undefined?null:data[key]};
 }})};
 const fetch=async()=>{calls.claim++;return claim();};
 const make=new Function('ensureFirebase','WORKSPACE_ROOT_KEY','isBootstrapAdmin','fetch','AbortSignal','console',
  readerSource+';return readUserAccessFromFirebase;');
 const quiet={warn(){},error(){},log(){}};
 return {read:make(()=>({db}),ROOT,()=>false,fetch,{timeout:()=>undefined},quiet),calls};
}
const user={uid:'u1',email:'Teacher@Example.com',emailVerified:true,getIdToken:async()=>'t'};
const invite={email:'teacher@example.com',active:true,classIds:{testing:true}};
const ok=body=>({ok:true,status:200,json:async()=>body,text:async()=>''});
const refuse=status=>({ok:false,status,json:async()=>({}),text:async()=>'refused'});

test('healthy teacher record is accepted without calling the server',async()=>{
 const {read,calls}=load({data:{[ROOT+'/teachers/u1']:{active:true,classIds:{testing:true}}},claim:()=>{throw new Error('no');}});
 const access=await read(user);
 assert.equal(access.authorized,true);
 assert.deepEqual(access.classIds,['testing']);
 assert.equal(calls.claim,0);
});

test('active record with no classes re-claims from an assigned invitation',async()=>{
 const {read,calls}=load({
  data:{[ROOT+'/teachers/u1']:{active:true},[ROOT+'/teacherInvites/teacher_example_com']:invite},
  claim:()=>ok({authorized:true,classIds:['testing'],inviteId:'teacher_example_com'})});
 const access=await read(user);
 assert.equal(access.authorized,true);
 assert.deepEqual(access.classIds,['testing']);
 assert.equal(calls.claim,1);
});

test('active record with no classes stays denied when the invitation is gone or inactive',async()=>{
 for(const inv of [undefined,{...invite,active:false}]){
  const data={[ROOT+'/teachers/u1']:{active:true,classIds:{}}};
  if(inv)data[ROOT+'/teacherInvites/teacher_example_com']=inv;
  const {read,calls}=load({data,claim:()=>ok({authorized:true,classIds:['x']})});
  const access=await read(user);
  assert.equal(access.authorized,false);
  assert.equal(access.checkFailed,undefined);
  assert.equal(calls.claim,0);
 }
});

test('active record with no classes stays denied when the server refuses (403)',async()=>{
 const {read}=load({
  data:{[ROOT+'/teachers/u1']:{active:true},[ROOT+'/teacherInvites/teacher_example_com']:invite},
  claim:()=>refuse(403)});
 const access=await read(user);
 assert.equal(access.authorized,false);
 assert.equal(access.checkFailed,undefined,'a real refusal is not a failed check');
});

test('a disabled teacher record is never revived by the client',async()=>{
 const {read,calls}=load({
  data:{[ROOT+'/teachers/u1']:{active:false,classIds:{testing:true}},[ROOT+'/teacherInvites/teacher_example_com']:invite},
  claim:()=>ok({authorized:true,classIds:['testing']})});
 const access=await read(user);
 assert.equal(access.authorized,false);
 assert.equal(calls.claim,0);
});

test('a server error is reported as a failed check, still denied',async()=>{
 const {read}=load({data:{[ROOT+'/teacherInvites/teacher_example_com']:invite},claim:()=>refuse(500)});
 const access=await read(user);
 assert.equal(access.authorized,false);
 assert.equal(access.checkFailed,true);
 assert.match(access.error,/HTTP 500/);
});

test('a failed database read is reported with its real error, still denied',async()=>{
 const {read}=load({data:{},claim:()=>ok({}),readError:'PERMISSION_DENIED: Permission denied'});
 const access=await read(user);
 assert.equal(access.authorized,false);
 assert.equal(access.checkFailed,true);
 assert.match(access.error,/PERMISSION_DENIED/);
});

test('sign-in shows a try-again message for a failed check, not "not authorized"',()=>{
 assert.match(source,/access\.checkFailed\s*\?\s*new Error\("We could not check your account just now/);
 assert.match(source,/b3\/access-check-failed/);
 assert.match(source,/This Google account is not authorized for Fun Torah Tools\./);
});
