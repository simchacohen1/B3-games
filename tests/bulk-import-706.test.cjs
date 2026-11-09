'use strict';
// Issue #706: one student account across many classes, safe re-imports, and
// rollback that never touches accounts that existed before an import.
// Fictional students and an in-memory database only.
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const DIR=process.env.STUDENT_FUNCTIONS_DIR||path.join(__dirname,'..','backend','functions');
const {manageStudents}=require(path.join(DIR,'student-management-core.cjs'));
const {studentAuth}=require(path.join(DIR,'student-auth-core.cjs'));
const R=require('../bulk-roster.js');

const OWNER={uid:'owner_uid',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const TEACHER={uid:'teacher_uid',email:'teacher@test.example',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const C='b3Games/workspaces/b3-2026/classes';

function db(tree,{failAfter=Infinity}={}){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:structuredClone(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??={};if(v===null||v===undefined)delete o[last];else o[last]=structuredClone(v)};
 let updates=0;
 return {tree,get,
  // Multi-path updates are atomic, as in the Realtime Database.
  update:async u=>{if(++updates>failAfter)throw new Error('connection lost');for(const [p,v] of Object.entries(u))set(p,v)},
  tx:async(p,f)=>{const v=f(await get(p));if(v!==undefined)set(p,v);return {committed:v!==undefined}},
  setFailAfter:n=>{failAfter=n;updates=0;}};
}
function site(){
 return db({b3Games:{
  students:{
   // Existed before any import, with real work and an ET membership.
   old_reuven:{profile:{id:'old_reuven',name:'Reuven Alpha',active:true,createdAt:1},memberships:{'b3-2026_et':{workspaceId:'b3-2026',classId:'et',active:true}},halacha:{done:3}},
   old_shimon:{profile:{id:'old_shimon',name:'Shimon Beta',active:true,rosterId:'R-100'},memberships:{'b3-2026_wt':{workspaceId:'b3-2026',classId:'wt',active:true}}}
  },
  workspaces:{'b3-2026':{
   classes:{
    et:{name:'ET',active:true,members:{old_reuven:{studentId:'old_reuven',name:'Reuven Alpha',active:true}}},
    wt:{name:'WT',active:true,members:{old_shimon:{studentId:'old_shimon',name:'Shimon Beta',active:true}}},
    b2_et_morning:{name:'B2 ET · Morning',active:true},
    b2_et_afternoon:{name:'B2 ET · Afternoon',active:true},
    b2_wt_morning:{name:'B2 WT · Morning',active:true}
   },
   teacherInvites:{existing_example_com:{email:'existing@example.com',name:'Rabbi Existing',role:'teacher',active:true,classIds:{et:true},claimedUid:'existing_uid'}},
   teachers:{existing_uid:{email:'existing@example.com',active:true,classIds:{et:true}},teacher_uid:{active:true,classIds:{et:true}}}
  }}},
  b3Private:{passcodes:{old_reuven:{passcode:'111111'},old_shimon:{passcode:'222222'}}},
  studentRewards:{students:{b3_x:{b3StudentId:'old_reuven',rewardBalance:5}}}
 });
}
const csv=rows=>['Type,Name,Email,Passcode,Classes,Student ID',...rows].join('\n');
function payload(text,store,decisions={}){
 const classNames=Object.values(store.tree.b3Games.workspaces['b3-2026'].classes).map(c=>c.name);
 const plan=R.plan(R.parse(text),classNames);
 return {plan,body:{batchId:R.batchIdFor(text),label:'test',classes:plan.classesToCreate.concat(plan.existingClassesInFile),
  staff:plan.staff.map(s=>({role:s.role,name:s.name,email:s.email,classes:s.classes})),
  students:plan.students.map(s=>({key:s.key,name:s.name,passcode:s.passcode,rosterId:s.rosterId,classes:s.classes,decision:decisions[s.name]||null}))}};
}
async function runImport(store,text,decisions){
 const {plan,body}=payload(text,store,decisions);
 assert.deepEqual(plan.errors,[],'client validation');
 const preview=await manageStudents(store,OWNER,{action:'importPreview',...body});
 const result=preview.errors.length?null:await manageStudents(store,OWNER,{action:'importApply',...body,planHash:preview.planHash});
 return {preview,result,body};
}
const students=store=>store.tree.b3Games.students;
const byName=(store,name)=>Object.entries(students(store)).filter(([,s])=>s.profile?.name===name);
const classesOf=(store,id)=>Object.values(students(store)[id].memberships).filter(m=>m.active!==false).map(m=>m.classId).sort();
const login=(store,name,pin)=>studentAuth(store,{action:'login',name,pin},'10.0.0.1',Date.now());

// ---- CSV format --------------------------------------------------------------
test('template: one row per person, Classes column with several classes, classes first, students last',()=>{
 const p=R.parse(R.TEMPLATE_ROWS.join('\n'));
 assert.equal(p.legacyFormat,false);
 assert.deepEqual(p.rows.map(r=>r.type),['class','class','teacher','principal','student','student']);
 const plan=R.plan(p,[]);
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.students.length,2);
 assert.deepEqual(plan.students[0].classes,['B2 ET Morning','B2 ET Afternoon']);
});
test('legacy "class" header still accepted; same name+passcode rows become ONE student',()=>{
 const p=R.parse('type,name,email,passcode,class\nstudent,Moshe Test,,482731,B2 ET Morning\nstudent,Moshe Test,,482731,B2 ET Afternoon');
 assert.equal(p.legacyFormat,true);
 const plan=R.plan(p,['B2 ET · Morning','B2 ET · Afternoon']);
 assert.deepEqual(plan.errors,[]);
 assert.equal(plan.students.length,1);
 assert.equal(plan.students[0].classes.length,2);
});
test('validation: 6-digit passcodes, unknown classes, bad emails, ambiguous classes',()=>{
 const plan=R.plan(R.parse(csv(['Student,A Kid,,12345,ET','Student,B Kid,,123456,Nowhere','Teacher,T,not-an-email,,ET','Student,C Kid,,654321,'])),['ET']);
 assert.equal(plan.errors.length,4,plan.errors.join('\n'));
 const amb=R.plan(R.parse(csv(['Student,D Kid,,123456,B2 ET Morning'])),['B2 ET · Morning','B2 ET � Morning']);
 assert.match(amb.errors.join(' '),/more than one class/);
});
test('two unrelated children with the same name but different passcodes stay separate (warned)',()=>{
 const plan=R.plan(R.parse(csv(['Student,Twin Name,,111222,ET','Student,Twin Name,,333444,WT'])),['ET','WT']);
 assert.deepEqual(plan.errors,[]);assert.equal(plan.students.length,2);assert.match(plan.warnings.join(' '),/different students/);
});
test('same Student ID used for two different children is an error',()=>{
 const plan=R.plan(R.parse(csv(['Student,Kid One,,111222,ET,X1','Student,Kid Two,,333444,ET,X1'])),['ET']);
 assert.match(plan.errors.join(' '),/used for two different students/);
});

// ---- Import on the server -----------------------------------------------------
test('1-3: students in one, two and five classes each get exactly ONE account',async()=>{
 const store=site();
 const text=csv(['Class,B2 WT Afternoon,,,','Class,Extra One,,,','Class,Extra Two,,,',
  'Student,One Class,,100001,ET','Student,Two Class,,100002,B2 ET Morning; B2 ET Afternoon',
  'Student,Five Class,,100005,B2 ET Morning; B2 ET Afternoon; B2 WT Morning; B2 WT Afternoon; Extra One']);
 const {result}=await runImport(store,text);
 assert.equal(result.status,'complete');
 for(const [name,n] of [['One Class',1],['Two Class',2],['Five Class',5]]){
  const hits=byName(store,name);assert.equal(hits.length,1,name);
  assert.equal(classesOf(store,hits[0][0]).length,n,name);
  for(const cid of classesOf(store,hits[0][0]))assert.ok(store.tree.b3Games.workspaces['b3-2026'].classes[cid].members[hits[0][0]],'member row '+cid);
 }
 assert.equal(store.tree.b3Private.passcodes[byName(store,'Two Class')[0][0]].passcode,'100002');
});
test('4: teacher in several classes gets all of them; existing teacher only gains classes',async()=>{
 const store=site();
 await runImport(store,csv(['Teacher,Rabbi New,new@example.com,,B2 ET Morning; B2 ET Afternoon','Teacher,Rabbi Existing,existing@example.com,,B2 WT Morning']));
 const ws=store.tree.b3Games.workspaces['b3-2026'];
 assert.deepEqual(Object.keys(ws.teacherInvites.new_example_com.classIds).sort(),['b2_et_afternoon','b2_et_morning']);
 assert.deepEqual(Object.keys(ws.teacherInvites.existing_example_com.classIds).sort(),['b2_wt_morning','et']);
 assert.equal(ws.teachers.existing_uid.classIds.b2_wt_morning,true);
 assert.equal(ws.classes.b2_wt_morning.teacherIds.existing_uid,true);
});
test('5,7: two unrelated students with identical names (different passcodes) are two accounts',async()=>{
 const store=site();
 await runImport(store,csv(['Student,Same Name,,555111,B2 ET Morning','Student,Same Name,,555222,B2 ET Afternoon']));
 const hits=byName(store,'Same Name');assert.equal(hits.length,2);assert.notEqual(hits[0][0],hits[1][0]);
});
test('6: repeated rows for the same verified student (Student ID) combine into one account',async()=>{
 const store=site();
 await runImport(store,csv(['Student,Rowed Kid,,777001,B2 ET Morning,K-7','Student,Rowed Kid,,777001,B2 ET Afternoon,K-7']));
 const hits=byName(store,'Rowed Kid');assert.equal(hits.length,1);assert.equal(classesOf(store,hits[0][0]).length,2);
 assert.equal(hits[0][1].profile.rosterId,'K-7');
});
test('8: re-importing the same CSV creates nothing new (idempotent)',async()=>{
 const store=site(),text=csv(['Student,Again Kid,,808080,B2 ET Morning; B2 ET Afternoon']);
 await runImport(store,text);
 const before=JSON.stringify(students(store));
 const {preview,result}=await runImport(store,text);
 assert.equal(preview.summary.studentsCreate,0);assert.equal(preview.summary.studentsUnchanged,1);
 assert.equal(result.counts.studentsCreated,0);
 assert.equal(JSON.stringify(students(store)),before);
});
test('9: an import interrupted half way leaves no half-made student and resumes without duplicates',async()=>{
 const store=site(),text=csv(['Student,Kid A,,900001,B2 ET Morning; B2 ET Afternoon','Student,Kid B,,900002,B2 ET Morning','Student,Kid C,,900003,B2 ET Afternoon']);
 const {body}=payload(text,store);
 const preview=await manageStudents(store,OWNER,{action:'importPreview',...body});
 store.setFailAfter(2); // header + Kid A, then the connection drops
 const r1=await manageStudents(store,OWNER,{action:'importApply',...body,planHash:preview.planHash}).catch(e=>({thrown:e.message}));
 store.setFailAfter(Infinity);
 assert.ok(r1.thrown||r1.status==='partial');
 for(const s of Object.values(students(store)))if(s.profile?.importBatchId)assert.ok(s.memberships&&Object.keys(s.memberships).length,'no account without its classes');
 const again=await manageStudents(store,OWNER,{action:'importPreview',...body});
 assert.equal(again.summary.studentsUnchanged,1,'Kid A is recognised as already imported');
 await manageStudents(store,OWNER,{action:'importApply',...body,planHash:again.planHash});
 for(const n of ['Kid A','Kid B','Kid C'])assert.equal(byName(store,n).length,1,n);
});
test('10: unknown class names are refused on the server even if the browser skipped validation',async()=>{
 const store=site();
 const body={batchId:'imp_0123456789abcdef',classes:[],staff:[],students:[{key:'np:x',name:'Lost Kid',passcode:'123456',classes:['No Such Class']}]};
 const p=await manageStudents(store,OWNER,{action:'importPreview',...body});
 assert.match(p.errors.join(' '),/does not exist/);
 await assert.rejects(manageStudents(store,OWNER,{action:'importApply',...body,planHash:p.planHash}),/Fix the problems/);
});
test('12, 20: a new row matching an existing account stops for review; owner decides',async()=>{
 const store=site(),text=csv(['Student,Reuven Alpha,,111111,B2 ET Morning']);
 const {preview}=await runImport(store,text);
 assert.equal(preview.conflicts.length,1);assert.deepEqual(preview.conflicts[0].samePasscode,['old_reuven']);
 assert.equal(preview.conflicts[0].allowNew,false,'cannot create a second account with the same name and passcode');
 assert.equal(byName(store,'Reuven Alpha').length,1);
 const {result}=await runImport(store,text,{'Reuven Alpha':{type:'same',studentId:'old_reuven'}});
 assert.equal(result.counts.studentsUpdated,1);
 assert.deepEqual(classesOf(store,'old_reuven'),['b2_et_morning','et']);
 assert.equal(students(store).old_reuven.halacha.done,3,'existing work kept');
 assert.equal(store.tree.b3Private.passcodes.old_reuven.passcode,'111111','existing passcode never overwritten');
});
test('existing student matched by Student ID gets the new classes, never a second account',async()=>{
 const store=site();
 const {result}=await runImport(store,csv(['Student,Shimon Beta,,999999,B2 WT Morning,R-100']));
 assert.equal(result.counts.studentsUpdated,1);assert.equal(byName(store,'Shimon Beta').length,1);
 assert.equal(store.tree.b3Private.passcodes.old_shimon.passcode,'222222');
});
test('15: only the owner or an administrator may import or roll back',async()=>{
 const store=site();
 for(const action of ['importPreview','importApply','rollbackPreview','rollbackExecute','bulkDelete','studentsOverview','auditLog'])
  await assert.rejects(manageStudents(store,TEACHER,{action,batchId:'imp_0123456789abcdef'}),/Owner or administrator/);
});

// ---- Sign-in -----------------------------------------------------------------
test('11, 13: multi-class student signs in once; wrong passcode refused; only own classes',async()=>{
 const store=site();
 await runImport(store,csv(['Student,Login Kid,,424242,B2 ET Morning; B2 ET Afternoon']));
 const r=await login(store,'Login Kid','424242');
 assert.equal(r.ok,true);
 assert.deepEqual(classesOf(store,r.id),['b2_et_afternoon','b2_et_morning']);
 await assert.rejects(login(store,'Login Kid','000000'),{code:401});
});
test('the bug: old importer data (two accounts, same name+passcode) blocks sign-in; one account fixes it',async()=>{
 const store=site();
 store.tree.b3Games.students.dup1={profile:{name:'Dup Kid',active:true},memberships:{a:{workspaceId:'b3-2026',classId:'b2_et_morning',active:true}}};
 store.tree.b3Games.students.dup2={profile:{name:'Dup Kid',active:true},memberships:{a:{workspaceId:'b3-2026',classId:'b2_et_afternoon',active:true}}};
 store.tree.b3Private.passcodes.dup1={passcode:'313131'};store.tree.b3Private.passcodes.dup2={passcode:'313131'};
 await assert.rejects(login(store,'Dup Kid','313131'),{code:409});
});

// ---- Rollback -----------------------------------------------------------------
async function legacyImport(store,rows,at){
 // Reproduces the OLD importer: one 'create' per class row.
 for(const [name,pin,cid] of rows)await manageStudents(store,OWNER,{action:'create',classId:cid,name,passcode:pin},at);
}
const legacySource=at=>({legacy:{from:at-1000,to:at+60000,createdBy:OWNER.uid}});
test('18, 22: rollback removes only accounts proven to be created by the import; pre-existing never touched',async()=>{
 const store=site(),at=Date.parse('2026-11-09T02:18:37Z');
 await legacyImport(store,[['Moshe Fict','482731','b2_et_morning'],['Moshe Fict','482731','b2_et_afternoon'],['Reuven Alpha','111111','b2_et_morning']],at);
 assert.equal(byName(store,'Moshe Fict').length,2);
 const preview=await manageStudents(store,OWNER,{action:'rollbackPreview',...legacySource(at)});
 assert.equal(preview.summary.newSafe,3);assert.equal(preview.summary.uncertain,0);
 assert.ok(!preview.records.some(r=>r.studentId.startsWith('old_')));
 const backup=JSON.stringify(store.tree.b3Games.students.old_reuven);
 await assert.rejects(manageStudents(store,OWNER,{action:'rollbackExecute',...legacySource(at),manifestHash:preview.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 2'}),/Type ROLL BACK 3/);
 const r=await manageStudents(store,OWNER,{action:'rollbackExecute',...legacySource(at),manifestHash:preview.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 3'});
 assert.equal(r.removed,3);
 assert.equal(byName(store,'Moshe Fict').length,0);
 assert.equal(JSON.stringify(store.tree.b3Games.students.old_reuven),backup,'pre-existing account identical');
 assert.equal(store.tree.b3Private.passcodes.old_reuven.passcode,'111111');
 assert.ok(store.tree.b3Games.workspaces['b3-2026'].classes.b2_et_morning,'classes are never deleted');
 assert.equal(Object.keys(store.tree.b3Games.workspaces['b3-2026'].classes.b2_et_morning.members||{}).length,0);
 assert.equal(Object.keys(store.tree.b3Private.importRollbacks[r.rollbackId].backup).length,3,'every removed account is backed up');
});
test('import-created account that already has student work is flagged, never removed',async()=>{
 const store=site(),at=Date.parse('2026-11-09T17:49:11Z');
 await legacyImport(store,[['Active Kid','565656','b2_et_morning'],['Quiet Kid','575757','b2_et_morning']],at);
 const [id]=byName(store,'Active Kid')[0];
 store.tree.posukPractice={students:{[id]:{lastActive:at+5000}}};
 const preview=await manageStudents(store,OWNER,{action:'rollbackPreview',...legacySource(at)});
 assert.equal(preview.records.find(r=>r.studentId===id).status,'NEW_HAS_DATA');
 await manageStudents(store,OWNER,{action:'rollbackExecute',...legacySource(at),manifestHash:preview.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 1'});
 assert.ok(students(store)[id],'kept');assert.equal(byName(store,'Quiet Kid').length,0);
});
test('rollback refuses to run if anything changed after the preview',async()=>{
 const store=site(),at=Date.parse('2026-11-09T02:18:37Z');
 await legacyImport(store,[['Change Kid','121212','b2_et_morning']],at);
 const preview=await manageStudents(store,OWNER,{action:'rollbackPreview',...legacySource(at)});
 const [id]=byName(store,'Change Kid')[0];
 store.tree.b3Games.students[id].halacha={started:true};
 await assert.rejects(manageStudents(store,OWNER,{action:'rollbackExecute',...legacySource(at),manifestHash:preview.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 1'}),/changed since the preview/);
 assert.ok(students(store)[id]);
});
test('21: rollback retry after a partial failure finishes without touching anything else',async()=>{
 const store=site(),at=Date.parse('2026-11-09T02:18:37Z');
 await legacyImport(store,[['Retry A','131313','b2_et_morning'],['Retry B','141414','b2_et_morning'],['Retry C','151515','b2_et_afternoon']],at);
 const preview=await manageStudents(store,OWNER,{action:'rollbackPreview',...legacySource(at)});
 store.setFailAfter(2); // header + first account
 const r1=await manageStudents(store,OWNER,{action:'rollbackExecute',...legacySource(at),manifestHash:preview.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 3'}).catch(e=>({thrown:e.message}));
 store.setFailAfter(Infinity);
 assert.ok(r1.thrown||r1.status==='partial');
 const again=await manageStudents(store,OWNER,{action:'rollbackPreview',...legacySource(at)});
 assert.equal(again.manifestHash,preview.manifestHash,'same approved list');
 assert.equal(again.summary.alreadyRemoved,1);
 const r2=await manageStudents(store,OWNER,{action:'rollbackExecute',...legacySource(at),manifestHash:again.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 2'});
 assert.equal(r2.removed,2);
 assert.deepEqual(Object.keys(students(store)).sort(),['old_reuven','old_shimon']);
});
test('19: rolling back a new-style import restores modified existing accounts exactly',async()=>{
 const store=site();
 const before=JSON.stringify({s:students(store).old_reuven,c:store.tree.b3Games.workspaces['b3-2026'].classes.et});
 const {result,body}=await runImport(store,csv(['Student,Reuven Alpha,,111111,B2 ET Morning; B2 ET Afternoon','Student,Brand New,,616161,B2 ET Morning']),{'Reuven Alpha':{type:'same',studentId:'old_reuven'}});
 assert.equal(result.counts.studentsUpdated,1);assert.equal(result.counts.studentsCreated,1);
 const preview=await manageStudents(store,OWNER,{action:'rollbackPreview',batchId:body.batchId});
 assert.equal(preview.summary.existingModified,1);assert.equal(preview.summary.newSafe,1);
 await manageStudents(store,OWNER,{action:'rollbackExecute',batchId:body.batchId,manifestHash:preview.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 2'});
 assert.deepEqual(classesOf(store,'old_reuven'),['et']);
 const ws=store.tree.b3Games.workspaces['b3-2026'];
 assert.equal(ws.classes.b2_et_morning.members?.old_reuven,undefined);
 assert.equal(students(store).old_reuven.halacha.done,3);
 assert.equal(byName(store,'Brand New').length,0);
 assert.equal(JSON.stringify({s:{...students(store).old_reuven,memberships:Object.fromEntries(Object.entries(students(store).old_reuven.memberships).filter(([,v])=>v))},c:ws.classes.et}),before);
});
test('undo puts removed accounts back from the private backup, passcode included',async()=>{
 const store=site(),at=Date.parse('2026-11-09T02:18:37Z');
 await legacyImport(store,[['Undo Kid','171717','b2_et_morning']],at);
 const [id]=byName(store,'Undo Kid')[0];
 const preview=await manageStudents(store,OWNER,{action:'rollbackPreview',...legacySource(at)});
 const r=await manageStudents(store,OWNER,{action:'rollbackExecute',...legacySource(at),manifestHash:preview.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 1'});
 const u=await manageStudents(store,OWNER,{action:'rollbackUndo',rollbackId:r.rollbackId});
 assert.equal(u.restored,1);assert.ok(students(store)[id].profile);
 assert.equal(store.tree.b3Private.passcodes[id].passcode,'171717');
 assert.ok(store.tree.b3Games.workspaces['b3-2026'].classes.b2_et_morning.members[id]);
});

// ---- Bulk management -----------------------------------------------------------
test('bulk delete refuses accounts with work, needs exact confirmation, and logs',async()=>{
 const store=site(),at=Date.parse('2026-11-09T02:18:37Z');
 await legacyImport(store,[['Bulk Kid','181818','b2_et_morning']],at);
 const [id]=byName(store,'Bulk Kid')[0];
 const p=await manageStudents(store,OWNER,{action:'bulkPreview',studentIds:[id,'old_reuven']});
 assert.equal(p.deletableCount,1);
 assert.equal(p.records.find(r=>r.studentId==='old_reuven').deletable,false);
 await assert.rejects(manageStudents(store,OWNER,{action:'bulkDelete',studentIds:[id,'old_reuven'],previewHash:p.previewHash,backupConfirmed:true,confirmText:'DELETE 2'}),/DELETE 1/);
 const r=await manageStudents(store,OWNER,{action:'bulkDelete',studentIds:[id,'old_reuven'],previewHash:p.previewHash,backupConfirmed:true,confirmText:'DELETE 1'});
 assert.equal(r.removed,1);assert.ok(students(store).old_reuven);assert.equal(students(store)[id],undefined);
 const log=await manageStudents(store,OWNER,{action:'auditLog'});
 assert.equal(log.entries[0].action,'bulkDelete');
 const ov=await manageStudents(store,OWNER,{action:'studentsOverview'});
 assert.ok(ov.rollbacks.some(x=>x.id===r.rollbackId));
});
test('export backup never contains passcodes',async()=>{
 const store=site();store.tree.b3Games.students.old_reuven.profile.passcode='111111';
 const r=await manageStudents(store,OWNER,{action:'exportBackup',studentIds:['old_reuven']});
 assert.equal(JSON.stringify(r).includes('111111'),false);
 assert.equal(r.records.old_reuven.student.halacha.done,3);
});
test('overview groups an untracked import run by its audit entries, not by names',async()=>{
 const store=site(),at=Date.parse('2026-11-09T17:49:11Z');
 await legacyImport(store,Array.from({length:12},(_,i)=>['Run Kid '+i,String(300000+i),i%2?'b2_et_morning':'b2_et_afternoon']).map((r,i)=>r),at);
 const ov=await manageStudents(store,OWNER,{action:'studentsOverview'});
 const run=ov.batches.find(b=>b.kind==='legacy');
 assert.equal(run.count,12);
 assert.equal(ov.students.filter(s=>s.importBatchId===run.id).length,12);
 assert.equal(ov.students.find(s=>s.studentId==='old_reuven').importBatchId,null);
});
