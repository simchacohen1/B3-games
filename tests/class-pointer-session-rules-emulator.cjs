'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,set,get}=require('firebase/database');

const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase-rules.json'),'utf8')).rules;
const projectId='demo-class-pointer-session-rules';
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
const sessionPath=(classId)=>`b3Games/workspaces/b3-2026/classes/${classId}/classPointerSessions/${room}`;
const permissionRoomPath=(classId)=>`b3Private/classPointerSharePermissions/b3-2026/${classId}/${room}`;
const permissionPath=(classId,studentId)=>`${permissionRoomPath(classId)}/${studentId}`;

test('Realtime Database enforces assigned teacher, class grant, and ET/WT isolation for Class Pointer sessions',async()=>{
  const env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules:JSON.stringify({rules})}});
  try{
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.database();
      await Promise.all([
        set(ref(db,'b3Games/workspaces/b3-2026/classes/et'),{active:true,members:{student_a:{active:true},student_b:{active:true}}}),
        set(ref(db,'b3Games/workspaces/b3-2026/classes/wt'),{active:true}),
        set(ref(db,'b3Games/workspaces/b3-2026/classes/alpha'),{active:true,toolGrants:{'class-pointer':true}}),
        set(ref(db,'b3Games/workspaces/b3-2026/classes/no-grant'),{active:true}),
        set(ref(db,'b3Games/workspaces/b3-2026/classes/inactive'),{active:false,toolGrants:{'class-pointer':true}}),
        set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-et'),{active:true,classIds:{et:true,wt:false}}),
        set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-wt'),{active:true,classIds:{wt:true}}),
        set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-alpha'),{active:true,classIds:{alpha:true}}),
        set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-no-grant'),{active:true,classIds:{'no-grant':true}}),
        set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-inactive-class'),{active:true,classIds:{inactive:true}}),
        set(ref(db,'b3Games/workspaces/b3-2026/teachers/teacher-inactive'),{active:false,classIds:{wt:true}}),
        set(ref(db,'b3Games/admins/admin'),{active:true}),
        set(ref(db,'b3Games/students/student_a/profile'),{active:true}),
        set(ref(db,'b3Games/students/student_b/profile'),{active:true})
      ]);
    });
    const session={roomId:room,teacherUid:'teacher'};
    const write=(uid,classId,token={})=>set(ref(env.authenticatedContext(uid,token).database(),sessionPath(classId)),session);
    await assertSucceeds(write('teacher-et','et'));
    await assertFails(write('teacher-et','wt'));
    await assertSucceeds(write('teacher-wt','wt'));
    await assertFails(write('teacher-wt','et'));
    await assertSucceeds(write('teacher-alpha','alpha'));
    await assertFails(write('teacher-alpha','wt'));
    await assertFails(write('teacher-no-grant','no-grant'));
    await assertFails(write('teacher-inactive','wt'));
    await assertFails(write('teacher-inactive-class','inactive'));
    await assertFails(write('student','et',{b3StudentId:'student'}));
    await assertSucceeds(write('admin','et'));
    const teacherEt=env.authenticatedContext('teacher-et').database();
    const teacherWt=env.authenticatedContext('teacher-wt').database();
    // Ordinary Fun Torah student sessions carry b3StudentId/b3ClassId (not a
    // Firebase Auth role); permission flags are delivered by the passcode-checked
    // authorization endpoint so no student identity can read the stored map.
    const studentA=env.authenticatedContext('student-a',{b3StudentId:'student_a',b3ClassId:'et'}).database();
    const studentB=env.authenticatedContext('student-b',{b3StudentId:'student_b',b3ClassId:'et'}).database();
    const wrongClass=env.authenticatedContext('student-a-wt',{b3StudentId:'student_a',b3ClassId:'wt'}).database();
    const stranger=env.authenticatedContext('stranger',{b3StudentId:'stranger',b3ClassId:'et'}).database();
    const anonymous=env.unauthenticatedContext().database();
    await assertSucceeds(set(ref(teacherEt,permissionRoomPath('et')),{student_a:{screenSharingDenied:true},student_b:{whiteboardDenied:true}}));
    await assertFails(get(ref(studentA,permissionPath('et','student_a'))));
    await assertFails(get(ref(studentA,permissionPath('et','student_b'))));
    await assertFails(get(ref(studentB,permissionPath('et','student_b'))));
    await assertFails(get(ref(anonymous,permissionPath('et','student_a'))));
    await assertFails(get(ref(wrongClass,permissionPath('et','student_a'))));
    await assertFails(get(ref(stranger,permissionPath('et','stranger'))));
    await assertFails(set(ref(studentA,permissionPath('et','student_a')),{screenSharingDenied:false}));
    await assertSucceeds(set(ref(teacherWt,permissionRoomPath('wt')),{student_a:{screenSharingDenied:true}}));
    await assertFails(set(ref(teacherWt,permissionRoomPath('et')),{student_b:{screenSharingDenied:true}}));
  }finally{
    await env.cleanup();
  }
});
