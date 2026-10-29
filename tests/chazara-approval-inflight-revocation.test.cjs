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

function fixture(revocation){
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
  let requestReads=0;
  const snap=v=>({val:()=>v===undefined?null:v,exists:()=>v!=null});
  const db={ref:path=>({
    get:async()=>{
      if(path===REQUEST && ++requestReads===2){
        if(revocation==='teacher') values[ROOT+'/teachers/teacher']={active:false,classIds:{alpha:true}};
        if(revocation==='tool') values[ROOT+'/classes/alpha']={...values[ROOT+'/classes/alpha'],toolGrants:{chazara:false}};
      }
      return snap(values[path]);
    },
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
  return {call,values,transactions,writes,get requestReads(){return requestReads}};
}


// RED security regressions: revoke a previously valid grant after the initial
// teacher authorization but before the approval/rejection transaction.
// These are fictional in-memory records, not production Firebase calls.
for(const revocation of ['teacher','tool']){
  for(const action of ['approve-point-request','reject-point-request']){
    test(action+' must not act after in-flight '+revocation+' revocation',async()=>{
      const x=fixture(revocation);
      const response=await x.call(action);
      assert.ok(x.requestReads>=2,'fixture must revoke after initial authorization');
      assert.equal(response.code,403,'revoked authorization must be rejected before mutation');
      assert.equal(x.values[REQUEST].status,'pending','request status must remain pending');
      assert.equal(x.values[BALANCE],5,'no points may be credited');
      assert.equal(x.values[MIRROR],undefined,'no event status may be mirrored');
      assert.equal(x.transactions.filter(t=>t.committed).length,0,'no transactions may commit');
      assert.equal(x.writes.length,0,'no writes may be made');
    });
  }
}
