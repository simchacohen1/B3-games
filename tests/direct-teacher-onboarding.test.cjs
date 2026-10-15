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

test('custom Fun Torah Tools domains are allowed to call the teacher claim function',()=>{
 assert.match(claimEndpoint,/https:\/\/funtorahtools\.com/);
 assert.match(claimEndpoint,/https:\/\/www\.funtorahtools\.com/);
});
