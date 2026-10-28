'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {get,ref,set,remove}=require('firebase/database');

const enabled=process.env.B3_RUN_STAGING_RTDB_EMULATOR_TESTS==='1';
const run=enabled?test:test.skip;
const projectId='demo-b3-staging';
const port=Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT||19110);
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const classPath='b3Games/workspaces/b3-2026/classes/TEST-ALEF';
const policy='b3Private/classPointerSharePermissions/b3-2026/TEST-ALEF/'+room;
let env;
test.before(async()=>{
  if(!enabled)return;
  const rules=fs.readFileSync('staging/database.rules.json','utf8');
  env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port,rules}});
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.database();
    await set(ref(db,classPath),{active:true,toolGrants:{'class-pointer':true},members:{test_student_alef:{active:true},test_student_other:{active:true}},classPointerSessions:{[room]:{roomId:room,teacherUid:'teacher-alef',createdAt:Date.now(),studentScreenSharing:true}}});
    await set(ref(db,'b3Games/students/test_student_alef/profile'),{active:true,name:'Fictional A1',classId:'TEST-ALEF'});
    await set(ref(db,'b3Games/students/test_student_other/profile'),{active:true,name:'Fictional A2',classId:'TEST-ALEF'});
    await set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-alef'),{active:true,classIds:{'TEST-ALEF':true}});
    await set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-beis'),{active:true,classIds:{'TEST-BEIS':true}});
    await set(ref(db,'b3Private/classPointerShareTickets/secret'),{token:'secret'});
    await set(ref(db,'b3Private/classPointerJoinLimits/secret'),{count:10});
    await set(ref(db,'b3Private/classPointerShareLimits/secret'),{count:10});
    await set(ref(db,'b3Private/passcodes/test_student_alef'),{passcode:'secret'});
  });
});
test.after(async()=>{await env?.cleanup();});
function student(id='test_student_alef',classId='TEST-ALEF',role='student'){
  return env.authenticatedContext('uid-'+id,{b3StudentRole:role,b3StudentId:id,b3ClassId:classId}).database();
}
function teacher(uid){return env.authenticatedContext(uid,{email:uid+'@funtorahtools-staging.test',email_verified:true,b3StagingAccount:true}).database();}
async function yes(p){await assert.doesNotReject(p);}
async function no(p){await assert.rejects(p);}
run('own-student policy reads work, while sibling, class, and parent reads are denied',async()=>{
  const a=student(),b=student('test_student_other');
  const t=teacher('teacher-alef');
  await yes(set(ref(t,policy),{test_student_alef:{screenSharingDenied:true},test_student_other:{whiteboardDenied:true}}));
  const value=(await get(ref(a,policy+'/test_student_alef'))).val();
  assert.equal(value.screenSharingDenied,true);
  await no(get(ref(a,policy+'/test_student_other')));
  await no(get(ref(a,policy)));
  await no(get(ref(b,policy+'/test_student_alef')));
  await no(get(ref(student('test_student_alef','TEST-BEIS'),policy+'/test_student_alef')));
  await no(get(ref(student('test_student_alef','TEST-ALEF','teacher'),policy+'/test_student_alef')));
  await no(get(ref(env.unauthenticatedContext().database(),policy+'/test_student_alef')));
});
run('teacher access is limited to assigned active class and valid policy schema',async()=>{
  const a=teacher('teacher-alef'),b=teacher('teacher-beis');
  await yes(get(ref(a,policy)));
  await no(get(ref(b,policy)));
  await no(set(ref(b,policy+'/test_student_alef'),{screenSharingDenied:false}));
  await no(set(ref(student(),policy+'/test_student_alef'),{screenSharingDenied:false}));
  await no(set(ref(a,policy+'/test_student_alef'),{secret:'leak'}));
  await no(set(ref(a,policy+'/test_student_alef'),{screenSharingDenied:'yes'}));
  await yes(set(ref(a,policy+'/test_student_alef'),{screenSharingDenied:false,whiteboardDenied:true}));
});
run('private tickets, PINs and rate limits stay inaccessible even to class teacher',async()=>{
  for(const db of [student(),teacher('teacher-alef'),env.unauthenticatedContext().database()]){
    for(const path of ['b3Private','b3Private/classPointerShareTickets/secret','b3Private/classPointerJoinLimits/secret','b3Private/classPointerJoinLimits/ok_secret','b3Private/classPointerJoinTicketIndex/secret','b3Private/classPointerShareLimits/secret','b3Private/passcodes/test_student_alef'])await no(get(ref(db,path)));
  }
});
run('student permission reads require a fresh, numeric room timestamp',async()=>{
  const db=student();
  const timestamp=classPath+'/classPointerSessions/'+room+'/createdAt';
  const update=async value=>env.withSecurityRulesDisabled(async c=>set(ref(c.database(),timestamp),value));
  await yes(get(ref(db,policy+'/test_student_alef')));
  await update(Date.now()-15000000);
  await no(get(ref(db,policy+'/test_student_alef')));
  await update(Date.now()+120000);
  await no(get(ref(db,policy+'/test_student_alef')));
  await update('not-a-timestamp');
  await no(get(ref(db,policy+'/test_student_alef')));
  await update(null);
  await no(get(ref(db,policy+'/test_student_alef')));
  await update(Date.now());
  await yes(get(ref(db,policy+'/test_student_alef')));
});
run('revoked class grant and removed session immediately deny own-student policy reads',async()=>{
  const db=student();
  const admin=env.withSecurityRulesDisabled.bind(env);
  await admin(async c=>set(ref(c.database(),classPath+'/toolGrants/class-pointer'),false));
  await no(get(ref(db,policy+'/test_student_alef')));
  await admin(async c=>set(ref(c.database(),classPath+'/toolGrants/class-pointer'),true));
  await yes(get(ref(db,policy+'/test_student_alef')));
  await admin(async c=>remove(ref(c.database(),classPath+'/classPointerSessions/'+room)));
  await no(get(ref(db,policy+'/test_student_alef')));
});
