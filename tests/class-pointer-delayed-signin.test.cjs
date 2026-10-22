'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('class-pointer-prototype/activity-share.js','utf8');
// Exercise the real startup through its auth boundary, without a real student or database.
function fixture({ready}={}){
 const values=new Map(),events=new Map();let tick,verified=0;
 const window={B3GameGateAuthReady:ready,B3_FIREBASE_CONFIG:{},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name)=>events.delete(name)};
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

test('Pointer waits for the access gate to initialize Firebase before verification',async()=>{
 let release;const ready=new Promise(resolve=>{release=resolve});const f=fixture({ready});
 f.values.set('b3Games_studentId','temporary-test');f.values.set('b3Games_classPin','synthetic-only');
 f.events.get('fttStudentSignedIn')();await Promise.resolve();await Promise.resolve();
 assert.equal(f.verified(),0);release();await f.task;assert.equal(f.verified(),1);
});

test('access gate creates the default Firebase app before asking Auth to restore',async()=>{
 const gate=fs.readFileSync('game-gate.js','utf8');
 const code=gate.slice(gate.indexOf('  async function watchTeacherAccess()'),gate.indexOf('  function getStoredStudentId()'));
 const order=[],firebase={apps:[],initializeApp(){order.push('initialize');this.apps.push({})},auth(){assert.equal(this.apps.length,1);order.push('auth');return{}},database(){}};
 const context=vm.createContext({window:{firebase,B3_FIREBASE_CONFIG:{},B3SiteSettings:{onAuthStateChanged(){}}},document:{readyState:'complete'},teacherWatchStarted:false,
  clearTimeout(){},setTimeout(){return 1},
  loadAuthScript:async()=>{},waitForFirebaseAuthState:async()=>{},boundedAccess:async p=>p,showClosed(){},markAuthReady:()=>order.push('ready'),console,checkNow(){}});
 vm.runInContext(code,context);await context.watchTeacherAccess();
 assert.deepEqual(order.slice(0,3),['initialize','auth','ready']);
 assert.ok(order.slice(3).every(step=>step==='ready'));
});


test('closing an activity pauses its media without freezing the independent teacher lesson',()=>{
 const gate=fs.readFileSync('game-gate.js','utf8');
 const code=gate.slice(gate.indexOf('  function showClosed('),gate.indexOf('  function showClosed(')+gate.slice(gate.indexOf('  function showClosed(')).indexOf('    markFirstDecision();'))+'}';
 const paused=[];
 const media=(id,lesson)=>({closest:selector=>selector==='#fttTeacherLessonOverlay'&&lesson,pause:()=>paused.push(id)});
 const context=vm.createContext({document:{querySelectorAll:()=>[media('activity-video',false),media('teacher-video',true),media('activity-audio',false)]}});
 vm.runInContext(code,context);context.showClosed('locked','locked');
 assert.deepEqual(paused,['activity-video','activity-audio']);
});
