'use strict';
// Fictional-data regression of the actual Chazara "Approve All" handler.
// No Firebase connection, live student records, or deployed rules.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('async function approvePendingBatch(');
const end=html.indexOf('\n$("recordingsApproveAllBtn")',start);
assert.ok(start>=0&&end>start,'extract the real class/UID-bound bulk approval handler');
const source=html.slice(start,end);

function deferred(){
 let release;
 const promise=new Promise(resolve=>{release=resolve});
 return {promise,release};
}
function fixture(api=async()=>({status:'approved'})){
 const button={disabled:false},calls=[],statuses=[],loads=[],errors=[];
 const context={
  auth:{currentUser:{uid:'teacher_alpha'}},
  scopeGeneration:5,
  teacherScope:{boundAuthUid:'teacher_alpha'},
  pendingPointRequests:{request_a:{},request_b:{},request_c:{}},
  $:id=>id==='approveAllBtn'?button:null,
  confirm:()=>true,
  teacherApi:async(action,args)=>{
   assert.equal(action,'approve-point-request');
   calls.push({uid:context.auth.currentUser?.uid,id:args.requestId});
   return api(args.requestId);
  },
  setApprovalStatus:msg=>statuses.push(msg),
  loadApprovals:async()=>{loads.push(true)},
  console:{error:err=>errors.push(String(err))}
 };
 vm.runInNewContext(source,context,{filename:'chazara-manual-bulk-approval.js'});
 return {context,button,calls,statuses,loads,errors,click:()=>button.onclick()};
}

test('authorized unchanged teacher approves each pending request and refreshes once',async()=>{
 const x=fixture();
 await x.click();
 assert.deepEqual(x.calls.map(c=>c.id),['request_a','request_b','request_c']);
 assert.ok(x.calls.every(c=>c.uid==='teacher_alpha'));
 assert.deepEqual(x.statuses,['3 Chazara point requests approved.']);
 assert.equal(x.loads.length,1);
 assert.equal(x.button.disabled,false);
});

test('account switch during first approval stops remaining old IDs and stale UI',async()=>{
 const gate=deferred();
 const x=fixture(id=>id==='request_a'?gate.promise:Promise.resolve({status:'approved'}));
 const running=x.click();
 assert.deepEqual(x.calls.map(c=>c.id),['request_a']);
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.release({status:'approved'});
 await running;
 assert.deepEqual(x.calls.map(c=>c.id),['request_a']);
 assert.deepEqual(x.statuses,[]);
 assert.equal(x.loads.length,0);
 assert.equal(x.button.disabled,false);
});

test('class scope revocation during an in-flight approval stops remaining IDs',async()=>{
 const gate=deferred(),x=fixture(id=>id==='request_a'?gate.promise:Promise.resolve({status:'approved'}));
 const running=x.click();
 x.context.scopeGeneration=6;
 gate.release({status:'approved'});
 await running;
 assert.deepEqual(x.calls.map(c=>c.id),['request_a']);
 assert.deepEqual(x.statuses,[]);
 assert.equal(x.loads.length,0);
});

test('pre-callback account change with old teacher scope never starts a bulk request',async()=>{
 const x=fixture();
 x.context.auth.currentUser={uid:'teacher_beta'};
 await x.click();
 assert.deepEqual(x.calls,[]);
 assert.deepEqual(x.statuses,[]);
 assert.equal(x.loads.length,0);
});

test('unchanged teacher continues after a failed individual approval',async()=>{
 const x=fixture(id=>id==='request_b'?Promise.reject(new Error('synthetic failure')):Promise.resolve({status:'approved'}));
 await x.click();
 assert.deepEqual(x.calls.map(c=>c.id),['request_a','request_b','request_c']);
 assert.deepEqual(x.statuses,['2 Chazara point requests approved.']);
 assert.equal(x.errors.length,1);
 assert.equal(x.loads.length,1);
});
