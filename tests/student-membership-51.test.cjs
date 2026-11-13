'use strict';
// Issue #51 (Student Management & Class Membership): duplicate-safe student
// creation and CSV import, independent ET / WT class membership, passcode
// management, teacher and principal permissions, and the read-only duplicate
// report. Fictional students and an in-memory database only.
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const DIR=process.env.STUDENT_FUNCTIONS_DIR||path.join(__dirname,'..','backend','functions');
const {manageStudents}=require(path.join(DIR,'student-management-core.cjs'));
const {duplicateReport,nameKey}=require(path.join(DIR,'student-duplicates-core.cjs'));
const R=require('../bulk-roster.js');

const google={email_verified:true,firebase:{sign_in_provider:'google.com'}};
const OWNER={uid:'owner_uid',email:'simcha5770@gmail.com',...google};
const ET_TEACHER={uid:'et_teacher',email:'et@test.example',...google};
const WT_TEACHER={uid:'wt_teacher',email:'wt@test.example',...google};
const PRINCIPAL={uid:'principal_uid',email:'principal@test.example',...google};
const STRANGER={uid:'nobody',email:'nobody@test.example',...google};
const W='b3-2026';
const BROKEN=String.fromCharCode(0xFFFD);

function db(tree){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:structuredClone(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??={};if(v===null||v===undefined)delete o[last];else o[last]=structuredClone(v)};
 const store={tree,writes:[],get,update:async u=>{store.writes.push(u);for(const [p,v] of Object.entries(u))set(p,v)}};
 return store;
}
const member=(id,name)=>({studentId:id,name,active:true});
const ship=cid=>({[W+'_'+cid]:{workspaceId:W,classId:cid,active:true}});
function site(){
 return db({b3Games:{
  students:{
   // Dovid is in the morning (ET) class and the afternoon (WT) class.
   dovid:{profile:{id:'dovid',name:'Dovid Fict',active:true,createdAt:1},memberships:{...ship('et'),...ship('wt')},halacha:{done:2}},
   // Ari is in the morning class only; Yossi in the afternoon class only.
   ari:{profile:{id:'ari',name:'Ari Fict',active:true,createdAt:2},memberships:ship('et')},
   yossi:{profile:{id:'yossi',name:'Yossi Fict',active:true,createdAt:3},memberships:ship('wt')}
  },
  workspaces:{[W]:{
   classes:{
    et:{name:'ET',active:true,members:{dovid:member('dovid','Dovid Fict'),ari:member('ari','Ari Fict')}},
    wt:{name:'WT',active:true,members:{dovid:member('dovid','Dovid Fict'),yossi:member('yossi','Yossi Fict')}}
   },
   teachers:{
    et_teacher:{active:true,role:'teacher',classIds:{et:true}},
    wt_teacher:{active:true,role:'teacher',classIds:{wt:true}},
    // A principal is a teacher-level account for the classes of the teachers they supervise.
    principal_uid:{active:true,role:'teacher',accountType:'principal',classIds:{et:true,wt:true}}
   }
  }}
 },b3Private:{passcodes:{dovid:{passcode:'111111'},ari:{passcode:'222222'},yossi:{passcode:'333333'}}}});
}
const students=s=>s.tree.b3Games.students;
const named=(s,name)=>Object.values(students(s)).filter(x=>nameKey(x.profile?.name)===nameKey(name));
const cls=(s,id)=>s.tree.b3Games.workspaces[W].classes[id];
const call=(s,who,body)=>manageStudents(s,who,body);

// ---- ET and WT are separate classes -------------------------------------------
test('ET and WT membership are independent: blocking in ET leaves WT and the account untouched',async()=>{
 const s=site();
 await call(s,ET_TEACHER,{action:'active',classId:'et',studentId:'dovid',active:false});
 assert.equal(cls(s,'et').members.dovid.active,false);
 assert.equal(students(s).dovid.memberships[W+'_et'].active,false);
 assert.equal(cls(s,'wt').members.dovid.active,true,'WT class list unchanged');
 assert.equal(students(s).dovid.memberships[W+'_wt'].active,true,'WT membership unchanged');
 assert.equal(students(s).dovid.profile.active,true,'the account itself is not turned off');
 assert.equal(students(s).dovid.halacha.done,2,'saved work kept');
});
test('the owner blocks a student in one class the same way: per class, not the whole account',async()=>{
 const s=site();
 await call(s,OWNER,{action:'active',classId:'wt',studentId:'dovid',active:false});
 assert.equal(cls(s,'wt').members.dovid.active,false);
 assert.equal(cls(s,'et').members.dovid.active,true);
 assert.equal(students(s).dovid.profile.active,true);
});
test('removing a student from ET keeps him in WT, with his account and work',async()=>{
 const s=site();
 await call(s,ET_TEACHER,{action:'remove',classId:'et',studentId:'dovid'});
 assert.equal(cls(s,'et').members.dovid,undefined);
 assert.equal(students(s).dovid.memberships[W+'_et'].active,false);
 assert.ok(cls(s,'wt').members.dovid);
 assert.equal(students(s).dovid.memberships[W+'_wt'].active,true);
 assert.equal(students(s).dovid.halacha.done,2);
});
test('a class list shows only that class: ET teacher gets ET passcodes, never WT-only students',async()=>{
 const s=site();
 const et=await call(s,ET_TEACHER,{action:'list',classId:'et'});
 assert.deepEqual(Object.keys(et.passcodes).sort(),['ari','dovid']);
 const wt=await call(s,WT_TEACHER,{action:'list',classId:'wt'});
 assert.deepEqual(Object.keys(wt.passcodes).sort(),['dovid','yossi']);
});

// ---- Permissions ----------------------------------------------------------------
test('a teacher cannot list, change or add to a class that is not theirs',async()=>{
 const s=site();
 for(const body of [{action:'list',classId:'wt'},{action:'passcode',classId:'wt',studentId:'yossi',passcode:'999999'},{action:'active',classId:'wt',studentId:'yossi',active:false},{action:'remove',classId:'wt',studentId:'yossi'},{action:'create',classId:'wt',name:'New Fict',passcode:'123123'}])
  await assert.rejects(call(s,ET_TEACHER,body),/not assigned/,body.action);
 // In their own class, they still cannot touch a student who is only in the other class.
 await assert.rejects(call(s,ET_TEACHER,{action:'passcode',classId:'et',studentId:'yossi',passcode:'999999'}),/not a member/);
 await assert.rejects(call(s,ET_TEACHER,{action:'add',classId:'et',studentId:'yossi'}),/not assigned to your classes/);
 assert.equal(s.writes.length,0);
});
test('a principal can manage students in the classes they supervise, and nothing owner-only',async()=>{
 const s=site();
 assert.deepEqual(Object.keys((await call(s,PRINCIPAL,{action:'list',classId:'et'})).passcodes).sort(),['ari','dovid']);
 assert.deepEqual(Object.keys((await call(s,PRINCIPAL,{action:'list',classId:'wt'})).passcodes).sort(),['dovid','yossi']);
 await call(s,PRINCIPAL,{action:'passcode',classId:'wt',studentId:'yossi',passcode:'444444'});
 assert.equal(s.tree.b3Private.passcodes.yossi.passcode,'444444');
 await call(s,PRINCIPAL,{action:'add',classId:'et',studentId:'yossi'});
 assert.ok(cls(s,'et').members.yossi,'principal can add a supervised student to another supervised class');
 for(const action of ['importPreview','rollbackPreview','bulkDelete','studentsOverview','duplicateReport','migratePasscodes'])
  await assert.rejects(call(s,PRINCIPAL,{action,classId:'et'}),/Owner|administrator/i,action);
 await assert.rejects(call(s,PRINCIPAL,{action:'list',all:true}),/Choose a class/,'whole-school passcode list stays owner only');
});
test('a principal whose supervision was removed, a disabled teacher and a stranger get nothing',async()=>{
 const s=site();
 s.tree.b3Games.workspaces[W].teachers.principal_uid.classIds={et:true};
 await assert.rejects(call(s,PRINCIPAL,{action:'list',classId:'wt'}),/not assigned/);
 s.tree.b3Games.workspaces[W].teachers.et_teacher.active=false;
 await assert.rejects(call(s,ET_TEACHER,{action:'list',classId:'et'}),/not assigned/);
 await assert.rejects(call(s,STRANGER,{action:'list',classId:'et'}),/not assigned/);
});

// ---- Student list loading --------------------------------------------------------
test('the passcode list for a large class is read side by side, not one student at a time',async()=>{
 const s=site();
 for(let i=0;i<300;i++){const id='big_'+i;students(s)[id]={profile:{id,name:'Big Fict '+i,active:true},memberships:ship('et')};cls(s,'et').members[id]=member(id,'Big Fict '+i);s.tree.b3Private.passcodes[id]={passcode:String(100000+i)};}
 let running=0,peak=0;const get=s.get;
 s.get=async p=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,1));try{return await get(p)}finally{running--}};
 const started=Date.now(),r=await call(s,ET_TEACHER,{action:'list',classId:'et'});
 assert.equal(Object.keys(r.passcodes).length,302);
 assert.equal(r.passcodes.big_7,'100007');
 assert.ok(peak>=20,'reads overlap (peak '+peak+')');
 assert.ok(peak<=40,'but stay bounded (peak '+peak+')');
 assert.ok(Date.now()-started<3000);
});
test('the owner can still open the list of a class that is turned off, but cannot change it',async()=>{
 const s=site();cls(s,'et').active=false;
 assert.deepEqual(Object.keys((await call(s,OWNER,{action:'list',classId:'et'})).passcodes).sort(),['ari','dovid']);
 await assert.rejects(call(s,OWNER,{action:'active',classId:'et',studentId:'ari',active:false}),/inactive/);
 await assert.rejects(call(s,ET_TEACHER,{action:'list',classId:'et'}),/inactive/);
});

// ---- Duplicate-safe single create ------------------------------------------------
test('creating a student who is already in the class is refused; nothing is written',async()=>{
 const s=site();
 await assert.rejects(call(s,ET_TEACHER,{action:'create',classId:'et',name:'  ari   FICT ',passcode:'987654'}),e=>e.code===409&&e.duplicate==='in-class');
 await assert.rejects(call(s,ET_TEACHER,{action:'create',classId:'et',name:'Ari Fict',passcode:'987654',confirmNew:true}),e=>e.duplicate==='in-class','cannot be overridden');
 assert.equal(named(s,'Ari Fict').length,1);assert.equal(s.writes.length,0);
});
test('pressing Create twice makes one student, not two',async()=>{
 const s=site(),body={action:'create',classId:'et',name:'Brand New Fict',passcode:'565656'};
 await call(s,ET_TEACHER,body);
 await assert.rejects(call(s,ET_TEACHER,body),e=>e.code===409);
 assert.equal(named(s,'Brand New Fict').length,1);
});
test('a same-name student in another class needs a deliberate confirmation, and never the same passcode',async()=>{
 const s=site();
 await assert.rejects(call(s,ET_TEACHER,{action:'create',classId:'et',name:'Yossi Fict',passcode:'121212'}),e=>e.code===409&&e.duplicate==='same-name');
 await assert.rejects(call(s,ET_TEACHER,{action:'create',classId:'et',name:'Yossi Fict',passcode:'333333',confirmNew:true}),e=>e.code===409&&e.duplicate==='same-passcode');
 assert.equal(named(s,'Yossi Fict').length,1);assert.equal(s.writes.length,0);
 const made=await call(s,ET_TEACHER,{action:'create',classId:'et',name:'Yossi Fict',passcode:'121212',confirmNew:true});
 assert.equal(named(s,'Yossi Fict').length,2,'a genuinely different boy can be created on purpose');
 assert.equal(students(s).yossi.memberships[W+'_wt'].active,true,'the first Yossi is untouched');
 assert.ok(cls(s,'et').members[made.studentId]);
});
test('a removed student is not recreated by accident: the teacher is told he already exists',async()=>{
 const s=site();
 await call(s,ET_TEACHER,{action:'remove',classId:'et',studentId:'ari'});
 await assert.rejects(call(s,ET_TEACHER,{action:'create',classId:'et',name:'Ari Fict',passcode:'787878'}),e=>e.duplicate==='same-name');
 assert.equal(named(s,'Ari Fict').length,1);
});
test('a turned-off account or a teacher demo student does not block a new student',async()=>{
 const s=site();students(s).ari.profile.active=false;delete cls(s,'et').members.ari;
 students(s).demo_x={profile:{id:'demo_x',name:'Demo Fict',active:true,demo:true}};
 await call(s,ET_TEACHER,{action:'create',classId:'et',name:'Ari Fict',passcode:'787878'});
 await call(s,ET_TEACHER,{action:'create',classId:'et',name:'Demo Fict',passcode:'797979'});
 assert.equal(named(s,'Ari Fict').length,2);
});

// ---- Passcodes -------------------------------------------------------------------
test('a passcode change is refused when another same-name student already uses it',async()=>{
 const s=site();
 const twin=(await call(s,ET_TEACHER,{action:'create',classId:'et',name:'Yossi Fict',passcode:'121212',confirmNew:true})).studentId;
 const before=s.writes.length;
 await assert.rejects(call(s,ET_TEACHER,{action:'passcode',classId:'et',studentId:twin,passcode:'333333'}),e=>e.code===409&&e.duplicate==='same-passcode');
 assert.equal(s.writes.length,before);assert.equal(s.tree.b3Private.passcodes[twin].passcode,'121212');
 await call(s,ET_TEACHER,{action:'passcode',classId:'et',studentId:twin,passcode:'343434'});
 assert.equal(s.tree.b3Private.passcodes[twin].passcode,'343434');
 // Saving a student's own current passcode again is fine.
 await call(s,ET_TEACHER,{action:'passcode',classId:'et',studentId:twin,passcode:'343434'});
});
test('one passcode per student: changing it in ET is what WT sees too, and it never lands in public data',async()=>{
 const s=site();
 await call(s,ET_TEACHER,{action:'passcode',classId:'et',studentId:'dovid',passcode:'676767'});
 assert.equal((await call(s,WT_TEACHER,{action:'list',classId:'wt'})).passcodes.dovid,'676767');
 assert.ok(!JSON.stringify(s.tree.b3Games).includes('676767'));
});

// ---- CSV import ------------------------------------------------------------------
const HEADER='Type,Name,Email,Passcode,Classes';
const csv=rows=>[HEADER,...rows].join('\n');
function payload(text,store,decisions){
 const names=Object.values(store.tree.b3Games.workspaces[W].classes).map(c=>c.name);
 const plan=R.plan(R.parse(text),names);
 assert.deepEqual(plan.errors,[],'file is valid');
 return {batchId:R.batchIdFor(text),classes:plan.classesToCreate.concat(plan.existingClassesInFile),staff:[],students:plan.students.map(s=>({...s,decision:decisions?.[s.name]}))};
}
async function runImport(store,text,decisions){
 const body=payload(text,store,decisions);
 const preview=await call(store,OWNER,{action:'importPreview',...body});
 const result=preview.errors.length?null:await call(store,OWNER,{action:'importApply',...body,planHash:preview.planHash});
 return {preview,result};
}
const ROSTER=['Student,Moshe Fict,,410001,ET; WT','Student,Levi Fict,,410002,ET','Student,Zalman Fict,,410003,WT'];
test('CSV import: each student gets one account, with a separate membership in each class',async()=>{
 const s=site(),{result}=await runImport(s,csv(ROSTER));
 assert.equal(result.counts.studentsCreated,3);
 for(const n of ['Moshe Fict','Levi Fict','Zalman Fict'])assert.equal(named(s,n).length,1,n);
 const moshe=named(s,'Moshe Fict')[0];
 assert.deepEqual(Object.values(moshe.memberships).map(m=>m.classId).sort(),['et','wt']);
 assert.deepEqual(Object.values(named(s,'Levi Fict')[0].memberships).map(m=>m.classId),['et']);
 assert.equal(cls(s,'wt').members[named(s,'Levi Fict')[0].profile.id],undefined,'an ET-only student is not put in WT');
});
test('CSV import: the same file a second and third time creates nothing',async()=>{
 const s=site();await runImport(s,csv(ROSTER));
 const count=Object.keys(students(s)).length,snapshot=JSON.stringify(s.tree.b3Games.students);
 for(let i=0;i<2;i++){
  const {preview,result}=await runImport(s,csv(ROSTER));
  assert.equal(preview.summary.studentsCreate,0);assert.equal(preview.summary.studentsUnchanged,3);
  assert.equal(result.counts.studentsCreated,0);
 }
 assert.equal(Object.keys(students(s)).length,count);
 assert.equal(JSON.stringify(s.tree.b3Games.students),snapshot,'student records are unchanged');
});
test('CSV import: an edited copy of the file (new row, reordered) still creates no duplicates',async()=>{
 const s=site();await runImport(s,csv(ROSTER));
 const edited=csv(['Student,Zalman Fict,,410003,WT','Student,Extra Fict,,410004,ET','Student,Moshe Fict,,410001,ET; WT','Student,Levi Fict,,410002,ET']);
 assert.notEqual(R.batchIdFor(edited),R.batchIdFor(csv(ROSTER)),'this is a different file to the importer');
 const {preview,result}=await runImport(s,edited);
 assert.equal(preview.conflicts.length,0,'known students are recognised without asking again');
 assert.equal(preview.summary.studentsCreate,1);assert.equal(preview.summary.studentsUnchanged,3);
 assert.equal(result.counts.studentsCreated,1);
 for(const n of ['Moshe Fict','Levi Fict','Zalman Fict','Extra Fict'])assert.equal(named(s,n).length,1,n);
});
test('CSV import: a file that adds WT to an ET student adds only that membership',async()=>{
 const s=site();await runImport(s,csv(ROSTER));
 const levi=named(s,'Levi Fict')[0].profile.id;
 const {preview,result}=await runImport(s,csv(['Student,Levi Fict,,410002,ET; WT']));
 assert.equal(preview.conflicts.length,0);assert.equal(result.counts.studentsUpdated,1);
 assert.equal(named(s,'Levi Fict').length,1);
 assert.ok(cls(s,'wt').members[levi]);assert.ok(cls(s,'et').members[levi]);
});
test('CSV import: an existing student with the same name and passcode is reused, work and passcode kept',async()=>{
 const s=site(),{preview,result}=await runImport(s,csv(['Student,Ari Fict,,222222,WT']));
 assert.equal(preview.conflicts.length,0);assert.equal(result.counts.studentsCreated,0);assert.equal(result.counts.studentsUpdated,1);
 assert.equal(named(s,'Ari Fict').length,1);
 assert.ok(cls(s,'wt').members.ari);assert.ok(cls(s,'et').members.ari,'still in ET');
 assert.equal(s.tree.b3Private.passcodes.ari.passcode,'222222');
});
test('CSV import: same name with a different passcode is never matched or created without the owner deciding',async()=>{
 const s=site(),{preview,result}=await runImport(s,csv(['Student,Ari Fict,,555555,WT']));
 assert.equal(preview.conflicts.length,1);assert.equal(result.counts.studentsCreated,0);assert.equal(result.counts.conflictsSkipped,1);
 assert.equal(named(s,'Ari Fict').length,1);assert.equal(cls(s,'wt').members.ari,undefined);
});
test('CSV import: two existing accounts with the same name and passcode are not guessed between',async()=>{
 const s=site();
 students(s).ari2={profile:{id:'ari2',name:'Ari Fict',active:true,createdAt:9},memberships:ship('wt')};cls(s,'wt').members.ari2=member('ari2','Ari Fict');s.tree.b3Private.passcodes.ari2={passcode:'222222'};
 const {preview}=await runImport(s,csv(['Student,Ari Fict,,222222,WT']));
 assert.equal(preview.conflicts.length,1);assert.equal(preview.conflicts[0].allowNew,false);
 assert.equal(named(s,'Ari Fict').length,2,'nothing created, nothing merged');
});

// ---- Duplicate report (read-only) -------------------------------------------------
function withDuplicates(){
 const s=site();
 // The 2026-11-09 mistake: one boy, one passcode, an account per class.
 students(s).dup_a={profile:{id:'dup_a',name:'Mendel Fict',active:true,createdAt:100,importBatchId:'legacy_1'},memberships:ship('et')};
 students(s).dup_b={profile:{id:'dup_b',name:'mendel  fict',active:true,createdAt:101},memberships:ship('wt'),halacha:{done:1}};
 cls(s,'et').members.dup_a=member('dup_a','Mendel Fict');cls(s,'wt').members.dup_b=member('dup_b','mendel  fict');
 s.tree.b3Private.passcodes.dup_a={passcode:'909090'};s.tree.b3Private.passcodes.dup_b={passcode:'909090'};
 // Two different boys who share a name: different passcodes.
 students(s).ari_other={profile:{id:'ari_other',name:'Ari Fict',active:true,createdAt:50},memberships:ship('wt')};
 cls(s,'wt').members.ari_other=member('ari_other','Ari Fict');s.tree.b3Private.passcodes.ari_other={passcode:'818181'};
 // Classes whose names clash, one with the broken character and no students.
 Object.assign(s.tree.b3Games.workspaces[W].classes,{b3_et_morning_716001:{name:'B3 ET · Morning',active:true,members:{ari:member('ari','Ari Fict')}},b3_et_morning:{name:'B3 ET '+BROKEN+' Morning',active:true}});
 // A class list entry whose account is gone.
 cls(s,'et').members.ghost=member('ghost','Ghost Fict');
 return s;
}
test('duplicate report lists same-name accounts with their classes and work, and never a passcode',async()=>{
 const s=withDuplicates(),r=await duplicateReport(s);
 assert.equal(r.readOnly,true);
 assert.equal(r.summary.sameNameGroups,2);assert.equal(r.summary.blockingSignIn,1);
 const mendel=r.studentGroups[0];
 assert.equal(mendel.blocksSignIn,true,'the sign-in-blocking group is listed first');
 assert.deepEqual(mendel.accounts.map(a=>a.studentId),['dup_a','dup_b']);
 assert.deepEqual(mendel.accounts.map(a=>a.classNames),[['ET'],['WT']]);
 assert.deepEqual(mendel.accounts.map(a=>a.passcodeGroup),['A','A']);
 assert.deepEqual(mendel.accounts[1].savedWork,['halacha']);
 const ari=r.studentGroups[1];
 assert.equal(ari.samePasscode,false);assert.equal(ari.blocksSignIn,false);
 assert.notEqual(ari.accounts[0].passcodeGroup,ari.accounts[1].passcodeGroup);
 const text=JSON.stringify(r);
 for(const code of ['909090','818181','222222','111111'])assert.ok(!text.includes(code),'no passcode in the report');
});
test('duplicate report lists clashing class names and class-list entries with no account',async()=>{
 const r=await duplicateReport(withDuplicates());
 assert.equal(r.classGroups.length,1);
 assert.equal(r.classGroups[0].name,'B3 ET · Morning');
 assert.deepEqual(r.classGroups[0].classes.map(c=>[c.classId,c.members,c.brokenName]),[['b3_et_morning_716001',1,false],['b3_et_morning',0,true]]);
 // 'ghost' has no account at all; 'ari' is on a class list that his account does not record.
 assert.deepEqual(r.mismatches.map(m=>[m.classId,m.studentId]),[['et','ghost'],['b3_et_morning_716001','ari']]);
});
test('duplicate report changes nothing, and only the owner can run it',async()=>{
 const s=withDuplicates(),before=JSON.stringify(s.tree);
 const r=await call(s,OWNER,{action:'duplicateReport'});
 assert.equal(r.ok,true);
 assert.equal(s.writes.length,0);assert.equal(JSON.stringify(s.tree),before);
 for(const who of [ET_TEACHER,PRINCIPAL,STRANGER])await assert.rejects(call(s,who,{action:'duplicateReport'}),{code:403});
});
test('a site with no duplicates reports none',async()=>{
 const r=await duplicateReport(site());
 assert.deepEqual([r.studentGroups.length,r.classGroups.length,r.mismatches.length],[0,0,0]);
});
