'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
const ROOT='b3Games/workspaces/b3-2026';
const ownerUi=fs.readFileSync(path.join(__dirname,'../owner-admin.html'),'utf8');
const settings=fs.readFileSync(path.join(__dirname,'../site-settings.js'),'utf8');
const claimEndpoint=fs.readFileSync(path.join(__dirname,'../backend/functions/teacher-claim.js'),'utf8');
function identity(overrides={}){return {uid:'teacher-uid',email:'teacher@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'},...overrides};}
function store(invite,existing){
 const data={
  [ROOT+'/teacherInvites']:{teacher_example_com:{email:'teacher@example.com',name:'Teacher',...invite}},
 };
 if(existing!==undefined)data[ROOT+'/teachers/teacher-uid']=existing;
 return {
  get:async key=>data[key]??null,
  update:async updates=>{Object.assign(data,updates)},
  data
 };
}
test('an unassigned direct invitation remains inactive and cannot be claimed',async()=>{
 await assert.rejects(claimTeacher(store({active:false,classIds:{}}),identity()),/No active teacher invitation/);
});
test('even an erroneously active invitation cannot be claimed with zero classes',async()=>{
 await assert.rejects(claimTeacher(store({active:true,classIds:{}}),identity()),/A class must be assigned/);
});
test('only explicitly assigned classes appear in teacher claim',async()=>{
 const s=store({active:true,classIds:{alpha:true,beta:false,'*':true}});
 const result=await claimTeacher(s,identity());
 assert.deepEqual(result.classIds,['alpha']);
 assert.deepEqual(s.data[ROOT+'/teachers/teacher-uid'].classIds,{alpha:true});
 assert.equal(s.data[ROOT+'/teacherInvites/teacher_example_com/claimedUid'],'teacher-uid');
});
test('a disabled existing teacher is not revived by an old invitation',async()=>{
 await assert.rejects(claimTeacher(store({active:true,classIds:{alpha:true}},{active:false,classIds:{alpha:true}}),identity()),/disabled/);
});
test('a different or unverified identity cannot claim another teacher invitation',async()=>{
 await assert.rejects(claimTeacher(store({active:true,classIds:{alpha:true}}),identity({email:'someone-else@example.com'})),/No active teacher invitation/);
 await assert.rejects(claimTeacher(store({active:true,classIds:{alpha:true}}),identity({email_verified:false})),/verified Google/);
});
test('owner direct-add flow does not activate an unassigned invitation',()=>{
 assert.match(ownerUi,/role:"teacher",active:false,updatedAt/);
 assert.ok(ownerUi.includes('[root+"/teacherInvites/"+t+"/active"]:true'));
 assert.match(ownerUi,/updates\[root\+"\/teachers\/"\+uid\+"\/active"\]=true/);
});
test('last-class unassignment deactivates both invitation and claimed teacher',()=>{
 assert.match(ownerUi,/if\(!hasRemaining\)updates\[root\+"\/teacherInvites\/"\+inviteId\+"\/active"\]=false/);
 assert.match(ownerUi,/if\(!hasRemaining\)updates\[root\+"\/teachers\/"\+uid\+"\/active"\]=false/);
});
test('new teacher verification failure always denies client access',()=>{
 assert.doesNotMatch(settings,/claimPending:true/);
 assert.match(settings,/A failed or unavailable verifier must never authorize a new teacher/);
});
test('new teacher access reads only the verified teacher invitation addressed to that email',()=>{
 assert.match(settings,/const inviteId = email\.replace\(\/\[\^a-z0-9\]\+\/g,"_"\)/);
 assert.match(settings,/ref\(WORKSPACE_ROOT_KEY \+ "\/teacherInvites\/" \+ inviteId\)/);
 assert.doesNotMatch(settings,/ref\(WORKSPACE_ROOT_KEY\s*\+\s*["']\/teacherInvites["']\s*\)\.once/);
 assert.match(settings,/String\(invite\.email \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== email/);
});

test('custom Fun Torah Tools domains are allowed to call the teacher claim function',()=>{
 assert.match(claimEndpoint,/https:\/\/funtorahtools\.com/);
 assert.match(claimEndpoint,/https:\/\/www\.funtorahtools\.com/);
});

const vm=require('node:vm');
function uiTeacherAccess(records,user){
 const begin=settings.indexOf('  function readUserAccess(user) {');
 const end=settings.indexOf('\n  function isAuthorizedUser(user)',begin);
 assert.ok(begin>=0&&end>begin,'teacher access code is present');
 const source=settings.slice(begin,end)+'\nreadUserAccess;';
 const ctx={
   ensureFirebase:()=>({db:{ref:pathname=>({once:async()=>({val:()=>records[pathname]??null})})}}),
   isBootstrapAdmin:()=>false,
   WORKSPACE_ROOT_KEY:ROOT,
   console
 };
 return vm.runInNewContext(source,ctx)(user);
}
test('existing active teacher with no assigned classes is not authorized in Teacher Center',async()=>{
 const user={uid:'empty',email:'teacher@example.com'};
 const access=await uiTeacherAccess({[ROOT+'/teachers/empty']:{active:true,classIds:{}}},user);
 assert.equal(access.authorized,false);
 assert.deepEqual(Array.from(access.classIds),[]);
});
test('existing active teacher cannot use wildcard or disabled classes as an assignment',async()=>{
 const user={uid:'empty',email:'teacher@example.com'};
 const access=await uiTeacherAccess({[ROOT+'/teachers/empty']:{active:true,classIds:{'*':true,closed:false}}},user);
 assert.equal(access.authorized,false);
});
test('existing active teacher with one assigned class retains access only to that class',async()=>{
 const user={uid:'assigned',email:'teacher@example.com'};
 const access=await uiTeacherAccess({[ROOT+'/teachers/assigned']:{active:true,classIds:{alpha:true,beta:false,'*':true}}},user);
 assert.equal(access.authorized,true);
 assert.deepEqual(Array.from(access.classIds),['alpha']);
});
test('unassigned invitation cannot authorize UI or attempt an implicit server claim',async()=>{
 const user={uid:'new',email:'new@example.test',emailVerified:true,getIdToken:async()=>{throw Error('Unexpected claim attempt')}};
 const access=await uiTeacherAccess({[ROOT+'/teacherInvites']:{new:{email:'new@example.test',active:true,classIds:{}}}},user);
 assert.equal(access.authorized,false);
});
