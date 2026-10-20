'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {authorizePracticeStudent}=require('../backend/functions/student-practice-auth.cjs');
const tools=require('../backend/functions/student-tool-policy.js');

const seed=()=>({
  'b3Games/students/synthetic_student/profile':{name:'Synthetic Student',active:true},
  'b3Games/students/synthetic_student/memberships':{'ws_class_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true}},
  'b3Games/workspaces/b3-2026/classes/alpha':{active:true,toolGrants:{chazara:true,'posuk-practice-scroll':true,shorashim:true},members:{synthetic_student:{active:true}}},
  'b3Games/workspaces/b3-2026/classes/beta':{active:true,toolGrants:{chazara:true},members:{synthetic_student:{active:true}}}
});
const claims={b3StudentRole:'student',b3StudentId:'synthetic_student',b3ClassId:'alpha'};
async function authorize({token='synthetic-token',claim=claims,data=seed(),source='chazara'}={}){
  const reads=[];
  const result=await authorizePracticeStudent({
    authorization:token?`Bearer ${token}`:'',
    verifyToken:async t=>{assert.equal(t,'synthetic-token');return claim;},
    get:async path=>{reads.push(path);return data[path]??null;},source,studentTools:tools
  });
  return {result,reads};
}

test('award authorization requires a bearer token with student identity claims',async()=>{
  assert.equal((await authorize({token:''})).result.status,401);
  assert.equal((await authorize({claim:{}})).result.status,401);
});
test('a student token is limited to the selected active class membership',async()=>{
  const allowed=await authorize();
  assert.equal(allowed.result.ok,true);
  const outside=await authorize({claim:{...claims,b3ClassId:'beta'}});
  assert.equal(outside.result.status,403);
});
test('inactive account, class, or membership is rejected',async()=>{
  for(const path of [
    'b3Games/students/synthetic_student/profile',
    'b3Games/students/synthetic_student/memberships',
    'b3Games/workspaces/b3-2026/classes/alpha'
  ]){
    const data=seed();
    if(path.endsWith('/profile'))data[path].active=false;
    else if(path.endsWith('/memberships'))data[path].ws_class_alpha.active=false;
    else data[path].active=false;
    assert.equal((await authorize({data})).result.status,403);
  }
});
test('a class tool grant cannot be bypassed with a valid student token',async()=>{
  const data=seed();data['b3Games/workspaces/b3-2026/classes/alpha'].toolGrants.chazara=false;
  assert.equal((await authorize({data})).result.status,403);
  assert.equal((await authorize({source:'reading100'})).result.ok,true);
  assert.equal((await authorize({source:'shorashim-recording'})).result.ok,true);
});
test('verified student identity is derived from claims and never from request body fields',async()=>{
  const {result}=await authorize();
  assert.equal(result.studentId,'synthetic_student');
  assert.equal(result.classId,'alpha');
});
