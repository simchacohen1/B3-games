'use strict';
const {randomUUID}=require('node:crypto');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
async function manageStudents(store,identity,body,now=Date.now()){
 if(!identity?.uid||identity.email_verified!==true||identity.firebase?.sign_in_provider!=='google.com')fail(403,'Verified Google teacher sign-in required.');
 const root='b3Games/workspaces/b3-2026',classId=body.classId;
 if(!key(classId))fail(400,'Choose a class.');
 const owner=String(identity.email||'').toLowerCase()==='simcha5770@gmail.com';
 const teacher=owner?null:await store.get(root+'/teachers/'+identity.uid);
 if(!owner&&(!teacher||teacher.active===false||teacher.classIds?.[classId]!==true))fail(403,'This class is not assigned to your teacher account.');
 const cls=await store.get(root+'/classes/'+classId);
 if(!cls||cls.active===false)fail(403,'This class is inactive.');
 let id=body.studentId,profile;
 if(body.action==='create')id='student_'+randomUUID().replaceAll('-','');
 else{
  if(!key(id))fail(400,'Choose a student.');
  profile=await store.get('b3Games/students/'+id+'/profile');
  if(!profile)fail(404,'Student profile not found.');
  if(body.action==='add'){
   const memberships=await store.get('b3Games/students/'+id+'/memberships')||{};
   if(!owner&&!Object.values(memberships).some(m=>m&&m.active!==false&&m.workspaceId==='b3-2026'&&teacher.classIds?.[m.classId]===true))fail(403,'This student is not assigned to your classes.');
  }else if(!cls.members?.[id])fail(403,'This student is not a member of the selected class.');
 }
 const memberPath=root+'/classes/'+classId+'/members/'+id,membershipPath='b3Games/students/'+id+'/memberships/b3-2026_'+classId,profilePath='b3Games/students/'+id+'/profile',updates={};
 if(body.action==='create'){
  const name=String(body.name||'').trim(),passcode=String(body.passcode||'').trim();
  if(!name||name.length>100||!passcode||passcode.length>100)fail(400,'Enter a student name and individual passcode.');
  profile={id,name,passcode,active:true,createdAt:now,createdBy:identity.uid,passcodeUpdatedAt:now};
  updates[profilePath]=profile;
  updates[memberPath]={studentId:id,name,active:true};
  updates[membershipPath]={workspaceId:'b3-2026',classId,active:true};
 }else if(body.action==='passcode'){
  const passcode=String(body.passcode||'').trim();if(!passcode||passcode.length>100)fail(400,'Enter an individual passcode.');
  updates[profilePath+'/passcode']=passcode;updates[profilePath+'/passcodeUpdatedAt']=now;
  // Remove redundant copies from this class; the central profile is authoritative.
  updates[memberPath+'/passcode']=null;
 }else if(body.action==='active'){
  if(typeof body.active!=='boolean')fail(400,'Choose enabled or blocked.');
  updates[memberPath+'/active']=body.active;
  updates[membershipPath]={workspaceId:'b3-2026',classId,active:body.active};
 }else if(body.action==='remove'){
  updates[memberPath]=null;updates[membershipPath]=null;
 }else if(body.action==='add'){
  updates[memberPath]={studentId:id,name:profile.name||id,active:true};
  updates[membershipPath]={workspaceId:'b3-2026',classId,active:true};
 }else fail(400,'Unknown student management action.');
 updates[root+'/classes/'+classId+'/managementAudit/'+randomUUID()]={action:body.action,studentId:id,teacherUid:identity.uid,at:now};
 await store.update(updates);return {ok:true,studentId:id};
}
module.exports={manageStudents};
