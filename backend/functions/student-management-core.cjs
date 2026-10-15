'use strict';
const {randomUUID}=require('node:crypto');
const {PRIVATE,clean,readPasscode,passcodeWrites}=require('./student-passcodes.cjs');
const tools=require('./student-tool-policy.js');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
// Owner-only: copy every passcode into private storage, and optionally erase
// the old public copies (profiles, class members, legacy allowedStudents).
async function migratePasscodes(store,deletePublic,now,{dryRun=false}={}){
 const [students,legacy,classes,priv]=await Promise.all([
  store.get('b3Games/students'),
  store.get('posukPractice/allowedStudents'),
  store.get('b3Games/workspaces/b3-2026/classes'),
  store.get('b3Private/passcodes')
 ]);
 const membersByStudent={};
 for(const [classId,cls] of Object.entries(classes||{})){
  if(!key(classId))continue;
  for(const [id,member] of Object.entries(cls?.members||{})){
   if(!key(id)||!member||typeof member!=='object')continue;
   (membersByStudent[id]??=[]).push({classId,member});
  }
 }
 // Include class-only records: they can contain a passcode even without a
 // central profile or legacy allowedStudents entry.
 const ids=new Set([
  ...Object.keys(students||{}),
  ...Object.keys(legacy||{}),
  ...Object.keys(membersByStudent),
  ...Object.keys(priv||{})
 ].filter(key));
 const updates={},conflicts=[],unmatched=[];
 let copied=0,alreadyPrivate=0,cleared=0;
 for(const id of ids){
  const profile=students?.[id]?.profile||null;
  const old=legacy?.[id]||null;
  const memberRows=membersByStudent[id]||[];
  const saved=clean(priv?.[id]?.passcode);
  const publicCodes=[profile?.passcode,old?.passcode,...memberRows.map(row=>row.member.passcode)]
   .map(clean).filter(Boolean);
  const distinct=[...new Set(publicCodes)];
  // A class member without a central or legacy student record cannot be
  // matched by the current sign-in flow. Flag it before deleting the fallback.
  if(!profile&&!old&&memberRows.length&&publicCodes.length)unmatched.push(id);
  // Do not choose arbitrarily between different public PINs. Doing so could
  // change the credential a student needs to sign in.
  if(!saved&&distinct.length>1){conflicts.push(id);continue;}
  if(saved)alreadyPrivate++;
  else if(distinct.length===1){
   updates[PRIVATE+id]={passcode:distinct[0],updatedAt:now};copied++;
  }
  if(!deletePublic)continue;
  if(profile&&Object.hasOwn(profile,'passcode')){
   updates['b3Games/students/'+id+'/profile/passcode']=null;cleared++;
  }
  if(old&&Object.hasOwn(old,'passcode')){
   updates['posukPractice/allowedStudents/'+id+'/passcode']=null;cleared++;
  }
  for(const row of memberRows){
   if(Object.hasOwn(row.member,'passcode')){
    updates['b3Games/workspaces/b3-2026/classes/'+row.classId+'/members/'+id+'/passcode']=null;cleared++;
   }
  }
 }
 // Preview does not write or expose passcode values.
 if(dryRun)return {ok:true,dryRun:true,copied,alreadyPrivate,cleared,conflicts,unmatched};
 // Never start a destructive cleanup if any student has ambiguous credentials.
 if(deletePublic&&(conflicts.length||unmatched.length))fail(409,'Cannot remove public passcodes: '+conflicts.length+' students have conflicting credentials and '+unmatched.length+' class-only records need a central profile. Review the preview and resolve these records first.');
 if(Object.keys(updates).length)await store.update(updates);
 return {ok:true,copied,alreadyPrivate,cleared,conflicts,unmatched};
}

async function manageStudents(store,identity,body,now=Date.now()){
 if(!identity?.uid||identity.email_verified!==true||identity.firebase?.sign_in_provider!=='google.com')fail(403,'Verified Google teacher sign-in required.');
 const root='b3Games/workspaces/b3-2026',classId=body.classId;
 // The owner account and any active site administrator count as owner here.
 const owner=String(identity.email||'').toLowerCase()==='simcha5770@gmail.com'||(await store.get('b3Games/admins/'+identity.uid))?.active===true;
 if(body.action==='migratePasscodes'){if(!owner)fail(403,'Owner access required.');return migratePasscodes(store,body.deletePublic===true,now,{dryRun:body.dryRun===true});}
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
 }else if(body.action==='studentTools'){
  if(profile.active===false||cls.members[id].active===false)fail(403,'This student is inactive.');
  const choices=body.toolAccess;
  if(!choices||typeof choices!=='object'||Array.isArray(choices)||!Object.keys(choices).length||Object.keys(choices).length>50)fail(400,'Choose student tools.');
  for(const [tool,enabled] of Object.entries(choices)){
   const ownerLegacy=owner&&['et','wt'].includes(classId)&&tools.studentActivities.includes(tool);
   if(!key(tool)||typeof enabled!=='boolean'||(!tools.granted(cls,tool)&&!ownerLegacy))fail(403,'Only tools enabled by the administrator can be assigned.');
   for(const alias of tools.aliases(tool))updates[memberPath+'/toolAccess/'+alias]=enabled?null:false;
  }
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
  updates[memberPath]=null;updates[membershipPath]={workspaceId:'b3-2026',classId,active:false,removedAt:now};
 }else if(body.action==='add'){
  updates[memberPath]={studentId:id,name:profile.name||id,active:true};
  updates[membershipPath]={workspaceId:'b3-2026',classId,active:true};
 }else fail(400,'Unknown student management action.');
 updates[root+'/classes/'+classId+'/managementAudit/'+randomUUID()]={action:body.action,studentId:id,teacherUid:identity.uid,at:now};
 await store.update(updates);return {ok:true,studentId:id};
}
module.exports={manageStudents};
