'use strict';
// Synthetic API-level integration of draft #346 with the generic-class scope
// already merged in #345. No Firebase network or real student data is used.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope=require('../backend/functions/teacher-class-scope');

function fixture(){
 const root='b3Games/workspaces/b3-2026';
 const eventPath='posukPractice/chazara/events/shared';
 const events={
  alpha_event:{workspaceClassId:'alpha',recorded:true,reviewApplied:true,perek:18,posuk:1},
  beta_event:{workspaceClassId:'beta',recorded:true,reviewApplied:true,perek:18,posuk:2},
  classless_event:{recorded:true,reviewApplied:true,perek:18,posuk:3}
 };
 return {
  [root+'/teachers/teacher']:{active:true,classIds:{alpha:true}},
  [root+'/classes/alpha']:{active:true,name:'Alpha',toolGrants:{chazara:true},members:{shared:{active:true}}},
  [root+'/classes/beta']:{active:true,name:'Beta',toolGrants:{chazara:true},members:{shared:{active:true}}},
  [root+'/classes/gamma']:{active:true,name:'Gamma',toolGrants:{chazara:true},members:{}},
  'b3Games/students/shared/profile':{name:'Synthetic shared student',active:true},
  'b3Games/students/shared/memberships':{
   a:{workspaceId:'b3-2026',classId:'alpha',active:true},
   b:{workspaceId:'b3-2026',classId:'beta',active:true}
  },
  [eventPath]:events,
  ...Object.fromEntries(Object.entries(events).map(([id,event])=>[eventPath+'/'+id,event])),
  'studentRewards/pointRequests/beta_request':{
   source:'chazara',practiceStudentId:'shared',workspaceClassId:'beta',status:'pending'
  }
 };
}
function server(data){
 const reads=[],writes=[];
 const snap=value=>({val:()=>value===undefined?null:value,exists:()=>value!=null});
 const db={ref:path=>({
  get:async()=>{reads.push(path);return snap(data[path]);},
  set:async value=>{writes.push([path,value]);},
  update:async value=>{writes.push([path,value]);}
 })};
 const admin={
  apps:[{}],database:()=>db,
  auth:()=>({verifyIdToken:async()=>({uid:'teacher',email:'teacher@example.test',email_verified:true})})
 };
 const ctx={exports:{},require:name=>
  name==='firebase-admin'?admin:
  name==='firebase-functions/v2/https'?{onRequest:(_options,fn)=>fn}:
  name==='./teacher-class-scope'?scope:
  name.startsWith('./')?require('../backend/functions/'+name.slice(2)):require(name),
  console,Buffer,Intl,Date,process
 };
 vm.runInNewContext(fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8'),ctx);
 async function call(action,extra={}){
  const req={method:'POST',body:{action,classId:'alpha',...extra},headers:{authorization:'Bearer synthetic'}};
  const res={code:200,set(){return this},setHeader(){return this},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}};
  await ctx.exports.studentRewardsAutoAward(req,res);
  return res;
 }
 return {call,reads,writes};
}
test('generic alpha class: explicit history excludes beta and ambiguous shared-student events',async()=>{
 const x=server(fixture());
 const res=await x.call('list-chazara-history',{studentId:'shared'});
 assert.equal(res.code,200,JSON.stringify(res.body));
 assert.deepEqual(Object.keys(res.body.events),['alpha_event']);
 assert.ok(x.reads.includes('posukPractice/chazara/events/shared'));
 assert.equal(x.writes.length,0,'history is read-only');
});
test('generic alpha class: exact recording read denies beta and ambiguous legacy',async()=>{
 const x=server(fixture());
 const own=await x.call('get-chazara-event',{studentId:'shared',eventId:'alpha_event'});
 assert.equal(own.code,200,JSON.stringify(own.body));
 assert.equal(own.body.event.workspaceClassId,'alpha');
 for(const eventId of ['beta_event','classless_event']){
  const denied=await x.call('get-chazara-event',{studentId:'shared',eventId});
  assert.equal(denied.code,403,'must deny '+eventId);
 }
 assert.equal(x.writes.length,0);
});
test('unassigned third class and revoked teacher cannot read recording history',async()=>{
 const data=fixture(),x=server(data);
 const denied=await x.call('list-chazara-history',{classId:'gamma',studentId:'shared'});
 assert.notEqual(denied.code,200,'unassigned gamma class must not be accessible');
 assert.ok(!x.reads.includes('posukPractice/chazara/events/shared'),'no event read before authorization');
 data['b3Games/workspaces/b3-2026/teachers/teacher'].active=false;
 const revoked=await x.call('get-chazara-event',{studentId:'shared',eventId:'alpha_event'});
 assert.notEqual(revoked.code,200,'revoked teacher must be denied');
 assert.equal(x.writes.length,0);
});
test('cross-class Chazara approval is rejected before any database write',async()=>{
 const x=server(fixture());
 const denied=await x.call('approve-point-request',{requestId:'beta_request'});
 assert.equal(denied.code,403,JSON.stringify(denied.body));
 assert.equal(x.writes.length,0,'no approval or points write');
});


test('revoked class grant, teacher assignment, and student membership block both approval and rejection before writes',async()=>{
 const scenarios=[
  ['class Chazara grant',d=>{d['b3Games/workspaces/b3-2026/classes/alpha'].toolGrants.chazara=false;}],
  ['teacher class assignment',d=>{d['b3Games/workspaces/b3-2026/teachers/teacher'].classIds.alpha=false;}],
  ['student class membership',d=>{d['b3Games/students/shared/memberships'].a.active=false;}],
  ['student class roster entry',d=>{d['b3Games/workspaces/b3-2026/classes/alpha'].members.shared.active=false;}]
 ];
 for(const [reason,revoke] of scenarios){
  const d=fixture();
  d['studentRewards/pointRequests/alpha_request']={
   source:'chazara-recording',practiceStudentId:'shared',
   workspaceClassId:'alpha',status:'pending'
  };
  revoke(d);
  const x=server(d);
  for(const action of ['approve-point-request','reject-point-request']){
   const response=await x.call(action,{requestId:'alpha_request'});
   assert.notEqual(response.code,200,reason+' must deny '+action);
   assert.equal(x.writes.length,0,reason+' must not write points or approvals');
   assert.equal(x.reads.some(path=>path.startsWith('posukPractice/chazara/events/')),false,
    reason+' must not read private recording events for a denied approval');
  }
 }
});
