'use strict';
// RED security regression: a point request can be reassigned between the
// teacher's authorization read and the approval/rejection mutation.
// Fictional data only; no Firebase connection or real student records.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope=require('../backend/functions/teacher-class-scope');

const ROOT='b3Games/workspaces/b3-2026';
const REQUEST='studentRewards/pointRequests/fictional_request';
function fixture(moveAt='second-read'){
  const own={source:'chazara-recording',status:'pending',practiceStudentId:'fictional_child',
    workspaceClassId:'alpha',rewardStudentId:'fictional_rewards',amount:2};
  const moved={...own,workspaceClassId:'beta'};
  const data={
    [ROOT+'/teachers/teacher']:{active:true,classIds:{alpha:true}},
    [ROOT+'/classes/alpha']:{active:true,toolGrants:{chazara:true},
      members:{fictional_child:{active:true}}},
    'b3Games/students/fictional_child/profile':{name:'Fictional Child',active:true},
    'b3Games/students/fictional_child/memberships':{
      a:{workspaceId:'b3-2026',classId:'alpha',active:true},
      b:{workspaceId:'b3-2026',classId:'beta',active:true}
    }
  };
  let requestReads=0,requestTransactions=0;
  const writes=[];
  const snap=value=>({val:()=>value===undefined?null:value,exists:()=>value!=null});
  const db={ref:path=>({
    get:async()=>{
      if(path===REQUEST){requestReads++;return snap(moveAt==='second-read'&&requestReads>=2?moved:own);}
      return snap(data[path]);
    },
    transaction:async updater=>{
      if(path===REQUEST){
        requestTransactions++;
        // Deliberately do not commit: attempting to claim the now-foreign
        // request is already a failure of the authorization boundary.
        updater(moved);
      }
      return {committed:false,snapshot:snap(moved)};
    },
    update:async value=>{writes.push({path,value});},
    set:async value=>{writes.push({path,value});}
  })};
  const admin={apps:[{}],database:()=>db,
    auth:()=>({verifyIdToken:async()=>({uid:'teacher',email:'teacher@example.test',email_verified:true})})};
  const ctx={exports:{},require:name=>
    name==='firebase-admin'?admin:
    name==='firebase-functions/v2/https'?{onRequest:(_options,fn)=>fn}:
    name==='./teacher-class-scope'?scope:
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
  return {call,writes,get requestReads(){return requestReads},
    get requestTransactions(){return requestTransactions}};
}

for(const action of ['approve-point-request','reject-point-request']){
  test(action+' must recheck class ownership if request changes after authorization',async()=>{
    const x=fixture();
    const response=await x.call(action);
    assert.ok(x.requestReads>=2,'fixture must simulate the request moving after the first authorized read');
    assert.equal(response.code,403,
      'a request moved to beta must be rejected before approval or rejection');
    assert.equal(x.requestTransactions,0,
      'no transaction may claim a request whose current class is outside teacher scope');
    assert.deepEqual(x.writes.filter(w=>w.path===REQUEST),[],
      'no status update may be written to a newly foreign-class request');
  });
}

for(const action of ['approve-point-request','reject-point-request']){
  test(action+' must abort transaction if ownership changes after the second read',async()=>{
    const x=fixture('transaction');
    const response=await x.call(action);
    assert.ok(x.requestReads>=2,'both authorization and action must read the request');
    assert.equal(response.code,403,'transaction must reject a request reassigned to beta');
    assert.equal(x.requestTransactions,1,'transaction must validate the current request value');
    assert.deepEqual(x.writes,[],'no reward balance or request writes after a denied transaction');
  });
}
