'use strict';
// Owner bulk roster import (Issue #706).
//
// One student = one account, with one membership per class. The browser parses
// the CSV (bulk-roster.js) and sends one entry per student; this module decides,
// on the server, which accounts to create and which existing accounts only get
// extra classes, and records every write in a batch record so the import can be
// resumed and rolled back exactly.
//
// Matching rules (never by name alone):
//  1. A student already created by THIS batch (same file) is that account.
//  2. A Student ID column value matches profile.rosterId, or an internal ID
//     whose profile has the same name.
//  3. Otherwise, if any active student has the same name, the row is a
//     CONFLICT until the owner decides: "same student" (pick which) or
//     "new student". "New" is refused when the passcode is also the same,
//     because then neither child could sign in.
//  4. No same-name student: a new account.
const crypto=require('node:crypto');
const {PRIVATE,clean,readPasscode,equal}=require('./student-passcodes.cjs');
const {loadStudentProfiles}=require('./student-directory.cjs');

const WS='b3-2026',ROOT='b3Games/workspaces/'+WS;
const BATCHES='b3Private/importBatches/';
const AUDIT='b3Private/studentAudit/';
const fail=(code,message,extra)=>{throw Object.assign(new Error(message),{code},extra);};
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
const nameKey=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const classKey=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[·�]/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
const cleanName=s=>String(s||'').replace(/[\t\r\n]+/g,' ').replace(/ {2,}/g,' ').trim();
const slug=s=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSCODE=/^[0-9]{6}$/;
const MAX_STUDENTS=2000,MAX_STAFF=300,MAX_CLASSES=300;
const hashOf=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,32);

function readInput(body){
 const batchId=String(body.batchId||'');
 if(!/^imp_[a-f0-9]{16}$/.test(batchId))fail(400,'Missing import batch id. Preview the file again.');
 const list=(v,max,what)=>{if(!Array.isArray(v))return [];if(v.length>max)fail(413,'Too many '+what+' in one file (limit '+max+').');return v;};
 const names=v=>Array.isArray(v)?[...new Set(v.map(cleanName).filter(Boolean))].slice(0,50):[];
 const classes=names(list(body.classes,MAX_CLASSES,'classes'));
 const staff=list(body.staff,MAX_STAFF,'teachers').map(s=>({role:s?.role==='principal'?'principal':s?.role==='teacher'?'teacher':'',name:cleanName(s?.name),email:String(s?.email||'').trim().toLowerCase(),classes:names(s?.classes)}));
 const students=list(body.students,MAX_STUDENTS,'students').map(s=>({key:String(s?.key||''),name:cleanName(s?.name),passcode:clean(s?.passcode),rosterId:clean(s?.rosterId),classes:names(s?.classes),decision:s?.decision&&typeof s.decision==='object'?{type:String(s.decision.type||''),studentId:String(s.decision.studentId||'')}:null}));
 return {batchId,label:cleanName(body.label).slice(0,120),classes,staff,students};
}

async function load(store){
 const [classes,invites,teachers,directory,admins]=await Promise.all([
  store.get(ROOT+'/classes'),store.get(ROOT+'/teacherInvites'),store.get(ROOT+'/teachers'),loadStudentProfiles(store.get,store.keys),Promise.resolve(null)
 ]);
 return {classes:classes||{},invites:invites||{},teachers:teachers||{},profiles:directory.profiles||{},admins};
}

// Builds the full plan. Pure apart from reads; never writes.
async function buildPlan(store,input,state){
 const {classes,invites,teachers,profiles}=state;
 const batch=await store.get(BATCHES+input.batchId)||{};
 const errors=[],conflicts=[];
 // ---- classes -------------------------------------------------------------
 const byKey={};
 for(const [id,c] of Object.entries(classes)){if(!validId(id)||!c)continue;const k=classKey(c.name||id);if(!k)continue;(byKey[k]??=[]).push(id);}
 const classPlan=[],newClassIds={},takenIds=new Set(Object.keys(classes));
 for(const name of input.classes){
  const k=classKey(name);
  if(!k){errors.push('Class "'+name+'" needs letters or numbers.');continue;}
  const done=Object.entries(batch.classes||{}).find(([id,c])=>classKey(c.name)===k&&classes[id]);
  if(done){classPlan.push({name,classId:done[0],status:'exists'});continue;}
  const hits=byKey[k]||[];
  if(hits.length>1){errors.push('Class "'+name+'" matches '+hits.length+' classes on the site ('+hits.join(', ')+'). Rename or remove the extra one first.');continue;}
  if(hits.length===1){classPlan.push({name,classId:hits[0],status:'exists'});continue;}
  let id=slug(name)||'class';if(takenIds.has(id))id=id+'_'+crypto.createHash('sha256').update(input.batchId+name).digest('hex').slice(0,6);
  takenIds.add(id);newClassIds[k]=id;byKey[k]=[id];
  classPlan.push({name,classId:id,status:'create'});
 }
 const resolveClass=(name,where)=>{
  const k=classKey(name),hits=byKey[k]||[];
  if(hits.length===1)return hits[0];
  errors.push(where+': class "'+name+'" '+(hits.length?'matches more than one class':'does not exist and is not in this file')+'.');
  return null;
 };
 const classActive=id=>newClassIds[classKey(classPlan.find(c=>c.classId===id)?.name)]===id||(classes[id]&&classes[id].active!==false);
 // ---- staff ---------------------------------------------------------------
 const staffPlan=[],seenEmail=new Set();
 for(const s of input.staff){
  const where=(s.role||'Staff')+' '+(s.email||s.name);
  if(!s.role){errors.push(where+': type must be Teacher or Principal.');continue;}
  if(!EMAIL.test(s.email)){errors.push(where+': needs a valid email.');continue;}
  if(seenEmail.has(s.email)){errors.push(where+': listed twice. Put all of their classes on one row.');continue;}
  seenEmail.add(s.email);
  const classIds=[...new Set(s.classes.map(n=>resolveClass(n,where)).filter(Boolean))];
  const inviteId=slug(s.email);
  if(!validId(inviteId)){errors.push(where+': email cannot be used as an id.');continue;}
  const invite=invites[inviteId];
  if(!invite){staffPlan.push({inviteId,role:s.role,name:s.name||s.email,email:s.email,status:'create',addClassIds:s.role==='teacher'?classIds:[]});continue;}
  const role=invite.role==='principal'||invite.accountType==='principal'?'principal':'teacher';
  if(role!==s.role){errors.push(where+': already exists as a '+role+'.');continue;}
  if(String(invite.email||'').toLowerCase()!==s.email){errors.push(where+': a different account already uses this id.');continue;}
  const add=role==='teacher'?classIds.filter(id=>invite.classIds?.[id]!==true):[];
  staffPlan.push({inviteId,role,name:invite.name||s.email,email:s.email,status:add.length?'update':'unchanged',addClassIds:add,claimedUid:validId(invite.claimedUid)?invite.claimedUid:''});
 }
 // ---- students ------------------------------------------------------------
 const sameName={};
 for(const [id,p] of Object.entries(profiles)){if(!validId(id)||!p||p.active===false||p.demo)continue;const k=nameKey(p.name||id);if(k)(sameName[k]??=[]).push(id);}
 const byRoster={};
 for(const [id,p] of Object.entries(profiles))if(p&&validId(p.rosterId))(byRoster[p.rosterId]??=[]).push(id);
 const codeCache={};
 const codeOf=async id=>{if(!(id in codeCache))codeCache[id]=(await readPasscode(store.get,id,{allowLegacyDefault:true})).passcode;return codeCache[id];};
 const studentPlan=[],seenKey=new Set(),claimed={};
 for(const s of input.students){
  const where='Student '+(s.name||'(no name)');
  if(!s.key||s.key.length>200||seenKey.has(s.key)){errors.push(where+': duplicate or missing row key. Preview the file again.');continue;}
  seenKey.add(s.key);
  if(!s.name||s.name.length>100){errors.push(where+': name is missing or too long.');continue;}
  if(!PASSCODE.test(s.passcode)){errors.push(where+': passcode must be exactly 6 digits.');continue;}
  if(s.rosterId&&!validId(s.rosterId)){errors.push(where+': Student ID may only use letters, numbers, - and _.');continue;}
  if(!s.classes.length){errors.push(where+': needs at least one class.');continue;}
  const classIds=[...new Set(s.classes.map(n=>resolveClass(n,where)).filter(Boolean))];
  if(classIds.length!==s.classes.length)continue;
  const entry={key:s.key,name:s.name,classIds,rosterId:s.rosterId};
  // 1. Created earlier by this same batch (resume / re-run of the same file).
  const prior=batch.students?.[hashOf(s.key)];
  let target=null,reason='';
  if(prior?.studentId&&profiles[prior.studentId]){target=prior.studentId;reason='this import';}
  // 2. Stable Student ID.
  if(!target&&s.rosterId){
   const hits=byRoster[s.rosterId]||[];
   if(hits.length>1){errors.push(where+': Student ID '+s.rosterId+' is on '+hits.length+' accounts. An administrator must fix this first.');continue;}
   if(hits.length===1){
    if(nameKey(profiles[hits[0]].name)!==nameKey(s.name)){conflicts.push({key:s.key,name:s.name,reason:'Student ID '+s.rosterId+' belongs to '+profiles[hits[0]].name+'.',candidates:[hits[0]],allowNew:false});continue;}
    target=hits[0];reason='Student ID';
   }else if(profiles[s.rosterId]){
    if(nameKey(profiles[s.rosterId].name)!==nameKey(s.name)){conflicts.push({key:s.key,name:s.name,reason:'Student ID '+s.rosterId+' belongs to '+profiles[s.rosterId].name+'.',candidates:[s.rosterId],allowNew:false});continue;}
    target=s.rosterId;reason='Student ID';
   }
  }
  // 3. Same name already on the site: the owner must decide.
  if(!target){
   const candidates=(sameName[nameKey(s.name)]||[]).filter(id=>id!==prior?.studentId);
   if(candidates.length){
    const samePin=[];for(const id of candidates)if(equal(await codeOf(id),s.passcode))samePin.push(id);
    const d=s.decision;
    if(d?.type==='same'&&candidates.includes(d.studentId)){target=d.studentId;reason='owner confirmed same student';}
    else if(d?.type==='new'&&!samePin.length){reason='owner confirmed different student';}
    else{
     conflicts.push({key:s.key,name:s.name,reason:samePin.length?'An account with this name and passcode already exists.':'An account with this name already exists.',candidates,samePasscode:samePin,allowNew:!samePin.length});
     continue;
    }
   }
  }
  if(target){
   if(claimed[target]){errors.push(where+': matches the same account as '+claimed[target]+'.');continue;}
   if(profiles[target]?.active===false){errors.push(where+': the matching account ('+target+') is turned off. Turn it on or choose another account.');continue;}
   claimed[target]=s.name;
   const memberships=await store.get('b3Games/students/'+target+'/memberships')||{};
   const add=[],already=[];
   for(const cid of classIds){
    const m=memberships[WS+'_'+cid],member=classes[cid]?.members?.[target];
    if(m&&m.active!==false&&member&&member.active!==false)already.push(cid);else add.push(cid);
   }
   studentPlan.push({...entry,status:add.length?'update':'unchanged',studentId:target,matchedBy:reason,addClassIds:add,alreadyClassIds:already,setRosterId:s.rosterId&&!profiles[target]?.rosterId&&s.rosterId!==target?s.rosterId:''});
  }else{
   studentPlan.push({...entry,status:'create',studentId:'',matchedBy:reason||'new',addClassIds:classIds,alreadyClassIds:[]});
  }
 }
 const inactive=[...new Set(studentPlan.flatMap(s=>s.addClassIds))].filter(id=>!classActive(id));
 if(inactive.length)errors.push('These classes are turned off: '+inactive.join(', ')+'. Turn them on first.');
 const summary={
  classesCreate:classPlan.filter(c=>c.status==='create').length,classesExisting:classPlan.filter(c=>c.status==='exists').length,
  staffCreate:staffPlan.filter(s=>s.status==='create').length,staffUpdate:staffPlan.filter(s=>s.status==='update').length,
  studentsCreate:studentPlan.filter(s=>s.status==='create').length,studentsUpdate:studentPlan.filter(s=>s.status==='update').length,
  studentsUnchanged:studentPlan.filter(s=>s.status==='unchanged').length,
  membershipsAdd:studentPlan.reduce((n,s)=>n+s.addClassIds.length,0),
  membershipsAlready:studentPlan.reduce((n,s)=>n+s.alreadyClassIds.length,0),
  conflicts:conflicts.length,errors:errors.length
 };
 const planHash=hashOf({c:classPlan,t:staffPlan.map(({claimedUid,...s})=>s),s:studentPlan.map(s=>[s.key,s.status,s.studentId,s.addClassIds])});
 return {batchId:input.batchId,classPlan,staffPlan,studentPlan,conflicts,errors,summary,planHash,batchStatus:batch.status||'new'};
}

function describe(plan,profiles){
 const sClean=s=>({key:s.key,name:s.name,status:s.status,studentId:s.studentId,matchedBy:s.matchedBy,addClassIds:s.addClassIds,alreadyClassIds:s.alreadyClassIds});
 const cand=id=>({studentId:id,name:profiles[id]?.name||id,createdAt:profiles[id]?.createdAt||null,importBatchId:profiles[id]?.importBatchId||null});
 return {ok:true,batchId:plan.batchId,batchStatus:plan.batchStatus,planHash:plan.planHash,summary:plan.summary,errors:plan.errors,
  classes:plan.classPlan,staff:plan.staffPlan.map(({claimedUid,...s})=>s),students:plan.studentPlan.map(sClean),
  conflicts:plan.conflicts.map(c=>({...c,candidates:c.candidates.map(cand)}))};
}

async function importPreview(store,identity,body){
 const input=readInput(body),state=await load(store);
 return describe(await buildPlan(store,input,state),state.profiles);
}

// Applies an import that the owner has just previewed. Each student is one
// atomic multi-path update that also records what it did in the batch, so a
// failure never leaves half a student, and running again continues the batch.
async function importApply(store,identity,body,now=Date.now()){
 const input=readInput(body),state=await load(store);
 const plan=await buildPlan(store,input,state);
 if(plan.planHash!==String(body.planHash||''))fail(409,'The site changed since the preview. Preview the file again.');
 if(plan.errors.length)fail(400,'Fix the problems in the preview first.');
 const B=BATCHES+input.batchId,uid=identity.uid;
 const header=await store.get(B+'/header');
 await store.update({[B+'/header']:{...(header||{}),batchId:input.batchId,label:input.label||header?.label||'',createdBy:header?.createdBy||uid,createdAt:header?.createdAt||now,lastRunAt:now,lastRunBy:uid},[B+'/status']:'running'});
 const results={classes:[],staff:[],students:[],failed:[]};
 // Classes. Never overwritten; only created when still missing.
 for(const c of plan.classPlan.filter(c=>c.status==='create')){
  try{
   if(await store.get(ROOT+'/classes/'+c.classId))throw new Error('class id already taken');
   await store.update({[ROOT+'/classes/'+c.classId]:{name:c.name,active:true,createdAt:now,createdBy:uid,importBatchId:input.batchId},[B+'/classes/'+c.classId]:{name:c.name,created:true,at:now}});
   results.classes.push(c.name);
  }catch(error){results.failed.push({what:'class',name:c.name,error:error.message});}
 }
 // Staff. New invites are created; existing teachers only GAIN classes, and
 // what they had before is recorded for rollback.
 for(const s of plan.staffPlan.filter(s=>s.status!=='unchanged')){
  try{
   const base=ROOT+'/teacherInvites/'+s.inviteId,updates={},rec={inviteId:s.inviteId,email:s.email,role:s.role,at:now};
   if(s.status==='create'){
    if(await store.get(base))throw new Error('already exists');
    const classIds=Object.fromEntries(s.addClassIds.map(id=>[id,true]));
    updates[base]=s.role==='principal'
     ?{email:s.email,name:s.name,role:'principal',accountType:'principal',active:false,updatedAt:now,importBatchId:input.batchId}
     :{email:s.email,name:s.name,role:'teacher',active:s.addClassIds.length>0,...(s.addClassIds.length?{classIds}:{}),updatedAt:now,importBatchId:input.batchId};
    rec.created=true;rec.classIds=s.addClassIds;
   }else{
    const invite=await store.get(base)||{};
    rec.created=false;rec.before={active:invite.active??null,classIds:Object.fromEntries(s.addClassIds.map(id=>[id,invite.classIds?.[id]??null]))};rec.classIds=s.addClassIds;
    for(const id of s.addClassIds)updates[base+'/classIds/'+id]=true;
    updates[base+'/active']=true;
    if(s.claimedUid){
     const t=await store.get(ROOT+'/teachers/'+s.claimedUid)||{};
     rec.teacherUid=s.claimedUid;rec.teacherBefore={active:t.active??null,classIds:Object.fromEntries(s.addClassIds.map(id=>[id,t.classIds?.[id]??null]))};
     for(const id of s.addClassIds){updates[ROOT+'/teachers/'+s.claimedUid+'/classIds/'+id]=true;updates[ROOT+'/classes/'+id+'/teacherIds/'+s.claimedUid]=true;}
     updates[ROOT+'/teachers/'+s.claimedUid+'/active']=true;
    }
   }
   updates[B+'/staff/'+s.inviteId]=rec;
   await store.update(updates);results.staff.push(s.email);
  }catch(error){results.failed.push({what:s.role,name:s.email,error:error.message});}
 }
 // Students.
 for(const s of plan.studentPlan){
  if(s.status==='unchanged'){results.students.push({name:s.name,status:'unchanged',studentId:s.studentId});continue;}
  try{
   const updates={},recKey=hashOf(s.key),prior=await store.get(B+'/students/'+recKey);
   let id=s.studentId;
   const rec={key:s.key,name:s.name,at:now,...(prior||{})};
   if(s.status==='create'){
    id='student_'+crypto.randomUUID().replaceAll('-','');
    updates['b3Games/students/'+id+'/profile']={id,name:s.name,active:true,createdAt:now,createdBy:uid,passcodeUpdatedAt:now,importBatchId:input.batchId,...(s.rosterId?{rosterId:s.rosterId}:{})};
    updates[PRIVATE+id]={passcode:clean(input.students.find(x=>x.key===s.key).passcode),updatedAt:now};
    Object.assign(rec,{studentId:id,created:true,addedClassIds:s.addClassIds,before:{}});
   }else{
    const memberships=await store.get('b3Games/students/'+id+'/memberships')||{};
    const before={...(prior?.before||{})};
    for(const cid of s.addClassIds){
     const mKey=WS+'_'+cid;
     if(!(mKey in before))before[mKey]={membership:memberships[mKey]??null,member:(await store.get(ROOT+'/classes/'+cid+'/members/'+id))??null};
    }
    Object.assign(rec,{studentId:id,created:prior?.created===true,addedClassIds:[...new Set([...(prior?.addedClassIds||[]),...s.addClassIds])],before});
    if(s.setRosterId){updates['b3Games/students/'+id+'/profile/rosterId']=s.setRosterId;rec.setRosterId=s.setRosterId;}
   }
   for(const cid of s.addClassIds){
    updates[ROOT+'/classes/'+cid+'/members/'+id]={studentId:id,name:s.status==='create'?s.name:(state.profiles[id]?.name||s.name),active:true};
    updates['b3Games/students/'+id+'/memberships/'+WS+'_'+cid]={workspaceId:WS,classId:cid,active:true};
    updates[ROOT+'/classes/'+cid+'/managementAudit/'+crypto.randomUUID()]={action:s.status==='create'?'importCreate':'importAdd',studentId:id,teacherUid:uid,batchId:input.batchId,at:now};
   }
   updates[B+'/students/'+recKey]=rec;
   await store.update(updates);
   results.students.push({name:s.name,status:s.status,studentId:id,addedClassIds:s.addClassIds});
  }catch(error){results.failed.push({what:'student',name:s.name,error:error.message});}
 }
 const counts={classesCreated:results.classes.length,staffChanged:results.staff.length,studentsCreated:results.students.filter(s=>s.status==='create').length,studentsUpdated:results.students.filter(s=>s.status==='update').length,studentsUnchanged:results.students.filter(s=>s.status==='unchanged').length,failed:results.failed.length,conflictsSkipped:plan.conflicts.length};
 const status=results.failed.length?'partial':plan.conflicts.length?'complete-with-conflicts':'complete';
 await store.update({[B+'/status']:status,[B+'/lastCounts']:counts,[AUDIT+crypto.randomUUID()]:{action:'import',batchId:input.batchId,by:uid,byEmail:String(identity.email||''),at:now,counts}});
 return {ok:true,batchId:input.batchId,status,counts,failed:results.failed,students:results.students,conflicts:plan.conflicts.map(c=>({name:c.name,reason:c.reason}))};
}

module.exports={importPreview,importApply,buildPlan,readInput,hashOf,nameKey,classKey,BATCHES,AUDIT,WS,ROOT};
