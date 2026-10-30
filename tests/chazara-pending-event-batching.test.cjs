'use strict';
// Fictional-data VM regression for pending-only Chazara event loading.
// No Firebase connections, production records, or live rewards are touched.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('async function loadApprovals(){');
const end=html.indexOf('\nlet automaticSweepRunning=',start);
assert.ok(start>=0&&end>start,'extract the actual pending approval loader');
const loader=html.slice(start,end);

function fixture({revoke=false,failAt=-1}={}){
 const requests=Array.from({length:12},(_,i)=>({
  id:'request_'+i,recorded:true,practiceStudentId:'student_'+i,eventId:'event_'+i
 }));
 const dom={classList:{add(){},remove(){}},innerHTML:''};
 let active=0,peak=0,reads=0;
 const ctx={
  auth:{currentUser:{uid:'fictional_teacher'}},
  scopeGeneration:1,approvalGeneration:0,
  pendingPointRequests:{},pendingRecordingKeys:new Set(),
  teacherScope:{selected:'alpha'},
  R:Object.fromEntries(requests.map(x=>[x.practiceStudentId,{name:x.practiceStudentId}])),
  E:{},console,
  $:()=>dom,setApprovalStatus(){},renderApprovals(){},renderRecordings(){},
  window:{
   FunTorahApprovalQueue:{
    isPendingAutomatic:()=>false,
    needsManualApproval:()=>true,
    isChazaraApproval:()=>true
   },
   FunTorahTeacherScope:{recordAllowed:()=>true,validKey:()=>true}
  },
  teacherApi:async(action,details={})=>{
   if(action==='list-chazara-pending')return {requests};
   assert.equal(action,'get-chazara-event');
   reads++;active++;peak=Math.max(peak,active);
   await new Promise(resolve=>setTimeout(resolve,5));
   active--;
   if(revoke&&reads===4)ctx.scopeGeneration++;
   if(details.eventId==='event_'+failAt)throw Error('fictional read failure');
   return {event:{recorded:true,workspaceClassId:'alpha',createdAt:1234}};
  }
 };
 vm.runInNewContext(loader+'\nthis.runLoader=loadApprovals;',ctx,{filename:'chazara-pending-loader.js'});
 return {run:()=>ctx.runLoader(),state:()=>({
  peak,reads,events:Object.keys(ctx.E),keys:ctx.pendingRecordingKeys.size,
  pending:Object.keys(ctx.pendingPointRequests).length
 })};
}

test('twelve pending recordings load in bounded batches without losing requests',async()=>{
 const x=fixture();await x.run();
 const s=x.state();
 assert.equal(s.reads,12);
 assert.equal(s.peak,4,'never issue all twelve scoped event reads at once');
 assert.equal(s.events.length,12);
 assert.equal(s.keys,12);
 assert.equal(s.pending,12);
});

test('one unavailable pending recording does not block other batches',async()=>{
 const x=fixture({failAt:2});await x.run();
 const s=x.state();
 assert.equal(s.reads,12);
 assert.equal(s.events.length,11);
 assert.equal(s.pending,12,'failed audio fetch must not silently remove pending approval');
 assert.ok(s.peak<=4);
});

test('class change during first batch prevents requests for later batches',async()=>{
 const x=fixture({revoke:true});await x.run();
 const s=x.state();
 assert.equal(s.reads,4,'do not continue scoped event reads after a class change');
 assert.equal(s.events.length,0,'discard stale events after the scope changes');
});
