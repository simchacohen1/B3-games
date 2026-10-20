'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('class-pointer-prototype/activity-share.js','utf8');
// Exercise the real startup through its auth boundary, without a real student or database.
function fixture(){
 const values=new Map(),events=new Map();let tick,verified=0;
 const window={B3_FIREBASE_CONFIG:{},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name)=>events.delete(name)};
 const context={window,document:{currentScript:{src:'https://funtorahtools.com/class-pointer-prototype/activity-share.js'}},location:{href:'https://funtorahtools.com/',pathname:'/'},URL,
 sessionStorage:{getItem:k=>values.get(k)||null},setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{},
 firebase:{apps:[{}],database:()=>({})},fetch:async()=>{verified++;return{ok:false}},console};
 window.firebase=context.firebase;
 const task=vm.runInNewContext(source,context);
 return{values,events,task,tick:()=>tick(),verified:()=>verified};
}
test('a student who signs in after more than a minute still starts Pointer',async()=>{
 const f=fixture();
 for(let n=0;n<121;n++)f.tick();
 await Promise.resolve();await Promise.resolve();
 f.values.set('b3Games_studentId','temporary-test');f.values.set('b3Games_classPin','synthetic-only');
 f.events.get('fttStudentSignedIn')?.();f.tick();await f.task;
 assert.equal(f.verified(),1,'late sign-in must reach the existing server verification');
});
test('leaving the unsigned-in page removes its waiting sign-in listener',async()=>{
 const f=fixture();f.events.get('pagehide')?.();await f.task;
 assert.equal(f.events.has('fttStudentSignedIn'),false);
 assert.equal(f.verified(),0);
});
