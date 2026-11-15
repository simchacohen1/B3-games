'use strict';
// Test helper only. Writes exactly what the OLD "create" action wrote before it
// gained a duplicate check: a new account every time, even for a name and
// passcode that already exist. Tests use it to rebuild the mistaken imports of
// 2026-11-09 with fictional students; the real action now refuses those.
const {randomUUID}=require('node:crypto');
async function legacyCreate(store,identity,{classId,name,passcode},now=Date.now()){
 const id='student_'+randomUUID().replaceAll('-',''),root='b3Games/workspaces/b3-2026';
 await store.update({
  ['b3Games/students/'+id+'/profile']:{id,name,active:true,createdAt:now,createdBy:identity.uid,passcodeUpdatedAt:now},
  ['b3Private/passcodes/'+id]:{passcode,updatedAt:now},
  [root+'/classes/'+classId+'/members/'+id]:{studentId:id,name,active:true},
  ['b3Games/students/'+id+'/memberships/b3-2026_'+classId]:{workspaceId:'b3-2026',classId,active:true},
  [root+'/classes/'+classId+'/managementAudit/'+randomUUID()]:{action:'create',studentId:id,teacherUid:identity.uid,at:now}
 });
 return {ok:true,studentId:id};
}
module.exports={legacyCreate};
