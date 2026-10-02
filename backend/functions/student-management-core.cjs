'use strict';
const {randomUUID}=require('node:crypto');
const {PRIVATE,clean,readPasscode,passcodeWrites}=require('./student-passcodes.cjs');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
// Owner-only: copy every passcode into private storage, and optionally erase
// the old public copies (profiles, class members, legacy allowedStudents).
async function migratePasscodes(store,deletePublic,now){
 const [students,legacy,classes,priv]=await Promise.all([store.get('b3Games/students'),store.get('posukPractice/allowedStudents'),store.get('b3Games/workspaces/b3-2026/classes'),store.get('b3Private/passcodes')]);
 const updates={},ids=new Set([...Object.keys(students||{}),...Object.keys(legacy||{})].filter(key));
 let copied=0,alreadyPrivate=0,cleared=0;
 for(const id of ids){
  const memberCodes=[...new Set(Object.values(classes||{}).map(c=>clean(c?.members?.[id]?.passcode)).filter(Boolean))];
  const found=clean(students?.[id]?.profile?.passcode)||(memberCodes.length===1?memberCodes[0]:'')||clean(legacy?.[id]?.passcode);
  if(clean(priv?.[id]?.passcode))alreadyPrivate++;
  else if(found){updates[PRIVATE+id]={passcode:found,updatedAt:now};copied++;}
 }
 if(deletePublic){
  for(const [id,row] of Object.entries(students||{}))if(row?.profile&&row.profile.passcode!==undefined){updates['b3Games/students/'+id+'/profile/passcode']=null;cleared++;}
  for(const [cid,c] of Object.entries(classes||{}))for(const [id,m] of Object.entries(c?.members||{}))if(m&&m.passcode!==undefined){updates['b3Games/workspaces/b3-2026/classes/'+cid+'/members/'+id+'/passcode']=null;cleared++;}
  for(const [id,row] of Object.entries(legacy||{}))if(row&&row.passcode!==undefined){updates['posukPractice/allowedStudents/'+id+'/passcode']=null;cleared++;}
 }
 if(Object.keys(updates).length)await store.update(updates);
 return {ok:true,copied,alreadyPrivate,cleared};
}

async function manageStudents(store,identity,body,now=Date.now()){
 if(!identity?.uid||identity.email_verified!==true||identity.firebase?.sign_in_provider!=='google.com')fail(403,'Verified Google teacher sign-in required.');
 const root='b3Games/workspaces/b3-2026',classId=body.classId;
 const owner=String(identity.email||'').toLowerCase()==='simcha5770@gmail.com';
 if(body.action==='migratePasscodes'){if(!owner)fail(403,'Owner access required.');return migratePasscodes(store,body.deletePublic===true,now);}
 if(body.action==='list'&&owner&&body.all===true){
  const [students,legacy]=await Promise.all([store.get('b3Games/students'),store.get('posukPractice/allowedStudents')]);
  const passcodes={};for(const id of new Set([...Object.keys(students||{}),...Object.keys(legacy||{})].filter(key)))passcodes[id]=(await readPasscode(store.get,id,{allowLegacyDefault:true})).passcode;
  return {ok:true,passcodes};
 }
 if(!key(classId))fail(400,'Choose a class.');
 const teacher=owner?null:await store.get(root+'/teachers/'+identity.uid);
 if(!owner&&(!teacher||teacher.active===false||teacher.classIds?.[classId]!==true))fail(403,'This class is not assigned to your teacher account.');
 const cls=await store.get(root+'/classes/'+classId);
 if(!cls||cls.active===false)fail(403,'This class is inactive.');
 if(body.action==='list'){
  const passcodes={};for(const id of Object.keys(cls.members||{}).filter(key))passcodes[id]=(await readPasscode(store.get,id,{allowLegacyDefault:true})).passcode;
  return {ok:true,passcodes};
 }
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
  profile={id,name,active:true,createdAt:now,createdBy:identity.uid,passcodeUpdatedAt:now};
  updates[profilePath]=profile;
  updates[PRIVATE+id]={passcode,updatedAt:now};
  updates[memberPath]={studentId:id,name,active:true};
  updates[membershipPath]={workspaceId:'b3-2026',classId,active:true};
 }else if(body.action==='passcode'){
  const passcode=String(body.passcode||'').trim();if(!passcode||passcode.length>100)fail(400,'Enter an individual passcode.');
  Object.assign(updates,passcodeWrites(id,passcode,now));
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
