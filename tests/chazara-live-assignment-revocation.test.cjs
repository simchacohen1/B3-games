'use strict';
// Synthetic-only regression for the Chazara teacher page's live assignment watcher.
// These tests execute the actual helper and listener callback from the page source.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('chazara/teacher.html','utf8');
const helperStart=html.indexOf('function teacherAssignmentChange(access,row){');
const helperEnd=html.indexOf('\n}',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'live assignment helper exists');
const teacherAssignmentChange=vm.runInNewContext('('+html.slice(helperStart,helperEnd+2)+')');
const handlerMatch=html.match(/const onAssignment=(snap=>\{[\s\S]*?\n   \});/);
assert.ok(handlerMatch,'the live assignment listener callback exists');

function fixture(){
 const calls=[],access={authorized:true,role:'teacher',classIds:['et','wt']},user={uid:'teacher-fixture'};
 const ctx={generation:4,scopeGeneration:4,teacherAssignmentChange,access,user,
  loadClassScope:(...args)=>calls.push(args)};
 const handler=vm.runInNewContext('('+handlerMatch[1]+')',ctx);
 return {calls,access,user,ctx,handler,row:row=>handler({val:()=>row})};
}

test('unchanged assignment, including key ordering, does not reload the Chazara page',()=>{
 const x=fixture();
 x.row({role:'teacher',active:true,classIds:{wt:true,et:true,'*':true}});
 assert.equal(x.calls.length,0);
});
test('teacher deactivation or deletion immediately denies the open Chazara page',()=>{
 for(const row of [{role:'teacher',active:false,classIds:{et:true,wt:true}},null]){
  const x=fixture();x.row(row);
  assert.equal(x.calls.length,1);
  assert.equal(x.calls[0][1].authorized,false);
 }
});
test('removing or adding an assigned class triggers a fresh server-scoped load',()=>{
 for(const classIds of [{wt:true},{et:true,wt:true,new_class:true}]){
  const x=fixture();x.row({role:'teacher',active:true,classIds});
  assert.equal(x.calls.length,1);
  assert.equal(x.calls[0][0],x.user);
  assert.equal(x.calls[0][1],x.access);
 }
});
test('non-teacher role fails closed, but unchanged principal teacher grant remains valid',()=>{
 const x=fixture();x.row({role:'student',active:true,classIds:{et:true,wt:true}});
 assert.equal(x.calls[0][1].authorized,false);
 const p=fixture();p.row({role:'principal',active:true,classIds:{et:true,wt:true}});
 assert.equal(p.calls.length,0);
});
test('obsolete listener from a previous sign-in cannot reauthorize or reload',()=>{
 const x=fixture();x.ctx.scopeGeneration=5;
 x.row({role:'teacher',active:false,classIds:{}});
 x.row({role:'teacher',active:true,classIds:{wt:true}});
 assert.equal(x.calls.length,0);
});
test('listener cancellation denies access and scope resets stop cached audio',()=>{
 assert.match(html,/assignmentRef\.on\('value',onAssignment,\(\)=>\{if\(generation===scopeGeneration\)loadClassScope\(user,\{authorized:false\}\)\}\)/);
 assert.match(html,/studentListeners\.push\(\[assignmentRef,onAssignment\]\)/);
 assert.match(html,/function clearStudentListeners\(\)\{for\(const \[ref,handler\] of studentListeners\)ref\.off\('value',handler\)/);
 assert.match(html,/panel\.querySelectorAll\('audio'\)\.forEach\(audio=>\{audio\.pause\(\);audio\.removeAttribute\('src'\);audio\.load\(\)\}\)/);
 assert.match(html,/panel\.replaceChildren\(\)/);
});
