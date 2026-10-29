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
  orderByChild(field){assert.equal(field,'status');return {equalTo(status){return {get:async()=>{reads.push(p);return snap(Object.fromEntries(Object.entries(data[p]||{}).filter(([,row])=>row?.status===status)))}}}}},
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

test('pending-only queue does not scan Chazara event histories or write recovery records',async()=>{
 const x=server(fixture());
 const response=await x.call('list-chazara-pending');
 assert.equal(response.code,200,JSON.stringify(response.body));
 assert.equal(x.reads.some(p=>p==='posukPractice/chazara/events'||p.startsWith('posukPractice/chazara/events/')),false,
   'pending queue must not read entire event history on server');
 assert.equal(x.writes.length,0,'pending queue must not repair saved Chazara records');
});
test('explicit class-scoped recovery can read histories but never runs on unassigned class',async()=>{
 const data=fixture(),path='posukPractice/chazara/events/shared';
 // Already reviewed events: recovery should scan, then leave data unchanged.
 data[path]=Object.fromEntries(Object.entries(data[path]).map(([id,e])=>[id,{...e,pointRequestStatus:'approved'}]));
 const x=server(data);
 const result=await x.call('repair-chazara-pending');
 assert.equal(result.code,200,JSON.stringify(result.body));
 assert.ok(x.reads.includes(path),'explicit recovery scans the selected class history');
 assert.equal(x.writes.length,0,'already-approved events must remain unchanged');
 const y=server(fixture());
 const forbidden=await y.call('repair-chazara-pending',{classId:'wt'});
 assert.notEqual(forbidden.code,200,'unassigned class recovery must fail');
 assert.equal(y.reads.some(p=>p.startsWith('posukPractice/chazara/events')),false,
   'no event histories may be read before authorization');
 assert.equal(y.writes.length,0);
});

test('inline legacy audio is absent from pending/history metadata and available only by authorized click',async()=>{
 const d=fixture(),audio='data:audio/webm;base64,'+'QUJD'.repeat(65536);
 d['posukPractice/chazara/events/shared/et_event'].audioDataURL=audio;
 d['posukPractice/chazara/events/shared/wt_event'].audioDataURL='data:audio/webm;base64,V1Q=';
 const x=server(d);
 const pending=await x.call('get-chazara-event',{studentId:'shared',eventId:'et_event'});
 assert.equal(pending.code,200,JSON.stringify(pending.body));
 assert.equal(pending.body.event.hasInlineAudio,true);
 assert.equal(pending.body.event.audioDataURL,undefined,'pending metadata must not contain audio bytes');
 assert.ok(Buffer.byteLength(JSON.stringify(pending.body))<2000,'pending metadata response stays small with 256 KiB inline audio');
 const history=await x.call('list-chazara-history',{studentId:'shared'});
 assert.equal(history.code,200,JSON.stringify(history.body));
 assert.equal(history.body.events.et_event.hasInlineAudio,true);
 assert.equal(history.body.events.et_event.audioDataURL,undefined,'history must not embed audio bytes');
 assert.ok(Buffer.byteLength(JSON.stringify(history.body))<3000,'history metadata response stays small with 256 KiB inline audio');
 const clicked=await x.call('get-chazara-audio',{studentId:'shared',eventId:'et_event'});
 assert.equal(clicked.code,200,JSON.stringify(clicked.body));
 assert.equal(clicked.body.audioDataURL,audio,'explicit audio action returns selected recording');
 assert.ok(Buffer.byteLength(JSON.stringify(clicked.body))>200000,'large inline audio transfers only after explicit request');
 const foreign=await x.call('get-chazara-audio',{studentId:'shared',eventId:'wt_event'});
 assert.equal(foreign.code,403,'another class audio must be denied');
 d['b3Games/workspaces/b3-2026/teachers/teacher'].active=false;
 const revoked=await x.call('get-chazara-audio',{studentId:'shared',eventId:'et_event'});
 assert.notEqual(revoked.code,200,'revoked teacher must not retrieve inline audio');
 assert.equal(x.writes.length,0);
});


test('legacy inline audioURL remains private when another non-audio URL field is present',async()=>{
 const d=fixture(),event=d['posukPractice/chazara/events/shared/et_event'];
 const inline='data:audio/ogg;base64,QUJDREVGRw==';
 event.audioDataURL='https://example.test/obsolete-audio-link';
 event.audioURL=inline;
 const x=server(d);
 const summary=await x.call('get-chazara-event',{studentId:'shared',eventId:'et_event'});
 assert.equal(summary.code,200,JSON.stringify(summary.body));
 assert.equal(summary.body.event.hasInlineAudio,true);
 assert.equal(summary.body.event.audioDataURL,undefined);
 assert.equal(summary.body.event.audioURL,undefined,'embedded audioURL must not appear in metadata');
 assert.ok(!JSON.stringify(summary.body).includes(inline));
 const history=await x.call('list-chazara-history',{studentId:'shared'});
 assert.equal(history.code,200,JSON.stringify(history.body));
 assert.equal(history.body.events.et_event.audioURL,undefined);
 const clicked=await x.call('get-chazara-audio',{studentId:'shared',eventId:'et_event'});
 assert.equal(clicked.code,200,JSON.stringify(clicked.body));
 assert.equal(clicked.body.audioDataURL,inline,'select actual inline audio, not unrelated legacy field');
 const foreign=await x.call('get-chazara-audio',{studentId:'shared',eventId:'wt_event'});
 assert.equal(foreign.code,403);
 assert.equal(x.writes.length,0);
});

test('inline audio access stops immediately after tool grant, teacher assignment, or student membership revocation',async()=>{
 const d=fixture(),audio='data:audio/webm;base64,QUJD';
 const eventPath='posukPractice/chazara/events/shared/et_event';
 d[eventPath].audioDataURL=audio;
 const x=server(d);
 const request=()=>x.call('get-chazara-audio',{studentId:'shared',eventId:'et_event'});
 const allowed=await request();
 assert.equal(allowed.code,200,JSON.stringify(allowed.body));
 assert.equal(allowed.body.audioDataURL,audio);
 const countEventReads=()=>x.reads.filter(path=>path===eventPath).length;
 const classRow=d['b3Games/workspaces/b3-2026/classes/et'];
 classRow.toolGrants.chazara=false;
 let before=countEventReads();
 const grantRevoked=await request();
 assert.notEqual(grantRevoked.code,200,'removed class Chazara grant must deny audio');
 assert.equal(countEventReads(),before,'grant revocation must deny before event audio is read');
 classRow.toolGrants.chazara=true;
 const teacherRow=d['b3Games/workspaces/b3-2026/teachers/teacher'];
 teacherRow.classIds.et=false;
 before=countEventReads();
 const assignmentRevoked=await request();
 assert.notEqual(assignmentRevoked.code,200,'removed teacher assignment must deny audio');
 assert.equal(countEventReads(),before,'teacher reassignment must deny before event audio is read');
 teacherRow.classIds.et=true;
 d['b3Games/students/shared/memberships'].a.active=false;
 before=countEventReads();
 const membershipRevoked=await request();
 assert.notEqual(membershipRevoked.code,200,'removed student ET membership must deny audio');
 assert.equal(countEventReads(),before,'student membership revocation must deny before event audio is read');
 assert.equal(x.writes.length,0,'all revocation checks must remain read-only');
});

test('authorized Chazara metadata and inline-audio reads fetch each event only once',async()=>{
 const d=fixture(),path='posukPractice/chazara/events/shared/et_event';
 d[path].audioDataURL='data:audio/webm;base64,QUJDREVGRw==';
 const x=server(d),reads=()=>x.reads.filter(p=>p===path).length;
 let before=reads();
 const metadata=await x.call('get-chazara-event',{studentId:'shared',eventId:'et_event'});
 assert.equal(metadata.code,200,JSON.stringify(metadata.body));
 assert.equal(metadata.body.event.hasInlineAudio,true);
 assert.equal(metadata.body.event.audioDataURL,undefined);
 assert.equal(reads()-before,1,'metadata request must not fetch large inline audio twice on the backend');
 before=reads();
 const clicked=await x.call('get-chazara-audio',{studentId:'shared',eventId:'et_event'});
 assert.equal(clicked.code,200,JSON.stringify(clicked.body));
 assert.equal(clicked.body.audioDataURL,d[path].audioDataURL);
 assert.equal(reads()-before,1,'explicit audio click must fetch its authorized event only once');
 const foreignPath='posukPractice/chazara/events/shared/wt_event';
 const denied=await x.call('get-chazara-audio',{studentId:'shared',eventId:'wt_event'});
 assert.equal(denied.code,403,'single-read optimization must not bypass class scope');
 assert.equal(x.reads.filter(p=>p===foreignPath).length,1,'foreign event must be checked, never returned');
 assert.equal(x.writes.length,0,'read-only optimization must not write student records');
});
