'use strict';
// Synthetic-only authorization tests for the new Chazara read API.
// These do not access production Firebase or any real student record.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope=require('../backend/functions/teacher-class-scope');

function fixture(){
 const base='posukPractice/chazara/events/shared';
 const events={
  et_event:{workspaceClassId:'et',recorded:true,reviewApplied:true,perek:18,posuk:1},
  wt_event:{workspaceClassId:'wt',recorded:true,reviewApplied:true,perek:18,posuk:2},
  legacy_event:{recorded:true,reviewApplied:true,perek:18,posuk:3}
 };
 return {
  'b3Games/workspaces/b3-2026/teachers/teacher':{active:true,classIds:{et:true}},
  'b3Games/workspaces/b3-2026/classes/et':{active:true,name:'ET',toolGrants:{chazara:true},members:{shared:{active:true}}},
  'b3Games/students/shared/profile':{name:'Synthetic Shared Student',active:true},
  'b3Games/students/shared/memberships':{
   a:{workspaceId:'b3-2026',classId:'et',active:true},
   b:{workspaceId:'b3-2026',classId:'wt',active:true}
  },
  [base]:events,
  ...Object.fromEntries(Object.entries(events).map(([id,event])=>[base+'/'+id,event]))
 };
}
function server(data){
 const reads=[],writes=[];
 const snap=value=>({val:()=>value===undefined?null:value,exists:()=>value!=null});
 const db={ref:p=>({
  get:async()=>{reads.push(p);return snap(data[p])},
  set:async value=>{writes.push([p,value])},
  update:async value=>{writes.push([p,value])}
 })};
 const admin={apps:[{}],database:()=>db,auth:()=>({verifyIdToken:async()=>({uid:'teacher',email:'teacher@example.test',email_verified:true})})};
 const ctx={exports:{},require:name=>name==='firebase-admin'?admin:
  name==='firebase-functions/v2/https'?{onRequest:(_options,fn)=>fn}:
  name==='./teacher-class-scope'?scope:
  name.startsWith('./')?require('../backend/functions/'+name.slice(2)):require(name),
  console,Buffer,Intl,Date,process};
 vm.runInNewContext(fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8'),ctx);
 async function call(action,extra={}){
  const req={method:'POST',body:{action,classId:'et',...extra},headers:{authorization:'Bearer synthetic'}};
  const res={code:200,set(){return this},setHeader(){return this},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}};
  await ctx.exports.studentRewardsAutoAward(req,res);
  return res;
 }
 return {call,reads,writes};
}
test('lazy history API returns only ET events for a student in ET and WT',async()=>{
 const x=server(fixture());
 const response=await x.call('list-chazara-history',{studentId:'shared'});
 assert.equal(response.code,200,JSON.stringify(response.body));
 assert.deepEqual(Object.keys(response.body.events),['et_event']);
 assert.ok(x.reads.includes('posukPractice/chazara/events/shared'));
 assert.equal(x.writes.length,0);
});
test('exact pending event API denies the other class and ambiguous legacy records',async()=>{
 const x=server(fixture());
 const own=await x.call('get-chazara-event',{studentId:'shared',eventId:'et_event'});
 assert.equal(own.code,200,JSON.stringify(own.body));
 assert.equal(own.body.event.workspaceClassId,'et');
 for(const eventId of ['wt_event','legacy_event']){
  const foreign=await x.call('get-chazara-event',{studentId:'shared',eventId});
  assert.equal(foreign.code,403,'must deny '+eventId);
 }
 assert.equal(x.writes.length,0);
});
test('unassigned class selection and revoked teacher deny Chazara read API',async()=>{
 const d=fixture(),x=server(d);
 const unassigned=await x.call('list-chazara-history',{classId:'wt',studentId:'shared'});
 assert.notEqual(unassigned.code,200,'unassigned WT is forbidden');
 assert.ok(!x.reads.includes('posukPractice/chazara/events/shared'));
 d['b3Games/workspaces/b3-2026/teachers/teacher'].active=false;
 const revoked=await x.call('get-chazara-event',{studentId:'shared',eventId:'et_event'});
 assert.notEqual(revoked.code,200,'revoked teacher is forbidden');
 assert.equal(x.writes.length,0);
});
