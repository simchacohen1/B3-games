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
const fetchPending=new AsyncFunction(
 'requests','generation','request','scopeGeneration','approvalGeneration',
 'R','E','pendingEventFetches','window','teacherScope','teacherApi','console',
 source.slice(start,end)
);

function fixture(count=13){
 const requests=Array.from({length:count},(_,i)=>({practiceStudentId:'synthetic_student',eventId:'event_'+i}));
 const R={synthetic_student:{name:'Synthetic Student'}},E={},pendingEventFetches=new Map();
 const window={FunTorahTeacherScope:{
  validKey:value=>/^[A-Za-z0-9_-]+$/.test(String(value)),
  recordAllowed:(_scope,id,event)=>id==='synthetic_student'&&event.classId==='synthetic_class'
 }};
 return {requests,R,E,pendingEventFetches,window,teacherScope:{selected:'synthetic_class'}};
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
 await fetchPending(f.requests,0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console);
 assert.equal(calls.length,13,'every distinct pending recording loads');
 assert.equal(maxInFlight,4,'batch limit is four even with delayed responses');
 assert.equal(Object.keys(f.E.synthetic_student).length,13);
 await fetchPending(f.requests,0,1,0,1,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console);
 assert.equal(calls.length,13,'a queue refresh reuses loaded pending audio');
});

test('revoked or superseded scope generation starts no new pending recording requests',async()=>{
 const f=fixture(9);let calls=0;
 const teacherApi=async()=>{calls++;return {event:{classId:'synthetic_class'}}};
 await fetchPending(f.requests,1,0,2,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console);
 await fetchPending(f.requests,2,1,2,3,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console);
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
  fetchPending(f.requests,0,0,0,0,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console),
  fetchPending(f.requests,0,1,0,1,f.R,f.E,f.pendingEventFetches,f.window,f.teacherScope,teacherApi,console)
 ]);
 assert.equal(calls,13,'the same event is never fetched twice during overlapping refreshes');
 assert.equal(maxInFlight,4,'overlap does not double the simultaneous event load');
 assert.equal(f.pendingEventFetches.size,0,'settled requests leave no in-flight cache entries');
});
