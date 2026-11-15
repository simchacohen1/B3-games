'use strict';
// Read-only duplicate report (Issue #51 / #665).
//
// Lists student accounts that share a name, and classes that share a name, so
// the owner can decide what to do with each one. This module NEVER writes: it
// does not delete, merge, rename or change any record, and it never returns a
// passcode. Passcodes are only compared, and reported as "same" or "different".
const {readPasscode}=require('./student-passcodes.cjs');

const WS='b3-2026',ROOT='b3Games/workspaces/'+WS;
const IDENTITY_KEYS=new Set(['profile','memberships']);
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
// English names compare by letters and digits only. A name with none of those
// (for example a Hebrew name) compares as typed, ignoring case and extra spaces.
const nameKey=s=>{
 const text=String(s||'');
 return text.toLowerCase().replace(/[^a-z0-9]+/g,'')||text.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
};
const classKey=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[·�]/g,' ').replace(/[^a-z0-9]+/g,' ').trim();

async function duplicateReport(store){
 const [classes,students]=await Promise.all([store.get(ROOT+'/classes'),store.get('b3Games/students')]);
 const className=id=>String(classes?.[id]?.name||id);
 // ---- students with the same name ------------------------------------------
 const byName={};
 for(const [id,row] of Object.entries(students||{})){
  const p=row?.profile;
  if(!validId(id)||!p||p.demo)continue;
  const k=nameKey(p.name||id);if(!k)continue;
  (byName[k]??=[]).push({id,row,p});
 }
 const studentGroups=[];
 for(const rows of Object.values(byName)){
  if(rows.length<2)continue;
  // Compare passcodes inside the group only; report a letter, never the value.
  const codes=await Promise.all(rows.map(r=>readPasscode(store.get,r.id,{allowLegacyDefault:true})));
  const letters={};let next=0;
  const accounts=rows.map((r,i)=>{
   const code=codes[i].passcode;
   const group=code?(letters[code]??=String.fromCharCode(65+Math.min(next++,25))):'';
   const memberships=Object.values(r.row?.memberships||{}).filter(m=>m&&m.workspaceId===WS&&validId(m.classId));
   const active=memberships.filter(m=>m.active!==false&&classes?.[m.classId]?.members?.[r.id]).map(m=>m.classId).sort();
   const former=memberships.filter(m=>!active.includes(m.classId)).map(m=>m.classId).sort();
   return {studentId:r.id,name:String(r.p.name||r.id),active:r.p.active!==false,createdAt:r.p.createdAt||null,importBatchId:r.p.importBatchId||'',rosterId:r.p.rosterId||'',
    classIds:active,classNames:active.map(className),formerClassIds:former,formerClassNames:former.map(className),
    passcodeGroup:group,savedWork:Object.keys(r.row||{}).filter(k=>!IDENTITY_KEYS.has(k)).sort()};
  }).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||a.studentId.localeCompare(b.studentId));
  const counts={};for(const a of accounts)if(a.passcodeGroup)counts[a.passcodeGroup]=(counts[a.passcodeGroup]||0)+1;
  const samePasscode=Object.values(counts).some(n=>n>1);
  const liveSamePasscode=Object.keys(counts).some(g=>accounts.filter(a=>a.passcodeGroup===g&&a.active).length>1);
  const sharedClassIds=[...new Set(accounts.flatMap(a=>a.classIds).filter((id,i,all)=>all.indexOf(id)!==i))].sort();
  studentGroups.push({name:accounts[0].name,accounts,samePasscode,
   // Two active accounts with one name and one passcode: neither boy can sign in.
   blocksSignIn:liveSamePasscode,
   sharedClassIds,sharedClassNames:sharedClassIds.map(className)});
 }
 studentGroups.sort((a,b)=>Number(b.blocksSignIn)-Number(a.blocksSignIn)||Number(b.samePasscode)-Number(a.samePasscode)||a.name.localeCompare(b.name));
 // ---- classes with the same name --------------------------------------------
 const byClass={};
 for(const [id,c] of Object.entries(classes||{})){
  if(!validId(id)||!c)continue;
  const k=classKey(c.name||id);if(!k)continue;
  (byClass[k]??=[]).push({classId:id,name:String(c.name||id),active:c.active!==false,schoolId:String(c.schoolId||''),
   members:Object.keys(c.members||{}).filter(validId).length,brokenName:String(c.name||'').includes('�')});
 }
 const classGroups=Object.values(byClass).filter(g=>g.length>1).map(g=>({name:g.find(c=>!c.brokenName)?.name||g[0].name,classes:g.sort((a,b)=>b.members-a.members||a.classId.localeCompare(b.classId))})).sort((a,b)=>a.name.localeCompare(b.name));
 // ---- class lists that point at a missing account, or only one side saved ---
 const mismatches=[];
 for(const [classId,c] of Object.entries(classes||{})){
  if(!validId(classId)||!c)continue;
  for(const [id,member] of Object.entries(c.members||{})){
   if(!validId(id)||!member)continue;
   const row=students?.[id],m=row?.memberships?.[WS+'_'+classId];
   if(!row?.profile)mismatches.push({classId,className:className(classId),studentId:id,name:String(member.name||id),problem:'On the class list, but the student account does not exist.'});
   // Older ET/WT accounts have no class records on the account at all; that is expected.
   else if(member.active!==false&&row.memberships&&(!m||m.active===false))mismatches.push({classId,className:className(classId),studentId:id,name:String(row.profile.name||member.name||id),problem:'On the class list, but the student account does not list this class.'});
  }
 }
 return {ok:true,readOnly:true,
  summary:{students:Object.keys(students||{}).filter(validId).length,sameNameGroups:studentGroups.length,accountsInGroups:studentGroups.reduce((n,g)=>n+g.accounts.length,0),
   blockingSignIn:studentGroups.filter(g=>g.blocksSignIn).length,sameClassNameGroups:classGroups.length,mismatches:mismatches.length},
  studentGroups,classGroups,mismatches};
}

module.exports={duplicateReport,nameKey,classKey};
