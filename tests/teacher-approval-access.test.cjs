'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
const server=fs.readFileSync(path.join(__dirname,'../backend/functions/teacher-requests.js'),'utf8');
const adminPage=fs.readFileSync(path.join(__dirname,'../owner-admin.html'),'utf8');
const registration=fs.readFileSync(path.join(__dirname,'../teacher-request.html'),'utf8');
const root='b3Games/workspaces/b3-2026';
function identity(){return {uid:'teacher-uid',email:'applicant@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}}}
function storeWith(invite){const records={[root+'/teacherInvites']:{applicant_example_com:invite}};return {get:async p=>records[p]??null,update:async update=>Object.assign(records,update)}}
test('approved but unassigned invitation is inactive',()=>{
 assert.match(server,/\[prefix\+'active'\]:false/);
 assert.match(server,/if\(!old\)/);
});
test('class assignment explicitly activates the invitation',()=>{
 assert.match(adminPage,/\[root\+"\/teacherInvites\/"\+t\+"\/active"\]:true/);
});
test('unassigned, inactive teacher is denied by teacher claim endpoint',async()=>{
 const store=storeWith({email:'applicant@example.com',name:'Applicant',active:false,classIds:{}});
 await assert.rejects(claimTeacher(store,identity()),/No active teacher invitation/);
});
test('student and unrelated Google identity cannot acquire a teacher role',async()=>{
 const store=storeWith({email:'applicant@example.com',name:'Applicant',active:true,classIds:{alpha:true}});
 await assert.rejects(claimTeacher(store,{...identity(),email:'student@example.com'}),/No active teacher invitation/);
 await assert.rejects(claimTeacher(store,{...identity(),firebase:{sign_in_provider:'password'}}),/verified Google/);
});
test('owner-assigned teacher only receives explicitly assigned classes',async()=>{
 const store=storeWith({email:'applicant@example.com',name:'Applicant',active:true,classIds:{alpha:true,beta:false,'*':true}});
 const granted=await claimTeacher(store,identity());
 assert.deepEqual(granted.classIds,['alpha']);
});
test('registration endpoint requires authentication and permits the custom domain',()=>{
 assert.match(server,/verifyIdToken\(token,true\)/);
 assert.match(server,/email_verified/);
 assert.match(server,/adultConfirmed!==true/);
 assert.match(server,/https:\/\/funtorahtools\.com/);
 assert.match(registration,/Request teacher access/);
});
test('approvals are restricted to the owner account',()=>{
 assert.match(server,/if\(email!==OWNER/);
 assert.match(server,/if\(action==='review'\)/);
});
