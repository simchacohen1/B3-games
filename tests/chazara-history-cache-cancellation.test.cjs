'use strict';
// Synthetic regression tests for the real Chazara teacher lazy-history loader.
// Fictional data only; no browser, Firebase connection, or live student records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('chazara/teacher.html', 'utf8');
const start = html.indexOf('async function loadRecordingHistory(){');
const end = html.indexOf('function eventForRequest(', start);
assert.ok(start >= 0 && end > start, 'Expected actual lazy-history loader and filter handler');
const loader = html.slice(start, end);

function fixture({studentIds=['fictional_a'], selected='', review='checked', api}={}) {
  const state = {
    selected, review, api:api || (async id=>({
      events:{
        ['own_'+id]:{workspaceClassId:'alpha',perek:18,posuk:1},
        ['foreign_'+id]:{workspaceClassId:'beta',perek:18,posuk:2}
      }
    })),
    roster:Object.fromEntries(studentIds.map(id=>[id,{name:id}])),
    calls:[], active:0, peak:0, renders:0, refreshes:0, warnings:[], errors:[]
  };
  const source = [
    'let scopeGeneration=0,historyGeneration=0,historyLoading=false;',
    'let historyStudentsLoaded=new Set();',
    'let E={}; const R=state.roster, teacherScope={classId:"alpha"};',
    'const fullDashboardLoaded=false;',
    'const window={FunTorahTeacherScope:{recordAllowed:(_scope,_id,event)=>event.workspaceClassId==="alpha"}};',
    'const $=id=>id==="recordingStudentFilter"?{value:state.selected}:{innerHTML:""};',
    'const recordingFilters=()=>({review:state.review});',
    'const renderRecordings=()=>{state.renders++};',
    'const refreshScopedViews=()=>{state.refreshes++};',
    'const setRecordingActionStatus=(message,isError)=>{state.errors.push({message,isError})};',
    'const console={warn:(...args)=>{state.warnings.push(args.map(String).join(" "))}};',
    'const teacherApi=async(action,{studentId})=>{',
    '  if(action!=="list-chazara-history")throw Error("Unexpected action "+action);',
    '  state.calls.push(studentId); state.active++; state.peak=Math.max(state.peak,state.active);',
    '  try{return await state.api(studentId)}finally{state.active--}',
    '};',
    loader,
    'return {loadRecordingHistory,recordingFilterChanged,',
    '  events:()=>E,loaded:()=>[...historyStudentsLoaded],',
    '  loading:()=>historyLoading,changeScope:()=>{scopeGeneration++}};'
  ].join('\n');
  return {state,...new Function('state',source)(state)};
}

test('selected student loads once; subsequent filters reuse cache; all-student history batches at four', async()=>{
  const ids=Array.from({length:6},(_,i)=>'fictional_'+i);
  const x=fixture({studentIds:ids,selected:'fictional_2'});
  await x.loadRecordingHistory();
  assert.deepEqual(x.state.calls,['fictional_2'],'a student filter must not download other students');
  assert.deepEqual(Object.keys(x.events().fictional_2),['own_fictional_2'],
    'only selected-class events are retained');
  x.state.review='needs';
  await x.loadRecordingHistory();
  assert.deepEqual(x.state.calls,['fictional_2'],'switching review filter reuses cached history');
  x.state.selected='';
  await x.loadRecordingHistory();
  assert.deepEqual([...x.state.calls].sort(),[...ids].sort(),'all students loaded exactly once');
  assert.equal(x.state.peak,4,'historical API requests are limited to four at once');
  assert.deepEqual(x.loaded().sort(),[...ids].sort());
  await x.loadRecordingHistory();
  assert.equal(x.state.calls.length,6,'repeat history view does not refetch cached students');
  assert.equal(x.loading(),false);
});

test('returning to pending cancels in-flight history and allows a later clean reload',async()=>{
  let resolveFirst,attempt=0;
  const x=fixture({api:async()=>{
    attempt++;
    if(attempt===1)return new Promise(resolve=>{resolveFirst=resolve});
    return {events:{own:{workspaceClassId:'alpha'},foreign:{workspaceClassId:'beta'}}};
  }});
  const first=x.loadRecordingHistory();
  assert.equal(x.state.calls.length,1);
  assert.equal(x.loading(),true);
  x.state.review='pending';
  x.recordingFilterChanged();
  assert.equal(x.loading(),false,'pending view must not wait for history');
  resolveFirst({events:{stale:{workspaceClassId:'alpha'}}});
  await first;
  assert.deepEqual(x.events(),{},'stale history must not enter the current view');
  assert.deepEqual(x.loaded(),[],'cancelled history must not poison the cache');
  x.state.review='checked';
  await x.loadRecordingHistory();
  assert.deepEqual(x.state.calls,['fictional_a','fictional_a']);
  assert.deepEqual(Object.keys(x.events().fictional_a),['own']);
});

test('failed history request is not cached and succeeds on retry',async()=>{
  let count=0;
  const x=fixture({api:async()=>{
    if(++count===1)throw Error('Synthetic transient failure');
    return {events:{recovered:{workspaceClassId:'alpha'}}};
  }});
  await x.loadRecordingHistory();
  assert.deepEqual(x.loaded(),[],'failed student must remain eligible for retry');
  assert.equal(x.state.errors.length,1,'failure is surfaced to the teacher');
  await x.loadRecordingHistory();
  assert.deepEqual(x.loaded(),['fictional_a']);
  assert.deepEqual(Object.keys(x.events().fictional_a),['recovered']);
  assert.equal(x.state.calls.length,2);
});
