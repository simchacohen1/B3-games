'use strict';
// Owner Admin "Export Everything" (Issue #724).
//
// One table for the owner: one row per student (name, passcode, school,
// classes, those classes' teachers, the school's principal), followed by a row
// for every class, teacher, principal and school that no student row shows, so
// nothing on the site is missing from the file.
//
// Read-only apart from one audit entry. Passcodes are included, so this is only
// reachable through funTorahManageStudents' owner check (BULK_ACTIONS).
const crypto=require('node:crypto');
const {readPasscode}=require('./student-passcodes.cjs');
const {loadStudentProfiles}=require('./student-directory.cjs');
const {AUDIT,WS,ROOT}=require('./student-import-core.cjs');

const HEADER=['Student name','Passcode','School','Classes','Teachers','Principal','Note'];
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
const isPrincipal=r=>!!r&&(r.accountType==='principal'||r.role==='principal');
const text=v=>String(v??'').replace(/\s+/g,' ').trim();
const byText=(a,b)=>a.localeCompare(b,'en',{sensitivity:'base',numeric:true});
const join=list=>[...new Set(list.filter(Boolean))].sort(byText).join('; ');

async function exportEverything(store,identity,body,now=Date.now()){
 const [classesRaw,invitesRaw,schoolsRaw,mirrors,legacy,priv,directory]=await Promise.all([
  store.get(ROOT+'/classes'),store.get(ROOT+'/teacherInvites'),store.get(ROOT+'/schools'),store.get(ROOT+'/students'),
  store.get('posukPractice/allowedStudents'),store.get('b3Private/passcodes'),
  // Profiles only: b3Games/students also holds every student's saved work.
  loadStudentProfiles(store.get,store.keys)
 ]);
 const classes=Object.fromEntries(Object.entries(classesRaw||{}).filter(([id,c])=>validId(id)&&c&&typeof c==='object'));
 const schools=Object.fromEntries(Object.entries(schoolsRaw||{}).filter(([,s])=>s&&typeof s==='object'&&text(s.name)).map(([id,s])=>[id,text(s.name)]));
 const staff=Object.entries(invitesRaw||{}).filter(([,p])=>p&&typeof p==='object').map(([id,p])=>({id,name:text(p.name)||text(p.email)||id,schoolId:schools[p.schoolId]?p.schoolId:'',principal:isPrincipal(p),classIds:Object.keys(p.classIds||{}).filter(c=>p.classIds[c]===true&&classes[c])}));
 const teachers=staff.filter(p=>!p.principal),principals=staff.filter(p=>p.principal);
 const className=id=>text(classes[id].name)||id;
 const classSchool=id=>schools[classes[id].schoolId]?classes[id].schoolId:'';
 const teachersOf=ids=>teachers.filter(t=>t.classIds.some(c=>ids.includes(c)));
 const principalsOf=schoolId=>schoolId?principals.filter(p=>p.schoolId===schoolId):[];

 // Every student the site knows: central profiles, class rosters, the owner's
 // school records and the old student list. Teachers' demo students are left out.
 const profiles=directory.profiles||{};
 const members={};
 for(const [cid,c] of Object.entries(classes))for(const [sid,m] of Object.entries(c.members||{}))if(validId(sid)&&m&&typeof m==='object')(members[sid]??=[]).push({cid,m});
 const ids=[...new Set([...Object.keys(profiles),...Object.keys(members),...Object.keys(mirrors||{}),...Object.keys(legacy||{})])].filter(validId);
 // The same lookup order sign-in uses, answered from the data already read.
 const PRIV='b3Private/passcodes/',OLD='posukPractice/allowedStudents/';
 const memory=async path=>path.startsWith(PRIV)?priv?.[path.slice(PRIV.length)]??null:path.startsWith(OLD)?legacy?.[path.slice(OLD.length)]??null:profiles[path.split('/')[2]]??null;
 const memberships=await Promise.all(ids.map(id=>profiles[id]?store.get('b3Games/students/'+id+'/memberships'):null));

 const shown={schools:new Set(),classes:new Set(),staff:new Set()};
 const row=(name,passcode,schoolId,classIds,note,extraStaff=[])=>{
  const t=[...teachersOf(classIds),...extraStaff.filter(p=>!p.principal)],p=[...principalsOf(schoolId),...extraStaff.filter(x=>x.principal)];
  if(schoolId)shown.schools.add(schoolId);
  classIds.forEach(c=>shown.classes.add(c));[...t,...p].forEach(x=>shown.staff.add(x.id));
  return [name,passcode,schoolId?schools[schoolId]:'',join(classIds.map(className)),join(t.map(x=>x.name)),join(p.map(x=>x.name)),note];
 };

 const students=[];
 for(const [i,id] of ids.entries()){
  const profile=profiles[id],rows=members[id]||[],old=legacy?.[id];
  if(/^demo_/.test(id)||profile?.demo===true||(!profile&&rows.length&&rows.every(r=>r.m.demo===true)))continue;
  const inClass=new Set(rows.filter(r=>r.m.active!==false).map(r=>r.cid));
  for(const m of Object.values(memberships[i]||{}))if(m&&m.active!==false&&m.workspaceId===WS&&classes[m.classId])inClass.add(String(m.classId));
  // Older accounts with no membership records still sign in to their first class.
  const first=profile?.classId||old?.classId;
  if(!inClass.size&&classes[first]&&memberships[i]?.[WS+'_'+first]?.active!==false)inClass.add(String(first));
  const classIds=[...inClass];
  const classSchools=[...new Set(classIds.map(classSchool))];
  const own=mirrors?.[id]?.schoolId;
  const schoolId=schools[own]?own:classSchools.length===1?classSchools[0]:'';
  const notes=[];
  const active=profile?profile.active!==false:old?old.active!==false:true;
  if(!active)notes.push('Account is turned off');
  if(!classIds.length)notes.push('Not in any class');
  if(!schoolId)notes.push(classSchools.filter(Boolean).length>1?'Classes are in more than one school':'No school chosen');
  const name=text(profile?.name)||text(rows.find(r=>text(r.m.name))?.m.name)||text(old?.name)||id;
  students.push({name,schoolId,classIds,passcode:(await readPasscode(memory,id,{allowLegacyDefault:true})).passcode,note:notes.join('; ')});
 }
 students.sort((a,b)=>byText(schools[a.schoolId]||'￿',schools[b.schoolId]||'￿')||byText(a.name,b.name));
 const out=students.map(s=>row(s.name,s.passcode,s.schoolId,s.classIds,s.note));

 // Everything no student row has shown yet.
 const extra=[];
 for(const cid of Object.keys(classes).sort((a,b)=>byText(className(a),className(b))))if(!shown.classes.has(cid))extra.push(row('','',classSchool(cid),[cid],classes[cid].active===false?'Class with no students (class is turned off)':'Class with no students'));
 for(const list of [teachers,principals])for(const p of [...list].sort((a,b)=>byText(a.name,b.name)))if(!shown.staff.has(p.id))extra.push(row('','',p.schoolId,p.classIds,(p.principal?'Principal':'Teacher')+' with no students',[p]));
 for(const sid of Object.keys(schools).sort((a,b)=>byText(schools[a],schools[b])))if(!shown.schools.has(sid))extra.push(row('','',sid,[],'School with no students'));

 const counts={students:out.length,classes:Object.keys(classes).length,teachers:teachers.length,principals:principals.length,schools:Object.keys(schools).length,withoutStudents:extra.length};
 await store.update({[AUDIT+crypto.randomUUID()]:{action:'exportEverything',by:identity.uid,byEmail:String(identity.email||''),at:now,counts}});
 return {ok:true,exportedAt:now,header:HEADER,rows:[...out,...extra],counts};
}

module.exports={exportEverything,HEADER};
