'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {TextEncoder}=require('node:util');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const firebase=require('firebase/compat/app');
require('firebase/compat/database');
const vm=require('node:vm');

const RUN=process.env.B3_RUN_RTDB_EMULATOR_TESTS==='1';
const PROJECT='demo-shorashim-cost-audit';
const ROOT='posukPractice/shorashimLearning';
const encoder=new TextEncoder();
const teacherSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../shorashim/teacher.js'),'utf8');
const helperBlock=teacherSource.match(/const B3ShorashimTeacherRosterSync=\(\(\)=>\{[\s\S]*?\}\)\(\);/);
if(!helperBlock)throw new Error('Could not find production Shorashim roster listener implementation');
const {bindStudentEvents,bindStudentValues}=vm.runInNewContext(`${helperBlock[0]}; B3ShorashimTeacherRosterSync;`,{setTimeout,clearTimeout});

function bytes(value){return encoder.encode(JSON.stringify(value)).byteLength;}
const ref=(database,path)=>database.ref(path);
const set=(reference,value)=>reference.set(value);
const update=(reference,value)=>reference.update(value);
const remove=reference=>reference.remove();
const get=reference=>reference.once('value');
function onValue(reference,callback){reference.on('value',callback);return()=>reference.off('value',callback);}
const goOffline=database=>database.goOffline();
const goOnline=database=>database.goOnline();
function instrumentRef(reference,onEvent){
  const originalOn=reference.on,originalOff=reference.off,wrappedByEvent=new Map();
  reference.on=function(event,callback,cancel){
    const wrapped=snap=>{onEvent(event,snap);callback(snap);};
    const callbacks=wrappedByEvent.get(event)||new Map();callbacks.set(callback,wrapped);wrappedByEvent.set(event,callbacks);
    return originalOn.call(reference,event,wrapped,cancel);
  };
  reference.off=function(event,callback){
    const wrapped=callback?wrappedByEvent.get(event)?.get(callback):undefined;
    return originalOff.call(reference,event,wrapped);
  };
  return reference;
}
function sleep(ms=150){return new Promise(resolve=>setTimeout(resolve,ms));}
async function until(predicate,label,timeout=5000){
  const started=Date.now();
  while(Date.now()-started<timeout){if(predicate())return;await sleep(20);}
  assert.fail(`Timed out waiting for ${label}`);
}
function syntheticStudent(id,index=0){
  const cards={};
  for(let i=0;i<48;i++)cards[`card-${i}`]={itemKey:`shorashim:word-${i}`,learnedAt:1700000000000+i*60000,lastReviewedAt:1700000000000+i*90000,reviewCount:(i%7)+1,attempts:Array.from({length:4},(_,n)=>({at:1700000000000+n*3600000,correct:n%2===0,elapsedMs:700+n*80}))};
  return {name:`Synthetic Student ${index}`,classId:id.startsWith('et')?'et':'wt',totalActiveSeconds:3600+index*60,lastActive:1700000000000+index,cards,attemptHistory:Array.from({length:30},(_,n)=>({date:`2026-09-${String((n%28)+1).padStart(2,'0')}`,score:n%10,source:'synthetic-emulator'}))};
}
async function makeContext(t){
  if(!RUN){t.skip('Run with FIREBASE_DATABASE_EMULATOR_HOST and B3_RUN_RTDB_EMULATOR_TESTS=1 inside firebase emulators:exec.');return null;}
  if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw new Error('RTDB emulator host is required');
  const [host,portText]=process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(':');
  const testEnv=await initializeTestEnvironment({projectId:PROJECT,database:{host,port:Number(portText),rules:JSON.stringify({rules:{'.read':true,'.write':true}})}});
  t.after(()=>testEnv.cleanup());
  const teacher=testEnv.authenticatedContext('synthetic-teacher',{role:'teacher',classIds:['et','wt']}).database();
  return {testEnv,writer:teacher,teacher};
}

test('progress changes download one student record and redraw only the dashboard',async t=>{
  const context=await makeContext(t);if(!context)return;
  const {writer,teacher}=context;
  const fixture={catalog:{shorashim:Array.from({length:120},(_,i)=>({id:`word-${i}`,front:`Synthetic ${i}`,english:`Meaning ${i}`}))},settings:{minReviewMs:500,studentSiteOpen:true},leaderboards:{match:{8:{}}},students:{}};
  for(let i=0;i<24;i++){const id=`et-${String(i).padStart(3,'0')}`;fixture.students[id]=syntheticStudent(id,i);fixture.leaderboards.match[8][id]={name:fixture.students[id].name,time:8000+i};}
  await set(ref(writer,ROOT),fixture);

  const baseline=[];
  const baselineOff=onValue(ref(teacher,ROOT),snap=>baseline.push(bytes(snap.val())));
  await until(()=>baseline.length===1,'baseline full-scope initial value');
  const studentPath=`${ROOT}/students`;
  const oldInitial=await get(ref(teacher,studentPath));
  const oldOneShotBytes=bytes(oldInitial.val());
  const oldMetadataReads=await Promise.all(['catalog','settings','leaderboards'].map(async path=>bytes((await get(ref(teacher,`${ROOT}/${path}`))).val())));

  const metadataBytes={},metadataEvents={};
  const metadataOffs=['catalog','settings','leaderboards'].map(path=>onValue(ref(teacher,`${ROOT}/${path}`),snap=>{
    metadataEvents[path]=(metadataEvents[path]||0)+1;
    if(metadataEvents[path]===1)metadataBytes[path]=bytes(snap.val());
  }));
  await until(()=>Object.keys(metadataBytes).length===3,'initial scoped metadata values');
  const state={students:{}};let redraws=0,initialChildBytes=0,changedBytes=0,removedBytes=0;
  const measuredRef=instrumentRef(ref(teacher,studentPath),(event,snap)=>{
    const payload=bytes({[snap.key]:snap.val()});
    if(event==='child_added')initialChildBytes+=payload;
    if(event==='child_changed')changedBytes+=payload;
    if(event==='child_removed')removedBytes+=payload;
  });
  const sync=bindStudentEvents(measuredRef,state,()=>redraws++);
  sync.ready();
  await until(()=>Object.keys(state.students).length===24,'initial student child events');
  await sleep();
  redraws=0;

  const beforeRoot=baseline.at(-1),beforeChanged=changedBytes,studentId='et-003';
  const changed=syntheticStudent(studentId,3);changed.totalActiveSeconds+=60;changed.cards['card-0'].reviewCount+=1;
  await set(ref(writer,`${studentPath}/${studentId}`),changed);
  await until(()=>changedBytes>beforeChanged&&baseline.length>=2,'one student progress update');
  await sleep();
  const rootAfter=baseline.at(-1),studentPayload=changedBytes-beforeChanged;
  assert.equal(state.students[studentId].totalActiveSeconds,changed.totalActiveSeconds);
  assert.equal(redraws,1,'one progress update causes one dashboard draw');
  assert.ok(rootAfter>studentPayload*5,'legacy parent value retransmits a much larger dashboard subtree');

  const oldInitialBytes=baseline[0]+oldOneShotBytes+oldMetadataReads.reduce((sum,n)=>sum+n,0);
  const candidateInitialBytes=Object.values(metadataBytes).reduce((sum,n)=>sum+n,0)+initialChildBytes;
  const beforeOncePlusEvents=oldOneShotBytes+initialChildBytes;
  assert.ok(initialChildBytes>0&&oldOneShotBytes>0);
  assert.ok(candidateInitialBytes<oldInitialBytes,'scoped initial listeners avoid the duplicated whole-scope snapshot');
  assert.deepEqual(metadataEvents,{catalog:1,settings:1,leaderboards:1},'each metadata path is downloaded once at startup');
  console.log(JSON.stringify({measurement:'decoded synthetic emulator snapshot JSON bytes; excludes WebSocket protocol framing/compression',students:24,oldInitialBytes,candidateInitialBytes,initialSavingsBytes:oldInitialBytes-candidateInitialBytes,studentOneShotBeforeBytes:oldOneShotBytes,initialChildEventsAfterBytes:initialChildBytes,rosterDuplicateAvoidedBytes:beforeOncePlusEvents-initialChildBytes,parentValueOnProgressBeforeBytes:rootAfter,changedStudentPayloadAfterBytes:studentPayload,progressTransferReductionPercent:Math.round((1-studentPayload/rootAfter)*100),initialDashboardDraws:1,drawsAfterOneProgressUpdate:redraws}));
  metadataOffs.forEach(off=>off());
  baselineOff();sync.dispose();
});

test('new and removed students update the roster once and do not duplicate listeners',async t=>{
  const context=await makeContext(t);if(!context)return;
  const {writer,teacher}=context;const students=ref(writer,`${ROOT}/classes/room-a/students`);
  await set(students,{'initial-a':syntheticStudent('et-a',0),'initial-b':syntheticStudent('et-b',1)});
  const state={students:{}};let draws=0,added=0,removed=0;
  const measured=instrumentRef(ref(teacher,`${ROOT}/classes/room-a/students`),(event,snap)=>{if(event==='child_added')added+=bytes({[snap.key]:snap.val()});if(event==='child_removed')removed+=bytes({[snap.key]:snap.val()});});
  const sync=bindStudentEvents(measured,state,()=>draws++);sync.ready();
  await until(()=>Object.keys(state.students).length===2,'initial class roster');await sleep();draws=0;
  const beforeAdd=added;await set(ref(writer,`${ROOT}/classes/room-a/students/new-student`),syntheticStudent('wt-new',3));
  await until(()=>state.students['new-student'],'new student');await sleep();
  assert.equal(added>beforeAdd,true);assert.equal(draws,1);
  await remove(ref(writer,`${ROOT}/classes/room-a/students/initial-a`));
  await until(()=>!state.students['initial-a'],'removed student');await sleep();
  assert.ok(removed>0);assert.equal(draws,2);
  const beforeRepeat=added;sync.dispose();
  const afterDispose=await get(ref(teacher,`${ROOT}/classes/room-a/students`));
  await set(ref(writer,`${ROOT}/classes/room-a/students/another`),syntheticStudent('et-new',4));await sleep();
  assert.equal(added,beforeRepeat,'disposed listener stops counting events');assert.ok(afterDispose.exists());
});

test('ET and WT assigned student listeners stay confined to their class rosters',async t=>{
  const context=await makeContext(t);if(!context)return;
  const {writer,teacher}=context;
  await set(ref(writer,`${ROOT}/students`),{'et-only':syntheticStudent('et-only',0),'wt-only':syntheticStudent('wt-only',1)});
  const etState={students:{}},wtState={students:{}};let etEvents=0,wtEvents=0,etDraws=0,wtDraws=0;
  const etRefs={'et-only':instrumentRef(ref(teacher,`${ROOT}/students/et-only`),()=>etEvents++)};
  const wtRefs={'wt-only':instrumentRef(ref(teacher,`${ROOT}/students/wt-only`),()=>wtEvents++)};
  const etSync=bindStudentValues(etRefs,etState,()=>etDraws++),wtSync=bindStudentValues(wtRefs,wtState,()=>wtDraws++);
  await Promise.all([etSync.initial,wtSync.initial]);etSync.ready();wtSync.ready();
  assert.equal(etEvents,1);assert.equal(wtEvents,1,'each assigned student is read once at initial subscription');
  etEvents=0;wtEvents=0;
  await update(ref(writer,`${ROOT}/students/et-only`),{totalActiveSeconds:7200});
  await until(()=>etEvents>0,'ET student update');await sleep();
  assert.equal(wtEvents,0,'WT listener is not notified by an ET student update');
  assert.equal(etDraws,1,'ET progress updates the dashboard once');assert.equal(wtDraws,0);
  await remove(ref(writer,`${ROOT}/students/wt-only`));
  await until(()=>wtEvents>0&&!wtState.students['wt-only'],'WT student removal');
  await sleep();assert.equal(wtDraws,1,'WT removal updates the dashboard once');
  assert.ok(etState.students['et-only']);
  etSync.dispose();wtSync.dispose();
});

test('authorized sign-in starts one listener set; page refresh and RTDB reconnect stay single',async t=>{
  const context=await makeContext(t);if(!context)return;
  const {writer,teacher}=context;await set(ref(writer,`${ROOT}/classes/room-b/students`),{'student-1':syntheticStudent('et-1',1)});
  const state={students:{}};let attaches=0,draws=0,added=0;
  let sync=null;
  const authStateChanged=(user,authorized)=>{
    if(!user||!authorized||sync)return;
    attaches++;
    const target=instrumentRef(ref(teacher,`${ROOT}/classes/room-b/students`),(event,snap)=>{if(event==='child_added')added++;});
    sync=bindStudentEvents(target,state,()=>draws++);sync.ready();
  };
  authStateChanged(null,false);assert.equal(attaches,0);
  authStateChanged({uid:'synthetic-teacher'},true);authStateChanged({uid:'synthetic-teacher'},true);
  await until(()=>state.students['student-1'],'signed-in initial roster');await sleep();
  assert.equal(attaches,1);assert.equal(added,1);draws=0;
  goOffline(teacher);await sleep(60);goOnline(teacher);await sleep(400);
  assert.equal(attaches,1,'network recovery does not re-run sign-in attachment');
  assert.equal(added,1,'reconnection does not redownload the initial roster');
  assert.equal(draws,0,'reconnection does not redraw the dashboard without a data change');
  sync.dispose();

  // A browser refresh creates a new page runtime and one new listener set.
  // The previous runtime's cleanup must prevent overlap or a second listener
  // surviving in the same page instance.
  const refreshedState={students:{}};let refreshedAttaches=0,refreshedChildAdds=0,refreshedDraws=0;
  const refreshedAuthStateChanged=(user,authorized)=>{
    if(!user||!authorized||refreshedAttaches)return;
    refreshedAttaches++;
    const target=instrumentRef(ref(teacher,`${ROOT}/classes/room-b/students`),(event,snap)=>{if(event==='child_added')refreshedChildAdds++;});
    const pageSync=bindStudentEvents(target,refreshedState,()=>refreshedDraws++);pageSync.ready();
  };
  refreshedAuthStateChanged({uid:'synthetic-teacher'},true);
  await until(()=>refreshedState.students['student-1'],'refreshed page initial roster');await sleep();
  assert.equal(refreshedAttaches,1,'refresh creates one listener set in the new page runtime');
  assert.equal(refreshedChildAdds,1,'refresh downloads the current assigned roster once');
  assert.equal(refreshedDraws,1,'refresh renders the initial dashboard once');
});

