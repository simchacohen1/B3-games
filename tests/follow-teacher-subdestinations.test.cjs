'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../follow-teacher/core.js');
const now=1800000000000;
const state={workspaceId:'b3-2026',classId:'et',teacherUid:'teacher1',revision:'lesson1',mode:'locked',destination:'shorashim',subdestination:'review',targets:'all',issuedAt:now-1000,heartbeatAt:now-500,expiresAt:now+60000};
const context={workspaceId:'b3-2026',classId:'et',studentId:'boy1',studentAuthorized:true,allowedTools:{shorashim:true},currentUrl:'https://funtorahtools.com/shorashim/',now};
for(const classId of ['et','wt'])for(const section of Object.keys(C.SUBDESTINATIONS.shorashim)) {
  test(`${classId}: ${section} sends precisely once and locks the actual subsection`,()=>{
    const s={...state,classId,subdestination:section},c={...context,classId,currentSection:''};
    const destination='/shorashim/?section='+section;
    assert.equal(C.decide(s,c).destination,destination);
    assert.equal(C.decide(s,{...c,currentSection:section}).action,'stay');
    assert.equal(C.decide(s,{...c,currentUrl:destination,currentSection:'another-section'}).action,'navigate','query string cannot disguise another visible screen');
    const once=C.decide({...s,mode:'free'},c);
    assert.equal(once.destination,destination);
    assert.equal(C.decide({...s,mode:'free'},{...c,lastAppliedKey:once.applyKey}).action,'none');
    assert.equal(C.decide({...s,mode:'independent'},c).action,'none');
    assert.equal(C.decide(s,{...c,classId:classId==='et'?'wt':'et'}).reason,'wrong-class');
  });
}
test('subsections are optional, activity-scoped and never arbitrary routes',()=>{
  for(const subdestination of ['constructor','__proto__','../../admin','https://evil.test/',123,['review'],{section:'review'}]) {
    assert.throws(()=>C.propose({...state,subdestination}),/Subdestination/);
    assert.equal(C.decide({...state,subdestination},context).reason,'not-permitted');
  }
  assert.throws(()=>C.propose({...state,destination:'chazara'}),/Subdestination/);
  assert.equal(C.propose({...state,subdestination:null}).subdestination,undefined);
  assert.equal(C.propose(state).subdestination,'review');
});
test('presentation uses only the dedicated student viewer and the existing tool grant',()=>{
  const s={...state,destination:'class-pointer',subdestination:undefined};
  assert.equal(C.decide(s,{...context,allowedTools:{'class-pointer':true}}).destination,'/class-pointer-prototype/student-view.html');
  assert.equal(C.decide(s,context).reason,'not-permitted');
});
