'use strict';
// Splitting the two legacy classes ET and WT into morning and afternoon
// classes (Issue #728). Owner only: these actions are reached through the
// existing owner gate in student-management-core.cjs.
//
//   classSplitPreview  read only: what exists, who would be enrolled where
//   classSplitCreate   make (or pick) the four classes, in ET/WT's own school
//   classSplitEnroll   add the ticked students to the ticked new classes
//   classSplitRetire   later: turn ET or WT off. Nothing is deleted.
//   classSplitRestore  turn a retired ET or WT back on
//
// What is never written:
//  - Nothing under classes/et or classes/wt, except `active`, `retiredAt` and
//    `retiredBy` when the owner retires or restores that class.
//  - No homework, records, rewards, passcodes or student profiles.
//  - No student is ever removed from any class here. Enrolling only adds.
//
// One write to a student's own record besides the new memberships: a legacy
// student with NO membership records reaches ET/WT through an old fallback
// that every access check switches off as soon as the student has any
// membership record. Before such a student gets a new class, the ET/WT
// membership they already rely on is written down, so ET/WT keeps working for
// them exactly as it does today.
const crypto=require('node:crypto');
const {hashOf,classKey,AUDIT}=require('./student-import-core.cjs');

const WS='b3-2026',ROOT='b3Games/workspaces/'+WS;
const STATE='b3Private/classSplits/';
const SOURCES={et:'ET',wt:'WT'};
const SESSIONS=['morning','afternoon'];
const MAX_PICKS=500;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
const slug=s=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const targetName=(source,session)=>'B3 '+SOURCES[source]+' '+session;
const activeMembers=cls=>Object.entries(cls?.members||{}).filter(([id,m])=>validId(id)&&m&&m.active!==false&&m.demo!==true&&!/^demo_/.test(id));

// Reads everything and decides nothing: one description of the site that the
// preview shows and that every writing action re-checks before it writes.
async function survey(store){
 const [classesRaw,stateRaw,recordsRaw]=await Promise.all([store.get(ROOT+'/classes'),store.get(STATE.slice(0,-1)),store.get(ROOT+'/students')]);
 const classes=classesRaw||{},state=stateRaw||{},records=recordsRaw||{};
 const classOpen=id=>!!classes[id]&&classes[id].active!==false;
 const out={classes,records,sources:{}};
 for(const source of Object.keys(SOURCES)){
  const cls=classes[source],st=state[source]||{};
  const s=out.sources[source]={source,label:SOURCES[source],exists:!!cls,name:String(cls?.name||SOURCES[source]),active:!!cls&&cls.active!==false,
   schoolId:validId(cls?.schoolId)?cls.schoolId:'',retired:st.retired||null,state:st,targets:{},students:[],skipped:[],stranded:[]};
  // ---- the two new classes ------------------------------------------------
  for(const session of SESSIONS){
   const name=targetName(source,session),recorded=st.targets?.[session];
   const classId=validId(recorded)&&classes[recorded]?recorded:'';
   const t=s.targets[session]={session,name,classId,ready:!!classId,candidates:[]};
   if(classId){
    const c=classes[classId],sourceIds=new Set(Object.keys(cls?.members||{}));
    Object.assign(t,{className:String(c.name||classId),active:c.active!==false,schoolId:validId(c.schoolId)?c.schoolId:'',
     members:activeMembers(c).length,others:activeMembers(c).filter(([id])=>!sourceIds.has(id)).length,
     teachers:Object.values(c.teacherIds||{}).filter(v=>v===true).length,toolsOn:Object.values(c.toolGrants||{}).filter(v=>v===true).length});
   }else{
    // Classes that already carry this name (Issue #665). Never picked silently.
    t.candidates=Object.entries(classes).filter(([id,c])=>validId(id)&&c&&!SOURCES[id]&&classKey(c.name||id)===classKey(name))
     .map(([id,c])=>({classId:id,name:String(c.name||id),members:activeMembers(c).length,active:c.active!==false,schoolId:validId(c.schoolId)?c.schoolId:'',sameSchool:(validId(c.schoolId)?c.schoolId:'')===s.schoolId}))
     .sort((a,b)=>a.classId.localeCompare(b.classId));
   }
  }
  if(!cls)continue;
  // ---- the students in the legacy class -----------------------------------
  for(const [id,member] of Object.entries(cls.members||{})){
   if(!validId(id)||!member||member.demo===true||/^demo_/.test(id))continue;
   const name=String(member.name||id);
   if(member.active===false){s.skipped.push({studentId:id,name,reason:'Turned off in '+s.label+'.'});continue;}
   const [profile,membershipsRaw]=await Promise.all([store.get('b3Games/students/'+id+'/profile'),store.get('b3Games/students/'+id+'/memberships')]);
   if(!profile){s.skipped.push({studentId:id,name,reason:'Has no student account yet (never signed in on the new sign-in).'});continue;}
   if(profile.active===false){s.skipped.push({studentId:id,name,reason:'This account is turned off.'});continue;}
   const memberships=membershipsRaw||{},own=memberships[WS+'_'+source];
   if(own&&own.active===false){s.skipped.push({studentId:id,name,reason:'Was taken out of '+s.label+'.'});continue;}
   // Legacy fallback (see the note at the top of this file).
   let keepSource=false;
   if(!own&&!Object.keys(memberships).length){
    if(profile.classId===source)keepSource=true;
    else{const legacy=await store.get('posukPractice/allowedStudents/'+id);keepSource=!!legacy&&legacy.active!==false&&legacy.classId===source;}
   }
   const row={studentId:id,name:String(profile.name||name),keepSource,hasRecord:!!records[id],seen:!!st.students?.[id]};
   for(const session of SESSIONS){
    const classId=s.targets[session].classId;
    if(!classId){row[session]='add';continue;}
    const m=classes[classId].members?.[id],link=memberships[WS+'_'+classId];
    row[session]=m&&m.active===false?'blocked':m&&link&&link.active!==false?'in':link&&link.active===false?'out':'add';
   }
   // Would this student still have a class if the legacy class were turned off?
   const elsewhere=Object.values(memberships).some(m=>m&&m.active!==false&&m.workspaceId===WS&&m.classId!==source&&classOpen(m.classId)
    &&classes[m.classId].members?.[id]&&classes[m.classId].members[id].active!==false);
   if(!elsewhere)s.stranded.push({studentId:id,name:row.name});
   s.students.push(row);
  }
  s.students.sort((a,b)=>a.name.localeCompare(b.name)||a.studentId.localeCompare(b.studentId));
  s.planHash=hashOf({source,active:s.active,schoolId:s.schoolId,retired:!!s.retired,
   targets:SESSIONS.map(x=>[s.targets[x].classId,s.targets[x].active??null,s.targets[x].candidates.map(c=>c.classId)]),
   students:s.students.map(r=>[r.studentId,r.morning,r.afternoon,r.keepSource]),stranded:s.stranded.map(r=>r.studentId)});
 }
 return out;
}

function describe(view){
 const sources=Object.values(view.sources).map(s=>({
  source:s.source,label:s.label,exists:s.exists,name:s.name,active:s.active,schoolId:s.schoolId,planHash:s.planHash||'',
  retired:s.retired?{at:s.retired.at||null}:null,
  targets:Object.fromEntries(SESSIONS.map(x=>[x,s.targets[x]])),
  // A student the owner already went through keeps the owner's choice: a
  // session they were left out of is not ticked again by default.
  students:s.students.map(r=>({studentId:r.studentId,name:r.name,morning:r.morning,afternoon:r.afternoon,
   tick:Object.fromEntries(SESSIONS.map(x=>[x,r[x]==='in'||(r[x]==='add'&&!r.seen)]))})),
  skipped:s.skipped,stranded:s.stranded
 }));
 return {ok:true,sources};
}

async function classSplitPreview(store){return describe(await survey(store));}

// Creates the classes that are still missing, or records which existing class
// the owner chose. An existing class is only pointed at, never changed.
async function classSplitCreate(store,identity,body,now=Date.now()){
 const view=await survey(store),uid=identity.uid;
 const choices=body.choices&&typeof body.choices==='object'?body.choices:{};
 const used=new Set(Object.values(view.sources).flatMap(s=>SESSIONS.map(x=>s.targets[x].classId)).filter(Boolean));
 const taken=new Set(Object.keys(view.classes)),plan=[];
 for(const s of Object.values(view.sources)){
  if(!s.exists)fail(409,'The class '+s.label+' does not exist on this site, so it cannot be split.');
  for(const session of SESSIONS){
   const t=s.targets[session];if(t.ready)continue;
   const choice=String(choices[s.source]?.[session]||'');
   if(choice==='new'||(!choice&&!t.candidates.length)){
    let id=slug(t.name);while(taken.has(id))id=slug(t.name)+'_'+crypto.randomBytes(3).toString('hex');
    taken.add(id);plan.push({s,session,classId:id,create:true,name:t.name});continue;
   }
   const hit=t.candidates.find(c=>c.classId===choice);
   if(!hit)fail(400,'Choose which class to use for '+t.name+': one that already has this name, or a new one.');
   if(!hit.active)fail(409,hit.name+' ('+hit.classId+') is turned off. Choose another class or a new one.');
   if(!hit.sameSchool)fail(409,hit.name+' ('+hit.classId+') is not in the same school as '+s.label+'. Change its school under Classes first, or choose a new class.');
   if(used.has(choice))fail(400,hit.name+' ('+hit.classId+') was chosen twice.');
   used.add(choice);plan.push({s,session,classId:choice,create:false,name:hit.name});
  }
 }
 const created=[],linked=[];
 for(const p of plan){
  const updates={[STATE+p.s.source+'/targets/'+p.session]:p.classId,[STATE+p.s.source+'/updatedAt']:now,[STATE+p.s.source+'/updatedBy']:uid};
  if(p.create){
   if(await store.get(ROOT+'/classes/'+p.classId))fail(409,'The site changed while creating the classes. Check again.');
   // Same shape as a class made under Classes, in the legacy class's school.
   updates[ROOT+'/classes/'+p.classId]={name:p.name,active:true,...(p.s.schoolId?{schoolId:p.s.schoolId}:{}),createdAt:now,createdBy:uid,splitFrom:p.s.source,session:p.session};
   created.push(p.classId);
  }else linked.push(p.classId);
  await store.update(updates);
 }
 if(plan.length)await store.update({[AUDIT+crypto.randomUUID()]:{action:'classSplitCreate',by:uid,byEmail:String(identity.email||''),at:now,counts:{created:created.length,linked:linked.length},classIds:[...created,...linked]}});
 return {...describe(await survey(store)),created,linked};
}

// Adds the ticked students to the ticked new classes. Only ever adds.
async function classSplitEnroll(store,identity,body,now=Date.now()){
 const source=String(body.source||'');
 if(!SOURCES[source])fail(400,'Choose ET or WT.');
 const view=await survey(store),s=view.sources[source],uid=identity.uid;
 if(!s.exists)fail(409,'The class '+s.label+' does not exist on this site.');
 for(const x of SESSIONS){
  if(!s.targets[x].ready)fail(409,'Create the new classes first.');
  if(!s.targets[x].active)fail(409,s.targets[x].className+' is turned off. Turn it on first.');
 }
 if(String(body.planHash||'')!==s.planHash)fail(409,'The site changed since you checked. Check again.');
 const picks=body.picks&&typeof body.picks==='object'&&!Array.isArray(body.picks)?body.picks:{};
 if(Object.keys(picks).length>MAX_PICKS)fail(413,'Too many students in one request.');
 const known=new Set(s.students.map(r=>r.studentId));
 const ignored=Object.keys(picks).filter(id=>!known.has(id));
 const results={enrolled:[],unchanged:[],failed:[]};
 let memberships=0,kept=0;
 for(const r of s.students){
  const pick=picks[r.studentId];
  if(!pick||typeof pick!=='object')continue;
  const add=SESSIONS.filter(x=>pick[x]===true&&(r[x]==='add'||r[x]==='out'));
  const id=r.studentId,updates={},S=STATE+source+'/students/'+id;
  // Remember that the owner went through this student, so a session they were
  // left out of is not ticked again next time.
  updates[S+'/reviewedAt']=now;updates[S+'/reviewedBy']=uid;
  if(add.length&&r.keepSource){
   updates['b3Games/students/'+id+'/memberships/'+WS+'_'+source]={workspaceId:WS,classId:source,active:true};
   updates[S+'/keptSourceAt']=now;
  }
  for(const x of add){
   const classId=s.targets[x].classId;
   updates[ROOT+'/classes/'+classId+'/members/'+id]={studentId:id,name:r.name,active:true};
   updates['b3Games/students/'+id+'/memberships/'+WS+'_'+classId]={workspaceId:WS,classId,active:true};
   updates[ROOT+'/classes/'+classId+'/managementAudit/'+crypto.randomUUID()]={action:'splitAdd',studentId:id,teacherUid:uid,from:source,at:now};
   // The owner panel's own (non-authoritative) copy of the student's classes.
   if(r.hasRecord){updates[ROOT+'/students/'+id+'/classIds/'+classId]=true;updates[ROOT+'/students/'+id+'/updatedAt']=now;}
   updates[S+'/added/'+x]={classId,at:now};
  }
  try{
   // One atomic write per student: never half a student.
   await store.update(updates);
   if(add.length){results.enrolled.push({studentId:id,name:r.name,sessions:add});memberships+=add.length;if(r.keepSource)kept++;}
   else results.unchanged.push(id);
  }catch(error){results.failed.push({studentId:id,name:r.name,error:String(error?.message||error)});}
 }
 const counts={students:results.enrolled.length,memberships,unchanged:results.unchanged.length,keptSource:kept,failed:results.failed.length,ignored:ignored.length};
 await store.update({[STATE+source+'/lastEnrolledAt']:now,[AUDIT+crypto.randomUUID()]:{action:'classSplitEnroll',source,by:uid,byEmail:String(identity.email||''),at:now,counts}});
 return {...describe(await survey(store)),source,counts,enrolled:results.enrolled,failed:results.failed,ignored};
}

// Turns the legacy class off. Its students, homework, records and passcodes
// all stay where they are; every existing check already treats a class whose
// `active` is false as closed.
async function classSplitRetire(store,identity,body,now=Date.now()){
 const source=String(body.source||'');
 if(!SOURCES[source])fail(400,'Choose ET or WT.');
 const view=await survey(store),s=view.sources[source],uid=identity.uid;
 if(!s.exists)fail(409,'The class '+s.label+' does not exist on this site.');
 if(!s.active)fail(409,s.label+' is already turned off.');
 for(const x of SESSIONS)if(!s.targets[x].ready||!s.targets[x].active)fail(409,'The two new '+s.label+' classes must exist and be turned on before '+s.label+' can be retired.');
 if(String(body.planHash||'')!==s.planHash)fail(409,'The site changed since you checked. Check again.');
 if(s.stranded.length&&body.allowNoClass!==true){
  const names=s.stranded.slice(0,10).map(r=>r.name).join(', ');
  fail(409,s.stranded.length+' student(s) would have no class left: '+names+(s.stranded.length>10?' and more':'')+'. Enroll them in a new class first, or tick "Retire anyway".');
 }
 if(String(body.confirmText||'').trim().toUpperCase()!=='RETIRE '+s.label)fail(400,'Type RETIRE '+s.label+' to confirm.');
 const cls=view.classes[source];
 await store.update({
  [ROOT+'/classes/'+source+'/active']:false,[ROOT+'/classes/'+source+'/retiredAt']:now,[ROOT+'/classes/'+source+'/retiredBy']:uid,
  [STATE+source+'/retired']:{at:now,by:uid,hadActive:Object.hasOwn(cls,'active')?cls.active:null,noClass:s.stranded.map(r=>r.studentId)},
  [AUDIT+crypto.randomUUID()]:{action:'classSplitRetire',source,by:uid,byEmail:String(identity.email||''),at:now,counts:{students:s.students.length,noClass:s.stranded.length}}
 });
 return {...describe(await survey(store)),source,retired:true};
}

// Puts a class retired here back exactly as it was.
async function classSplitRestore(store,identity,body,now=Date.now()){
 const source=String(body.source||'');
 if(!SOURCES[source])fail(400,'Choose ET or WT.');
 const view=await survey(store),s=view.sources[source],uid=identity.uid;
 if(!s.exists)fail(409,'The class '+s.label+' does not exist on this site.');
 if(!s.retired)fail(409,s.label+' was not retired from here, so there is nothing to bring back.');
 const had=s.retired.hadActive;
 await store.update({
  [ROOT+'/classes/'+source+'/active']:had===true?true:null,[ROOT+'/classes/'+source+'/retiredAt']:null,[ROOT+'/classes/'+source+'/retiredBy']:null,
  [STATE+source+'/retired']:null,[STATE+source+'/restoredAt']:now,
  [AUDIT+crypto.randomUUID()]:{action:'classSplitRestore',source,by:uid,byEmail:String(identity.email||''),at:now,counts:{students:s.students.length}}
 });
 return {...describe(await survey(store)),source,restored:true};
}

module.exports={classSplitPreview,classSplitCreate,classSplitEnroll,classSplitRetire,classSplitRestore,survey,targetName,SOURCES,SESSIONS,STATE};
