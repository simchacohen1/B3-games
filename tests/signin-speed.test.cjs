'use strict';
// Regression tests for student sign-in speed and reliability.
// Security behavior (name + individual passcode, rate limits, blocked students)
// must be exactly as strict as before; only the amount of work changes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {studentAuth}=require('../backend/functions/student-auth-core.cjs');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');

// In-memory database that records every path that is read.
function db(tree){
 const parts=p=>p.split('/').filter(Boolean);
 const reads=[];
 const get=async p=>{reads.push(p);return parts(p).reduce((o,k)=>o?.[k],tree)??null;};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??={};if(v===null)delete o[last];else o[last]=structuredClone(v);};
 return {tree,reads,get,update:async u=>{for(const [p,v] of Object.entries(u))set(p,v);},tx:async(p,f)=>{const v=f(structuredClone(await get(p)));if(v!==undefined)set(p,v);}};
}
const seed=()=>db({
 b3Private:{passcodes:{moshe:{passcode:'1111'},dovid:{passcode:'3333'},off:{passcode:'2222'}}},
 b3Games:{students:{
  moshe:{profile:{name:'Moshe Levi',active:true},memberships:{'b3-2026_et':{active:true,workspaceId:'b3-2026',classId:'et'}}},
  dovid:{profile:{name:'Dovid',active:true}},
  off:{profile:{name:'Blocked Boy',active:false}}
 }},
 posukPractice:{allowedStudents:{}}
});
const login=(d,name,pin,studentId)=>studentAuth(d,{action:'login',name,pin,...(studentId?{studentId}:{})},'1.2.3.4',1000);
const wholeTreeReads=d=>d.reads.filter(p=>p==='b3Games/students'||p==='posukPractice/allowedStudents');

test('a returning browser checks only its own student, not every student',async()=>{
 const slow=seed();await login(slow,'Moshe Levi','1111');
 assert.ok(wholeTreeReads(slow).length>0,'without a hint the whole list is still read');
 const fast=seed();const r=await login(fast,'Moshe Levi','1111','moshe');
 assert.equal(r.id,'moshe');
 assert.equal(wholeTreeReads(fast).length,0,'the hinted check never downloads the whole student list');
});

test('a hint can never sign in someone else',async()=>{
 const d=seed();
 // Moshe's real name and passcode, but the browser claims to be Dovid.
 const r=await login(d,'Moshe Levi','1111','dovid');
 assert.equal(r.id,'moshe');
 // Dovid's hint with Moshe's passcode and Dovid's name must still fail.
 await assert.rejects(login(seed(),'Dovid','1111','dovid'),{code:401});
});

test('a wrong passcode with a hint is refused',async()=>{
 await assert.rejects(login(seed(),'Moshe Levi','0000','moshe'),{code:401});
});

test('a blocked student stays blocked even with a hint',async()=>{
 await assert.rejects(login(seed(),'Blocked Boy','2222','off'),{code:401});
});

test('an unknown or malformed hint falls back to the normal check',async()=>{
 assert.equal((await login(seed(),'Moshe Levi','1111','nobody')).id,'moshe');
 assert.equal((await login(seed(),'Moshe Levi','1111','../../b3Private')).id,'moshe');
});

test('the hint keeps the sign-in rate limit',async()=>{
 const d=seed();
 for(let i=0;i<40;i++)await login(d,'Moshe Levi','0000','moshe').catch(()=>{});
 await assert.rejects(login(d,'Moshe Levi','1111','moshe'),{code:429});
});

test('the hinted login result carries the same memberships the full check does',async()=>{
 const full=await login(seed(),'Moshe Levi','1111');
 const hinted=await login(seed(),'Moshe Levi','1111','moshe');
 assert.deepEqual(hinted,full);
 assert.equal(hinted.classId,'et');
});

// ---- homepage -------------------------------------------------------------
const home=read('index.html');
const block=(start,end)=>home.slice(home.indexOf(start),home.indexOf(end,home.indexOf(start)));

test('returning-student restore makes one server call, not verify then login twice',()=>{
 const restore=block('  async function restoreStudent(){','  async function switchStudent(');
 assert.doesNotMatch(restore,/action:"verify"/);
 assert.match(restore,/earlyLogin=actingStudent\?null:studentAuthCall\(\{action:"login"/,'the login starts together with the profile read');
 assert.ok(restore.indexOf('earlyLogin=')<restore.indexOf('.once("value")'),'login is started before waiting for the profile');
 assert.match(restore,/customToken:identity\.classId===restoredClassId/);
});

test('the homepage wakes the sign-in server while the student types',()=>{
 assert.match(home,/fetch\(STUDENT_AUTH_URL,\{method:"GET"/);
});

test('Switch Student runs to the end and returns to the sign-in form',async()=>{
 const body=block('  async function switchStudent(','  function timeParts(');
 const saved=new Map([['b3Games_studentId','s1'],['b3Games_studentName','Student One'],['b3Games_studentClass','et'],['b3Games_classPin','synthetic'],['posukPractice_studentId','s1']]);
 const calls=[];
 const node=()=>({value:'synthetic',textContent:'',classList:{add(){},remove(){}}});
 const context=vm.createContext({
  isAuthorizedTeacher:false,studentAccessRevoked:false,myStudentId:'s1',myStudentName:'Student One',myClassId:'et',
  studentClassWatch:{off:()=>calls.push('class-off')},studentProfileWatch:{off:()=>calls.push('profile-off')},studentMembershipWatch:{off:()=>calls.push('membership-off')},
  sessionStorage:{removeItem:k=>saved.delete(k)},window:{FTTFollowStudent:{stop:()=>calls.push('follow-stop')}},
  el:node,setLoginMsg:m=>calls.push('msg:'+m),showLogin:()=>calls.push('showLogin'),
  settingsApi:{endStudentSession:async()=>calls.push('end-session')},console
 });
 // Any call to a function that does not exist (the old resetPinForm bug) throws here.
 vm.runInContext(body+';this.run=switchStudent;',context);
 await context.run();
 assert.ok(calls.includes('showLogin'));
 assert.ok(calls.includes('end-session'));
 assert.equal(saved.size,0,'every saved student value is cleared');
 assert.equal(context.studentAccessRevoked,false);
 assert.equal(context.myStudentId,'');
});

// ---- shared gate ----------------------------------------------------------
const gate=read('game-gate.js');
test('the gate reads public settings and the permission script alongside the class reads',()=>{
 const check=gate.slice(gate.indexOf('function checkNow()'));
 assert.match(check,/settingsRead = fetchJson\(settingsUrl, true\)/);
 assert.match(check,/var policyReady = /);
 assert.doesNotMatch(check,/if\(!window\.B3StudentTools\)await loadOneScript/);
});

test('student reads wait only for Firebase sign-in, not the teacher helper script',()=>{
 const watch=gate.slice(gate.indexOf('async function watchTeacherAccess'),gate.indexOf('function getStoredStudentId'));
 assert.ok(watch.indexOf('markAuthReady();')<watch.indexOf('await settingsScript'),'auth is released before site-settings.js finishes');
 assert.match(watch,/Promise\.all\(missing\.map/);
});

test('the gate does not repeat every request when a student has no teacher account',()=>{
 assert.match(gate,/if\(!authorized&&!wasTeacher\)\{[\s\S]{0,200}return;/);
});

test('the class reads for the remembered class start with the profile reads',()=>{
 const resolve=gate.slice(gate.indexOf('async function resolveStudentClass'),gate.indexOf('function timeToMinutes'));
 assert.ok(resolve.indexOf('guessedFields=guess?readClassFields(guess)')<resolve.indexOf('var rows=await Promise.all'));
 assert.match(resolve,/guessedFields&&studentClassId===guess/,'guessed reads are used only when the memberships confirm that class');
});

// ---- first visit / private window -----------------------------------------
function pages(dir=root,out=[]){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(/^(node_modules|\.git|_worktrees|staging-build|playwright-testing|backup-|preview-)/.test(e.name))continue;
  const p=path.join(dir,e.name);
  if(e.isDirectory())pages(p,out);else if(e.name.endsWith('.html'))out.push(p);
 }
 return out;
}
test('no page creates an empty Firebase sign-in database (stops sign-in on a first visit)',()=>{
 let checked=0;
 for(const file of pages()){
  const s=fs.readFileSync(file,'utf8');
  if(!s.includes("indexedDB.open('firebaseLocalStorageDb'"))continue;
  checked++;
  assert.match(s,/idbReq\.onupgradeneeded\s*=\s*function\(e\)\s*\{\s*try\s*\{\s*e\.target\.transaction\.abort\(\);/,path.relative(root,file)+' must cancel instead of creating the database');
 }
 assert.ok(checked>20,'the check actually found the pages');
});

test('every page that uses the gate loads the new gate file version',()=>{
 for(const file of pages()){
  const s=fs.readFileSync(file,'utf8');
  const m=s.match(/game-gate\.js\?v=([A-Za-z0-9._-]+)/);
  if(m&&m[1].startsWith('20261021-'))assert.equal(m[1],'20261021-signin-speed1',path.relative(root,file));
 }
});
