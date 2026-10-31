'use strict';
// Synthetic-only regressions execute the actual manual Chazara add/delete handlers
// and teacherApi token boundary. No Firebase, live student records or network calls.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('async function addManualChazara(){');
const apiStart=html.indexOf('async function teacherApi(action,extra={}){',start);
const end=html.indexOf('async function loadApprovals(){',apiStart);
assert.ok(start>=0&&apiStart>start&&end>apiStart,'extract actual manual handlers and teacher API');
const manualSource=html.slice(start,apiStart);
const apiSource=html.slice(apiStart,end);

function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b});
 return {promise,resolve,reject};
}
function fixture(api=async()=>({quantity:2,pointsAdded:4,studentName:'Fictional Student',pointsAction:'reversed',pointsAmount:-2}),onConfirm=()=>true){
 const calls=[],statuses=[],renders=[],errors=[];
 const fields={
  manualAddBtn:{disabled:false,textContent:'Add Chazara + Point'},
  manualStudent:{value:'student_a'},
  manualDate:{value:'2026-10-31'},
  manualPerek:{value:'18'},
  manualPasuk:{value:'3'},
  manualQuantity:{value:'2'}
 };
 const button={disabled:false,textContent:'Delete Chazara + Points'};
 const context={
  auth:{currentUser:{uid:'teacher_alpha'}},
  scopeGeneration:7,
  teacherScope:{boundAuthUid:'teacher_alpha'},
  E:{student_a:{event_a:{studentName:'Fictional Student',perek:18,posuk:3}}},
  $:id=>fields[id]||null,
  currentChazaraAction:(uid,generation)=>!!uid&&context.auth.currentUser?.uid===uid&&context.scopeGeneration===generation&&context.teacherScope?.boundAuthUid===uid,
  teacherApi:async(action,args)=>{calls.push({action,args});return api(action,args)},
  setManualStatus:(msg,bad)=>statuses.push({msg,bad:!!bad}),
  renderManualMatches:()=>renders.push('render'),
  manualStudentName:()=> 'Fictional Student',
  confirm:msg=>onConfirm(context,msg),
  console:{error:err=>errors.push(String(err))}
 };
 vm.runInNewContext(manualSource,context,{filename:'chazara-manual-actions.js'});
 return {context,fields,button,calls,statuses,renders,errors,add:()=>context.addManualChazara(),del:()=>context.deleteManualChazara('student_a','event_a',button)};
}
test('authorized teacher adds Chazara with the chosen student, date and quantity',async()=>{
 const x=fixture();
 await x.add();
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].action,'teacher-add-chazara');
 assert.equal(x.calls[0].args.studentId,'student_a');
 assert.equal(x.calls[0].args.quantity,2);
 assert.equal(x.fields.manualQuantity.value,'1');
 assert.equal(x.renders.length,1);
 assert.match(x.statuses.at(-1).msg,/Added 2 Chazaras and 4 points/);
 assert.equal(x.fields.manualAddBtn.disabled,false);
});
test('pre-callback Google account switch cannot submit an old manual addition',async()=>{
 const x=fixture();
 x.context.auth.currentUser={uid:'teacher_beta'};
 await x.add();
 assert.equal(x.calls.length,0);
 assert.equal(x.statuses.length,0);
});
test('manual addition finishing after Google switch cannot update the new teacher UI',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const pending=x.add();
 assert.equal(x.calls.length,1);
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.resolve({quantity:2,pointsAdded:4,studentName:'Fictional Student'});
 await pending;
 assert.equal(x.statuses.length,1,'old progress only');
 assert.equal(x.renders.length,0);
 assert.equal(x.fields.manualQuantity.value,'2');
});
test('manual addition finishing after class-scope revocation suppresses old result',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const pending=x.add();
 x.context.scopeGeneration=8;
 gate.resolve({quantity:2,pointsAdded:4,studentName:'Fictional Student'});
 await pending;
 assert.equal(x.statuses.length,1);
 assert.equal(x.renders.length,0);
});
test('stale manual-add API failure does not show an error to a new account',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const pending=x.add();
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.reject(Error('old teacher rejected'));
 await pending;
 assert.equal(x.errors.length,0);
 assert.equal(x.statuses.length,1);
});
test('unchanged teacher still receives manual-add errors and usable button',async()=>{
 const x=fixture(async()=>{throw Error('synthetic permission denial')});
 await x.add();
 assert.equal(x.errors.length,1);
 assert.equal(x.statuses.at(-1).bad,true);
 assert.match(x.statuses.at(-1).msg,/synthetic permission denial/);
 assert.equal(x.fields.manualAddBtn.disabled,false);
});
test('authorized teacher deletes manual Chazara and sees point reversal',async()=>{
 const x=fixture();
 await x.del();
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].action,'teacher-delete-chazara');
 assert.equal(x.calls[0].args.eventId,'event_a');
 assert.match(x.statuses.at(-1).msg,/2 points removed/);
 assert.equal(x.renders.length,1);
 assert.equal(x.button.disabled,false);
});
test('account switch during deletion confirmation blocks old-session API dispatch',async()=>{
 const x=fixture(undefined,ctx=>{ctx.auth.currentUser={uid:'teacher_beta'};return true});
 await x.del();
 assert.equal(x.calls.length,0);
 assert.equal(x.statuses.length,0);
});
test('pre-callback account switch blocks stale manual deletion click',async()=>{
 const x=fixture();
 x.context.auth.currentUser={uid:'teacher_beta'};
 await x.del();
 assert.equal(x.calls.length,0);
});
test('in-flight manual deletion after class revocation cannot refresh new scope',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const pending=x.del();
 x.context.scopeGeneration=8;
 gate.resolve({pointsAction:'reversed',pointsAmount:-2});
 await pending;
 assert.equal(x.statuses.length,1);
 assert.equal(x.renders.length,0);
});
test('stale manual-delete API rejection is suppressed',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const pending=x.del();
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.reject(Error('old deletion failed'));
 await pending;
 assert.equal(x.errors.length,0);
 assert.equal(x.statuses.length,1);
});
function apiFixture(token=async()=> 'fictional-token'){
 const requests=[];
 const user={uid:'teacher_alpha',getIdToken:token};
 const context={
  auth:{currentUser:user},
  teacherAccess:{authorized:true},
  teacherScope:{selected:'alpha',boundAuthUid:'teacher_alpha'},
  scopeGeneration:7,
  currentChazaraAction:(uid,generation)=>!!uid&&context.auth.currentUser?.uid===uid&&context.scopeGeneration===generation&&context.teacherScope?.boundAuthUid===uid,
  POINTS_API:'https://fictional.invalid/api',
  fetch:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>({ok:true})}}
 };
 vm.runInNewContext(apiSource,context,{filename:'chazara-teacher-api.js'});
 return {context,requests,call:()=>context.teacherApi('teacher-add-chazara',{studentId:'student_a'})};
}
test('teacherApi sends authorized class after a valid token is obtained',async()=>{
 const x=apiFixture();
 await x.call();
 assert.equal(x.requests.length,1);
 assert.equal(JSON.parse(x.requests[0].opts.body).classId,'alpha');
 assert.equal(x.requests[0].opts.headers.Authorization,'Bearer fictional-token');
});
test('teacherApi never sends old-class action if Google account switches while fetching token',async()=>{
 const gate=deferred(),x=apiFixture(()=>gate.promise);
 const pending=x.call();
 x.context.auth.currentUser={uid:'teacher_beta',getIdToken:async()=> 'beta-token'};
 gate.resolve('old-token');
 await assert.rejects(pending,/Teacher session changed/);
 assert.equal(x.requests.length,0);
});
test('teacherApi never sends action after class scope rebuild during token fetch',async()=>{
 const gate=deferred(),x=apiFixture(()=>gate.promise);
 const pending=x.call();
 x.context.scopeGeneration=8;
 gate.resolve('old-token');
 await assert.rejects(pending,/Teacher session changed/);
 assert.equal(x.requests.length,0);
});
test('teacherApi rejects stale verified scope before token retrieval',async()=>{
 const x=apiFixture();
 x.context.teacherScope.boundAuthUid='teacher_beta';
 await assert.rejects(x.call(),/Teacher session changed/);
 assert.equal(x.requests.length,0);
});
test('scope rebuild resets manual Add button so a cancelled old request cannot leave it disabled',()=>{
 assert.match(html,/const manualAddButton=\$\('manualAddBtn'\);if\(manualAddButton\)\{manualAddButton\.disabled=false;manualAddButton\.textContent='Add Chazara \+ Point'\}/);
});
