'use strict';
// Fictional-data regression for the actual automatic Posuk/Chazara point sweep.
// Does not connect to Firebase, deploy rules, or touch student records.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('let automaticSweepKey=null;');
const end=html.indexOf('\nasync function approvePointRequest(',start);
assert.ok(start>=0&&end>start,'extract the actual account-bound automatic approval sweep');
const source=html.slice(start,end);

function deferred(){
 let release;
 const promise=new Promise(resolve=>{release=resolve});
 return {promise,release};
}
function fixture(api=async()=>({status:'approved'})){
 const calls=[];
 const context={
  auth:{currentUser:{uid:'teacher_alpha'}},
  scopeGeneration:1,
  teacherScope:{boundAuthUid:'teacher_alpha'},
  teacherApi:async(action,args)=>{
   assert.equal(action,'approve-point-request');
   calls.push({uid:context.auth.currentUser?.uid,id:args.requestId});
   return api(args.requestId);
  },
  console
 };
 vm.runInNewContext(source+'\nthis.runSweep=sweepAutomaticPoints;',context,{
  filename:'chazara-automatic-approval-sweep.js'
 });
 return {context,calls,run:ids=>context.runSweep(ids)};
}

test('unchanged authorized teacher completes automatic approvals sequentially',async()=>{
 const x=fixture();
 await x.run(['automatic_a','automatic_b','automatic_c']);
 assert.deepEqual(x.calls.map(c=>c.id),['automatic_a','automatic_b','automatic_c']);
 assert.ok(x.calls.every(c=>c.uid==='teacher_alpha'));
});

test('Google account switch before auth callback stops remaining old-account automatic approvals',async()=>{
 const gate=deferred();
 const x=fixture(id=>id==='old_a'?gate.promise:Promise.resolve({status:'approved'}));
 const old=x.run(['old_a','old_b','old_c']);
 assert.deepEqual(x.calls.map(c=>c.id),['old_a']);
 // Firebase may update currentUser before the app receives onAuthStateChanged.
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.release({status:'approved'});
 await old;
 assert.deepEqual(x.calls.map(c=>c.id),['old_a'],
  'the new account must not dispatch old pending request IDs');
});

test('new authorized account may start its own sweep while old account request finishes',async()=>{
 const gate=deferred();
 const x=fixture(id=>id==='old_a'?gate.promise:Promise.resolve({status:'approved'}));
 const old=x.run(['old_a','old_b']);
 x.context.auth.currentUser={uid:'teacher_beta'};
 x.context.scopeGeneration=2;
 x.context.teacherScope={boundAuthUid:'teacher_beta'};
 const newer=x.run(['new_a','new_b']);
 await newer;
 gate.release({status:'approved'});
 await old;
 assert.deepEqual(x.calls.map(c=>c.id),['old_a','new_a','new_b']);
 assert.equal(x.calls.find(c=>c.id==='new_a').uid,'teacher_beta');
});

test('same-scope concurrent sweep does not duplicate automatic approval calls',async()=>{
 const gate=deferred();
 const x=fixture(id=>id==='automatic_a'?gate.promise:Promise.resolve({status:'approved'}));
 const first=x.run(['automatic_a','automatic_b']);
 await x.run(['automatic_a','automatic_b']);
 assert.deepEqual(x.calls.map(c=>c.id),['automatic_a']);
 gate.release({status:'approved'});
 await first;
 assert.deepEqual(x.calls.map(c=>c.id),['automatic_a','automatic_b']);
});

test('stale scope cannot start automatic approval after UID changes',async()=>{
 const x=fixture();
 x.context.auth.currentUser={uid:'teacher_beta'};
 await x.run(['old_a']);
 assert.deepEqual(x.calls,[]);
});
