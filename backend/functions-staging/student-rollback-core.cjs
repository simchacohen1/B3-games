'use strict';
// Import rollback and owner bulk student management (Issue #706).
//
// Safety rules:
//  - Accounts are only ever chosen from trustworthy evidence: a batch record
//    written by the importer, or (for imports made before batch records
//    existed) the per-class managementAudit "create" entries written by the
//    server at the moment each account was created. Never from names.
//  - Every candidate is re-checked against the live database. Anything that
//    holds student work, has extra classes, or does not match its audit entry
//    is NOT removed and is listed for manual review.
//  - Execution must quote the hash of the exact preview the owner approved; if
//    anything changed, nothing is removed.
//  - Each account is backed up (including its private passcode, into
//    b3Private, which browsers cannot read) in the same atomic write that
//    removes it, so a failure never loses data and a retry simply continues.
//  - Classes, teachers and every other record are never deleted.
const crypto=require('node:crypto');
const {PRIVATE}=require('./student-passcodes.cjs');
const {BATCHES,AUDIT,WS,ROOT,hashOf}=require('./student-import-core.cjs');

const ROLLBACKS='b3Private/importRollbacks/';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
const IMPORT_ID=/^student_[0-9a-f]{32}$/;
const IDENTITY_KEYS=new Set(['profile','memberships']);
// Every tree that can hold a student's work or progress. A student id found as
// a key or a value anywhere in these trees counts as linked student data.
const LINK_TREES=['posukPractice','rashiLetters','b3Quiz','studentRewards','assignmentCenter','classGallery','classGalleryMeta','multiplayerCenter','privateParentDashboard','yiddishPrivate','questionSets','tentTrailTrivia','b3Games/classGalleryTag','b3Games/classGalleryPresence','b3Private/multiplayerGames'];
const MAX_WINDOW=6*3600*1000;

async function scanLinked(store,ids){
 const want=new Set(ids),found={};
 const walk=(node,path,depth)=>{
  if(depth>40||node==null)return;
  if(typeof node==='string'){if(want.has(node))(found[node]??=[]).push(path);return;}
  if(typeof node!=='object')return;
  for(const [k,v] of Object.entries(node)){
   const p=path+'/'+k;
   if(want.has(k))(found[k]??=[]).push(p);
   walk(v,p,depth+1);
  }
 };
 for(const tree of LINK_TREES)walk(await store.get(tree),tree,0);
 return found;
}

// Audit entries: studentId -> [{classId, at, uid, action}]
function auditIndex(classes){
 const idx={};
 for(const [cid,c] of Object.entries(classes||{})){
  if(!validId(cid))continue;
  for(const a of Object.values(c?.managementAudit||{}))if(a&&validId(a.studentId))(idx[a.studentId]??=[]).push({classId:cid,at:Number(a.at)||0,uid:String(a.teacherUid||''),action:String(a.action||''),batchId:a.batchId||null});
 }
 return idx;
}

// Import runs made before batch records existed: groups of 10+ server "create"
// audit entries by one account with no gap over 10 minutes.
function legacyRuns(classes){
 const creates=[];
 for(const [cid,c] of Object.entries(classes||{}))for(const a of Object.values(c?.managementAudit||{}))if(a?.action==='create'&&validId(a.studentId))creates.push({cid,at:Number(a.at)||0,uid:String(a.teacherUid||''),studentId:a.studentId});
 creates.sort((a,b)=>a.uid.localeCompare(b.uid)||a.at-b.at);
 const runs=[];let cur=null;
 for(const a of creates){
  if(cur&&cur.uid===a.uid&&a.at-cur.to<=600000){cur.to=a.at;cur.count++;cur.classIds.add(a.cid);}
  else{if(cur)runs.push(cur);cur={uid:a.uid,from:a.at,to:a.at,count:1,classIds:new Set([a.cid])};}
 }
 if(cur)runs.push(cur);
 return runs.filter(r=>r.count>=10).map(r=>({id:'legacy_'+r.from+'_'+r.to,uid:r.uid,from:r.from,to:r.to,count:r.count,classIds:[...r.classIds].sort()}));
}

function readSource(body){
 if(body.batchId){if(!/^imp_[a-f0-9]{16}$/.test(String(body.batchId)))fail(400,'Unknown import batch.');return {kind:'batch',batchId:String(body.batchId)};}
 const l=body.legacy||{};
 const from=Number(l.from),to=Number(l.to),uid=String(l.createdBy||'');
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<from||to-from>MAX_WINDOW||!validId(uid))fail(400,'Choose an import run.');
 return {kind:'legacy',from,to,uid};
}

async function buildManifest(store,source){
 const [classes,students,mirrors,legacyRows]=await Promise.all([store.get(ROOT+'/classes'),store.get('b3Games/students'),store.get(ROOT+'/students'),store.get('posukPractice/allowedStudents')]);
 const audits=auditIndex(classes);
 const records=[],restores=[],staff=[];
 let candidates=[];let batch=null,rollbackId;
 if(source.kind==='batch'){
  batch=await store.get(BATCHES+source.batchId);
  if(!batch)fail(404,'Import batch not found.');
  for(const [recKey,r] of Object.entries(batch.students||{}))if(validId(r?.studentId))candidates.push({studentId:r.studentId,recKey,rec:r});
  for(const s of Object.values(batch.staff||{}))if(s&&!s.created&&s.classIds?.length)staff.push(s);
  rollbackId='rb_'+source.batchId.slice(4);
 }else{
  const seen=new Set();
  for(const [sid,list] of Object.entries(audits))for(const a of list)if(a.action==='create'&&a.uid===source.uid&&a.at>=source.from&&a.at<=source.to&&!seen.has(sid)){seen.add(sid);candidates.push({studentId:sid,audit:a});}
  rollbackId='rb_legacy_'+source.from+'_'+source.to;
 }
 const run=await store.get(ROLLBACKS+rollbackId)||{};
 const live=candidates.filter(c=>students?.[c.studentId]).map(c=>c.studentId);
 const linked=live.length?await scanLinked(store,live):{};
 for(const c of candidates){
  const id=c.studentId,row=students?.[id],profile=row?.profile;
  const memberships=Object.values(row?.memberships||{}).filter(m=>m&&m.workspaceId===WS);
  const classIds=[...new Set(memberships.map(m=>String(m.classId)))];
  const base={studentId:id,name:profile?.name||run.backup?.[id]?.student?.profile?.name||'',classIds,createdAt:profile?.createdAt||null};
  if(!row){records.push({...base,status:run.done?.[id]?'ALREADY_REMOVED':'MISSING',reasons:[run.done?.[id]?'Removed by this rollback earlier.':'No longer exists; nothing to do.']});continue;}
  const reasons=[];
  if(c.rec&&c.rec.created!==true){
   // Existing account changed by a new-style batch: plan the restore.
   const pieces=[];
   for(const cid of c.rec.addedClassIds||[]){
    const k=WS+'_'+cid,before=c.rec.before?.[k]||{membership:null,member:null};
    const cur=row.memberships?.[k],member=classes?.[cid]?.members?.[id];
    const untouched=cur&&cur.active===true&&cur.classId===cid&&member&&member.active!==false;
    pieces.push({classId:cid,ok:!!untouched,before});
   }
   const bad=pieces.filter(p=>!p.ok);
   restores.push({studentId:id,name:profile?.name||'',recKey:c.recKey,pieces,setRosterId:c.rec.setRosterId&&profile?.rosterId===c.rec.setRosterId?c.rec.setRosterId:''});
   records.push({...base,status:bad.length?'UNCERTAIN':'EXISTING_MODIFIED',reasons:bad.length?['Classes added by the import were changed afterwards: '+bad.map(p=>p.classId).join(', ')]:['Remove classes added by the import: '+pieces.map(p=>p.classId).join(', ')]});
   continue;
  }
  // Newly created account: prove it, and make sure it is still empty.
  if(!IMPORT_ID.test(id))reasons.push('ID is not one the importer creates.');
  if(c.rec){
   if(profile?.importBatchId!==source.batchId)reasons.push('Profile is not marked with this import.');
   const extra=classIds.filter(x=>!(c.rec.addedClassIds||[]).includes(x));
   if(extra.length)reasons.push('Also in classes the import did not add: '+extra.join(', '));
  }else{
   const a=c.audit;
   if(profile?.createdBy!==a.uid)reasons.push('Created by a different account.');
   if(!(Math.abs((Number(profile?.createdAt)||0)-a.at)<=5000))reasons.push('Creation time does not match the audit entry.');
   const others=(audits[id]||[]).filter(x=>x!==a&&!(x.action==='create'&&x.at===a.at));
   if(others.length)reasons.push('Changed after creation ('+[...new Set(others.map(o=>o.action))].join(', ')+').');
   if(classIds.length!==1||classIds[0]!==a.classId)reasons.push('Class memberships differ from the import.');
  }
  if(profile?.active===false)reasons.push('Account was turned off by hand.');
  const extraKeys=Object.keys(row).filter(k=>!IDENTITY_KEYS.has(k));
  if(extraKeys.length)reasons.push('Has saved work in the student record: '+extraKeys.join(', '));
  if(legacyRows?.[id])reasons.push('Also listed in the old student list.');
  const memberOf=Object.entries(classes||{}).filter(([,cl])=>cl?.members?.[id]).map(([cid])=>cid);
  if(memberOf.some(cid=>!classIds.includes(cid)))reasons.push('Listed as a member of a class without a membership record.');
  const links=linked[id]||[];
  if(links.length)reasons.push('Has student data: '+links.slice(0,5).join(', ')+(links.length>5?' (+'+(links.length-5)+' more)':''));
  records.push({...base,status:links.length||extraKeys.length?'NEW_HAS_DATA':reasons.length?'UNCERTAIN':'NEW_SAFE',reasons,memberOf,mirror:!!mirrors?.[id],linked:links.length});
 }
 // Teacher classes added by a new-style batch.
 const staffRestores=[];
 for(const s of staff){
  const invite=await store.get(ROOT+'/teacherInvites/'+s.inviteId)||{};
  staffRestores.push({inviteId:s.inviteId,email:s.email,teacherUid:s.teacherUid||'',pieces:s.classIds.map(cid=>({classId:cid,ok:invite.classIds?.[cid]===true,before:s.before?.classIds?.[cid]??null,teacherBefore:s.teacherBefore?.classIds?.[cid]??null}))});
 }
 const count=k=>records.filter(r=>r.status===k).length;
 const totalStudents=Object.keys(students||{}).length;
 // Classes the undo takes students out of. Classes are never deleted: this
 // only tells the owner what each class will look like afterwards, and whether
 // the class had any students before this import (batch record, or for older
 // imports: no audit history before the run and no other members).
 const leaving={},candidateIds=new Set(candidates.map(c=>c.studentId));
 const leave=cid=>{if(validId(cid))leaving[cid]=(leaving[cid]||0)+1;};
 for(const r of records)if(r.status==='NEW_SAFE')for(const cid of new Set([...r.classIds,...(r.memberOf||[])]))leave(cid);
 for(const r of restores)if(r.pieces.length&&r.pieces.every(p=>p.ok))for(const p of r.pieces)if(p.before.member==null)leave(p.classId);
 const classImpact=Object.entries(leaving).map(([cid,n])=>{
  const c=classes?.[cid]||{},members=Object.keys(c.members||{}),audit=Object.values(c.managementAudit||{}).filter(Boolean);
  const newWithImport=source.kind==='batch'?batch?.classes?.[cid]?.created===true
   :!audit.some(a=>(Number(a.at)||0)<source.from)&&members.every(id=>candidateIds.has(id)||audit.some(a=>a.studentId===id&&(Number(a.at)||0)>=source.from));
  return {classId:cid,name:String(c.name||cid),membersNow:members.length,leaving:n,membersAfter:Math.max(0,members.length-n),newWithImport};
 }).sort((a,b)=>a.name.localeCompare(b.name));
 const summary={totalStudents:Object.keys(students||{}).length,classesAffected:classImpact.length,candidates:candidates.length,newSafe:count('NEW_SAFE'),newHasData:count('NEW_HAS_DATA'),existingModified:count('EXISTING_MODIFIED'),uncertain:count('UNCERTAIN'),alreadyRemoved:count('ALREADY_REMOVED'),missing:count('MISSING'),preservedUntouched:totalStudents-live.length,staffRestores:staffRestores.length};
 records.sort((a,b)=>a.status.localeCompare(b.status)||a.name.localeCompare(b.name));
 const manifestHash=hashOf({source,act:records.filter(r=>['NEW_SAFE','ALREADY_REMOVED','EXISTING_MODIFIED'].includes(r.status)).map(r=>[r.studentId,r.status==='ALREADY_REMOVED'?'NEW_SAFE':r.status]).sort(),staff:staffRestores.map(s=>[s.inviteId,s.pieces.filter(p=>p.ok).map(p=>p.classId)])});
 return {source,rollbackId,manifestHash,summary,records,restores,staffRestores,classImpact,batchKeys:Object.fromEntries(candidates.map(c=>[c.studentId,c.recKey||null])),classes};
}

const publicManifest=m=>({ok:true,rollbackId:m.rollbackId,manifestHash:m.manifestHash,summary:m.summary,records:m.records,classes:m.classImpact,staffRestores:m.staffRestores.map(s=>({email:s.email,classIds:s.pieces.filter(p=>p.ok).map(p=>p.classId),changedSince:s.pieces.filter(p=>!p.ok).map(p=>p.classId)})),source:m.source});

async function rollbackPreview(store,identity,body){
 return publicManifest(await buildManifest(store,readSource(body)));
}

// Backs up and removes one student account in one atomic write.
async function removeAccountUpdates(store,id,classes,where,now,uid,extra){
 const [row,passcode,mirror]=await Promise.all([store.get('b3Games/students/'+id),store.get(PRIVATE+id),store.get(ROOT+'/students/'+id)]);
 const members={},updates={};
 for(const [cid,cl] of Object.entries(classes||{}))if(validId(cid)&&cl?.members?.[id]){members[cid]=cl.members[id];updates[ROOT+'/classes/'+cid+'/members/'+id]=null;updates[ROOT+'/classes/'+cid+'/managementAudit/'+crypto.randomUUID()]={action:extra.action,studentId:id,teacherUid:uid,rollbackId:extra.rollbackId,at:now};}
 updates[where+'/backup/'+id]={student:row??null,passcode:passcode??null,members,mirror:mirror??null,at:now};
 updates[where+'/done/'+id]={at:now,by:uid,action:'removed'};
 updates['b3Games/students/'+id]=null;
 updates[PRIVATE+id]=null;
 updates[ROOT+'/students/'+id]=null;
 return updates;
}

async function rollbackExecute(store,identity,body,now=Date.now()){
 const source=readSource(body),m=await buildManifest(store,source);
 if(String(body.manifestHash||'')!==m.manifestHash)fail(409,'The records changed since the preview. Preview again before removing anything.');
 if(body.backupConfirmed!==true)fail(409,'Download the backup first.');
 const toRemove=m.records.filter(r=>r.status==='NEW_SAFE'),toRestore=m.restores.filter(r=>r.pieces.every(p=>p.ok)&&r.pieces.length);
 const expected='ROLL BACK '+(toRemove.length+toRestore.length);
 if(String(body.confirmText||'').trim().toUpperCase()!==expected)fail(400,'Type '+expected+' to confirm.');
 const where=ROLLBACKS+m.rollbackId,uid=identity.uid;
 const head=await store.get(where+'/header');
 await store.update({[where+'/header']:{...(head||{}),rollbackId:m.rollbackId,source,manifestHash:m.manifestHash,startedAt:head?.startedAt||now,lastRunAt:now,by:uid,planned:{remove:toRemove.length,restore:toRestore.length}},[where+'/status']:'running'});
 const log={removed:[],restored:[],failed:[],skipped:m.records.filter(r=>!['NEW_SAFE','EXISTING_MODIFIED','ALREADY_REMOVED','MISSING'].includes(r.status)).map(r=>({studentId:r.studentId,name:r.name,status:r.status}))};
 for(const r of toRemove){
  try{
   const updates=await removeAccountUpdates(store,r.studentId,m.classes,where,now,uid,{action:'rollbackRemove',rollbackId:m.rollbackId});
   const recKey=m.batchKeys[r.studentId];
   if(recKey&&source.kind==='batch')updates[BATCHES+source.batchId+'/students/'+recKey+'/removedByRollback']=m.rollbackId;
   await store.update(updates);log.removed.push(r.studentId);
  }catch(error){log.failed.push({studentId:r.studentId,error:error.message});}
 }
 for(const r of toRestore){
  try{
   const updates={},backup={};
   for(const p of r.pieces){
    const k=WS+'_'+p.classId;
    backup[k]={membership:await store.get('b3Games/students/'+r.studentId+'/memberships/'+k),member:m.classes?.[p.classId]?.members?.[r.studentId]??null};
    updates['b3Games/students/'+r.studentId+'/memberships/'+k]=p.before.membership??null;
    updates[ROOT+'/classes/'+p.classId+'/members/'+r.studentId]=p.before.member??null;
    updates[ROOT+'/classes/'+p.classId+'/managementAudit/'+crypto.randomUUID()]={action:'rollbackRestore',studentId:r.studentId,teacherUid:uid,rollbackId:m.rollbackId,at:now};
   }
   if(r.setRosterId)updates['b3Games/students/'+r.studentId+'/profile/rosterId']=null;
   updates[where+'/restoreBackup/'+r.studentId]={...backup,at:now};
   updates[where+'/done/'+r.studentId]={at:now,by:uid,action:'restored'};
   updates[BATCHES+source.batchId+'/students/'+r.recKey+'/restoredByRollback']=m.rollbackId;
   await store.update(updates);log.restored.push(r.studentId);
  }catch(error){log.failed.push({studentId:r.studentId,error:error.message});}
 }
 for(const s of m.staffRestores){
  const updates={};
  for(const p of s.pieces.filter(p=>p.ok)){
   updates[ROOT+'/teacherInvites/'+s.inviteId+'/classIds/'+p.classId]=p.before===true?true:null;
   if(s.teacherUid){updates[ROOT+'/teachers/'+s.teacherUid+'/classIds/'+p.classId]=p.teacherBefore===true?true:null;if(p.teacherBefore!==true)updates[ROOT+'/classes/'+p.classId+'/teacherIds/'+s.teacherUid]=null;}
  }
  if(Object.keys(updates).length){try{await store.update(updates);}catch(error){log.failed.push({teacher:s.email,error:error.message});}}
 }
 const status=log.failed.length?'partial':'complete';
 await store.update({[where+'/status']:status,[where+'/lastLog']:{removed:log.removed.length,restored:log.restored.length,failed:log.failed,skipped:log.skipped.length,at:now},...(source.kind==='batch'?{[BATCHES+source.batchId+'/status']:'rolled-back'}:{}),[AUDIT+crypto.randomUUID()]:{action:'rollback',rollbackId:m.rollbackId,by:uid,byEmail:String(identity.email||''),at:now,removed:log.removed.length,restored:log.restored.length,failed:log.failed.length}});
 return {ok:true,rollbackId:m.rollbackId,status,removed:log.removed.length,restored:log.restored.length,failed:log.failed,skipped:log.skipped};
}

// Puts back accounts a rollback or bulk delete removed, from its backup.
async function rollbackUndo(store,identity,body,now=Date.now()){
 const rollbackId=String(body.rollbackId||'');
 if(!/^(rb|del)_[A-Za-z0-9_]{1,80}$/.test(rollbackId))fail(400,'Unknown rollback.');
 const where=ROLLBACKS+rollbackId,run=await store.get(where);
 if(!run)fail(404,'Rollback not found.');
 const ids=Array.isArray(body.studentIds)&&body.studentIds.length?body.studentIds.filter(validId):Object.keys(run.backup||{});
 let restored=0;const skipped=[];
 for(const id of ids){
  const b=run.backup?.[id];
  if(!b?.student){skipped.push({studentId:id,reason:'no backup'});continue;}
  if(await store.get('b3Games/students/'+id+'/profile')){skipped.push({studentId:id,reason:'account exists'});continue;}
  const updates={['b3Games/students/'+id]:b.student};
  if(b.passcode)updates[PRIVATE+id]=b.passcode;
  if(b.mirror)updates[ROOT+'/students/'+id]=b.mirror;
  for(const [cid,member] of Object.entries(b.members||{}))if(validId(cid)){updates[ROOT+'/classes/'+cid+'/members/'+id]=member;updates[ROOT+'/classes/'+cid+'/managementAudit/'+crypto.randomUUID()]={action:'rollbackUndo',studentId:id,teacherUid:identity.uid,rollbackId,at:now};}
  updates[where+'/done/'+id]={at:now,by:identity.uid,action:'undone'};
  await store.update(updates);restored++;
 }
 await store.update({...(restored?{[where+'/status']:'put-back'}:{}),[AUDIT+crypto.randomUUID()]:{action:'rollbackUndo',rollbackId,by:identity.uid,byEmail:String(identity.email||''),at:now,restored}});
 return {ok:true,restored,skipped};
}

// ---- Bulk management ------------------------------------------------------
async function studentsOverview(store){
 const [classes,students,batches,rollbacks]=await Promise.all([store.get(ROOT+'/classes'),store.get('b3Games/students'),store.get(BATCHES.slice(0,-1)),store.get(ROLLBACKS.slice(0,-1))]);
 const audits=auditIndex(classes),runs=legacyRuns(classes);
 const runOf=(id)=>{const c=(audits[id]||[]).find(a=>a.action==='create');if(!c)return null;const r=runs.find(r=>r.uid===c.uid&&c.at>=r.from&&c.at<=r.to);return r?r.id:null;};
 const list=Object.entries(students||{}).filter(([id])=>validId(id)).map(([id,row])=>{
  const p=row?.profile||{};
  return {studentId:id,name:String(p.name||id),active:p.active!==false,demo:!!p.demo,createdAt:p.createdAt||null,importBatchId:p.importBatchId||runOf(id),rosterId:p.rosterId||'',
   classIds:[...new Set(Object.values(row?.memberships||{}).filter(m=>m&&m.active!==false&&m.workspaceId===WS).map(m=>String(m.classId)))],
   savedWork:Object.keys(row||{}).filter(k=>!IDENTITY_KEYS.has(k))};
 });
 return {ok:true,students:list,
  classes:Object.fromEntries(Object.entries(classes||{}).filter(([id])=>validId(id)).map(([id,c])=>[id,{name:String(c?.name||id),active:c?.active!==false}])),
  batches:[...Object.entries(batches||{}).map(([id,b])=>({id,kind:'batch',label:b?.header?.label||'',createdAt:b?.header?.createdAt||null,status:b?.status||'',counts:b?.lastCounts||null})),...runs.map(r=>({id:r.id,kind:'legacy',label:'Import run before tracking ('+r.count+' accounts)',createdAt:r.from,from:r.from,to:r.to,createdBy:r.uid,count:r.count,classIds:r.classIds}))],
  rollbacks:Object.entries(rollbacks||{}).map(([id,r])=>({id,status:r?.status||'',startedAt:r?.header?.startedAt||null,lastLog:r?.lastLog||null,backups:Object.keys(r?.backup||{}).length}))};
}

async function bulkPreview(store,identity,body){
 const ids=readIds(body);
 const [classes,students]=await Promise.all([store.get(ROOT+'/classes'),Promise.all(ids.map(id=>store.get('b3Games/students/'+id)))]);
 const linked=await scanLinked(store,ids);
 const audits=auditIndex(classes);
 const records=ids.map((id,i)=>{
  const row=students[i],p=row?.profile;
  const links=linked[id]||[],extra=Object.keys(row||{}).filter(k=>!IDENTITY_KEYS.has(k));
  const reasons=[];
  if(!row)reasons.push('Not found.');
  if(p?.demo)reasons.push('Teacher demo account.');
  if(extra.length)reasons.push('Saved work in student record: '+extra.join(', '));
  if(links.length)reasons.push('Linked student data: '+links.slice(0,5).join(', ')+(links.length>5?' (+'+(links.length-5)+' more)':''));
  return {studentId:id,name:p?.name||'',createdAt:p?.createdAt||null,importBatchId:p?.importBatchId||null,history:(audits[id]||[]).map(a=>({action:a.action,classId:a.classId,at:a.at})),
   classIds:Object.values(row?.memberships||{}).filter(m=>m&&m.active!==false).map(m=>m.classId),linked:links,deletable:!!row&&!reasons.length,reasons};
 });
 const deletable=records.filter(r=>r.deletable).map(r=>r.studentId).sort();
 return {ok:true,records,previewHash:hashOf(['bulkDelete',deletable]),deletableCount:deletable.length};
}

async function bulkDelete(store,identity,body,now=Date.now()){
 const preview=await bulkPreview(store,identity,body);
 if(String(body.previewHash||'')!==preview.previewHash)fail(409,'The records changed since the preview. Preview again.');
 if(body.backupConfirmed!==true)fail(409,'Download the backup first.');
 const ids=preview.records.filter(r=>r.deletable).map(r=>r.studentId);
 if(!ids.length)fail(400,'None of the selected accounts can be deleted.');
 const expected='DELETE '+ids.length;
 if(String(body.confirmText||'').trim().toUpperCase()!==expected)fail(400,'Type '+expected+' to confirm.');
 const rollbackId='del_'+preview.previewHash.slice(0,16),where=ROLLBACKS+rollbackId,classes=await store.get(ROOT+'/classes');
 await store.update({[where+'/header']:{rollbackId,kind:'bulkDelete',startedAt:now,by:identity.uid,planned:{remove:ids.length}}});
 const removed=[],failed=[];
 for(const id of ids){
  try{await store.update(await removeAccountUpdates(store,id,classes,where,now,identity.uid,{action:'bulkDelete',rollbackId}));removed.push(id);}
  catch(error){failed.push({studentId:id,error:error.message});}
 }
 await store.update({[where+'/status']:failed.length?'partial':'complete',[AUDIT+crypto.randomUUID()]:{action:'bulkDelete',rollbackId,by:identity.uid,byEmail:String(identity.email||''),at:now,removed:removed.length,failed:failed.length,studentIds:removed}});
 return {ok:true,rollbackId,removed:removed.length,failed,refused:preview.records.filter(r=>!r.deletable).map(r=>({studentId:r.studentId,reasons:r.reasons}))};
}

// Non-secret backup a browser may download: never includes passcodes.
async function exportBackup(store,identity,body){
 const ids=readIds(body);
 const classes=await store.get(ROOT+'/classes')||{};
 const records={};
 for(const id of ids){
  const [row,mirror]=await Promise.all([store.get('b3Games/students/'+id),store.get(ROOT+'/students/'+id)]);
  const members={};for(const [cid,c] of Object.entries(classes))if(c?.members?.[id])members[cid]=c.members[id];
  const student=row?JSON.parse(JSON.stringify(row)):null;
  if(student?.profile)delete student.profile.passcode;
  records[id]={student,members,mirror:mirror??null};
 }
 return {ok:true,exportedAt:Date.now(),note:'Passcodes are not included. The server keeps a private copy with each removal so it can be undone.',records};
}

async function auditLog(store){
 const rows=await store.get(AUDIT.slice(0,-1))||{};
 return {ok:true,entries:Object.values(rows).filter(Boolean).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,300)};
}

function readIds(body){
 const ids=Array.isArray(body.studentIds)?[...new Set(body.studentIds.map(String))]:[];
 if(!ids.length||ids.length>1000||!ids.every(validId))fail(400,'Choose up to 1000 students.');
 return ids;
}

module.exports={rollbackPreview,rollbackExecute,rollbackUndo,studentsOverview,bulkPreview,bulkDelete,exportBackup,auditLog,buildManifest,scanLinked,legacyRuns,LINK_TREES,ROLLBACKS};
