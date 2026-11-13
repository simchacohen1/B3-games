'use strict';
// Issue #801, checked against a REAL Firebase Realtime Database (the local emulator) with the real
// Firebase client and the real teacher script: a dropped teacher connection must leave the lesson
// record in place with only an offline time, and coming back must clear it and arm it again.
// Runs under both rule sets in this repository: the live rules and the hardened candidate.
//
//   firebase emulators:exec --only database --project demo-class-pointer \
//     "node --test tests/class-pointer-teacher-reconnect-emulator.cjs"
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const compat=require('firebase/compat/app');require('firebase/compat/database');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const classPath='b3Games/workspaces/b3-2026/classes/et';
const sessionPath=classPath+'/classPointerSessions/'+room;
const policyPath='b3Private/classPointerSharePermissions/b3-2026/et/'+room;
const until=async(check,what)=>{
  const start=Date.now();
  for(;;){
    const value=await check();
    if(value)return value;
    if(Date.now()-start>15000)throw Error('Timed out waiting for: '+what);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
};

async function run(rulesFile,projectId){
  const rules=JSON.parse(read(rulesFile)).rules;
  const env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules:JSON.stringify({rules})}});
  try{
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.database();
      await db.ref(classPath).set({name:'Test ET',active:true,toolGrants:{'class-pointer':true}});
      await db.ref('b3Games/workspaces/b3-2026/teachers/teacher-et').set({active:true,classIds:{et:true}});
    });
    const peek=async p=>{let value;await env.withSecurityRulesDisabled(async context=>{value=(await context.database().ref(p).once('value')).val()});return value};
    const teacherDb=env.authenticatedContext('teacher-et').database();
    let authChanged;const warnings=[];
    const database=()=>teacherDb;database.ServerValue=compat.database.ServerValue;
    const window={B3_APP_CONTEXT:{workspaceId:'b3-2026'},B3SiteSettings:{onAuthStateChanged:fn=>authChanged=fn},addEventListener(){}};
    const context=vm.createContext({window,URL,location:{href:'https://example.test/classroom.html?dashboard=teacher&class=et'},
      document:{getElementById:()=>null},firebase:{database,auth:()=>({currentUser:{uid:'teacher-et'}})},
      setTimeout,clearTimeout,console:{warn:(...a)=>warnings.push(a.map(String).join(' ')),log(){}}});
    for(const name of ['dashboard-core.js','dashboard-session.js'])vm.runInContext(read('class-pointer-prototype/'+name),context);
    await authChanged({uid:'teacher-et'},true,{authorized:true,role:'teacher',classIds:['et']});
    const dashboard=window.ClassPointerDashboard;

    await dashboard.publish(room);
    await dashboard.requestStudentDestination('screens',{screens:{'test-boy-2':true}});
    let row=await peek(sessionPath);
    assert.equal(row.roomId,room);assert.equal(row.studentScreenSharing,true);assert.equal(row.teacherOfflineAt,undefined);

    for(let blink=1;blink<=3;blink++){
      // The teacher's connection drops.
      teacherDb.goOffline();
      row=await until(async()=>{const r=await peek(sessionPath);return r&&Number.isFinite(r.teacherOfflineAt)?r:null},'offline time on blink '+blink);
      assert.equal(row.roomId,room,'the lesson record is still there');
      assert.equal(row.studentScreenSharing,true,'sharing is still enabled');
      assert.equal(row.teacherUid,'teacher-et');
      assert.ok(Math.abs(row.teacherOfflineAt-Date.now())<60000,'the offline time is a server timestamp');
      assert.deepEqual(await peek(policyPath),{'test-boy-2':{screenSharingDenied:true}},'per-student permissions are untouched');
      // The connection returns.
      teacherDb.goOnline();
      row=await until(async()=>{const r=await peek(sessionPath);return r&&r.teacherOfflineAt===undefined?r:null},'offline time cleared on blink '+blink);
      assert.equal(row.roomId,room);assert.equal(row.studentScreenSharing,true);
    }

    await dashboard.end();
    assert.equal(await peek(sessionPath),null,'End Class removes the lesson');
    assert.equal(await peek(policyPath),null);
    // Nothing is left armed: a later drop must not write an orphan record.
    teacherDb.goOffline();await new Promise(resolve=>setTimeout(resolve,700));
    assert.equal(await peek(sessionPath),null);
    teacherDb.goOnline();await new Promise(resolve=>setTimeout(resolve,700));
    assert.equal(await peek(sessionPath),null,'an ended lesson is never brought back');
    assert.deepEqual(warnings,[]);
  }finally{await env.cleanup()}
}

test('#801 real database, live rules: teacher blinks three times; lesson record and permissions survive',()=>run('firebase-rules.json','demo-class-pointer-801-live'));
test('#801 real database, hardened rules: the offline time is accepted and the lesson survives',()=>run('firebase-rules.hardened.json','demo-class-pointer-801-hardened'));
