'use strict';
// Deliberately RED fictional-data regressions for the principal browser access
// reader when the owner changes the PRINCIPAL invitation itself. Unlike the
// supervised teacher's invitation, this invitation is not checked by #486.
// This is client-only coverage: not a Firebase rules or live-access test.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const ROOT='b3Games/workspaces/b3-2026';
const PRINCIPAL_UID='fictional-principal';
const PRINCIPAL_EMAIL='principal@example.test';
const PRINCIPAL_INVITE='principal_invite';
const user={uid:PRINCIPAL_UID,email:PRINCIPAL_EMAIL,emailVerified:true,
  getIdToken:async()=> 'fictional'};

function fixture(principalInvite){
  const records={
    [ROOT+'/teachers/'+PRINCIPAL_UID]:{
      active:true,role:'teacher',accountType:'principal',
      email:PRINCIPAL_EMAIL,inviteId:PRINCIPAL_INVITE,
      classIds:{et:true,wt:true},
      supervisedTeachers:{teacherA:{classIds:{et:true,wt:true}}}
    },
    [ROOT+'/teacherInvites/teacherA']:{
      role:'teacher',active:true,classIds:{et:true,wt:true}
    }
  };
  if(principalInvite!==null)records[ROOT+'/teacherInvites/'+PRINCIPAL_INVITE]=principalInvite;
  const reads=[];
  const db={ref(path){return {once:async()=>{
    reads.push(path);
    return {val:()=>Object.prototype.hasOwnProperty.call(records,path)?records[path]:null};
  }};}};
  const firebase={apps:[{}],database:()=>db,auth:()=>({currentUser:user})};
  const window={firebase,B3_FIREBASE_CONFIG:Object.fromEntries(
    ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId']
      .map(key=>[key,'fictional']))};
  const document={readyState:'complete',addEventListener(){}};
  const source=fs.readFileSync('site-settings.js','utf8')
    .replace('  window.B3SiteSettings = {',
      '  window.readPrincipalAccessForTest = readUserAccess;\n  window.B3SiteSettings = {');
  assert.match(source,/window\.readPrincipalAccessForTest = readUserAccess/);
  vm.runInNewContext(source,{window,firebase,document,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    sessionStorage:{getItem:()=>null},
    console,Intl,Date,setTimeout,clearTimeout});
  return {read:()=>window.readPrincipalAccessForTest(user),reads};
}

function invite(overrides={}){
  return {active:true,accountType:'principal',email:PRINCIPAL_EMAIL,
    claimedUid:PRINCIPAL_UID,classIds:{et:true,wt:true},
    supervisedTeacherIds:{teacherA:true},...overrides};
}

test('CONTROL: currently assigned principal keeps both supervised classes',async()=>{
  const x=fixture(invite());
  const result=await x.read();
  assert.equal(result.authorized,true);
  assert.deepEqual(Array.from(result.classIds),['et','wt']);
});

test('RED: disabling principal own invitation denies cached client access',async()=>{
  const x=fixture(invite({active:false}));
  const result=await x.read();
  assert.equal(result.authorized,false,
    'owner revocation of principal invitation must deny without reconciliation');
});

test('RED: removing owner supervision assignment denies stale principal grant',async()=>{
  const x=fixture(invite({supervisedTeacherIds:{}}));
  const result=await x.read();
  assert.equal(result.authorized,false,
    'principal cannot keep teacherA solely through cached supervisedTeachers');
});

test('RED: principal invitation class removal narrows client class list',async()=>{
  const x=fixture(invite({classIds:{et:true}}));
  const result=await x.read();
  assert.equal(result.authorized,true);
  assert.deepEqual(Array.from(result.classIds),['et'],
    'principal own invitation must remain an upper bound for class grants');
});
