'use strict';
// Phase 1 sign-in speed: the gate must reach a decision in fewer network
// round trips WITHOUT trusting anything that was not freshly verified.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const DELAY=40;
function gate(data,stored={}){
  const storage=new Map(Object.entries({b3Games_studentId:'child',b3Games_studentClass:'',...stored}));
  const fetched=[];
  function element(){return {style:{},dataset:{},parentNode:{removeChild(){}},appendChild(){},setAttribute(){},contains(){return false},querySelector(){return {textContent:''}},remove(){},set innerHTML(v){this.html=v}}}
  const document={currentScript:{src:'https://example.test/game-gate.js',getAttribute:k=>k==='data-game-id'?'yiddish':null},head:element(),documentElement:element(),body:element(),scripts:[],readyState:'complete',createElement:element,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  const firebase={auth:()=>({currentUser:{getIdToken:async()=>'t'}})};
  const read=url=>{const p=new URL(url).pathname;return Object.prototype.hasOwnProperty.call(data,p)?data[p]:null;};
  const ctx={document,window:{firebase,B3StudentTools:require('../backend/functions/student-tool-policy.js'),addEventListener(){}},firebase,location:{search:'',href:'https://example.test/'},
    sessionStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    URL,URLSearchParams,Intl,Date,console,AbortController,setTimeout,clearTimeout,setInterval(){},
    fetch:async url=>{fetched.push(new URL(url).pathname);await new Promise(r=>setTimeout(r,DELAY));return{ok:true,json:async()=>read(url)};}};
  let source=fs.readFileSync('game-gate.js','utf8').replace(/\r\n/g,'\n');
  source=source.replace(/  (?:if \(!isGuestPreview\(\)\) )?watchTeacherAccess\(\);\s*checkNow\(\);/,
    '  markAuthReady(); window.testGate={resolveStudentClass,state:()=>({studentClassId,studentActive,assignedClass})};');
  vm.runInNewContext(source,ctx);
  return {g:ctx.window.testGate,storage,fetched};
}
const W='/b3Games/workspaces/b3-2026/classes/';
function db(classId,{member=true}={}){
  return {
    '/b3Games/students/child/profile.json':{active:true},
    '/b3Games/students/child/memberships.json':{m:{workspaceId:'b3-2026',classId,active:true}},
    [W+classId+'/active.json']:true,[W+classId+'/toolGrants.json']:{yiddish:true},
    [W+classId+'/members/child.json']:member?{active:true}:null,
    [W+'old_class/active.json']:true,[W+'old_class/toolGrants.json']:{yiddish:true,secret:true},
    [W+'old_class/members/child.json']:{active:true}
  };
}

test('first visit verifies membership, then remembers the verified class',async()=>{
  const {g,storage}=gate(db('new_class'));
  await g.resolveStudentClass();
  assert.equal(g.state().studentActive,true);
  assert.equal(storage.get('b3Games_gateVerifiedClass_child'),'new_class');
});

test('remembered class is read in parallel: one round trip instead of two',async()=>{
  const cold=gate(db('new_class'));
  let t=Date.now();await cold.g.resolveStudentClass();const coldMs=Date.now()-t;
  const warm=gate(db('new_class'),{b3Games_gateVerifiedClass_child:'new_class'});
  t=Date.now();await warm.g.resolveStudentClass();const warmMs=Date.now()-t;
  assert.equal(warm.g.state().studentActive,true);
  assert.ok(coldMs>=DELAY*2-5,`cold path should take two rounds (${coldMs}ms)`);
  assert.ok(warmMs<DELAY*2-5,`warm path should take one round (${warmMs}ms vs cold ${coldMs}ms)`);
  // Profile and membership are still freshly read every time.
  assert.ok(warm.fetched.includes('/b3Games/students/child/memberships.json'));
  assert.ok(warm.fetched.includes('/b3Games/students/child/profile.json'));
});

test('a stale remembered class is never trusted when the student moved classes',async()=>{
  const {g,storage}=gate(db('new_class'),{b3Games_gateVerifiedClass_child:'old_class'});
  await g.resolveStudentClass();
  const s=g.state();
  assert.equal(s.studentClassId,'new_class');
  assert.equal(s.assignedClass.toolGrants.secret,undefined,'old class grants must be discarded');
  assert.equal(storage.get('b3Games_gateVerifiedClass_child'),'new_class');
});

test('removal from the class closes access and forgets the remembered class',async()=>{
  const {g,storage}=gate(db('new_class',{member:false}),{b3Games_gateVerifiedClass_child:'new_class'});
  await g.resolveStudentClass();
  assert.equal(g.state().studentActive,false);
  assert.equal(storage.has('b3Games_gateVerifiedClass_child'),false);
});

test('blocked profile is enforced even with a remembered class',async()=>{
  const data=db('new_class');data['/b3Games/students/child/profile.json']={active:false};
  const {g}=gate(data,{b3Games_gateVerifiedClass_child:'new_class'});
  await g.resolveStudentClass();
  assert.equal(g.state().studentActive,false);
});

test('gate startup downloads independent scripts together and starts settings with access reads',()=>{
  const src=fs.readFileSync('game-gate.js','utf8');
  assert.match(src,/await Promise\.all\(\[\s*window\.firebase\.auth \? null/);
  assert.match(src,/var done=await Promise\.all\(\[settingsReady,policyReady,accessReady\]\)/);
  assert.doesNotMatch(src,/active:await fetchJson\(teacherClassPath/,'teacher class reads must not run one at a time');
});
