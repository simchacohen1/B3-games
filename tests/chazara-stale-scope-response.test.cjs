'use strict';
// Synthetic, network-free regression for async Chazara responses crossing a class change.
// No Firebase credentials, production data, or live student records are used.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
function extract(start,end){
  const a=html.indexOf(start),b=html.indexOf(end,a);
  assert.ok(a>=0&&b>a,'expected Chazara implementation section: '+start);
  return html.slice(a,b);
}
const historyCode=extract('async function loadPreviousRecordings(){',"if($('loadPreviousRecordingsBtn'))");
const pendingCode=extract('async function loadApprovals(){','let automaticSweepRunning=false;');
const scopeCode=extract('async function loadClassScope(user,access){','window.B3SiteSettings.onAuthStateChanged');

function fixture(code,fn){
  let resolveResponse,renderCount=0,approvalCount=0,sweepCount=0;
  const response=new Promise(resolve=>{resolveResponse=resolve});
  const button={disabled:false,textContent:'Load previous recordings'};
  const review={value:'needs'};
  const signin={classList:{add(){},remove(){}}};
  const approvalList={innerHTML:''};
  const elements={loadPreviousRecordingsBtn:button,recordingReviewFilter:review,approvalSignInBtn:signin,approvalList};
  const ctx={
    scopeGeneration:1,
    approvalLoadSequence:0,
    teacherScope:{selected:'et',students:{shared:{}}},
    teacherAccess:{authorized:true},
    recordingHistoryLoading:false,recordingHistoryLoaded:false,
    E:{shared:{pending:{workspaceClassId:'et',recorded:true}}},
    pendingPointRequests:{},
    auth:{currentUser:{uid:'synthetic-teacher'}},
    window:{
      FunTorahTeacherScope:{recordAllowed:(scope,id,event)=>
        Object.prototype.hasOwnProperty.call(scope.students||{},id)&&event?.workspaceClassId===scope.selected},
      FunTorahApprovalQueue:{isPendingAutomatic:()=>false,needsManualApproval:()=>true,isChazaraApproval:()=>true}
    },
    $:id=>elements[id],
    teacherApi:()=>response,
    renderRecordings:()=>{renderCount++},
    renderApprovals:()=>{approvalCount++},
    loadApprovals:async()=>{approvalCount++},
    sweepAutomaticPoints:()=>{sweepCount++},
    setApprovalStatus:()=>{},
    setRecordingActionStatus:()=>{},
    console
  };
  vm.createContext(ctx);
  vm.runInContext(code+'\nthis.run='+fn+';',ctx);
  return {ctx,button,review,resolveResponse,renderCount:()=>renderCount,approvalCount:()=>approvalCount,sweepCount:()=>sweepCount};
}

test('late history response cannot restore recordings from a previously authorized class',async()=>{
  const f=fixture(historyCode,'loadPreviousRecordings');
  const loading=f.ctx.run();
  f.ctx.scopeGeneration++;
  f.ctx.teacherScope={selected:'wt',students:{shared:{}}};
  f.ctx.E={shared:{current:{workspaceClassId:'wt'}}};
  f.ctx.recordingHistoryLoading=false;
  f.button.disabled=false;
  f.resolveResponse({recordings:[{studentId:'shared',id:'old-et',workspaceClassId:'et'}]});
  await loading;
  assert.equal(f.ctx.E.shared['old-et'],undefined);
  assert.equal(f.ctx.E.shared.current.workspaceClassId,'wt');
  assert.equal(f.ctx.recordingHistoryLoaded,false);
  assert.equal(f.renderCount(),0);
  assert.equal(f.approvalCount(),0);
  assert.equal(f.button.disabled,false);
});

test('same-class history response still loads permitted recordings but excludes foreign class',async()=>{
  const f=fixture(historyCode,'loadPreviousRecordings');
  const loading=f.ctx.run();
  f.resolveResponse({recordings:[
    {studentId:'shared',id:'own-et',workspaceClassId:'et'},
    {studentId:'shared',id:'foreign-wt',workspaceClassId:'wt'}
  ]});
  await loading;
  assert.equal(f.ctx.E.shared['own-et'].workspaceClassId,'et');
  assert.equal(f.ctx.E.shared['foreign-wt'],undefined);
  assert.equal(f.ctx.recordingHistoryLoaded,true);
  assert.equal(f.renderCount(),1);
  assert.equal(f.approvalCount(),1);
  assert.equal(f.button.disabled,false);
});

test('late pending response cannot repopulate approvals or recordings after a class change',async()=>{
  const f=fixture(pendingCode,'loadApprovals');
  const loading=f.ctx.run();
  f.ctx.scopeGeneration++;
  f.ctx.teacherScope={selected:'wt',students:{shared:{}}};
  f.ctx.E={shared:{current:{workspaceClassId:'wt'}}};
  f.ctx.pendingPointRequests={newClass:{id:'newClass'}};
  f.resolveResponse({requests:[{id:'old',practiceStudentId:'shared',workspaceClassId:'et'}],
    recordings:[{studentId:'shared',id:'old-et',workspaceClassId:'et'}]});
  await loading;
  assert.deepEqual(Object.keys(f.ctx.pendingPointRequests),['newClass']);
  assert.equal(f.ctx.E.shared['old-et'],undefined);
  assert.equal(f.ctx.E.shared.current.workspaceClassId,'wt');
  assert.equal(f.renderCount(),0);
  assert.equal(f.approvalCount(),0);
  assert.equal(f.sweepCount(),0);
});

test('same-class pending response applies a second class check to recording summaries',async()=>{
  const f=fixture(pendingCode,'loadApprovals');
  const loading=f.ctx.run();
  f.resolveResponse({requests:[{id:'own',practiceStudentId:'shared',workspaceClassId:'et'}],
    recordings:[
      {studentId:'shared',id:'own-et',workspaceClassId:'et'},
      {studentId:'shared',id:'foreign-wt',workspaceClassId:'wt'}
    ]});
  await loading;
  assert.deepEqual(Object.keys(f.ctx.pendingPointRequests),['own']);
  assert.equal(f.ctx.E.shared['own-et'].workspaceClassId,'et');
  assert.equal(f.ctx.E.shared['foreign-wt'],undefined);
  assert.equal(f.renderCount(),1);
  assert.equal(f.approvalCount(),1);
});

test('class-scope reset invalidates history state and restores the load button',()=>{
  assert.match(scopeCode,/const generation=\+\+scopeGeneration;/);
  assert.match(scopeCode,/recordingHistoryLoaded=false;recordingHistoryLoading=false;/);
  assert.match(scopeCode,/historyButton\.disabled=false/);
});

test('overlapping same-class pending responses apply only the newest result',async()=>{
  const f=fixture(pendingCode,'loadApprovals');
  const deferred=[];
  f.ctx.teacherApi=()=>new Promise(resolve=>deferred.push(resolve));
  const older=f.ctx.run();
  const newer=f.ctx.run();
  assert.equal(deferred.length,2);
  deferred[1]({requests:[{id:'fresh',practiceStudentId:'shared',workspaceClassId:'et'}],
    recordings:[{studentId:'shared',id:'fresh-event',workspaceClassId:'et'}]});
  await newer;
  deferred[0]({requests:[{id:'stale',practiceStudentId:'shared',workspaceClassId:'et'}],
    recordings:[{studentId:'shared',id:'stale-event',workspaceClassId:'et'}]});
  await older;
  assert.deepEqual(Object.keys(f.ctx.pendingPointRequests),['fresh']);
  assert.equal(f.ctx.E.shared['fresh-event'].workspaceClassId,'et');
  assert.equal(f.ctx.E.shared['stale-event'],undefined);
  assert.equal(f.renderCount(),1);
  assert.equal(f.approvalCount(),1);
});

test('late failure from an older same-class request cannot erase a newer queue',async()=>{
  const f=fixture(pendingCode,'loadApprovals');
  const deferred=[];
  f.ctx.teacherApi=()=>new Promise((resolve,reject)=>deferred.push({resolve,reject}));
  const older=f.ctx.run();
  const newer=f.ctx.run();
  deferred[1].resolve({requests:[{id:'fresh',practiceStudentId:'shared',workspaceClassId:'et'}],
    recordings:[]});
  await newer;
  deferred[0].reject(new Error('old network error'));
  await older;
  assert.deepEqual(Object.keys(f.ctx.pendingPointRequests),['fresh']);
  assert.equal(f.renderCount(),1);
  assert.equal(f.approvalCount(),1);
});

test('history refresh prefers latest authorized server status over stale cached event',async()=>{
  const f=fixture(historyCode,'loadPreviousRecordings');
  f.ctx.recordingHistoryLoaded=true;
  f.ctx.E={shared:{
    same:{workspaceClassId:'et',fullReviewChecked:false,pointRequestStatus:'pending'},
    localPending:{workspaceClassId:'et',pointRequestStatus:'pending'}
  }};
  const loading=f.ctx.run();
  f.resolveResponse({recordings:[{
    studentId:'shared',id:'same',workspaceClassId:'et',
    fullReviewChecked:true,pointRequestStatus:'approved'
  }]});
  await loading;
  assert.equal(f.ctx.E.shared.same.fullReviewChecked,true);
  assert.equal(f.ctx.E.shared.same.pointRequestStatus,'approved');
  assert.equal(f.ctx.E.shared.localPending.pointRequestStatus,'pending');
  assert.equal(f.ctx.recordingHistoryLoaded,true);
  assert.equal(f.renderCount(),1);
});
