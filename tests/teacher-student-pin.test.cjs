'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');

function fixture({teacher=false,profile={name:'Synthetic Student',active:true},pin='synthetic-pin',verifyError=null}={}){
  const start=html.indexOf('  async function restoreStudent(){');
  const end=html.indexOf('  async function switchStudent(',start);
  const saved=new Map([['b3Games_studentId','synthetic_student'],['b3Games_studentName','Synthetic Student'],['b3Games_studentClass','alpha'],['b3Games_classPin',pin]]);
  const calls=[],entered=[],messages=[];let reads=0,loginShown=0;
  const ctx={settingsApi:{getActingStudent:()=>null},actingStudentRestoreInFlight:false,studentAccessRevoked:false,
    isAuthorizedTeacher:teacher,isStudentPreview:false,isGuest:()=>false,previewStudentId:'',
    sessionStorage:{getItem:key=>saved.get(key)||null,removeItem:key=>saved.delete(key)},
    db:{ref:path=>({once:async()=>{reads++;return{exists:()=>!!profile,val:()=>profile};}})},
    studentAuthCall:async body=>{calls.push(body);if(body.action==='verify'&&verifyError)throw verifyError;if(body.action==='login')return{ok:true,id:'synthetic_student',name:'Synthetic Student',classId:'alpha',classChoices:[{id:'alpha',name:'Alpha'}]};return{ok:true};},
    studentClassChoices:[],resolvedStudentClass:async()=>'',enterStudent:async identity=>entered.push(identity),
    showChecking(){},showLogin(){loginShown++;},setLoginMsg:message=>messages.push(message),
    el:id=>({value:''}),console
  };
  vm.runInNewContext(html.slice(start,end)+';this.restore=restoreStudent;',ctx);
  return{run:()=>ctx.restore(),saved,calls,entered,messages,get reads(){return reads;},get loginShown(){return loginShown;}};
}

test('saved student session is verified server-side and restored into its active class',async()=>{
  const f=fixture();await f.run();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[
    {action:'verify',studentId:'synthetic_student',pin:'synthetic-pin'},
    {action:'login',name:'Synthetic Student',pin:'synthetic-pin'}
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.entered)),[{id:'synthetic_student',name:'Synthetic Student',classId:'alpha'}]);
  assert.equal(f.saved.get('b3Games_classPin'),'synthetic-pin');
});

test('expired saved passcode is cleared and never restores student access',async()=>{
  const f=fixture({verifyError:{status:401}});await f.run();
  assert.equal(f.saved.has('b3Games_classPin'),false);
  assert.equal(f.entered.length,0);
  assert.equal(f.loginShown,1);
  assert.match(f.messages.at(-1),/sign in once more/i);
});

test('blocked student profile is refused before class access is restored',async()=>{
  const f=fixture({profile:{name:'Synthetic Student',active:false}});await f.run();
  assert.equal(f.entered.length,0);
  assert.equal(f.loginShown,1);
});

test('authorized teacher session does not restore an acting student from browser flags',async()=>{
  const f=fixture({teacher:true});await f.run();
  assert.equal(f.reads,0);
  assert.equal(f.calls.length,0);
  assert.equal(f.entered.length,0);
});
