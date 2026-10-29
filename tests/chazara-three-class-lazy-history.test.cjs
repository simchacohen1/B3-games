'use strict';
// Fictional, in-memory regression for class-generic Chazara history/pending reads.
// Tests only the retained #404 API; no Firebase project, student data or writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const teacherClassScope=require('../backend/functions/teacher-class-scope');

const ROOT='b3Games/workspaces/b3-2026';
const EVENTS='posukPractice/chazara/events/shared';
const REQUESTS='studentRewards/pointRequests';
function fixture(){
  const events={
    alpha_event:{workspaceClassId:'alpha',recorded:true,reviewApplied:true},
    gamma_event:{workspaceClassId:'gamma',recorded:true,reviewApplied:true},
    beta_event:{workspaceClassId:'beta',recorded:true,reviewApplied:true},
    classless_event:{recorded:true,reviewApplied:true}
  };
  return {
    [ROOT+'/teachers/teacher']:{active:true,classIds:{alpha:true,gamma:true}},
    [ROOT+'/classes/alpha']:{active:true,name:'Alpha',toolGrants:{chazara:true},members:{shared:{active:true}}},
    [ROOT+'/classes/gamma']:{active:true,name:'Gamma',toolGrants:{chazara:true},members:{shared:{active:true}}},
    [ROOT+'/classes/beta']:{active:true,name:'Beta',toolGrants:{chazara:true},members:{shared:{active:true}}},
    'b3Games/students/shared/profile':{name:'Fictional Shared Child',active:true},
    'b3Games/students/shared/memberships':{
      a:{workspaceId:'b3-2026',classId:'alpha',active:true},
      b:{workspaceId:'b3-2026',classId:'beta',active:true},
      c:{workspaceId:'b3-2026',classId:'gamma',active:true}
    },
    [EVENTS]:events,
    ...Object.fromEntries(Object.entries(events).map(([id,e])=>[EVENTS+'/'+id,e])),
    [REQUESTS]:{
      gamma_pending:{status:'pending',source:'chazara-recording',practiceStudentId:'shared',workspaceClassId:'gamma',amount:2,createdAt:3},
      alpha_pending:{status:'pending',source:'chazara-recording',practiceStudentId:'shared',workspaceClassId:'alpha',amount:2,createdAt:2},
      beta_pending:{status:'pending',source:'chazara-recording',practiceStudentId:'shared',workspaceClassId:'beta',amount:2,createdAt:1},
      gamma_archived:{status:'approved',source:'chazara-recording',practiceStudentId:'shared',workspaceClassId:'gamma',amount:2,createdAt:0}
    }
  };
}
function server(data){
  const reads=[],writes=[];
  const snap=value=>({val:()=>value===undefined?null:value,exists:()=>value!=null});
  const db={ref:path=>({
    get:async()=>{reads.push(path);return snap(data[path]);},
    set:async value=>{writes.push({path,kind:'set',value});},
    update:async value=>{writes.push({path,kind:'update',value});}
  })};
  const admin={apps:[{}],database:()=>db,auth:()=>({verifyIdToken:async()=>({
    uid:'teacher',email:'fictional-teacher@example.test',email_verified:true
  })})};
  const ctx={exports:{},require:name=>
    name==='firebase-admin'?admin:
    name==='firebase-functions/v2/https'?{onRequest:(_opts,fn)=>fn}:
    name==='./teacher-class-scope'?teacherClassScope:
    name.startsWith('./')?require('../backend/functions/'+name.slice(2)):require(name),
    console,Buffer,Intl,Date,process};
  vm.runInNewContext(fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8'),ctx);
  async function call(action,classId,extra={}){
    const req={method:'POST',headers:{authorization:'Bearer fictional'},
      body:{action,classId,...extra}};
    const res={code:200,set(){return this},setHeader(){return this},
      status(code){this.code=code;return this},
      json(body){this.body=body;return this},end(){return this}};
    await ctx.exports.studentRewardsAutoAward(req,res);
    return res;
  }
  return {call,reads,writes};
}
test('history is lazy and filtered to the selected arbitrary class, not ET/WT names',async()=>{
  const x=server(fixture());
  const pending=await x.call('list-chazara-pending','gamma');
  assert.equal(pending.code,200,JSON.stringify(pending.body));
  assert.deepEqual(Array.from(pending.body.requests,r=>r.id),['gamma_pending']);
  assert.equal(x.reads.some(p=>p.startsWith('posukPractice/chazara/events/')),false,
    'initial pending queue must not download recording histories');
  assert.equal(x.writes.length,0);
  const gamma=await x.call('list-chazara-history','gamma',{studentId:'shared'});
  assert.equal(gamma.code,200,JSON.stringify(gamma.body));
  assert.deepEqual(Object.keys(gamma.body.events),['gamma_event']);
  const alpha=await x.call('list-chazara-history','alpha',{studentId:'shared'});
  assert.equal(alpha.code,200,JSON.stringify(alpha.body));
  assert.deepEqual(Object.keys(alpha.body.events),['alpha_event']);
  assert.equal(x.writes.length,0,'history filters must be read-only');
});
test('shared three-class student never exposes foreign or ambiguous legacy events',async()=>{
  const x=server(fixture());
  const own=await x.call('get-chazara-event','gamma',{studentId:'shared',eventId:'gamma_event'});
  assert.equal(own.code,200,JSON.stringify(own.body));
  for(const eventId of ['alpha_event','beta_event','classless_event']){
    const denied=await x.call('get-chazara-event','gamma',{studentId:'shared',eventId});
    assert.equal(denied.code,403,'must deny '+eventId);
  }
  const readCount=x.reads.filter(p=>p.startsWith('posukPractice/chazara/events/')).length;
  const unassigned=await x.call('list-chazara-history','beta',{studentId:'shared'});
  assert.notEqual(unassigned.code,200,'teacher is not assigned to beta');
  assert.equal(x.reads.filter(p=>p.startsWith('posukPractice/chazara/events/')).length,readCount,
    'unassigned class must fail before reading history');
  assert.equal(x.writes.length,0);
});
test('revoked class tool grant or roster membership blocks lazy history access',async()=>{
  const data=fixture(),x=server(data);
  data[ROOT+'/classes/gamma'].toolGrants.chazara=false;
  const denied=await x.call('list-chazara-history','gamma',{studentId:'shared'});
  assert.notEqual(denied.code,200,'tool grant revocation must deny history');
  assert.equal(x.reads.includes(EVENTS),false,'no history read after tool revocation');
  data[ROOT+'/classes/gamma'].toolGrants.chazara=true;
  data[ROOT+'/classes/gamma'].members.shared.active=false;
  const removed=await x.call('list-chazara-history','gamma',{studentId:'shared'});
  assert.notEqual(removed.code,200,'roster revocation must deny history');
  assert.equal(x.reads.includes(EVENTS),false,'no history read after roster revocation');
  assert.equal(x.writes.length,0);
});
