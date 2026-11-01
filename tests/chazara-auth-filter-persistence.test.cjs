'use strict';
// Intentional RED regression on #531: exercise the real auth callback AND
// the synchronous startup of loadClassScope, rather than mocking loadClassScope.
// Fictional accounts only; no Firebase/network or student data.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.join(__dirname,'../chazara/teacher.html'),'utf8');
const scopeStart=html.indexOf('async function loadClassScope(user,access){');
const scopeStop=html.indexOf('if(!access?.authorized)',scopeStart);
const authStart=html.indexOf('let lastChazaraAuthUid=null;',scopeStop);
const authStop=html.indexOf("// Re-check the teacher's classes",authStart);
assert.ok(scopeStart>=0&&scopeStop>scopeStart&&authStart>scopeStop&&authStop>authStart,
  'find the actual Chazara scope initialization and Google-auth callback');
// The prefix is all that is needed: it synchronously resets the filter before
// the first awaited roster/API read. No Firebase request is made by this test.
const script=html.slice(scopeStart,scopeStop)+'return Promise.resolve();\n}\n'+html.slice(authStart,authStop);

function fixture(){
  const ids=['teacherApp','detail','teacherGate','recordingReviewFilter',
    'manualAddBtn','showFullDashboard','showPendingOnly'];
  const nodes=Object.fromEntries(ids.map(id=>{
    const classes=new Set();
    return [id,{value:id==='recordingReviewFilter'?'pending':'',disabled:false,
      textContent:'',classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),
        contains:c=>classes.has(c)}}];
  }));
  let authCallback;
  const ctx={Promise,scopeGeneration:0,historyGeneration:0,approvalGeneration:0,
    historyLoading:false,historyStudentsLoaded:new Set(),pendingRecordingKeys:new Set(),
    pendingEventFetches:new Map(),teacherAccess:null,teacherScope:null,
    D:{},R:{},E:{},P:{},pendingPointRequests:{},fullDashboardLoaded:false,
    clearStudentListeners(){},$:id=>nodes[id],
    window:{B3SiteSettings:{onAuthStateChanged:fn=>{authCallback=fn}}}};
  vm.runInNewContext(script,ctx,{filename:'chazara/teacher.html'});
  assert.equal(typeof authCallback,'function');
  return {ctx,nodes,auth:(uid,authorized=!!uid)=>authCallback(uid?{uid}:null,authorized,{authorized})};
}

test('same-UID auth refresh retains an explicitly chosen historical review filter',async()=>{
  const x=fixture();
  await x.auth('fictional_teacher_a');
  x.ctx.fullDashboardLoaded=true;
  x.nodes.recordingReviewFilter.value='checked';
  await x.auth('fictional_teacher_a');
  assert.equal(x.ctx.fullDashboardLoaded,true,'full dashboard remains explicitly selected');
  assert.equal(x.nodes.recordingReviewFilter.value,'checked',
    'same Google account must not silently revert to pending while full history still loads');
});

test('switching to a different Google UID resets history and filter to pending',async()=>{
  const x=fixture();
  await x.auth('fictional_teacher_a');
  x.ctx.fullDashboardLoaded=true;
  x.nodes.recordingReviewFilter.value='checked';
  await x.auth('fictional_teacher_b');
  assert.equal(x.ctx.fullDashboardLoaded,false);
  assert.equal(x.nodes.recordingReviewFilter.value,'pending');
});

// A revoked account may retain the same Firebase UID; the full-history opt-in
// must not survive an explicit authorization denial.
test('same-UID authorization revocation resets historical view to pending',async()=>{
  const x=fixture();
  await x.auth('fictional_teacher_a');
  x.ctx.fullDashboardLoaded=true;
  x.nodes.recordingReviewFilter.value='checked';
  await x.auth('fictional_teacher_a',false);
  assert.equal(x.ctx.fullDashboardLoaded,false);
  assert.equal(x.nodes.recordingReviewFilter.value,'pending');
});
