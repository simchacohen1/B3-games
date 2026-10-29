'use strict';
// Synthetic-only read-volume regression for the retained Chazara teacher queue.
// No Firebase network, production records, credentials or writes are involved.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const scope=require('../backend/functions/teacher-class-scope');

function fixture(archivedCount){
  const requests={
    synthetic_pending:{
      source:'chazara-recording',status:'pending',practiceStudentId:'synthetic_student',
      workspaceClassId:'alpha',eventId:'synthetic_event',amount:2,createdAt:1000
    }
  };
  for(let i=0;i<archivedCount;i++){
    requests['historical_'+i]={
      source:'chazara-recording',status:'approved',practiceStudentId:'other_student',
      workspaceClassId:'beta',eventId:'old_'+i,amount:2,createdAt:i,
      reason:'Synthetic historical entry for byte-size measurement. '.repeat(3)
    };
  }
  return {
    'b3Games/workspaces/b3-2026/teachers/teacher':{active:true,classIds:{alpha:true}},
    'b3Games/workspaces/b3-2026/classes/alpha':{
      active:true,name:'Alpha',toolGrants:{chazara:true},members:{synthetic_student:{active:true}}
    },
    'b3Games/students/synthetic_student/profile':{name:'Synthetic Student',active:true,classId:'alpha'},
    'b3Games/students/synthetic_student/memberships':{
      one:{workspaceId:'b3-2026',classId:'alpha',active:true}
    },
    'studentRewards/pointRequests':requests
  };
}
function server(data){
  const reads=[],writes=[];
  const snap=value=>({val:()=>value===undefined?null:value,exists:()=>value!=null});
  const db={ref:path=>({
    get:async()=>{
      const value=data[path];
      reads.push({path,bytes:Buffer.byteLength(JSON.stringify(value??null),'utf8')});
      return snap(value);
    },
    set:async value=>{writes.push([path,value]);},
    update:async value=>{writes.push([path,value]);}
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
  async function call(){
    const req={method:'POST',body:{action:'list-chazara-pending',classId:'alpha'},
      headers:{authorization:'Bearer synthetic'}};
    const res={code:200,set(){return this},setHeader(){return this},
      status(code){this.code=code;return this},json(body){this.body=body;return this},
      end(){return this}};
    await ctx.exports.studentRewardsAutoAward(req,res);
    return res;
  }
  return {call,reads,writes};
}

test('pending-only API has constant response but still downloads all archived point requests',async()=>{
  const results=[];
  for(const archivedCount of [0,100,1000]){
    const x=server(fixture(archivedCount));
    const response=await x.call();
    assert.equal(response.code,200,JSON.stringify(response.body));
    assert.equal(response.body.requests.length,1,'one selected-class pending request');
    assert.equal(response.body.requests[0].id,'synthetic_pending');
    assert.equal(x.reads.filter(r=>r.path==='studentRewards/pointRequests').length,1,
      'the current backend fetches the entire request collection once');
    assert.equal(x.reads.some(r=>r.path.startsWith('posukPractice/chazara/events')),false,
      'pending-only must not scan Chazara history');
    assert.equal(x.writes.length,0,'pending-only must not write or repair');
    const collectionBytes=x.reads.find(r=>r.path==='studentRewards/pointRequests').bytes;
    const responseBytes=Buffer.byteLength(JSON.stringify(response.body),'utf8');
    results.push({archivedCount,collectionBytes,responseBytes});
  }
  assert.ok(results[2].collectionBytes>results[1].collectionBytes*5,
    'full collection read must expose archive-size growth until indexed queue is implemented');
  assert.equal(results[0].responseBytes,results[1].responseBytes);
  assert.equal(results[1].responseBytes,results[2].responseBytes);
  console.log('Synthetic Chazara pending queue read-volume (not production measurements):',JSON.stringify(results));
});
