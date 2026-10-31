'use strict';
// Fictional-data VM regressions execute the actual recording-review click handler.
// No Firebase connection, student records, deployed rules, or production writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('if($("recordingsList"))$("recordingsList").onclick=async e=>{');
const end=html.indexOf("if($('recordingStudentFilter'))",start);
assert.ok(start>=0&&end>start,'extract the real recording review handler');
const source=html.slice(start,end);

function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b});
 return {promise,resolve,reject};
}
function fixture(api=async()=>({pointsAction:'cancelled'}),onConfirm=()=>true){
 const calls=[],statuses=[],renders=[],refreshes=[],errors=[];
 const list={onclick:null};
 const checked={dataset:{recordingStudent:'student_a',recordingEvent:'event_a',recordingChecked:'false'},textContent:'Fully Checked',disabled:false};
 const rejected={dataset:{recordingStudent:'student_a',recordingEvent:'event_a'},textContent:'Reject Recording',disabled:false};
 const context={
  auth:{currentUser:{uid:'teacher_alpha'}},
  scopeGeneration:7,
  teacherScope:{boundAuthUid:'teacher_alpha'},
  E:{student_a:{event_a:{studentName:'Fictional Student',perek:18,posuk:3,teacherFullyChecked:false,teacherRejected:false,pointRequestStatus:'pending'}}},
  $:id=>id==='recordingsList'?list:null,
  currentChazaraAction:(uid,generation)=>!!uid&&context.auth.currentUser?.uid===uid&&context.scopeGeneration===generation&&context.teacherScope?.boundAuthUid===uid,
  teacherApi:async(action,args)=>{calls.push({action,args});return api(action,args)},
  setRecordingActionStatus:(msg,bad)=>statuses.push({msg,bad:!!bad}),
  renderRecordings:()=>renders.push('recordings'),
  renderApprovals:()=>renders.push('approvals'),
  loadApprovals:async()=>{refreshes.push(true)},
  recordingStatus:event=>event.pointRequestStatus,
  manualStudentName:()=> 'Fictional Student',
  confirm:message=>onConfirm(context,message),
  console:{error:err=>errors.push(String(err))}
 };
 vm.runInNewContext(source,context,{filename:'chazara-recording-review.js'});
 const click=kind=>list.onclick({target:{closest:selector=>
   kind==='checked'&&selector==='[data-recording-checked]'?checked:
   kind==='reject'&&selector==='[data-recording-reject]'?rejected:null}});
 return {context,calls,statuses,renders,refreshes,errors,checked,rejected,click};
}
test('authorized teacher can mark a recording fully checked',async()=>{
 const x=fixture();
 await x.click('checked');
 assert.deepEqual(x.calls.map(c=>c.action),['teacher-set-recording-full-review']);
 assert.equal(x.calls[0].args.checked,true);
 assert.equal(x.context.E.student_a.event_a.teacherFullyChecked,true);
 assert.deepEqual(x.renders,['recordings','approvals']);
 assert.match(x.statuses.at(-1).msg,/Fully checked/);
 assert.equal(x.checked.disabled,false);
});
test('authorized teacher can reject a recording and refresh approvals',async()=>{
 const x=fixture();
 await x.click('reject');
 assert.deepEqual(x.calls.map(c=>c.action),['teacher-reject-chazara-recording']);
 assert.equal(x.context.E.student_a.event_a.teacherRejected,true);
 assert.equal(x.context.E.student_a.event_a.pointRequestStatus,'rejected');
 assert.equal(x.refreshes.length,1);
 assert.match(x.statuses.at(-1).msg,/Pending points cancelled/);
 assert.equal(x.rejected.disabled,false);
});
test('pre-callback Google account switch blocks recording actions before dispatch',async()=>{
 const x=fixture();
 x.context.auth.currentUser={uid:'teacher_beta'};
 await x.click('checked');
 await x.click('reject');
 assert.equal(x.calls.length,0);
 assert.equal(x.statuses.length,0);
});
test('Google account switch during confirmation prevents old-session rejection',async()=>{
 const x=fixture(undefined,(ctx)=>{ctx.auth.currentUser={uid:'teacher_beta'};return true});
 await x.click('reject');
 assert.equal(x.calls.length,0);
 assert.equal(x.context.E.student_a.event_a.teacherRejected,false);
});
test('account switch during full-review API call cannot change new-session cache or UI',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const running=x.click('checked');
 assert.equal(x.calls.length,1);
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.resolve({});
 await running;
 assert.equal(x.context.E.student_a.event_a.teacherFullyChecked,false);
 assert.equal(x.renders.length,0);
 assert.equal(x.statuses.length,1,'only the old-session progress message may exist');
 assert.equal(x.errors.length,0);
});
test('class-scope revocation during recording rejection suppresses stale changes and refresh',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const running=x.click('reject');
 x.context.scopeGeneration=8;
 gate.resolve({pointsAction:'cancelled'});
 await running;
 assert.equal(x.context.E.student_a.event_a.teacherRejected,false);
 assert.equal(x.refreshes.length,0);
 assert.equal(x.renders.length,0);
 assert.equal(x.statuses.length,1);
});
test('old-account API failure cannot display an error in the next teacher session',async()=>{
 const gate=deferred(),x=fixture(()=>gate.promise);
 const running=x.click('checked');
 x.context.auth.currentUser={uid:'teacher_beta'};
 gate.reject(Error('old-account failure'));
 await running;
 assert.equal(x.errors.length,0);
 assert.equal(x.statuses.length,1);
 assert.equal(x.renders.length,0);
});
test('unchanged authorized teacher still sees recording-review API errors',async()=>{
 const x=fixture(async()=>{throw Error('synthetic permission denial')});
 await x.click('checked');
 assert.equal(x.errors.length,1);
 assert.equal(x.statuses.at(-1).bad,true);
 assert.match(x.statuses.at(-1).msg,/synthetic permission denial/);
 assert.equal(x.checked.disabled,false);
});
