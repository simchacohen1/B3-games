'use strict';
// Exercise the actual inline pending-audio fetch loop, with delayed synthetic
// responses. No Firebase network, live students or credentials are involved.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('chazara/teacher.html','utf8');
const start=source.indexOf('  // Keep pending audio requests bounded,');
const end=source.indexOf('  if(generation!==scopeGeneration||request!==approvalGeneration)return;\n  renderApprovals();renderRecordings();',start);
assert.ok(start>=0&&end>start,'pending-audio loop must remain identifiable for the regression');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const permitStart=source.indexOf(' let pendingEventActive=0,pendingEventWaiters=[];');
const permitEnd=source.indexOf('function cls(',permitStart);
assert.ok(permitStart>=0&&permitEnd>permitStart);
const makePermit=new Function(source.slice(permitStart,permitEnd)+';return withPendingEventSlot;');
const keyStart=source.indexOf('function recordingKey(e)'),keyEnd=source.indexOf('\n',keyStart);
const recordingKey=new Function(source.slice(keyStart,keyEnd)+';return recordingKey;')();
const fetchPending=new AsyncFunction(
 'requests','generation','request','scopeGeneration','approvalGeneration',
 'R','E','pendingEventFetches','window','teacherScope','teacherApi','console','withPendingEventSlot','pendingRecordingKeys',
 source.slice(start,end)
);

function fixture(count=13){
 const requests=Array.from({length:count},(_,i)=>({practiceStudentId:'synthetic_student',eventId:'event_'+i}));
 const R={synthetic_student:{name:'Synthetic Student'}},E={},pendingEventFetches=new Map();
 const window={FunTorahTeacherScope:{
  validKey:value=>/^[A-Za-z0-9_-]+$/.test(String(value)),
  recordAllowed:(_scope,id,event)=>id==='synthetic_student'&&event.classId==='synthetic_class'
 }};
 return {requests,R,E,pendingEventFetches,window,teacherScope:{selected:'synthetic_class'},withPendingEventSlot:makePermit(),pendingRecordingKeys:new Set(requests.map(x=>JSON.stringify([x.practiceStudentId,x.eventId])))};
}

test('pending recording fetches never exceed four concurrent requests and are cached on refresh',async()=>{
 const f=fixture(),calls=[];let inFlight=0,maxInFlight=0;
 const teacherApi=async(action,{studentId,eventId})=>{
  assert.equal(action,'get-chazara-event');
  assert.equal(studentId,'synthetic_student');
  calls.push(eventId);inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  await new Promise(resolve=>setTimeout(resolve,8));
  inFlight--;
  return {event:{recorded:true,reviewApplied:true,classId:'synthetic_class'}};
 };
 await fetchPending(f.requests,0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console,f.withPendingEventSlot,f.pendingRecordingKeys);
 assert.equal(calls.length,13,'every distinct pending recording loads');
 assert.equal(maxInFlight,4,'batch limit is four even with delayed responses');
 assert.equal(Object.keys(f.E.synthetic_student).length,13);
 await fetchPending(f.requests,0,1,0,1,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console,f.withPendingEventSlot,f.pendingRecordingKeys);
 assert.equal(calls.length,13,'a queue refresh reuses loaded pending audio');
});

test('revoked or superseded scope generation starts no new pending recording requests',async()=>{
 const f=fixture(9);let calls=0;
 const teacherApi=async()=>{calls++;return {event:{classId:'synthetic_class'}}};
 await fetchPending(f.requests,1,0,2,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console,f.withPendingEventSlot,f.pendingRecordingKeys);
 await fetchPending(f.requests,2,1,2,3,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console,f.withPendingEventSlot,f.pendingRecordingKeys);
 assert.equal(calls,0,'stale scope or approval generation must not launch audio reads');
});


test('overlapping refreshes share in-flight pending recording requests',async()=>{
 const f=fixture(13);let calls=0,inFlight=0,maxInFlight=0;
 const teacherApi=async()=>{
  calls++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
  await new Promise(resolve=>setTimeout(resolve,10));
  inFlight--;
  return {event:{recorded:true,reviewApplied:true,classId:'synthetic_class'}};
 };
 await Promise.all([
  fetchPending(f.requests,0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console,f.withPendingEventSlot,f.pendingRecordingKeys),
  fetchPending(f.requests,0,1,0,1,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console,f.withPendingEventSlot,f.pendingRecordingKeys)
 ]);
 assert.equal(calls,13,'the same event is never fetched twice during overlapping refreshes');
 assert.equal(maxInFlight,4,'overlap does not double the simultaneous event load');
 assert.equal(f.pendingEventFetches.size,0,'settled requests leave no in-flight cache entries');
});

test('disjoint overlapping refreshes share one global four-request budget',async()=>{
 const f=fixture(16);let active=0,max=0,calls=0;
 const api=async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,12));active--;return {event:{classId:'synthetic_class',recorded:true,reviewApplied:true}}};
 await Promise.all([
  fetchPending(f.requests.slice(0,8),0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,api,console,f.withPendingEventSlot,f.pendingRecordingKeys),
  fetchPending(f.requests.slice(8),0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,api,console,f.withPendingEventSlot,f.pendingRecordingKeys)
 ]);
 assert.equal(calls,16);assert.equal(max,4);assert.equal(f.pendingEventFetches.size,0);
});
test('student and event IDs with double underscores cannot alias',async()=>{
 const f=fixture(0);f.R={'a__b':{},a:{}};
 f.requests=[{practiceStudentId:'a__b',eventId:'c'},{practiceStudentId:'a',eventId:'b__c'}];
 f.pendingRecordingKeys=new Set(f.requests.map(x=>JSON.stringify([x.practiceStudentId,x.eventId])));
 f.window.FunTorahTeacherScope.recordAllowed=(_s,id,e)=>e.classId==='synthetic_class'&&(id==='a'||id==='a__b');
 assert.notEqual(recordingKey({studentId:'a__b',id:'c'}),recordingKey({studentId:'a',id:'b__c'}));
 let calls=0;const api=async()=>{calls++;return {event:{classId:'synthetic_class',recorded:true,reviewApplied:true}}};
 await fetchPending(f.requests,0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,api,console,f.withPendingEventSlot,f.pendingRecordingKeys);
 assert.equal(calls,2);assert.ok(f.E['a__b'].c);assert.ok(f.E.a['b__c']);
});
test('removed pending events do not start after waiting for a permit',async()=>{
 const f=fixture(8);let calls=0;
 const api=async()=>{calls++;await new Promise(r=>setTimeout(r,12));return {event:{classId:'synthetic_class'}}};
 const task=fetchPending(f.requests,0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,api,console,f.withPendingEventSlot,f.pendingRecordingKeys);
 await new Promise(r=>setTimeout(r,2));
 f.pendingRecordingKeys.clear();for(const x of f.requests.slice(0,4))f.pendingRecordingKeys.add(JSON.stringify([x.practiceStudentId,x.eventId]));
 await task;assert.equal(calls,4);
});
