'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {get,ref,set}=require('firebase/database');

const enabled=process.env.B3_RUN_RTDB_EMULATOR_TESTS==='1';
const t=enabled?test:test.skip;
const port=Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT||19105);
const envPath='b3Games/workspaces/b3-2026';
let env;

test.before(async()=>{
  if(!enabled)return;
  env=await initializeTestEnvironment({
    projectId:'demo-b3-transitional-teacher-scope',
    database:{host:'127.0.0.1',port,rules:fs.readFileSync('firebase-rules.json','utf8')}
  });
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.database();
    const {ref,set}=require('firebase/database');
    const fixtures={
      [`${envPath}/teachers/teacher_alpha`]:{active:true,classIds:{alpha:true}},
      [`${envPath}/teachers/teacher_beta`]:{active:true,classIds:{beta:true}},
      [`${envPath}/teachers/teacher_et`]:{active:true,classIds:{et:true}},
      [`${envPath}/teachers/teacher_principal`]:{active:true,accountType:'principal',classIds:{alpha:true}},
      [`${envPath}/classes/alpha`]:{active:true,members:{student_alpha:{active:true}}},
      [`${envPath}/classes/beta`]:{active:true,members:{student_beta:{active:true}}},
      [`${envPath}/classes/alpha/members/student_suspended`]:{active:false},
      'b3Quiz/classes/alpha/quizzes/quiz_one':{title:'Synthetic Alpha Quiz'},
      'b3Quiz/classes/alpha/launches/launch_one':{classId:'alpha',started:true},
      'b3Quiz/classes/beta/launches/launch_two':{classId:'beta',started:true},
      'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha':'launch_one',
      'b3Quiz/classes/beta/settings/activeLaunchByClass/beta':'launch_two',
      'b3Quiz/classes/alpha/settings/studentActiveLaunch/student_alpha':'launch_one',
      'b3Quiz/classes/beta/settings/studentActiveLaunch/student_beta':'launch_two',
      'b3Quiz/classes/alpha/settings/studentAssignments/student_alpha/launch_one':true,
      'b3Quiz/classes/beta/settings/studentAssignments/student_beta/launch_two':true,
      'b3Quiz/quizzes/owner_quiz':{title:'Synthetic Owner Quiz'},
      'b3Quiz/settings/activeLaunchByClass/et':'owner_launch',
      'b3Games/students/student_alpha/profile':{name:'Synthetic Alpha',classId:'alpha',active:true},
      'b3Games/students/student_beta/profile':{name:'Synthetic Beta',classId:'beta',active:true},
      'b3Games/students/student_suspended/profile':{name:'Synthetic Suspended',classId:'alpha',active:true},
      'posukPractice/attempts/student_alpha/attempt_one':{score:3},
      'posukPractice/attempts/student_beta/attempt_one':{score:4},
      'posukPractice/attempts/student_suspended/attempt_one':{score:0},
      'questionSets/legacy_alpha':{questions:[{q:'Synthetic legacy question',ans:'secret'}]},
      'questionSets/legacy_et':{questions:[{q:'Synthetic ET legacy question',ans:'secret'}]},
      'questionSets/classes/alpha/set':{questions:[{q:'Synthetic alpha question',ans:'secret'}]},
      'questionSets/classes/beta/set':{questions:[{q:'Synthetic beta question',ans:'secret'}]},
      'questionSets/classes/alpha/live':{roundActive:true,scores:{}},
      'tentTrailTrivia':{roundActive:true,qIndex:0},
      'rashiLetters/progress/student_alpha':{name:'Synthetic Alpha',units:{}},
      'rashiLetters/progress/student_beta':{name:'Synthetic Beta',units:{}},
      'rashiLetters/matchRooms/alpha-room':{host:'student_alpha',hostName:'Synthetic Alpha',classId:'alpha',state:'lobby',createdAt:1,questions:[],players:{student_alpha:{name:'Synthetic Alpha',score:0,q:0}}},
      'posukPractice/allowedStudents/student_alpha':{name:'Synthetic Alpha',passcode:'1111',classSection:'alpha'},
      'posukPractice/allowedStudents/student_beta':{name:'Synthetic Beta',passcode:'2222',classSection:'beta'},
      'posukPractice/chazara/students/student_alpha':{reviews:{'1_1':{reviewApplied:true}}},
      'posukPractice/chazara/students/student_beta':{reviews:{'1_1':{reviewApplied:true}}},
      'posukPractice/chazara/events/student_alpha/event_one':{classId:'alpha',perek:1,posuk:1},
      'posukPractice/chazara/events/student_beta/event_two':{classId:'beta',perek:1,posuk:1},
      'posukPractice/shorashimLearning/students/student_alpha':{name:'Synthetic Alpha',cards:{}},
      'posukPractice/shorashimLearning/students/student_beta':{name:'Synthetic Beta',cards:{}},
      'posukPractice/shorashimLearning/classes/alpha/catalog':{cards:{alpha:{word:'Synthetic Alpha'}}},
      'posukPractice/shorashimLearning/classes/beta/catalog':{cards:{beta:{word:'Synthetic Beta'}}},
      'posukPractice/shorashimLearning/classes/alpha/settings':{minReviewMs:500},
      'posukPractice/shorashimLearning/catalog':{cards:{legacy:{word:'Synthetic legacy'}}},
      'posukPractice/shorashimLearning/settings':{minReviewMs:500}
    };
    for(const [path,value] of Object.entries(fixtures))await set(ref(db,path),value);
  });
});
test.after(async()=>{await env?.cleanup();});

t('Weekly Quiz rules scope class data and student pointers while preserving owner access',async()=>{
  const alpha=env.authenticatedContext('teacher_alpha',{email:'alpha@example.test',email_verified:true}).database();
  const student=env.authenticatedContext('student-alpha',{b3StudentId:'student_alpha',b3ClassId:'alpha',b3StudentRole:'student'}).database();
  const owner=env.authenticatedContext('owner',{email:'simcha5770@gmail.com',email_verified:true}).database();
  const anonymous=env.unauthenticatedContext().database();
  await assert.rejects(get(ref(anonymous,'b3Quiz')));
  await assert.rejects(get(ref(anonymous,'b3Quiz/classes')));
  await assert.rejects(get(ref(alpha,'b3Quiz/classes')));
  await assert.doesNotReject(get(ref(alpha,'b3Quiz/classes/alpha/quizzes')));
  await assert.doesNotReject(get(ref(alpha,'b3Quiz/classes/alpha/launches')));
  await assert.rejects(get(ref(alpha,'b3Quiz/classes/beta/launches')));
  await assert.doesNotReject(set(ref(alpha,'b3Quiz/classes/alpha/launches/launch_new'),{classId:'alpha',started:true}));
  await assert.rejects(set(ref(alpha,'b3Quiz/classes/alpha/launches/forged'),{classId:'beta',started:true}));
  await assert.doesNotReject(set(ref(alpha,'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha'),'launch_new'));
  await assert.rejects(set(ref(alpha,'b3Quiz/classes/alpha/settings/activeLaunchByClass/beta'),'launch_new'));
  await assert.doesNotReject(set(ref(alpha,'b3Quiz/classes/alpha/settings/studentActiveLaunch/student_alpha'),null));
  await assert.doesNotReject(get(ref(student,'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha')));
  await assert.doesNotReject(get(ref(student,'b3Quiz/classes/alpha/settings/studentAssignments/student_alpha')));
  await assert.rejects(get(ref(student,'b3Quiz/classes/beta/settings/activeLaunchByClass/beta')));
  await assert.rejects(get(ref(student,'b3Quiz/classes/alpha/settings/studentAssignments/student_beta')));
  await assert.rejects(set(ref(student,'b3Quiz/classes/alpha/settings/studentAssignments/student_alpha/forged'),true));
  await assert.doesNotReject(get(ref(owner,'b3Quiz/quizzes')));
  await assert.doesNotReject(get(ref(owner,'b3Quiz/settings')));
  await assert.doesNotReject(get(ref(owner,'b3Quiz/classes/alpha')));
  await assert.rejects(get(ref(anonymous,'b3Quiz/quizzes')));
});

t('transitional rules allow an assigned teacher and owner while denying cross-class or inactive membership reads',async()=>{
  const alpha=env.authenticatedContext('teacher_alpha',{email:'alpha@example.test',email_verified:true}).database();
  const beta=env.authenticatedContext('teacher_beta',{email:'beta@example.test',email_verified:true}).database();
  const et=env.authenticatedContext('teacher_et',{email:'et@example.test',email_verified:true}).database();
  const principal=env.authenticatedContext('teacher_principal',{email:'principal@example.test',email_verified:true}).database();
  const owner=env.authenticatedContext('owner',{email:'simcha5770@gmail.com',email_verified:true}).database();
  const anonymous=env.unauthenticatedContext().database();
  const student=env.authenticatedContext('student_alpha',{b3StudentId:'student_alpha',b3ClassId:'alpha',b3StudentRole:'student'}).database();
  await assert.rejects(get(ref(anonymous,'b3Games')));
  await assert.rejects(get(ref(anonymous,'b3Games/workspaces')));
  await assert.rejects(get(ref(anonymous,`${envPath}/classes`)));
  await assert.rejects(get(ref(alpha,`${envPath}/classes`)));
  await assert.rejects(get(ref(anonymous,`${envPath}/classes/alpha`)));
  await assert.doesNotReject(get(ref(alpha,`${envPath}/classes/alpha`)));
  await assert.rejects(get(ref(alpha,`${envPath}/classes/beta`)));
  await assert.doesNotReject(get(ref(principal,`${envPath}/classes/alpha`)));
  await assert.rejects(get(ref(principal,`${envPath}/classes/beta`)));
  await assert.doesNotReject(get(ref(alpha,`${envPath}/teachers/teacher_alpha`)));
  await assert.rejects(get(ref(alpha,`${envPath}/teachers/teacher_beta`)));
  await assert.doesNotReject(get(ref(owner,`${envPath}/classes`)));
  await assert.doesNotReject(get(ref(owner,`${envPath}/teachers`)));
  await assert.doesNotReject(set(ref(owner,`${envPath}/classes/owner_created`),{name:'Synthetic Owner Class',active:true}));
  await assert.rejects(set(ref(alpha,`${envPath}/classes/teacher_created`),{name:'Unauthorized Synthetic Class',active:true}));
  await assert.rejects(set(ref(principal,`${envPath}/classes/principal_created_directly`),{name:'Unauthorized Direct Class',active:true}));
  await assert.doesNotReject(set(ref(owner,`${envPath}/teacherInvites/owner_created_example_test`),{email:'owner-created@example.test',active:false,classIds:{}}));
  await assert.rejects(set(ref(alpha,`${envPath}/teacherInvites/teacher_created_example_test`),{email:'teacher-created@example.test',active:false,classIds:{}}));
  await assert.doesNotReject(get(ref(alpha,'b3Games/students/student_alpha/profile')));
  await assert.rejects(get(ref(alpha,'b3Games/students/student_beta/profile')));
  await assert.doesNotReject(get(ref(beta,'b3Games/students/student_beta/profile')));
  await assert.doesNotReject(get(ref(alpha,'posukPractice/attempts/student_alpha')));
  await assert.rejects(get(ref(alpha,'posukPractice/attempts/student_beta')));
  await assert.doesNotReject(get(ref(beta,'posukPractice/attempts/student_beta')));
  await assert.rejects(get(ref(beta,'posukPractice/attempts/student_alpha')));
  await assert.rejects(get(ref(alpha,'posukPractice/attempts/student_suspended')));
  await assert.doesNotReject(get(ref(principal,'posukPractice/attempts/student_alpha')));
  await assert.rejects(get(ref(principal,'posukPractice/attempts/student_beta')));
  await assert.doesNotReject(get(ref(owner,'posukPractice/attempts/student_beta')));
  await assert.rejects(get(ref(anonymous,'posukPractice/attempts/student_alpha')));
  await assert.rejects(get(ref(anonymous,'b3Games/students/student_alpha/profile')));
  await assert.doesNotReject(get(ref(owner,'b3Games/students/student_beta/profile')));
  await assert.doesNotReject(get(ref(alpha,'questionSets/classes/alpha/set')));
  await assert.rejects(get(ref(alpha,'questionSets/classes/beta/set')));
  await assert.doesNotReject(get(ref(beta,'questionSets/classes/beta/set')));
  await assert.doesNotReject(get(ref(owner,'questionSets/classes/beta/set')));
  await assert.rejects(get(ref(anonymous,'questionSets/classes/alpha/set')));
  await assert.rejects(get(ref(student,'questionSets/classes/alpha/set')));
  await assert.doesNotReject(get(ref(student,'questionSets/classes/alpha/live')));
  await assert.rejects(get(ref(alpha,'questionSets')));
  await assert.rejects(get(ref(alpha,'questionSets/legacy_alpha')));
  await assert.doesNotReject(get(ref(et,'questionSets/legacy_et')));
  await assert.rejects(get(ref(anonymous,'tentTrailTrivia')));
  await assert.doesNotReject(get(ref(student,'tentTrailTrivia')));
  await assert.rejects(get(ref(alpha,'tentTrailTrivia')));
  await assert.rejects(set(ref(alpha,'tentTrailTrivia/roundActive'),false));
  await assert.doesNotReject(get(ref(owner,'tentTrailTrivia')));
  await assert.doesNotReject(set(ref(owner,'tentTrailTrivia/roundActive'),false));
  await assert.doesNotReject(get(ref(alpha,'rashiLetters/progress/student_alpha')));
  await assert.rejects(get(ref(alpha,'rashiLetters/progress/student_beta')));
  await assert.doesNotReject(get(ref(student,'rashiLetters/progress/student_alpha')));
  await assert.rejects(get(ref(student,'rashiLetters/progress/student_beta')));
  await assert.rejects(get(ref(anonymous,'rashiLetters/progress/student_alpha')));
  await assert.doesNotReject(set(ref(student,'rashiLetters/progress/student_alpha/lastActive'),2));
  await assert.rejects(set(ref(student,'rashiLetters/progress/student_beta/lastActive'),2));
  await assert.doesNotReject(set(ref(student,'posukPractice/attempts/student_alpha/synthetic-attempt'),{score:3}));
  await assert.rejects(set(ref(student,'posukPractice/attempts/student_beta/synthetic-attempt'),{score:99}));
  await assert.rejects(set(ref(alpha,'posukPractice/attempts/student_alpha/synthetic-attempt'),{score:100}));
  await assert.doesNotReject(get(ref(student,'posukPractice/students/student_alpha')));
  await assert.rejects(get(ref(student,'posukPractice/students/student_beta')));
  await assert.doesNotReject(get(ref(alpha,'posukPractice/students/student_alpha')));
  await assert.rejects(get(ref(alpha,'posukPractice/students/student_beta')));
  await assert.rejects(get(ref(anonymous,'posukPractice/students/student_alpha')));
  await assert.doesNotReject(set(ref(student,'posukPractice/students/student_alpha'),{name:'Synthetic Alpha',lastActive:2}));
  await assert.rejects(set(ref(student,'posukPractice/students/student_beta'),{name:'forged',lastActive:3}));
  await assert.rejects(get(ref(anonymous,'posukPractice/settings')));
  await assert.doesNotReject(get(ref(student,'posukPractice/settings')));
  await assert.doesNotReject(set(ref(alpha,'posukPractice/settings/classPracticeLimits/alpha'),{allowAll:true}));
  await assert.rejects(set(ref(alpha,'posukPractice/settings/classPracticeLimits/beta'),{allowAll:true}));
  await assert.rejects(set(ref(alpha,'posukPractice/settings/practiceLimit'),{start:1,end:2}));
  await assert.rejects(set(ref(alpha,'posukPractice/settings/accessLocked'),true));
  await assert.rejects(set(ref(alpha,'posukPractice/settings/customUnsafeKey'),true));
  await assert.doesNotReject(set(ref(owner,'posukPractice/settings/practiceLimit'),{start:1,end:2}));
  await assert.doesNotReject(set(ref(owner,'posukPractice/settings/accessLocked'),true));
  await assert.rejects(get(ref(anonymous,'posukPractice/allowedStudents/student_alpha')));
  await assert.doesNotReject(get(ref(student,'posukPractice/allowedStudents/student_alpha')));
  await assert.rejects(get(ref(student,'posukPractice/allowedStudents/student_beta')));
  await assert.rejects(get(ref(alpha,'posukPractice/allowedStudents/student_alpha')));
  await assert.doesNotReject(get(ref(owner,'posukPractice/allowedStudents/student_beta')));
  await assert.rejects(get(ref(anonymous,'posukPractice/chazara/events/student_alpha')));
  await assert.doesNotReject(get(ref(student,'posukPractice/chazara/events/student_alpha')));
  await assert.rejects(get(ref(student,'posukPractice/chazara/events/student_beta')));
  await assert.doesNotReject(get(ref(alpha,'posukPractice/chazara/events/student_alpha')));
  await assert.rejects(get(ref(alpha,'posukPractice/chazara/events/student_beta')));
  await assert.doesNotReject(set(ref(student,'posukPractice/chazara/events/student_alpha/event_new'),{perek:1,posuk:2}));
  await assert.rejects(set(ref(student,'posukPractice/chazara/events/student_beta/event_forged'),{perek:1,posuk:2}));
  await assert.rejects(get(ref(anonymous,'posukPractice/shorashimLearning/students/student_alpha')));
  await assert.doesNotReject(get(ref(student,'posukPractice/shorashimLearning/students/student_alpha')));
  await assert.rejects(get(ref(student,'posukPractice/shorashimLearning/students/student_beta')));
  await assert.doesNotReject(set(ref(student,'posukPractice/shorashimLearning/students/student_alpha/cards/card_one'),{seen:true}));
  await assert.rejects(set(ref(student,'posukPractice/shorashimLearning/students/student_beta/cards/card_one'),{seen:true}));
  await assert.doesNotReject(get(ref(alpha,'posukPractice/shorashimLearning/students/student_alpha')));
  await assert.rejects(get(ref(alpha,'posukPractice/shorashimLearning/students/student_beta')));
  await assert.doesNotReject(get(ref(alpha,'posukPractice/shorashimLearning/classes/alpha/catalog')));
  await assert.rejects(get(ref(alpha,'posukPractice/shorashimLearning/classes/beta/catalog')));
  await assert.doesNotReject(set(ref(alpha,'posukPractice/shorashimLearning/classes/alpha/settings/minReviewMs'),700));
  await assert.rejects(set(ref(alpha,'posukPractice/shorashimLearning/classes/beta/settings/minReviewMs'),700));
  await assert.doesNotReject(get(ref(student,'posukPractice/shorashimLearning/catalog')));
  await assert.rejects(get(ref(anonymous,'posukPractice/shorashimLearning/catalog')));
  await assert.doesNotReject(set(ref(et,'posukPractice/shorashimLearning/catalog/cards/legacy'),{word:'Updated legacy'}));
  await assert.doesNotReject(get(ref(student,'rashiLetters/matchRooms/alpha-room')));
  await assert.rejects(get(ref(beta,'rashiLetters/matchRooms/alpha-room')));
  await assert.rejects(get(ref(anonymous,'rashiLetters/matchRooms/alpha-room')));
  await assert.doesNotReject(set(ref(student,'rashiLetters/matchRooms/alpha-room/state'),'finished'));
  await assert.rejects(set(ref(beta,'rashiLetters/matchRooms/alpha-room/state'),'finished'));
  await env.withSecurityRulesDisabled(async context=>{
    const {set}=require('firebase/database');
    await set(ref(context.database(),`${envPath}/teachers/teacher_alpha/active`),false);
  });
  await assert.rejects(get(ref(alpha,'b3Games/students/student_alpha/profile')));
  await assert.rejects(get(ref(alpha,'posukPractice/attempts/student_alpha')));
});
