'use strict';
// Synthetic regression for single-pass Chazara pending filtering.
// No Firebase connection, real student data, or production writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('backend/functions/student-rewards-auto-award.js','utf8');
const start=source.indexOf('async function listPendingChazaraRequests(');
const end=source.indexOf('function chazaraRecordingSummary(',start);
assert.ok(start>=0&&end>start,'expected pending-list implementation');
const implementation=source.slice(start,end);

function fixture(){
  const requests={
    own:{practiceStudentId:'mine',workspaceClassId:'alpha',status:'pending',source:'chazara-recording',createdAt:1},
    sharedOwn:{practiceStudentId:'shared',workspaceClassId:'alpha',status:'pending',source:'chazara',createdAt:3},
    sharedForeign:{practiceStudentId:'shared',workspaceClassId:'beta',status:'pending',source:'chazara-recording',createdAt:4},
    alreadyApproved:{practiceStudentId:'mine',workspaceClassId:'alpha',status:'approved',source:'chazara',createdAt:5},
    unrelated:{practiceStudentId:'outsider',workspaceClassId:'alpha',status:'pending',source:'chazara',createdAt:6},
    wrongSource:{practiceStudentId:'mine',workspaceClassId:'alpha',status:'pending',source:'other',createdAt:7}
  };
  for(let i=0;i<5000;i++)requests['other_'+i]={
    practiceStudentId:'other_'+i,workspaceClassId:'beta',status:'pending',source:'chazara',createdAt:i
  };
  const students={mine:{},shared:{}};
  for(let i=0;i<200;i++)students['classmate_'+i]={};
  const scope={selected:'alpha',students};
  const reads=[],writes=[],checked=[];
  const ctx={
    SR_ROOT:'studentRewards',
    rtdb:{ref:path=>({
      get:async()=>{reads.push(path);return{val:()=>requests}},
      update:async()=>{writes.push(path)}
    })},
    teacherClassScope:{recordAllowed:(current,id,row)=>{
      checked.push(id);
      return Boolean(current.students[id]&&row.workspaceClassId===current.selected);
    }},
    isReviewableRequest:row=>['chazara','chazara-recording'].includes(row?.source),
    sweepPendingMilestones:async rows=>rows
  };
  vm.createContext(ctx);
  vm.runInContext(implementation+'\nthis.listPending=listPendingChazaraRequests;',ctx);
  return {scope,reads,writes,checked,run:()=>ctx.listPending(scope,{repair:false})};
}

test('pending scan returns only current-class requests and reads the queue once',async()=>{
  const f=fixture();
  const rows=await f.run();
  assert.deepEqual(Array.from(rows,row=>row.id),['sharedOwn','own']);
  assert.deepEqual(f.reads,['studentRewards/pointRequests']);
  assert.deepEqual(f.checked,['mine','shared','shared']);
  assert.equal(f.writes.length,0);
});

test('pending filter uses one pass through requests, not a student-by-request nested loop',()=>{
  assert.match(implementation,/for\(const \[id,item\] of Object\.entries\(allRequests\)\)/);
  assert.doesNotMatch(implementation,/for\(const studentId of Object\.keys\(scope\.students\)\)/);
  assert.match(implementation,/Object\.prototype\.hasOwnProperty\.call\(scope\.students,studentId\)/);
});
