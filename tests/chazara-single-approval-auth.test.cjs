'use strict';
// Synthetic-only regression of the actual single-request Chazara approval/rejection
// handlers. No Firebase connection, deployed rules, or live student records.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('function currentChazaraAction(');
const end=html.indexOf('$("approvalList").onclick=',start);
assert.ok(start>=0&&end>start,'extract real UID/scope-bound individual handlers');
const source=html.slice(start,end);

function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b});
 return {promise,resolve,reject};
}
function fixture(api=async()=>({status:'approved',studentName:'Synthetic Student',actualAmount:2})){
 const calls=[],statuses=[],refreshes=[],errors=[];
 const context={
  auth:{currentUser:{uid:'teacher_alpha'}},
  scopeGeneration:7,
  teacherScope:{boundAuthUid:'teacher_alpha'},
  pendingPointRequests:{
   recorded:{recorded:true,practiceStudentId:'student_a',eventId:'event_a'},
   normal:{recorded:false}
  },
  teacherApi:async(action,args)=>{
   calls.push({action,args,uid:context.auth.currentUser?.uid});
   return api(action,args);
  },
  setApprovalStatus:(msg,bad)=>statuses.push({msg,bad:!!bad}),
  loadApprovals:async()=>{refreshes.push(true)},
  console:{error:err=>errors.push(String(err))}
 };
 vm.runInNewContext(source,context,{filename:'chazara-single-approval.js'});
 return {context,calls,statuses,refreshes,errors,
  approve:(id='normal')=>context.approvePointRequest(id),
  reject:(id='normal')=>context.rejectPointRequest(id)};
}
test('unchanged authorized teacher approves one request and refreshes once',async()=>{
 const x=fixture();
 assert.equal(await x.approve(),true);
 assert.deepEqual(x.calls.map(x=>x.action),['approve-point-request']);
 assert.equal(x.refreshes.length,1);
 assert.match(x.statuses.at(-1).msg,/Synthetic Student: \+2 points approved/);
});
test('unchanged authorized teacher rejects ordinary and recorded requests through correct APIs',async()=>{
 const x=fixture();
 assert.equal(await x.reject('normal'),true);
 assert.equal(await x.reject('recorded'),true);
 assert.deepEqual(x.calls.map(x=>x.action),['reject-point-request','teacher-reject-chazara-recording']);
 assert.equal(x.calls[1].args.studentId,'student_a');
 assert.equal(x.refreshes.length,2);
});
test('pre-callback Google account switch blocks individual approve and reject before API call',async()=>{
 const x=fixture();
 x.context.auth.currentUser={uid:'teacher_beta'};
 assert.equal(await x.approve(),false);
 assert.equal(await x.reject('recorded'),false);
 assert.equal(x.calls.length,0);
 assert.equal(x.statuses.length,0);
 assert.equal(x.refreshes.length,0);
});
test('account switch while approval is in flight suppresses stale status and refresh',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const running=x.approve();
 assert.equal(x.calls.length,1);
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.resolve({status:'approved',studentName:'Old Student',actualAmount:3});
 assert.equal(await running,false);
 assert.equal(x.statuses.length,1,'only the pre-request progress status is allowed');
 assert.equal(x.statuses[0].msg,'Approving…');
 assert.equal(x.refreshes.length,0);
});
test('class-scope change while rejection is in flight suppresses stale status and refresh',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const running=x.reject('recorded');
 x.context.scopeGeneration=8;
 gate.resolve({status:'rejected'});
 assert.equal(await running,false);
 assert.equal(x.statuses.length,0);
 assert.equal(x.refreshes.length,0);
});
test('stale API rejection after account switch does not show error in new teacher session',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const running=x.reject('normal');
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.reject(new Error('old account failure'));
 assert.equal(await running,false);
 assert.equal(x.statuses.length,0);
 assert.equal(x.errors.length,0);
 assert.equal(x.refreshes.length,0);
});
test('unchanged teacher still sees an individual API failure',async()=>{
 const x=fixture(async()=>{throw Error('synthetic denial')});
 assert.equal(await x.approve(),false);
 assert.equal(x.statuses.at(-1).bad,true);
 assert.match(x.statuses.at(-1).msg,/synthetic denial/);
 assert.equal(x.errors.length,1);
 assert.equal(x.refreshes.length,0);
});
