'use strict';
// Fictional-data VM regression for pending-only Chazara event loading.
// No Firebase connections, production records, or live rewards are touched.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('async function loadApprovals(){');
const end=html.indexOf('\nlet automaticSweepKey=',start);
assert.ok(start>=0&&end>start,'extract the actual pending approval loader');
const loader=html.slice(start,end);
const permitStart=html.indexOf('let pendingEventActive=0,pendingEventWaiters=[];');
const permitEnd=html.indexOf('function cls(',permitStart);
assert.ok(permitStart>=0&&permitEnd>permitStart,'extract the global permit pool');
const permits=html.slice(permitStart,permitEnd);
const keyStart=html.indexOf('function recordingKey(e){');
const keyEnd=html.indexOf('function updateRecordingRow(',keyStart);
assert.ok(keyStart>=0&&keyEnd>keyStart,'extract the real recording key encoder');
const keyEncoder=html.slice(keyStart,keyEnd);

function fixture({revoke=false,failAt=-1,queueSplit=false,delayMs=5,requestPairs=null,failOnceAt=-1,deniedStudents=[],emptyAfterFirst=false}={}){
 const requests=requestPairs||Array.from({length:queueSplit?16:12},(_,i)=>({
  id:'request_'+i,recorded:true,practiceStudentId:'student_'+i,eventId:'event_'+i
 }));
 const dom={classList:{add(){},remove(){}},innerHTML:''};
 let active=0,peak=0,reads=0,listCalls=0,failedOnce=false;
 const ctx={
  auth:{currentUser:{uid:'fictional_teacher'}},
  scopeGeneration:1,approvalGeneration:0,
  pendingPointRequests:{},pendingRecordingKeys:new Set(),pendingEventFetches:new Map(),
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
   FunTorahTeacherScope:{recordAllowed:(_scope,studentId)=>!deniedStudents.includes(studentId),validKey:()=>true}
  },
  teacherApi:async(action,details={})=>{
   if(action==='list-chazara-pending'){
    const call=listCalls++;
    return {requests:emptyAfterFirst&&call>0?[]:queueSplit?(call===0?requests.slice(0,8):requests.slice(8)):requests};
   }
   assert.equal(action,'get-chazara-event');
   reads++;active++;peak=Math.max(peak,active);
   await new Promise(resolve=>setTimeout(resolve,delayMs));
   active--;
   if(revoke&&reads===4)ctx.scopeGeneration++;
   if(details.eventId==='event_'+failAt)throw Error('fictional read failure');
   if(details.eventId==='event_'+failOnceAt&&!failedOnce){failedOnce=true;throw Error('fictional transient read failure')}
   return {event:{recorded:true,workspaceClassId:'alpha',createdAt:1234}};
  }
 };
 vm.runInNewContext(permits+'\n'+keyEncoder+'\n'+loader+'\nthis.runLoader=loadApprovals;this.keyOf=recordingKey;',ctx,{filename:'chazara-pending-loader.js'});
 return {run:()=>ctx.runLoader(),keyOf:e=>ctx.keyOf(e),hasPending:e=>ctx.pendingRecordingKeys.has(ctx.keyOf(e)),state:()=>({
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


test('repeated pending refresh reuses authorized recording audio instead of downloading it twice',async()=>{
 const x=fixture();await x.run();await x.run();
 const s=x.state();
 assert.equal(s.reads,12,'a second authorized queue refresh must not re-download twelve unchanged recordings');
 assert.equal(s.events.length,12);
});

test('overlapping refreshes for different pending events share a global four-read budget',async()=>{
 const x=fixture({queueSplit:true,delayMs:35});
 const first=x.run();
 for(let i=0;i<40&&x.state().reads<4;i++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(x.state().reads,4,'first refresh has four active reads before the second starts');
 const second=x.run();
 await Promise.all([first,second]);
 const s=x.state();
 assert.equal(s.peak,4,'two overlapping queue refreshes must not issue eight simultaneous reads');
 assert.equal(s.reads,12,'old first batch and all eight new pending events are fetched');
 assert.equal(s.pending,8,'newer queue wins');
});


test('overlapping refreshes of the same queue deduplicate in-flight event requests',async()=>{
 const x=fixture({delayMs:35});
 const first=x.run();
 for(let i=0;i<40&&x.state().reads<4;i++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(x.state().reads,4,'first refresh starts four pending reads');
 const second=x.run();
 await Promise.all([first,second]);
 const s=x.state();
 assert.equal(s.reads,12,'overlap must not download each recording twice');
 assert.equal(s.peak,4,'global limit still applies to duplicate reads');
 assert.equal(s.pending,12);
 assert.equal(s.events.length,12,'newest refresh retains all pending recordings');
});

test('tuple keys keep distinct student and event IDs separate even with underscores',async()=>{
 const left={studentId:'student_a__b',id:'c'};
 const right={studentId:'student_a',id:'b__c'};
 const x=fixture({requestPairs:[
  {id:'request_left',recorded:true,practiceStudentId:left.studentId,eventId:left.id},
  {id:'request_right',recorded:true,practiceStudentId:right.studentId,eventId:right.id}
 ]});
 assert.notEqual(x.keyOf(left),x.keyOf(right),'composite keys must not collide');
 await x.run();
 const s=x.state();
 assert.equal(s.keys,2,'both pending queue entries must survive');
 assert.equal(s.reads,2,'each distinct recording must be fetched');
 assert.equal(s.events.length,2,'both students retain their own recordings');
 assert.ok(x.hasPending(left),'first recording is present in pending filter');
 assert.ok(x.hasPending(right),'second recording is present in pending filter');
});


test('transient pending recording failure retries only the missing audio on the next refresh',async()=>{
 const x=fixture({failOnceAt:2});
 await x.run();
 const first=x.state();
 assert.equal(first.reads,12,'the initial pending queue fetches each recording once');
 assert.equal(first.events.length,11,'one transient API failure leaves its audio unavailable');
 assert.equal(first.pending,12,'a recording fetch failure must not remove its pending approval');
 await x.run();
 const recovered=x.state();
 assert.equal(recovered.reads,13,'only the failed recording is retried; successful audio stays cached');
 assert.equal(recovered.events.length,12,'the recovered recording is now available');
 assert.equal(recovered.pending,12,'the authorized pending queue remains intact');
 assert.ok(recovered.peak<=4,'recovery must respect the global four-read cap');
 await x.run();
 assert.equal(x.state().reads,13,'a third refresh reuses all recovered recordings');
});


test('out-of-class pending items never trigger authenticated recording reads',async()=>{
 const x=fixture({deniedStudents:['student_0','student_1']});
 await x.run();
 const s=x.state();
 assert.equal(s.pending,10,'unauthorized pending requests must not be shown');
 assert.equal(s.keys,10,'unauthorized recordings must not enter the pending filter');
 assert.equal(s.reads,10,'do not request audio for out-of-class students');
 assert.equal(s.events.length,10);
 assert.ok(s.peak<=4);
});

test('new empty authorized queue invalidates an older in-flight recording batch',async()=>{
 const x=fixture({emptyAfterFirst:true,delayMs:35});
 const first=x.run();
 for(let i=0;i<40&&x.state().reads<4;i++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(x.state().reads,4,'old queue has four in-flight reads');
 const second=x.run();
 await Promise.all([first,second]);
 const s=x.state();
 assert.equal(s.pending,0,'the latest authorized queue must win');
 assert.equal(s.keys,0,'removed pending recordings must not remain selectable');
 assert.equal(s.reads,4,'do not start additional reads from the superseded queue');
 assert.equal(s.events.length,0,'discard audio returned to an invalidated refresh');
 assert.ok(s.peak<=4);
});
