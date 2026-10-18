'use strict';
// Regression checks for issues found in live Classroom Pointer testing (October 2026).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const ROOM='class-pointer-12345678-1234-1234-1234-123456789abc';

test('students are told "removed" only after a deliberate removal or a lost class membership',()=>{
  const classroom=read('class-pointer-prototype/classroom.js');
  const sends=classroom.match(/\{type:'removed'\}/g)||[];
  // 1) blocked rejoin of a removed student, 2) blocked background connection, 3-4) the deliberate removal
  // (lesson page and background connections), 5) the server says he is no longer in the class.
  assert.equal(sends.length,5);
  // A second tab or a reconnect of the same student is a quiet replacement, never a removal.
  assert.match(classroom,/send\(duplicate\.connection,\{type:'replaced'\}\)/);
  assert.doesNotMatch(classroom,/send\(duplicate\.connection,\{type:'removed'\}\)/);
  // Every Remove button goes through the deliberate path, which remembers the removal.
  assert.match(classroom,/remove\.addEventListener\('click',\(\)=>removeStudentDeliberately\(member\)\)/);
  assert.match(classroom,/remove\(id\)\{const m=members\.get\(id\)\|\|presence\.get\(id\);if\(!m\)return;removeStudentDeliberately\(m\)\}/);
  assert.match(classroom,/if\(verifiedId&&removedStudents\.has\(verifiedId\)\)\{send\(connection,\{type:'removed'\}\)/);
});

test('students from Fun Torah Tools never see a Join button and reconnect on their own',()=>{
  const classroom=read('class-pointer-prototype/classroom.js');
  assert.match(classroom,/const autoJoin=!isTeacher&&entry==='student';/);
  assert.match(classroom,/if\(autoJoin\)\{\$\('joinForm'\)\.hidden=true;\$\('leaveClass'\)\.hidden=true\}/);
  assert.match(classroom,/\$\('joinForm'\)\.hidden=autoJoin;/);
  // Unexpected closes reconnect; only "removed" stops reconnecting with the removal message.
  assert.match(classroom,/connection\.on\('close',\(\)=>\{if\(teacherConnection===connection\)\{if\(autoJoin\)\{scheduleReconnect\(\);return\}/);
  assert.match(classroom,/if\(message\.type==='removed'\)\{stopReconnecting=true;/);
  assert.match(classroom,/if\(kind==='peer-unavailable'\)\{goWaiting\(/);
});

test('the waiting page does not send a removed student back into the same lesson',async()=>{
  let listener,redirect;const nodes=new Map(),element=id=>{if(!nodes.has(id))nodes.set(id,{textContent:''});return nodes.get(id)};
  const store=new Map([['b3Games_studentId','pt1'],['b3Games_classPin','synthetic'],['classPointerRemovedRoom',ROOM]]);
  const row={name:'Pointer Test',active:true,toolGrants:{'class-pointer':true},members:{pt1:{active:true}}};
  const db={ref:p=>({child:k=>db.ref(p+'/'+k),once:async()=>({val:()=>p.endsWith('/profile')?{name:'Pointer Test Student One'}:row}),on:(_e,cb)=>{listener=cb}})};
  const context=vm.createContext({window:{B3_APP_CONTEXT:{workspaceId:'b3-2026'},FunTorahStudentClass:{resolve:async()=>({workspaceId:'b3-2026',classId:'pointer_test'})}},firebase:{apps:[{}],database:()=>db},
    document:{getElementById:element},location:{href:'https://example.test/dashboard.html',replace:v=>redirect=v},URL,AbortSignal,
    sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},fetch:async()=>({ok:true,json:async()=>({ok:true})})});
  vm.runInContext(read('class-pointer-prototype/dashboard-core.js'),context);
  await vm.runInContext(read('class-pointer-prototype/dashboard.js'),context);
  listener({val:()=>({[ROOM]:{roomId:ROOM,createdAt:Date.now()}})});
  assert.equal(redirect,undefined);
  assert.match(element('message').textContent,/removed you/);
  // A new lesson (different room) is joined normally.
  const next=ROOM.replace('abc','abd');
  listener({val:()=>({[next]:{roomId:next,createdAt:Date.now()}})});
  assert.match(redirect,/dashboard=student&room=/);
});

test('class membership recheck covers every connected student (server checks 16 per request)',async()=>{
  const calls=[];let tick;
  const sandbox={window:undefined,location:{search:'?dashboard=teacher&class=pointer_test'},sessionStorage:{getItem:()=>''},
    document:{getElementById:id=>id==='joinLink'?{value:'https://x.test/classroom.html?room='+ROOM}:{disabled:false}},
    firebase:{auth:()=>({currentUser:{getIdToken:async()=>'tok'}})},
    fetch:async(_u,o)=>{const body=JSON.parse(o.body);calls.push(body);return{ok:true,json:async()=>({ok:true,allowed:body.studentIds})}},
    URL,URLSearchParams,setInterval:fn=>{tick=fn;return 1},clearInterval:()=>{},console};
  sandbox.window=sandbox;sandbox.globalThis=sandbox;
  vm.runInNewContext(read('class-pointer-prototype/join-auth.js'),sandbox);
  const members=Array.from({length:20},(_,i)=>({studentId:'s'+i}));members.push({studentId:'s3'}); // second tab of s3
  const revoked=[];sandbox.ClassPointerJoinGate.watch(()=>members,m=>revoked.push(m.studentId));
  await tick();
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>c.studentIds.length),[16,4]);
  assert.deepEqual(revoked,[]);
});

test('teacher changes are refused under a different signed-in account',()=>{
  const session=read('class-pointer-prototype/dashboard-session.js');
  const guards=session.match(/if\(!firebase\.auth\(\)\.currentUser\|\|firebase\.auth\(\)\.currentUser\.uid!==context\.user\.uid\)\{teacherSessionChanged\(\);throw Error\(SIGNIN_CHANGED\)\}/g)||[];
  assert.equal(guards.length,5);
  assert.match(session,/Sign in again as teacher/);
});
