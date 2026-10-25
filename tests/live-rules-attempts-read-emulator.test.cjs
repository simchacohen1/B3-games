'use strict';
// Checks the LIVE rules file (firebase-rules.json), not the hardened candidate:
// Posuk Practice recording links are readable only by the student, an active
// teacher, an admin or the owner. Writes are deliberately unchanged for now.
// Run with B3_RUN_RTDB_EMULATOR_TESTS=1 set:
//   firebase emulators:exec --only database --project demo-b3-live-rules
//     --config firebase.security-test.json
//     "node --test tests/live-rules-attempts-read-emulator.test.cjs"
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
      'posukPractice/attempts/synthetic_one/p1/a1':{audioUrl:'https://example.test/one.webm'},
      'posukPractice/attempts/synthetic_two/p1/a1':{audioUrl:'https://example.test/two.webm'},
      // A new-class student has memberships but no profile.classId.
      'b3Games/students/synthetic_new/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true},
      'posukPractice/attempts/synthetic_new/p1/a1':{audioUrl:'https://example.test/new.webm'},
      'b3Games/workspaces/b3-2026/teachers/teacher_alpha':{active:true,classIds:{alpha:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_legacy':{classIds:{et:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_inactive':{active:false,classIds:{alpha:true}},
      'b3Games/admins/admin_active':{active:true},
      'b3Games/admins/admin_inactive':{active:false}
    };
    for(const [path,value] of Object.entries(fixtures)) await set(ref(db,path),value);
  });
});

test.after(async()=>{await env?.cleanup();});

function db(uid,claims={}){return env.authenticatedContext(uid,claims).database();}
const one='posukPractice/attempts/synthetic_one';
async function succeeds(promise){await assert.doesNotReject(promise);}
async function fails(promise){await assert.rejects(promise);}

testEmulator('strangers and plain Google accounts cannot read recording links',async()=>{
  await fails(get(ref(env.unauthenticatedContext().database(),one)));
  await fails(get(ref(env.unauthenticatedContext().database(),'posukPractice/attempts')));
  const google=db('random_google',{email:'someone@example.test',email_verified:true});
  await fails(get(ref(google,one)));
  await fails(get(ref(google,'posukPractice/attempts')));
});

testEmulator('a student reads only their own recordings',async()=>{
  const student=db('student_uid_one',{b3StudentId:'synthetic_one'});
  await succeeds(get(ref(student,one)));
  await fails(get(ref(student,'posukPractice/attempts/synthetic_two')));
  await fails(get(ref(student,'posukPractice/attempts')));
});

testEmulator('active teachers read per student, including new-class students; inactive teachers cannot',async()=>{
  for(const uid of ['teacher_alpha','teacher_legacy']){
    const teacher=db(uid,{email:uid+'@example.test',email_verified:true});
    await succeeds(get(ref(teacher,one)));
    await succeeds(get(ref(teacher,'posukPractice/attempts/synthetic_new')));
    await fails(get(ref(teacher,'posukPractice/attempts')));
  }
  await fails(get(ref(db('teacher_inactive',{email:'inactive@example.test',email_verified:true}),one)));
});

testEmulator('owner and active admins read the whole tree for Approvals',async()=>{
  await succeeds(get(ref(db('owner_uid',{email:OWNER,email_verified:true}),'posukPractice/attempts')));
  await fails(get(ref(db('owner_unverified',{email:OWNER,email_verified:false}),'posukPractice/attempts')));
  await succeeds(get(ref(db('admin_active'),'posukPractice/attempts')));
  await fails(get(ref(db('admin_inactive'),'posukPractice/attempts')));
});

testEmulator('writes are unchanged in this step',async()=>{
  await succeeds(set(ref(db('student_uid_one',{b3StudentId:'synthetic_one'}),one+'/p2/a1'),{audioUrl:'https://example.test/x.webm'}));
  await succeeds(set(ref(env.unauthenticatedContext().database(),one+'/p3/a1'),{audioUrl:'https://example.test/y.webm'}));
});
