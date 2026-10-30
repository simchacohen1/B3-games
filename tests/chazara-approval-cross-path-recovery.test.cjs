'use strict';
// Fictional-data-only cross-path failure injection for Chazara point approvals.
// Deliberately exercises incomplete recovery without Firebase access.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const teacherScope=require('../backend/functions/teacher-class-scope');

const ROOT='b3Games/workspaces/b3-2026';
const REQUEST='studentRewards/pointRequests/fictional_request';
const BALANCE='studentRewards/students/fictional_rewards/rewardBalance';
const MIRROR='posukPractice/chazara/events/fictional_child/fictional_event/pointRequestStatus';

function fixture(failure='none'){
  const values={
    [ROOT+'/teachers/teacher']:{active:true,classIds:{alpha:true}},
    [ROOT+'/classes/alpha']:{active:true,toolGrants:{chazara:true},
      members:{fictional_child:{active:true}}},
    'b3Games/students/fictional_child/profile':{name:'Fictional Child',active:true},
    'b3Games/students/fictional_child/memberships':{
      a:{workspaceId:'b3-2026',classId:'alpha',active:true},
      b:{workspaceId:'b3-2026',classId:'beta',active:true}
    },
    [REQUEST]:{source:'chazara-recording',status:'pending',
      practiceStudentId:'fictional_child',workspaceClassId:'alpha',
      rewardStudentId:'fictional_rewards',eventId:'fictional_event',amount:2},
    [BALANCE]:5
  };
  const transactions=[],writes=[];let failureConsumed=false;
  const snap=v=>({val:()=>v===undefined?null:v,exists:()=>v!=null});
  const db={ref:path=>({
    get:async()=>snap(values[path]),
    transaction:async updater=>{
      const prior=values[path]===undefined?null:values[path];
      if(path===BALANCE&&failure==='balance-transaction'&&!failureConsumed){
        failureConsumed=true;
        transactions.push({path,committed:false,syntheticFailure:true});
        return {committed:false,snapshot:snap(prior)};
      }
      const next=updater(prior);
      transactions.push({path,committed:next!==undefined});
      if(next===undefined)return {committed:false,snapshot:snap(prior)};
      values[path]=next;
      return {committed:true,snapshot:snap(next)};
    },
    update:async patch=>{
      if(path===REQUEST&&patch.status==='approved'&&failure==='finalize-request'&&!failureConsumed){
        failureConsumed=true;
        throw new Error('Synthetic request-finalization failure after balance commit');
      }
      writes.push({path,kind:'update',patch});
      values[path]={...(values[path]||{}),...patch};
    },
    set:async value=>{
      if(path===MIRROR&&failure==='mirror-status'&&!failureConsumed){
        failureConsumed=true;
        throw new Error('Synthetic recording-mirror failure after approval');
      }
      writes.push({path,kind:'set',value});
      values[path]=value;
    }
  })};
  const admin={apps:[{}],database:()=>db,
    auth:()=>({verifyIdToken:async()=>({
      uid:'teacher',email:'teacher@example.test',email_verified:true
    })})};
  const ctx={exports:{},require:name=>
    name==='firebase-admin'?admin:
    name==='firebase-functions/v2/https'?{onRequest:(_options,handler)=>handler}:
    name==='./teacher-class-scope'?teacherScope:
    name.startsWith('./')?require('../backend/functions/'+name.slice(2)):require(name),
    console,Buffer,Intl,Date,process};
  vm.runInNewContext(fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8'),ctx);
  async function call(action){
    const req={method:'POST',headers:{authorization:'Bearer fictional'},
      body:{action,classId:'alpha',requestId:'fictional_request'}};
    const res={code:200,set(){return this},setHeader(){return this},
      status(code){this.code=code;return this},
      json(body){this.body=body;return this},end(){return this}};
    await ctx.exports.studentRewardsAutoAward(req,res);
    return res;
  }
  return {call,values,transactions,writes};
}


test('balance transaction failure leaves request retryable and credits exactly once',async()=>{
  const x=fixture('balance-transaction');
  const first=await x.call('approve-point-request');
  assert.notEqual(first.code,200,'first attempt must report a failed balance write');
  assert.equal(x.values[REQUEST].status,'pending','failed balance transaction must release claim');
  assert.equal(x.values[BALANCE],5,'no points awarded on failed balance transaction');
  const retry=await x.call('approve-point-request');
  assert.equal(retry.code,200,JSON.stringify(retry.body));
  assert.equal(x.values[REQUEST].status,'approved');
  assert.equal(x.values[BALANCE],7,'retry must credit exactly once');
  assert.equal(x.values[MIRROR],'approved');
});

test('RED: finalization failure after balance commit must recover without double-credit',async()=>{
  const x=fixture('finalize-request');
  const first=await x.call('approve-point-request');
  assert.notEqual(first.code,200,'failed finalization must not report success');
  assert.equal(x.values[BALANCE],7,'balance transaction already committed');
  assert.equal(x.values[REQUEST].status,'processing','approval was claimed before failure');
  const retry=await x.call('approve-point-request');
  assert.equal(retry.code,200,JSON.stringify(retry.body));
  assert.equal(x.values[BALANCE],7,'recovery must never credit points twice');
  assert.equal(x.values[REQUEST].status,'approved','retry must not strand the request in processing');
  assert.equal(x.values[MIRROR],'approved','recovered approval must update the recording');
});

test('RED: mirror write failure must be repaired by a safe idempotent retry',async()=>{
  const x=fixture('mirror-status');
  const first=await x.call('approve-point-request');
  assert.equal(first.code,200,JSON.stringify(first.body));
  assert.equal(x.values[REQUEST].status,'approved');
  assert.equal(x.values[BALANCE],7);
  assert.equal(x.values[MIRROR],undefined,'injected mirror failure must be observable');
  const retry=await x.call('approve-point-request');
  assert.equal(retry.code,200,JSON.stringify(retry.body));
  assert.equal(x.values[BALANCE],7,'retry must not award points twice');
  assert.equal(x.values[MIRROR],'approved','retry must repair missing recording status');
});


// RED design regressions: another authorized writer can change the same numeric
// reward balance while a Chazara request is stranded after crediting points.
// These changes model a separate completed numeric-child transaction, not a
// Firebase call or a mock of the proposed recovery algorithm.
for(const scenario of [
  {label:'prize spend',delta:-3,expected:4},
  {label:'teacher adjustment',delta:4,expected:11}
]){
  test('RED: retry after credited-but-unfinalized approval preserves concurrent '+scenario.label,async()=>{
    const x=fixture('finalize-request');
    const first=await x.call('approve-point-request');
    assert.notEqual(first.code,200,'injected finalization failure must be visible');
    assert.equal(x.values[REQUEST].status,'processing');
    assert.equal(x.values[BALANCE],7,'the original two-point credit committed');

    // A separate legitimate writer commits between the failure and retry.
    // Starting 5 + Chazara 2 + concurrent delta is the only correct balance.
    x.values[BALANCE]+=scenario.delta;
    assert.equal(x.values[BALANCE],scenario.expected);

    const retry=await x.call('approve-point-request');
    assert.equal(retry.code,200,JSON.stringify(retry.body));
    assert.equal(x.values[BALANCE],scenario.expected,
      'recovery must neither double-credit nor overwrite the concurrent writer');
    assert.equal(x.values[REQUEST].status,'approved',
      'the original credited request must finalize');
    assert.equal(x.values[MIRROR],'approved',
      'the Chazara event mirror must be repaired');
  });
}
