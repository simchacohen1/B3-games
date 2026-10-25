'use strict';
// Checks the LIVE rules file (firebase-rules.json): class records (member
// names, class PINs, settings) are readable only by a student of that class,
// an active teacher, an admin or the owner. Other workspace areas stay as open.
// Run with B3_RUN_RTDB_EMULATOR_TESTS=1 set:
//   firebase emulators:exec --only database --project demo-b3-live-rules
//     --config firebase.security-test.json
//     "node --test tests/live-rules-class-records-read-emulator.test.cjs"
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
const WS='b3Games/workspaces/b3-2026';
const alpha=WS+'/classes/alpha';
let env;

test.before(async()=>{
  if(!emulatorEnabled)return;
  env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:emulatorPort,rules}});
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.database();
    const fixtures={
      [alpha]:{name:'Synthetic Alpha',active:true,classPin:'0000',toolGrants:{chazara:true},
        members:{synthetic_one:{name:'Synthetic One',active:true}}},
      [WS+'/classes/beta']:{name:'Synthetic Beta',active:true,members:{synthetic_two:{name:'Synthetic Two',active:true}}},
      [WS+'/teachers/teacher_alpha']:{active:true,classIds:{alpha:true}},
      [WS+'/teachers/teacher_legacy']:{classIds:{et:true}},
      [WS+'/teachers/teacher_inactive']:{active:false,classIds:{alpha:true}},
      [WS+'/teacherInvites/invite_example_test']:{email:'invite@example.test',active:false},
      [WS+'/contentGrants/alpha']:{yiddishWineMerchant:true},
      'b3Games/admins/admin_active':{active:true},
      'b3Games/admins/admin_inactive':{active:false}
    };
    for(const [path,value] of Object.entries(fixtures)) await set(ref(db,path),value);
  });
});

test.after(async()=>{await env?.cleanup();});

function db(uid,claims={}){return env.authenticatedContext(uid,claims).database();}
async function succeeds(promise){await assert.doesNotReject(promise);}
async function fails(promise){await assert.rejects(promise);}

testEmulator('strangers and plain Google accounts cannot read class records',async()=>{
  const anon=env.unauthenticatedContext().database();
  const google=db('random_google',{email:'someone@example.test',email_verified:true});
  for(const reader of [anon,google]){
    await fails(get(ref(reader,alpha)));
    await fails(get(ref(reader,alpha+'/members')));
    await fails(get(ref(reader,alpha+'/classPin')));
    await fails(get(ref(reader,alpha+'/active')));
    await fails(get(ref(reader,WS+'/classes')));
  }
});

testEmulator('other workspace areas stay publicly readable',async()=>{
  const anon=env.unauthenticatedContext().database();
  for(const path of [WS+'/teachers',WS+'/teacherInvites',WS+'/contentGrants/alpha'])await succeeds(get(ref(anon,path)));
});

testEmulator('a student reads their own class (by class list or signed-in class), not another class',async()=>{
  const member=db('student_uid_one',{b3StudentId:'synthetic_one',b3ClassId:'alpha'});
  await succeeds(get(ref(member,alpha)));
  await succeeds(get(ref(member,alpha+'/members')));
  await fails(get(ref(member,WS+'/classes/beta')));
  await fails(get(ref(member,WS+'/classes')));
  // Not on the class list, but the server confirmed this class at sign-in.
  const tokenOnly=db('student_uid_legacy',{b3StudentId:'synthetic_legacy',b3ClassId:'alpha'});
  await succeeds(get(ref(tokenOnly,alpha+'/toolGrants')));
  // On the class list, signed in to another class.
  const listOnly=db('student_uid_one_b',{b3StudentId:'synthetic_one',b3ClassId:'beta'});
  await succeeds(get(ref(listOnly,alpha+'/active')));
});

testEmulator('active teachers read classes; inactive teachers cannot',async()=>{
  for(const uid of ['teacher_alpha','teacher_legacy']){
    const teacher=db(uid,{email:uid+'@example.test',email_verified:true});
    await succeeds(get(ref(teacher,WS+'/classes')));
    await succeeds(get(ref(teacher,alpha+'/members')));
  }
  await fails(get(ref(db('teacher_inactive',{email:'inactive@example.test',email_verified:true}),alpha)));
});

testEmulator('owner and active admins read the whole workspace',async()=>{
  await succeeds(get(ref(db('owner_uid',{email:OWNER,email_verified:true}),WS)));
  await fails(get(ref(db('owner_unverified',{email:OWNER,email_verified:false}),WS+'/classes')));
  await succeeds(get(ref(db('admin_active'),WS)));
  await fails(get(ref(db('admin_inactive'),WS+'/classes')));
});

testEmulator('writes are unchanged in this step',async()=>{
  await succeeds(set(ref(env.unauthenticatedContext().database(),alpha+'/resources/gallery/x'),1));
  await fails(set(ref(db('student_uid_one',{b3StudentId:'synthetic_one',b3ClassId:'alpha'}),alpha+'/name'),'Changed'));
  await succeeds(set(ref(db('teacher_alpha',{email:'teacher_alpha@example.test',email_verified:true}),alpha+'/siteEnabled'),true));
  await succeeds(set(ref(db('owner_uid',{email:OWNER,email_verified:true}),alpha+'/name'),'Synthetic Alpha'));
});
