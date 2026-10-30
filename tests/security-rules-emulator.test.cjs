'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {get,ref,set}=require('firebase/database');

const projectId='demo-b3-security';
const rules=fs.readFileSync('firebase-rules.hardened.json','utf8');
const emulatorEnabled=process.env.B3_RUN_RTDB_EMULATOR_TESTS==='1';
const emulatorPort=Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT||19100);
const testEmulator=emulatorEnabled?test:test.skip;
let env;

test.before(async()=>{
  if(!emulatorEnabled)return;
  env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:emulatorPort,rules}});
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.database();
    const fixtures={
      'b3Games/students/synthetic_one/profile':{name:'Synthetic One',active:true,classId:'alpha'},
      'b3Games/students/synthetic_one/memberships/b3-2026_alpha':{workspaceId:'b3-2026',classId:'alpha',active:true},
      'b3Games/students/synthetic_two/profile':{name:'Synthetic Two',active:true,classId:'beta'},
      'b3Games/students/synthetic_two/memberships/b3-2026_beta':{workspaceId:'b3-2026',classId:'beta',active:true},
      'b3Games/workspaces/b3-2026/classes/alpha':{name:'Synthetic Alpha',active:true,members:{synthetic_one:{active:true},synthetic_friend:{active:true}},toolGrants:{chazara:true,'class-pointer':true},classPointerSessions:{'class-pointer-alpha':{roomId:'class-pointer-alpha',teacherUid:'teacher_alpha',createdAt:1700000000000,studentScreenSharing:true}}},
      'b3Games/workspaces/b3-2026/classes/beta':{name:'Synthetic Beta',active:true,members:{synthetic_two:{active:true}},toolGrants:{chazara:true,'class-pointer':true},classPointerSessions:{'class-pointer-beta':{roomId:'class-pointer-beta',teacherUid:'teacher_beta',createdAt:1700000000000,studentScreenSharing:true}}},
      'b3Games/workspaces/b3-2026/teachers/teacher_alpha':{active:true,classIds:{alpha:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_beta':{active:true,classIds:{beta:true}},
      'b3Games/workspaces/b3-2026/classes/et':{active:true,members:{synthetic_et:{active:true}},toolGrants:{chazara:true},classPointerSessions:{'class-pointer-et':{roomId:'class-pointer-et',teacherUid:'teacher_et',createdAt:1700000000000,studentScreenSharing:true}}},
      'b3Games/workspaces/b3-2026/classes/wt':{active:true,members:{synthetic_wt:{active:true}},toolGrants:{chazara:true},classPointerSessions:{'class-pointer-wt':{roomId:'class-pointer-wt',teacherUid:'teacher_wt',createdAt:1700000000000,studentScreenSharing:true}}},
      'b3Games/students/synthetic_et/profile':{name:'Synthetic East',active:true,classId:'et'},
      'b3Games/students/synthetic_wt/profile':{name:'Synthetic West',active:true,classId:'wt'},
      'b3Games/workspaces/b3-2026/teachers/teacher_et':{active:true,classIds:{et:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_wt':{active:true,classIds:{wt:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_inactive':{active:false,classIds:{et:true,alpha:true,wt:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_multi':{active:true,classIds:{alpha:true}},
      'b3Games/workspaces/b3-2026/teachers/teacher_unassigned':{active:true,classIds:{beta:true}},
      'b3Games/workspaces/b3-2026/teacherInvites':{
        alpha_example_test:{email:'alpha@example.test',active:true,classIds:{alpha:true}},
        beta_example_test:{email:'beta@example.test',active:true,classIds:{beta:true}},
        pending_example_test:{email:'pending@example.test',active:false,classIds:{}}
      },
      'posukPractice/shorashimLearning/students/synthetic_one':{name:'Synthetic One',cards:{}},
      'posukPractice/shorashimLearning/students/synthetic_two':{name:'Synthetic Two',cards:{}},
      'posukPractice/shorashimLearning/recordingEvents/synthetic_one/event_one':{type:'start',at:1},
      'posukPractice/shorashimLearning/recordingEvents/synthetic_two/event_two':{type:'start',at:2},
      'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_one':{wins:3},
      'posukPractice/shorashimLearning/leaderboards/match/8/synthetic_two':{wins:4},
      'posukPractice/settings/classPracticeLimits/alpha':{allowAll:true},
      'classGallery/posts/post_alpha':{studentId:'synthetic_one',classId:'alpha',status:'pending',title:'Synthetic alpha'},
      'classGallery/posts/post_beta':{studentId:'synthetic_two',classId:'beta',status:'pending',title:'Synthetic beta'},
      'b3Games/workspaces/b3-2026/classes/alpha/resources/gallery/posts/modern_pending':{studentId:'synthetic_friend',classId:'alpha',status:'pending',title:'Synthetic private post'},
      'rashiLetters/matchRooms/1234':{host:'synthetic_one',hostName:'Synthetic One',classId:'alpha',state:'lobby',createdAt:1,questions:[],players:{synthetic_one:{name:'Synthetic One',score:0,q:0}}},
      'questionSets/vayeira18':{title:'Synthetic legacy',questions:[{q:'Synthetic question',ans:'private answer'}]},
      'questionSets/classes/alpha/set':{title:'Synthetic alpha',questions:[{q:'Synthetic alpha question',ans:'private answer'}]},
      'questionSets/classes/beta/set':{title:'Synthetic beta',questions:[{q:'Synthetic beta question',ans:'private answer'}]},
      'questionSets/classes/alpha/live':{roundActive:true,qIndex:0,scores:{'Synthetic One':0}},
      'studentRewards/students/reward_one':{id:'reward_one',b3StudentId:'synthetic_one',classId:'b3_alpha',rewardBalance:5},
      'studentRewards/students/reward_two':{id:'reward_two',b3StudentId:'synthetic_two',classId:'b3_beta',rewardBalance:7},
      'studentRewards/classes/b3_alpha':{id:'b3_alpha',name:'Synthetic Alpha',active:true,b3ClassId:'alpha'},
      'studentRewards/classes/b3_beta':{id:'b3_beta',name:'Synthetic Beta',active:true,b3ClassId:'beta'},
      'studentRewards/refundRequests/reward_one/old':{status:'pending',amount:2},
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

testEmulator('unauthorized users cannot enumerate teacher invitations',async()=>{
  const anonymous=env.unauthenticatedContext().database();
  const alpha=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  const beta=db('teacher_beta',{email:'beta@example.test',email_verified:true});
  const owner=db('owner',{email:'simcha5770@gmail.com',email_verified:true});
  const invites='b3Games/workspaces/b3-2026/teacherInvites';
  await fails(get(ref(anonymous,'b3Games')));
  await fails(get(ref(anonymous,invites)));
  await fails(get(ref(alpha,invites)));
  await succeeds(get(ref(alpha,invites+'/alpha_example_test')));
  await fails(get(ref(alpha,invites+'/beta_example_test')));
  await fails(get(ref(beta,invites+'/alpha_example_test')));
  await succeeds(get(ref(owner,invites)));
  await fails(set(ref(alpha,invites+'/alpha_example_test/active'),false));
});

testEmulator('Class Pointer session metadata is readable only inside its active assigned class',async()=>{
  const anonymous=env.unauthenticatedContext().database();
  const alphaTeacher=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  const betaTeacher=db('teacher_beta',{email:'beta@example.test',email_verified:true});
  const inactiveTeacher=db('teacher_inactive',{email:'inactive@example.test',email_verified:true});
  const alphaStudent=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  const betaStudent=db('student-two',{b3StudentId:'synthetic_two',b3ClassId:'beta',b3StudentRole:'student'});
  const etStudent=db('student-et',{b3StudentId:'synthetic_et',b3ClassId:'et',b3StudentRole:'student'});
  const wtTeacher=db('teacher_wt',{email:'wt@example.test',email_verified:true});
  const alphaPath='b3Games/workspaces/b3-2026/classes/alpha/classPointerSessions/class-pointer-alpha';
  const betaPath='b3Games/workspaces/b3-2026/classes/beta/classPointerSessions/class-pointer-beta';
  const etPath='b3Games/workspaces/b3-2026/classes/et/classPointerSessions/class-pointer-et';
  const wtPath='b3Games/workspaces/b3-2026/classes/wt/classPointerSessions/class-pointer-wt';
  await fails(get(ref(anonymous,alphaPath)));
  await succeeds(get(ref(alphaTeacher,alphaPath)));
  await succeeds(get(ref(alphaStudent,alphaPath)));
  await fails(get(ref(alphaStudent,betaPath)));
  await fails(get(ref(betaTeacher,alphaPath)));
  await fails(get(ref(inactiveTeacher,etPath)));
  await succeeds(get(ref(etStudent,etPath)));
  await fails(get(ref(etStudent,wtPath)));
  await succeeds(set(ref(alphaTeacher,alphaPath+'/shareRequest'),{at:Date.now()}));
  await succeeds(set(ref(alphaTeacher,alphaPath+'/studentScreenSharing'),false));
  await fails(set(ref(betaTeacher,alphaPath+'/studentScreenSharing'),false));
  await fails(set(ref(alphaStudent,alphaPath+'/studentScreenSharing'),false));
  await succeeds(get(ref(wtTeacher,wtPath)));
  await fails(set(ref(wtTeacher,wtPath+'/screenSharingDenied/synthetic_et'),true));
});

testEmulator('assigned students can read their class name and tool grants, but not another class settings',async()=>{
  const alphaStudent=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  const betaStudent=db('student-two',{b3StudentId:'synthetic_two',b3ClassId:'beta',b3StudentRole:'student'});
  const anonymous=env.unauthenticatedContext().database();
  const base='b3Games/workspaces/b3-2026/classes/';
  const alphaName=await get(ref(alphaStudent,base+'alpha/name'));
  const alphaTools=await get(ref(alphaStudent,base+'alpha/toolGrants'));
  assert.equal(alphaName.val(),'Synthetic Alpha');
  assert.equal(alphaTools.val()['class-pointer'],true);
  const betaName=await get(ref(betaStudent,base+'beta/name'));
  const betaTools=await get(ref(betaStudent,base+'beta/toolGrants'));
  assert.equal(betaName.val(),'Synthetic Beta');
  assert.equal(betaTools.val()['class-pointer'],true);
  await fails(get(ref(alphaStudent,base+'beta/name')));
  await fails(get(ref(alphaStudent,base+'beta/toolGrants')));
  await fails(get(ref(anonymous,base+'alpha/name')));
  const classRule=JSON.parse(rules).rules.b3Games.workspaces['$workspaceId'].classes['$classId'];
  assert.ok(classRule.name,'class name rules must be attached directly to the class record');
  assert.ok(classRule.toolGrants,'tool-grant rules must be attached directly to the class record');
  assert.equal(classRule.resources.name,undefined,'class metadata must not be nested under resources');
  assert.equal(classRule.resources.toolGrants,undefined,'class metadata must not be nested under resources');
});

testEmulator('assigned teachers can start sessions and write private share settings only for their class',async()=>{
  const alphaTeacher=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  const betaTeacher=db('teacher_beta',{email:'beta@example.test',email_verified:true});
  const unassigned=db('teacher_unassigned',{email:'unassigned@example.test',email_verified:true});
  const inactive=db('teacher_inactive',{email:'inactive@example.test',email_verified:true});
  const noGrantTeacher=db('teacher_no_grant',{email:'no-grant@example.test',email_verified:true});
  const student=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  const room='class-pointer-12345678-1234-1234-1234-123456789abc';
  const sessionPath='b3Games/workspaces/b3-2026/classes/alpha/classPointerSessions/'+room;
  const alphaPermissions='b3Private/classPointerSharePermissions/b3-2026/alpha/'+room;
  const betaPermissions='b3Private/classPointerSharePermissions/b3-2026/beta/'+room;
  const noGrantPermissions='b3Private/classPointerSharePermissions/b3-2026/no-grant/'+room;
  await succeeds(set(ref(alphaTeacher,sessionPath),{roomId:room,teacherUid:'teacher_alpha',createdAt:Date.now(),studentScreenSharing:false}));
  await succeeds(set(ref(alphaTeacher,alphaPermissions),{synthetic_one:{screenSharingDenied:true,whiteboardDenied:false}}));
  await fails(set(ref(betaTeacher,alphaPermissions),{synthetic_one:{screenSharingDenied:false}}));
  await fails(set(ref(unassigned,alphaPermissions),{synthetic_one:{screenSharingDenied:false}}));
  await fails(set(ref(inactive,alphaPermissions),{synthetic_one:{screenSharingDenied:false}}));
  await fails(set(ref(noGrantTeacher,noGrantPermissions),{synthetic_one:{screenSharingDenied:false}}));
  await fails(set(ref(student,alphaPermissions),{synthetic_one:{screenSharingDenied:false}}));
  await fails(get(ref(student,alphaPermissions+'/synthetic_one')));
  await fails(set(ref(alphaTeacher,betaPermissions),{synthetic_two:{screenSharingDenied:true}}));
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

testEmulator('Posuk Practice limits require an active teacher assignment',async()=>{
  const alpha=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  const inactive=db('teacher_inactive',{email:'inactive@example.test',email_verified:true});
  await succeeds(set(ref(alpha,'posukPractice/settings/classPracticeLimits/alpha'),{allowAll:false,max:5}));
  await fails(set(ref(alpha,'posukPractice/settings/classPracticeLimits/beta'),{allowAll:false,max:5}));
  await fails(set(ref(inactive,'posukPractice/settings/classPracticeLimits/alpha'),{allowAll:false,max:5}));
});

testEmulator('Gallery reads are class scoped and students cannot overwrite a peer post',async()=>{
  const one=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  const teacher=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  await fails(get(ref(one,'classGallery/posts/post_alpha')));
  await fails(get(ref(one,'classGallery/posts/post_beta')));
  await fails(get(ref(one,'b3Games/workspaces/b3-2026/classes/alpha/resources/gallery/posts')));
  await fails(get(ref(one,'b3Games/workspaces/b3-2026/classes/alpha/resources/gallery/posts/modern_pending')));
  await succeeds(set(ref(one,'b3Games/workspaces/b3-2026/classes/alpha/resources/gallery/posts/own_new'),{studentId:'synthetic_one',classId:'alpha',status:'pending',title:'Synthetic own post'}));
  await fails(set(ref(one,'b3Games/workspaces/b3-2026/classes/alpha/resources/gallery/posts/forged'),{studentId:'synthetic_friend',classId:'alpha',status:'pending',title:'Synthetic forged post'}));
  await succeeds(get(ref(teacher,'classGallery/posts/post_alpha')));
  await fails(get(ref(teacher,'classGallery/posts/post_beta')));
  await succeeds(get(ref(teacher,'b3Games/workspaces/b3-2026/classes/alpha/resources/gallery/posts/modern_pending')));
  await fails(set(ref(one,'classGallery/posts/post_beta'),{studentId:'synthetic_one',classId:'alpha',status:'pending'}));
  await fails(set(ref(one,'classGallery/posts/post_alpha'),{studentId:'synthetic_one',classId:'alpha',status:'approved'}));
});

testEmulator('Rashi progress and match rooms remain inside the authenticated class',async()=>{
  const one=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  const beta=db('student-two',{b3StudentId:'synthetic_two',b3ClassId:'beta',b3StudentRole:'student'});
  const friend=db('student-friend',{b3StudentId:'synthetic_friend',b3ClassId:'alpha',b3StudentRole:'student'});
  const teacher=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  await succeeds(get(ref(teacher,'rashiLetters/progress/synthetic_one')));
  await fails(get(ref(teacher,'rashiLetters/progress/synthetic_two')));
  await succeeds(get(ref(one,'rashiLetters/matchRooms/1234')));
  await succeeds(get(ref(friend,'rashiLetters/matchRooms/1234')));
  await fails(get(ref(beta,'rashiLetters/matchRooms/1234')));
  await fails(set(ref(beta,'rashiLetters/matchRooms/1234'),{host:'synthetic_two',classId:'beta',players:{synthetic_two:{name:'Synthetic Two'}}}));
  await succeeds(set(ref(one,'rashiLetters/matchRooms/new_room'),{host:'synthetic_one',hostName:'Synthetic One',classId:'alpha',state:'lobby',createdAt:2,questions:[],players:{synthetic_one:{name:'Synthetic One',score:0,q:0}}}));
  await succeeds(set(ref(friend,'rashiLetters/matchRooms/1234/players/synthetic_friend'),{name:'Synthetic Friend',score:0,q:0}));
  await fails(set(ref(friend,'rashiLetters/matchRooms/1234/players/synthetic_one/score'),100));
  await fails(set(ref(friend,'rashiLetters/matchRooms/new_room/state'),'ended'));
});

testEmulator('Game Show answer keys stay teacher only and students cannot alter live scores',async()=>{
  const one=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student'});
  const teacher=db('teacher_alpha',{email:'alpha@example.test',email_verified:true});
  const etTeacher=db('teacher_et',{email:'et@example.test',email_verified:true});
  const betaTeacher=db('teacher_beta',{email:'beta@example.test',email_verified:true});
  await fails(get(ref(one,'questionSets/classes/alpha/set')));
  await fails(get(ref(one,'questionSets/vayeira18')));
  await succeeds(get(ref(teacher,'questionSets/classes/alpha/set')));
  await succeeds(get(ref(etTeacher,'questionSets/vayeira18')));
  await fails(get(ref(betaTeacher,'questionSets/classes/alpha/set')));
  await succeeds(get(ref(one,'questionSets/classes/alpha/live')));
  await fails(set(ref(one,'questionSets/classes/alpha/live/scores/Synthetic One'),100));
  await fails(set(ref(one,'questionSets/classes/alpha/live/buzzedBy'),'Synthetic One'));
  await succeeds(set(ref(teacher,'questionSets/classes/alpha/live/roundActive'),false));
});

testEmulator('Student Rewards own paths work while peer data and direct awards stay private',async()=>{
  const one=db('student-one',{b3StudentId:'synthetic_one',b3ClassId:'alpha',b3StudentRole:'student',studentRewardsStudentId:'reward_one',studentRewardsClassId:'b3_alpha'});
  const two=db('student-two',{b3StudentId:'synthetic_two',b3ClassId:'beta',b3StudentRole:'student',studentRewardsStudentId:'reward_two',studentRewardsClassId:'b3_beta'});
  const owner=db('owner',{email:'simcha5770@gmail.com',email_verified:true});
  await succeeds(get(ref(one,'studentRewards/students/reward_one')));
  await fails(get(ref(one,'studentRewards/students/reward_two')));
  await succeeds(get(ref(one,'studentRewards/rewards')));
  await fails(get(ref(one,'studentRewards')));
  await fails(get(ref(one,'studentRewards/pointHistoryIndex/reward_one')));
  await fails(set(ref(one,'studentRewards/pointHistoryIndex/reward_one/requests/request_one'),true));
  await fails(set(ref(one,'studentRewards/students/reward_one/rewardBalance'),999));
  await succeeds(set(ref(one,'studentRewards/refundRequests/reward_one/new'),{status:'pending',amount:2}));
  await fails(set(ref(two,'studentRewards/refundRequests/reward_one/other'),{status:'pending',amount:2}));
  await succeeds(set(ref(one,'studentRewards/refundRequests/reward_one/old'),null));
  await succeeds(get(ref(owner,'studentRewards/students')));
  await fails(get(ref(owner,'studentRewards/privateAuth')));
});
