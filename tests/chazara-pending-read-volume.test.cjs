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
    orderByChild(field){assert.equal(field,'status');return {equalTo(status){return {get:async()=>{
      const pending=Object.fromEntries(Object.entries(data[path]||{}).filter(([,row])=>row?.status===status));
      reads.push({path,query:'status='+status,bytes:Buffer.byteLength(JSON.stringify(pending),'utf8')});
      return snap(pending);
    }}}}},
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

test('pending-only API uses indexed status query with archive-independent read volume',async()=>{
  const results=[];
  for(const archivedCount of [0,100,1000]){
    const x=server(fixture(archivedCount));
    const response=await x.call();
    assert.equal(response.code,200,JSON.stringify(response.body));
    assert.equal(response.body.requests.length,1,'one selected-class pending request');
    assert.equal(response.body.requests[0].id,'synthetic_pending');
    assert.equal(x.reads.filter(r=>r.path==='studentRewards/pointRequests').length,1,
      'one indexed pending-status query per teacher queue load');
    assert.equal(x.reads.find(r=>r.path==='studentRewards/pointRequests').query,'status=pending');
    assert.equal(x.reads.some(r=>r.path.startsWith('posukPractice/chazara/events')),false,
      'pending-only must not scan Chazara history');
    assert.equal(x.writes.length,0,'pending-only must not write or repair');
    const collectionBytes=x.reads.find(r=>r.path==='studentRewards/pointRequests').bytes;
    const responseBytes=Buffer.byteLength(JSON.stringify(response.body),'utf8');
    results.push({archivedCount,collectionBytes,responseBytes});
  }
  assert.equal(results[0].collectionBytes,results[1].collectionBytes,
    'archived requests must not increase indexed pending-query bytes');
  assert.equal(results[1].collectionBytes,results[2].collectionBytes);
  assert.equal(results[0].responseBytes,results[1].responseBytes);
  assert.equal(results[1].responseBytes,results[2].responseBytes);
  console.log('Synthetic indexed Chazara pending queue read-volume (not production measurements):',JSON.stringify(results));
});

test('indexed pending queue excludes foreign-class and ambiguous shared-student requests',async()=>{
  const data=fixture(100);
  data['b3Games/workspaces/b3-2026/classes/alpha'].members.shared={active:true};
  data['b3Games/students/shared/profile']={name:'Fictional Shared Student',active:true};
  data['b3Games/students/shared/memberships']={
    a:{workspaceId:'b3-2026',classId:'alpha',active:true},
    b:{workspaceId:'b3-2026',classId:'beta',active:true}
  };
  const requests=data['studentRewards/pointRequests'];
  const common={source:'chazara-recording',status:'pending',practiceStudentId:'shared',amount:2};
  requests.alpha_shared={...common,workspaceClassId:'alpha',eventId:'alpha_event'};
  requests.beta_shared={...common,workspaceClassId:'beta',eventId:'beta_event'};
  requests.ambiguous_shared={...common,eventId:'legacy_event'};
  requests.outsider={source:'chazara-recording',status:'pending',practiceStudentId:'unassigned',workspaceClassId:'alpha',amount:2};
  const x=server(data);
  const response=await x.call();
  assert.equal(response.code,200,JSON.stringify(response.body));
  const ids=Array.from(response.body.requests,row=>row.id);
  assert.deepEqual(ids.slice().sort(),['alpha_shared','synthetic_pending'],
    'only own-class pending requests may reach the teacher, even after the status query');
  assert.equal(x.reads.filter(row=>row.path==='studentRewards/pointRequests'&&row.query==='status=pending').length,1);
  assert.equal(x.reads.some(row=>row.path.startsWith('posukPractice/chazara/events')),false);
  assert.equal(x.writes.length,0);
});

test('revoked teacher or Chazara grant cannot fetch the indexed pending queue',async()=>{
  for(const revoke of ['teacher','tool']){
    const data=fixture(100);
    if(revoke==='teacher')data['b3Games/workspaces/b3-2026/teachers/teacher'].active=false;
    else data['b3Games/workspaces/b3-2026/classes/alpha'].toolGrants.chazara=false;
    const x=server(data);
    const response=await x.call();
    assert.notEqual(response.code,200,'revoked '+revoke+' must fail closed');
    assert.equal(x.reads.some(row=>row.path==='studentRewards/pointRequests'),false,
      'authorization must reject '+revoke+' before the indexed query');
    assert.equal(x.writes.length,0);
  }
});

test('indexed status query still reads foreign-class pending requests: synthetic scaling diagnostic',async()=>{
  // Status is indexed globally, not by class. The API must never return foreign
  // requests, but a large school-wide pending backlog still costs server reads.
  // This is a passing diagnostic, NOT evidence of production bandwidth or latency.
  const results=[];
  for(const foreignPendingCount of [0,100,1000]){
    const data=fixture(0),requests=data['studentRewards/pointRequests'];
    for(let i=0;i<foreignPendingCount;i++){
      requests['foreign_pending_'+i]={
        source:'chazara-recording',status:'pending',
        practiceStudentId:'foreign_student_'+i,workspaceClassId:'beta',
        eventId:'foreign_event_'+i,amount:2,createdAt:i,
        reason:'Synthetic other-class pending request for read-volume measurement.'
      };
    }
    const x=server(data);
    const response=await x.call();
    assert.equal(response.code,200,JSON.stringify(response.body));
    assert.deepEqual(Array.from(response.body.requests,row=>row.id),['synthetic_pending'],
      'foreign-class requests must never appear in the teacher response');
    const indexed=x.reads.filter(row=>row.path==='studentRewards/pointRequests');
    assert.equal(indexed.length,1);
    assert.equal(indexed[0].query,'status=pending');
    assert.equal(x.reads.some(row=>row.path.startsWith('posukPractice/chazara/events')),false);
    assert.equal(x.writes.length,0);
    results.push({
      foreignPendingCount,
      indexedQueryBytes:indexed[0].bytes,
      responseBytes:Buffer.byteLength(JSON.stringify(response.body),'utf8')
    });
  }
  assert.ok(results[0].indexedQueryBytes<results[1].indexedQueryBytes);
  assert.ok(results[1].indexedQueryBytes<results[2].indexedQueryBytes,
    'the status-only index still transfers other classes pending requests');
  assert.equal(results[0].responseBytes,results[1].responseBytes);
  assert.equal(results[1].responseBytes,results[2].responseBytes);
  console.log('Synthetic cross-class Chazara pending-query amplification (not production measurements):',JSON.stringify(results));
});
