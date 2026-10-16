'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {get,ref,set}=require('firebase/database');

const projectId='demo-b3-security';
const rules=fs.readFileSync('firebase-rules.hardened.json','utf8');
const emulatorEnabled=process.env.B3_RUN_RTDB_EMULATOR_TESTS==='1';
const testEmulator=emulatorEnabled?test:test.skip;
let env;

test.before(async()=>{
  if(!emulatorEnabled)return;
  env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules}});
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.database();
    const fixtures={
      'b3Games/students/synthetic_one/profile':{name:'Synthetic One',active:true,classId:'alpha'},
      'b3Games/students/synthetic_one/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true},
      'b3Games/students/synthetic_two/profile':{name:'Synthetic Two',active:true,classId:'beta'},
      'b3Games/students/synthetic_two/memberships/b3-2026_beta':{workspaceId:'b3-2026',classId:'beta',active:true},
      'b3Games/workspaces/b3-2026/classes/alpha':{active:true,members:{synthetic_one:{active:true}},toolGrants:{chazara:true}},
      'b3Games/workspaces/b3-2026/classes/beta':{active:true,members:{synthetic_two:{active:true}},toolGrants:{chazara:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_alpha':{active:true,classIds:{alpha:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_beta':{active:true,classIds:{beta:true}},
      'b3Games/workspaces/b3-2026/classes/et':{active:true,members:{synthetic_et:{active:true}},toolGrants:{chazara:true}},
      'b3Games/workspaces/b3-2026/classes/wt':{active:true,members:{synthetic_wt:{active:true}},toolGrants:{chazara:true}},
      'b3Games/students/synthetic_et/profile':{name:'Synthetic East',active:true,classId:'et'},
      'b3Games/students/synthetic_wt/profile':{name:'Synthetic West',active:true,classId:'wt'},
      'b3Games/workspaces/b3-2026/teachers/teacher_et':{active:true,classIds:{et:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_wt':{active:true,classIds:{wt:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_inactive':{active:false,classIds:{et:true}},
      'posukPractice/shorashimLearning/students/synthetic_one':{name:'Synthetic One',cards:{}},
      'posukPractice/shorashimLearning/students/synthetic_two':{name:'Synthetic Two',cards:{}},
      'posukPractice/shorashimLearning/recordingEvents/synthetic_one/event_one':{type:'start',at:1},
      'posukPractice/shorashimLearning/recordingEvents/synthetic_two/event_two':{type:'start',at:2},
      'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_one':{wins:3},
      'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_two':{wins:4},
      'b3Quiz/classes/alpha/quizzes/quiz_one':{title:'Synthetic Quiz'},
      'b3Quiz/classes/alpha/launches/launch_shared':{classId:'alpha',targetStudents:null,started:true,quizSnapshot:{questions:[{correctIndex:1}]}},
      'b3Quiz/classes/alpha/launches/launch_targeted':{classId:'alpha',targetStudents:{synthetic_two:true},started:true,quizSnapshot:{questions:[{correctIndex:0}]}},
      'b3Quiz/classes/alpha/responses/launch_shared/synthetic_one/0':{choiceIndex:1,correct:true},
      'b3Quiz/classes/beta/launches/launch_beta':{classId:'beta',targetStudents:null,started:true}
    };
    for(const [path,value] of Object.entries(fixtures)) await set(ref(db,path),value);
  });
});

test.after(async()=>{await env?.cleanup();});

function db(uid,claims={}){return env.authenticatedContext(uid,claims).database();}
async function succeeds(promise){await assert.doesNotReject(promise);}
async function fails(promise){await assert.rejects(promise);}

testEmulator('student records and attempts are private by default and isolated by student id',async()=>{
  const one=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  const anonymous=env.unauthenticatedContext().database();
  await fails(get(ref(anonymous,'b3Games/students/synthetic_one/profile')));
  await succeeds(get(ref(one,'b3Games/students/synthetic_one/profile')));
  await fails(get(ref(one,'b3Games/students/synthetic_two/profile')));
  await succeeds(get(ref(one,'posukPractice/attempts/synthetic_one')));
  await fails(get(ref(one,'posukPractice/attempts/synthetic_two')));
});

testEmulator('student writes stay within their own Posuk and Chazara records',async()=>{
  const one=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  await succeeds(set(ref(one,'posukPractice/attempts/synthetic_one/new'),{score:42}));
  await fails(set(ref(one,'posukPractice/attempts/synthetic_two/new'),{score:100}));
  await succeeds(set(ref(one,'posukPractice/chazara/events/synthetic_one/new'),{reviewApplied:true}));
  await fails(set(ref(one,'posukPractice/chazara/events/synthetic_two/new'),{reviewApplied:true}));
  await fails(get(ref(env.unauthenticatedContext().database(),'posukPractice/chazara/events/synthetic_one')));
});

testEmulator('teachers can read assigned class records and cannot cross into another class',async()=>{
  const alpha=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  await succeeds(get(ref(alpha,'posukPractice/attempts/synthetic_one')));
  await fails(get(ref(alpha,'posukPractice/attempts/synthetic_two')));
  const beta=db('teacher_beta',{email:'beta@example.test',email_verified:true});
  await succeeds(get(ref(beta,'posukPractice/attempts/synthetic_two')));
  await fails(get(ref(beta,'posukPractice/attempts/synthetic_one')));
  await succeeds(get(ref(alpha,'b3Games/workspaces/b3-2026/classes/alpha')));
  await fails(get(ref(alpha,'b3Games/workspaces/b3-2026/classes/beta')));
  await succeeds(get(ref(alpha,'b3Games/students/synthetic_one/profile')));
  await fails(get(ref(alpha,'b3Games/students/synthetic_two/profile')));
  await succeeds(get(ref(alpha,'b3Games/students/synthetic_one/memberships/b3-2026_alpha')));
  await fails(get(ref(alpha,'b3Games/students/synthetic_two/memberships/b3-2026_beta')));
});

testEmulator('Shorashim teacher access follows each student profile class and keeps leaderboard data scoped',async()=>{
  const alpha=db('teacher_alpha',{email:'alpha@example.test',email_verified:true,b3ClassId:'beta'});
  const beta=db('teacher_beta',{email:'beta@example.test',email_verified:true,b3ClassId:'alpha'});
  await succeeds(get(ref(alpha,'posukPractice/shorashimLearning/students/synthetic_one')));
  await fails(get(ref(alpha,'posukPractice/shorashimLearning/students/synthetic_two')));
  await succeeds(get(ref(alpha,'posukPractice/shorashimLearning/recordingEvents/synthetic_one')));
  await fails(get(ref(alpha,'posukPractice/shorashimLearning/recordingEvents/synthetic_two')));
  await succeeds(get(ref(alpha,'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_one')));
  await fails(get(ref(alpha,'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_two')));
  await succeeds(get(ref(beta,'posukPractice/shorashimLearning/students/synthetic_two')));
  await fails(get(ref(beta,'posukPractice/shorashimLearning/students/synthetic_one')));
  await fails(set(ref(alpha,'posukPractice/shorashimLearning/settings/minReviewMs'),1000));
});

testEmulator('Shorashim student writes stay on its own progress, recordings, and score paths',async()=>{
  const one=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  await succeeds(set(ref(one,'posukPractice/shorashimLearning/students/synthetic_one/cards/card_one'),{learnedAt:10}));
  await fails(set(ref(one,'posukPractice/shorashimLearning/students/synthetic_two/cards/card_two'),{learnedAt:11}));
  await succeeds(set(ref(one,'posukPractice/shorashimLearning/recordingEvents/synthetic_one/event_new'),{createdAt:12}));
  await fails(set(ref(one,'posukPractice/shorashimLearning/recordingEvents/synthetic_two/event_new'),{createdAt:13}));
  await succeeds(set(ref(one,'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_one'),{name:'Synthetic One',time:99}));
  await fails(set(ref(one,'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_two'),{name:'Synthetic Two',time:1}));
});

testEmulator('ET and WT Shorashim teachers can edit shared curriculum and only their class settings',async()=>{
  const et=db('teacher_et',{email:'et@example.test',email_verified:true});
  const wt=db('teacher_wt',{email:'wt@example.test',email_verified:true});
  await succeeds(set(ref(et,'posukPractice/shorashimLearning/classes/et/settings/minReviewMs'),650));
  await fails(set(ref(et,'posukPractice/shorashimLearning/classes/wt/settings/minReviewMs'),900));
  await succeeds(set(ref(wt,'posukPractice/shorashimLearning/classes/wt/settings/minReviewMs'),750));
  await succeeds(set(ref(et,'posukPractice/shorashimLearning/catalog/_synthetic_probe'),{id:'probe'}));
  await succeeds(set(ref(wt,'posukPractice/shorashimLearning/catalog/_synthetic_probe'),null));
});

testEmulator('ET and WT students and teachers remain isolated from the other track',async()=>{
  const etStudent=db('student-et',{b3StudentId:'synthetic_et',b3ClassId:'et',b3StudentRole:'student'});
  const wtStudent=db('student-wt',{b3StudentId:'synthetic_wt',b3ClassId:'wt',b3StudentRole:'student'});
  const etTeacher=db('teacher_et',{email:'et@example.test',email_verified:true});
  const wtTeacher=db('teacher_wt',{email:'wt@example.test',email_verified:true});
  const inactiveTeacher=db('teacher_inactive',{email:'inactive@example.test',email_verified:true});
  await succeeds(get(ref(etStudent,'b3Games/workspaces/b3-2026/classes/et/members/synthetic_et')));
  await fails(get(ref(etStudent,'b3Games/workspaces/b3-2026/classes/wt/members/synthetic_wt')));
  await succeeds(get(ref(wtStudent,'b3Games/workspaces/b3-2026/classes/wt/members/synthetic_wt')));
  await fails(get(ref(wtStudent,'b3Games/workspaces/b3-2026/classes/et/members/synthetic_et')));
  await succeeds(get(ref(etTeacher,'posukPractice/attempts/synthetic_et')));
  await fails(get(ref(etTeacher,'posukPractice/attempts/synthetic_wt')));
  await succeeds(get(ref(wtTeacher,'posukPractice/attempts/synthetic_wt')));
  await fails(get(ref(wtTeacher,'posukPractice/attempts/synthetic_et')));
  await fails(get(ref(inactiveTeacher,'posukPractice/attempts/synthetic_et')));
});

testEmulator('teachers cannot write student profile or rewards balance',async()=>{
  const alpha=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  const student=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  await fails(set(ref(alpha,'b3Games/students/synthetic_one/profile/active'),false));
  await fails(set(ref(student,'studentRewards/students/synthetic_one/rewardBalance'),999));
});

testEmulator('Weekly Quiz teacher reads and student launch access stay class scoped',async()=>{
  const alphaTeacher=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  const betaTeacher=db('teacher_beta',{email:'beta@example.test',email_verified:true});
  const alphaStudent=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  await succeeds(get(ref(alphaTeacher,'b3Quiz/classes/alpha/quizzes')));
  await succeeds(get(ref(alphaTeacher,'b3Quiz/classes/alpha/launches')));
  await succeeds(get(ref(alphaTeacher,'b3Quiz/classes/alpha/responses')));
  await fails(get(ref(alphaTeacher,'b3Quiz/classes/beta/launches')));
  await fails(get(ref(alphaStudent,'b3Quiz/classes/alpha/launches/launch_shared')));
  await fails(get(ref(alphaStudent,'b3Quiz/classes/alpha/launches/launch_targeted')));
  await fails(get(ref(alphaStudent,'b3Quiz/classes/beta/launches/launch_beta')));
  await fails(get(ref(alphaStudent,'b3Quiz/classes/alpha/responses/launch_shared/synthetic_one')));
  await fails(get(ref(alphaStudent,'b3Quiz/classes/alpha/responses/launch_shared/synthetic_two')));
  await fails(set(ref(alphaStudent,'b3Quiz/classes/alpha/responses/launch_shared/synthetic_one/0'),{choiceIndex:1,correct:true}));
  await fails(get(ref(alphaStudent,'b3Quiz/classes/alpha/completions/launch_shared/synthetic_one')));
  await fails(set(ref(alphaStudent,'b3Quiz/classes/alpha/completions/launch_shared/synthetic_one'),{correct:1,total:1,pct:100}));
});
