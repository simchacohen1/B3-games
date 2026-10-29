'use strict';
// Fictional-data-only positive-path regression for the scoped Chazara approval
// transaction. Complements the ownership-race tests without Firebase access.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const teacherScope=require('../backend/functions/teacher-class-scope');

const ROOT='b3Games/workspaces/b3-2026';
const REQUEST='studentRewards/pointRequests/fictional_request';
const BALANCE='studentRewards/students/fictional_rewards/rewardBalance';
const MIRROR='posukPractice/chazara/events/fictional_child/fictional_event/pointRequestStatus';

function fixture(){
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
  const transactions=[],writes=[];
  const snap=v=>({val:()=>v===undefined?null:v,exists:()=>v!=null});
  const db={ref:path=>({
    get:async()=>snap(values[path]),
    transaction:async updater=>{
      const prior=values[path]===undefined?null:values[path];
      const next=updater(prior);
      transactions.push({path,committed:next!==undefined});
      if(next===undefined)return {committed:false,snapshot:snap(prior)};
      values[path]=next;
      return {committed:true,snapshot:snap(next)};
    },
    update:async patch=>{
      writes.push({path,kind:'update',patch});
      values[path]={...(values[path]||{}),...patch};
    },
    set:async value=>{
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

test('same-class approval credits once, mirrors the recording, and retry is idempotent',async()=>{
  const x=fixture();
  const first=await x.call('approve-point-request');
  assert.equal(first.code,200,JSON.stringify(first.body));
  assert.equal(first.body.status,'approved');
  assert.equal(x.values[REQUEST].status,'approved');
  assert.equal(x.values[BALANCE],7,'exactly two points credited');
  assert.equal(x.values[MIRROR],'approved');
  assert.equal(x.transactions.filter(t=>t.path===REQUEST&&t.committed).length,1);
  assert.equal(x.transactions.filter(t=>t.path===BALANCE&&t.committed).length,1);
  const count=x.transactions.length;
  const retry=await x.call('approve-point-request');
  assert.equal(retry.code,200,JSON.stringify(retry.body));
  assert.equal(retry.body.alreadyHandled,true);
  assert.equal(x.transactions.length,count,'retry must not repeat any transaction');
  assert.equal(x.values[BALANCE],7,'retry must not credit again');
});

test('same-class rejection is transactional, mirrors status, and never changes balance',async()=>{
  const x=fixture();
  const first=await x.call('reject-point-request');
  assert.equal(first.code,200,JSON.stringify(first.body));
  assert.equal(first.body.status,'rejected');
  assert.equal(x.values[REQUEST].status,'rejected');
  assert.equal(x.values[BALANCE],5,'rejection must not credit or debit');
  assert.equal(x.values[MIRROR],'rejected');
  assert.equal(x.transactions.filter(t=>t.path===REQUEST&&t.committed).length,1);
  assert.equal(x.transactions.filter(t=>t.path===BALANCE).length,0);
  const count=x.transactions.length;
  const retry=await x.call('reject-point-request');
  assert.equal(retry.code,200,JSON.stringify(retry.body));
  assert.equal(retry.body.alreadyHandled,true);
  assert.equal(x.transactions.length,count,'retry must not repeat rejection');
  assert.equal(x.values[BALANCE],5);
});
