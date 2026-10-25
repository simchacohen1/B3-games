'use strict';
// Checks the LIVE rules file (firebase-rules.json): student records under
// b3Games/students are readable only by the student, an active teacher, an
// admin or the owner, while every other b3Games area stays as open as before.
// Run with B3_RUN_RTDB_EMULATOR_TESTS=1 set:
//   firebase emulators:exec --only database --project demo-b3-live-rules
//     --config firebase.security-test.json
//     "node --test tests/live-rules-student-records-read-emulator.test.cjs"
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {get,ref,set}=require('firebase/database');

const projectId='demo-b3-live-rules';
const rules=fs.readFileSync('firebase-rules.json','utf8');
const emulatorEnabled=process.env.B3_RUN_RTDB_EMULATOR_TESTS==='1';
const emulatorPort=Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT||9100);
const testEmulator=emulatorEnabled?test:test.skip;
const OWNER='simcha5770@gmail.com';
let env;

test.before(async()=>{
  if(!emulatorEnabled)return;
  env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:emulatorPort,rules}});
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.database();
    const fixtures={
      'b3Games/students/synthetic_one/profile':{id:'synthetic_one',name:'Synthetic One',active:true},
      'b3Games/students/synthetic_one/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true},
      'b3Games/students/synthetic_two/profile':{id:'synthetic_two',name:'Synthetic Two',active:true},
      'b3Games/siteSettings':{studentSiteOpen:true},
      'b3Games/workspaces/b3-2026/classes/alpha':{name:'Synthetic Alpha',active:true,members:{synthetic_one:{active:true}}},
      'b3Games/workspaces/b3-2026/teachers/teacher_alpha':{active:true,classIds:{alpha:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_legacy':{classIds:{et:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_inactive':{active:false,classIds:{alpha:true}},
      'b3Games/teachers/legacy_teacher':{name:'Synthetic Legacy'},
      'b3Games/admins/admin_active':{active:true},
      'b3Games/admins/admin_inactive':{active:false},
      'b3Games/classGalleryPresence/alpha':{synthetic_one:1},
      'b3Games/classGalleryTag/alpha':{tag:1},
      'b3Games/classGalleryPresenceSettings':{enabled:true},
      'b3Games/someOtherArea':{value:1}
    };
    for(const [path,value] of Object.entries(fixtures)) await set(ref(db,path),value);
  });
});

test.after(async()=>{await env?.cleanup();});

function db(uid,claims={}){return env.authenticatedContext(uid,claims).database();}
const one='b3Games/students/synthetic_one';
async function succeeds(promise){await assert.doesNotReject(promise);}
async function fails(promise){await assert.rejects(promise);}

testEmulator('strangers and plain Google accounts cannot read student records',async()=>{
  const anon=env.unauthenticatedContext().database();
  const google=db('random_google',{email:'someone@example.test',email_verified:true});
  for(const reader of [anon,google]){
    await fails(get(ref(reader,one+'/profile')));
    await fails(get(ref(reader,one)));
    await fails(get(ref(reader,'b3Games/students')));
  }
});

testEmulator('every other b3Games area stays publicly readable',async()=>{
  const anon=env.unauthenticatedContext().database();
  // Class records under workspaces are covered by live-rules-class-records-read-emulator.
  for(const path of ['b3Games/siteSettings','b3Games/workspaces/b3-2026/teachers',
    'b3Games/teachers','b3Games/admins','b3Games/classGalleryPresence','b3Games/classGalleryTag',
    'b3Games/classGalleryPresenceSettings','b3Games/someOtherArea']){
    await succeeds(get(ref(anon,path)));
  }
});

testEmulator('a student reads only their own record',async()=>{
  const student=db('student_uid_one',{b3StudentId:'synthetic_one'});
  await succeeds(get(ref(student,one)));
  await succeeds(get(ref(student,one+'/memberships')));
  await fails(get(ref(student,'b3Games/students/synthetic_two/profile')));
  await fails(get(ref(student,'b3Games/students')));
});

testEmulator('active teachers read student records one at a time; inactive teachers cannot',async()=>{
  for(const uid of ['teacher_alpha','teacher_legacy']){
    const teacher=db(uid,{email:uid+'@example.test',email_verified:true});
    await succeeds(get(ref(teacher,one+'/profile')));
    await succeeds(get(ref(teacher,'b3Games/students/synthetic_two/profile')));
    await fails(get(ref(teacher,'b3Games/students')));
  }
  await fails(get(ref(db('teacher_inactive',{email:'inactive@example.test',email_verified:true}),one+'/profile')));
});

testEmulator('owner and active admins read the whole student list',async()=>{
  await succeeds(get(ref(db('owner_uid',{email:OWNER,email_verified:true}),'b3Games/students')));
  await fails(get(ref(db('owner_unverified',{email:OWNER,email_verified:false}),'b3Games/students')));
  await succeeds(get(ref(db('admin_active'),'b3Games/students')));
  await fails(get(ref(db('admin_inactive'),'b3Games/students')));
});

testEmulator('writes are unchanged in this step',async()=>{
  const student=db('student_uid_one',{b3StudentId:'synthetic_one'});
  await succeeds(set(ref(student,one+'/halacha/siman1'),{done:true}));
  await fails(set(ref(student,one+'/profile/name'),'Changed'));
  await succeeds(set(ref(env.unauthenticatedContext().database(),'b3Games/classGalleryPresence/alpha/x'),1));
  await succeeds(set(ref(db('owner_uid',{email:OWNER,email_verified:true}),one+'/profile/active'),true));
});
