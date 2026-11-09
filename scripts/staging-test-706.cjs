#!/usr/bin/env node
'use strict';
// Issue #706 staging check. STAGING ONLY: refuses any other database.
//   ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/staging-test-706.cjs
// Uses fictional "T706" students and classes. Runs the import and rollback code
// against the real staging Realtime Database, signs in through the DEPLOYED
// staging sign-in function, checks pre-existing staging students are untouched,
// then removes everything it created.
const assert=require('node:assert/strict');
const R=require('../bulk-roster.js');
const {manageStudents}=require('../backend/functions-staging/student-management-core.cjs');
const DB='https://fun-torah-tools-staging-default-rtdb.firebaseio.com';
const FN='https://us-central1-fun-torah-tools-staging.cloudfunctions.net/';
const token=process.env.ACCESS_TOKEN;
if(!token)throw new Error('ACCESS_TOKEN required');
if(!/fun-torah-tools-staging/.test(DB+FN))throw new Error('staging only');
const url=p=>DB+'/'+p.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'.json?access_token='+encodeURIComponent(token);
const store={
 get:async p=>{const r=await fetch(url(p));if(!r.ok)throw new Error('GET '+p+' '+r.status);return r.json();},
 update:async u=>{const r=await fetch(DB+'/.json?access_token='+encodeURIComponent(token),{method:'PATCH',body:JSON.stringify(u)});if(!r.ok)throw new Error('PATCH '+r.status+' '+await r.text());},
 tx:async(p,f)=>{const v=f(await store.get(p));if(v!==undefined)await store.update({[p]:v});return {committed:v!==undefined};}
};
const OWNER={uid:'staging_test_706_owner',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const call=async(name,body,headers={})=>{const r=await fetch(FN+name,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://fun-torah-tools-staging.web.app',...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>({}))};};
const C='b3Games/workspaces/b3-2026/classes';
const results=[];const step=async(name,fn)=>{try{await fn();results.push(['PASS',name]);console.log('PASS',name);}catch(e){results.push(['FAIL',name,e.message]);console.log('FAIL',name,'-',e.message);}};
const named=async n=>Object.entries(await store.get('b3Games/students')||{}).filter(([,s])=>s?.profile?.name===n);

(async()=>{
 const before=await store.get('b3Games/students')||{};
 const beforeIds=Object.keys(before);
 const csv=['Type,Name,Email,Passcode,Classes',
  'Class,T706 ET Morning,,,','Class,T706 ET Afternoon,,,','Class,T706 WT Morning,,,',
  'Teacher,T706 Rabbi,t706-teacher@example.com,,T706 ET Morning; T706 ET Afternoon',
  'Student,T706 Moshe,,706001,T706 ET Morning; T706 ET Afternoon',
  'Student,T706 Three,,706003,T706 ET Morning; T706 ET Afternoon; T706 WT Morning',
  'Student,T706 Same,,706011,T706 ET Morning','Student,T706 Same,,706012,T706 WT Morning'].join('\n');
 const classNames=Object.values(await store.get(C)||{}).map(c=>c?.name).filter(Boolean);
 const plan=R.plan(R.parse(csv),classNames);
 const body={batchId:R.batchIdFor(csv),label:'staging-test-706',classes:plan.classesToCreate.concat(plan.existingClassesInFile),staff:plan.staff.map(s=>({role:s.role,name:s.name,email:s.email,classes:s.classes})),students:plan.students.map(s=>({key:s.key,name:s.name,passcode:s.passcode,rosterId:'',classes:s.classes}))};
 let batchId=body.batchId;
 await step('deployed function refuses a caller with no Google sign-in',async()=>{const r=await call('funTorahManageStudents',{action:'importPreview',...body});assert.ok(r.status===401||r.status===403,'status '+r.status);});
 await step('import preview: 3 classes, 1 teacher, 4 students, 0 errors',async()=>{const p=await manageStudents(store,OWNER,{action:'importPreview',...body});assert.deepEqual(p.errors,[]);assert.equal(p.summary.classesCreate,3);assert.equal(p.summary.studentsCreate,4);assert.equal(p.summary.staffCreate,1);body.planHash=p.planHash;});
 await step('import apply on the staging database',async()=>{const r=await manageStudents(store,OWNER,{action:'importApply',...body});assert.equal(r.status,'complete');assert.equal(r.counts.studentsCreated,4);});
 await step('T706 Moshe is ONE account in two classes; T706 Three in three',async()=>{const m=await named('T706 Moshe');assert.equal(m.length,1);assert.equal(Object.keys(m[0][1].memberships).length,2);const t=await named('T706 Three');assert.equal(t.length,1);assert.equal(Object.keys(t[0][1].memberships).length,3);});
 await step('two different children named T706 Same stay two accounts',async()=>{assert.equal((await named('T706 Same')).length,2);});
 await step('teacher got both classes',async()=>{const inv=await store.get('b3Games/workspaces/b3-2026/teacherInvites/t706_teacher_example_com');assert.equal(Object.keys(inv.classIds).length,2);});
 await step('deployed sign-in: multi-class student signs in and sees both classes',async()=>{const r=await call('funTorahStudentAuth',{action:'login',name:'T706 Moshe',pin:'706001'});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.classChoices.length,2);assert.ok(r.body.customToken);assert.deepEqual(r.body.classChoices.map(c=>c.name).sort(),['T706 ET Afternoon','T706 ET Morning']);});
 await step('deployed sign-in: switching class gives a token for the other class',async()=>{const a=await call('funTorahStudentAuth',{action:'login',name:'T706 Moshe',pin:'706001'});const other=a.body.classChoices.find(c=>c.id!==a.body.classId).id;const b=await call('funTorahStudentAuth',{action:'login',name:'T706 Moshe',pin:'706001',classId:other});assert.equal(b.status,200);assert.equal(b.body.classId,other);});
 await step('deployed sign-in: a class the student is not in is refused',async()=>{const r=await call('funTorahStudentAuth',{action:'login',name:'T706 Moshe',pin:'706001',classId:'TEST-ALEF'});assert.equal(r.status,403);});
 await step('deployed sign-in: wrong passcode refused',async()=>{const r=await call('funTorahStudentAuth',{action:'login',name:'T706 Moshe',pin:'000000'});assert.equal(r.status,401);});
 await step('re-importing the same file creates nothing',async()=>{const p=await manageStudents(store,OWNER,{action:'importPreview',...body});assert.equal(p.summary.studentsCreate,0);assert.equal(p.summary.studentsUnchanged,4);const r=await manageStudents(store,OWNER,{action:'importApply',...body,planHash:p.planHash});assert.equal(r.counts.studentsCreated,0);assert.equal((await named('T706 Moshe')).length,1);});
 // Reproduce the OLD importer bug: one create per class row.
 const ids=Object.fromEntries(Object.entries(await store.get(C)||{}).filter(([,c])=>/^T706 /.test(c?.name||'')).map(([id,c])=>[c.name,id]));
 const t0=Date.now();
 const legacyOwner={...OWNER,uid:'staging_test_706_legacy'};
 await step('old importer behaviour recreated: same boy, two accounts',async()=>{for(const cls of ['T706 ET Morning','T706 ET Afternoon'])await manageStudents(store,legacyOwner,{action:'create',classId:ids[cls],name:'T706 Dup',passcode:'706099'},t0);assert.equal((await named('T706 Dup')).length,2);});
 await step('deployed sign-in shows the duplicate-account message with the fix',async()=>{const r=await call('funTorahStudentAuth',{action:'login',name:'T706 Dup',pin:'706099'});assert.equal(r.status,409);assert.match(r.body.error,/Bulk Management/);});
 const legacy={legacy:{from:t0-1000,to:t0+60000,createdBy:legacyOwner.uid}};
 await step('undo old-style import: preview finds exactly the 2 duplicates, nothing else',async()=>{const p=await manageStudents(store,OWNER,{action:'rollbackPreview',...legacy});assert.equal(p.summary.newSafe,2);assert.equal(p.summary.uncertain,0);legacy.hash=p.manifestHash;assert.deepEqual(p.classes.map(c=>[c.name,c.leaving,c.membersNow-c.membersAfter]).sort(),[['T706 ET Afternoon',1,1],['T706 ET Morning',1,1]]);assert.ok(p.classes.every(c=>c.newWithImport===false),'classes that already had students are marked');assert.equal(p.summary.totalStudents,beforeIds.length+6);});
 await step('undo old-style import: removes them with a private backup',async()=>{const r=await manageStudents(store,OWNER,{action:'rollbackExecute',...legacy,manifestHash:legacy.hash,backupConfirmed:true,confirmText:'ROLL BACK 2'});assert.equal(r.removed,2);assert.equal((await named('T706 Dup')).length,0);legacy.rb=r.rollbackId;});
 await step('undo of the undo puts them back (then removed again)',async()=>{const u=await manageStudents(store,OWNER,{action:'rollbackUndo',rollbackId:legacy.rb});assert.equal(u.restored,2);assert.equal((await named('T706 Dup')).length,2);
  const ids=(await named('T706 Dup')).map(([id])=>id);const p=await manageStudents(store,OWNER,{action:'bulkPreview',studentIds:ids});const d=await manageStudents(store,OWNER,{action:'bulkDelete',studentIds:ids,previewHash:p.previewHash,backupConfirmed:true,confirmText:'DELETE '+p.deletableCount});assert.equal(d.removed,2);});
 await step('undo new import: 4 new accounts removed',async()=>{const p=await manageStudents(store,OWNER,{action:'rollbackPreview',batchId});assert.equal(p.summary.newSafe,4);assert.equal(p.classes.length,3);assert.ok(p.classes.every(c=>c.newWithImport===true&&c.membersAfter===0),'the three classes this import made end up empty, and are listed');const r=await manageStudents(store,OWNER,{action:'rollbackExecute',batchId,manifestHash:p.manifestHash,backupConfirmed:true,confirmText:'ROLL BACK 4'});assert.equal(r.removed,4);});
 await step('every pre-existing staging student is byte-for-byte unchanged',async()=>{const after=await store.get('b3Games/students')||{};assert.deepEqual(Object.keys(after).sort(),beforeIds.sort());for(const id of beforeIds)assert.deepEqual(after[id],before[id],id);});
 await step('classes and teacher records were not deleted by the undo',async()=>{for(const id of Object.values(ids))assert.ok(await store.get(C+'/'+id));assert.ok(await store.get('b3Games/workspaces/b3-2026/teacherInvites/t706_teacher_example_com'));});
 // Clean up the fictional test classes and teacher (test data only).
 const cleanup={'b3Games/workspaces/b3-2026/teacherInvites/t706_teacher_example_com':null};
 for(const id of Object.values(ids))cleanup[C+'/'+id]=null;
 await store.update(cleanup);
 console.log(JSON.stringify({pass:results.filter(r=>r[0]==='PASS').length,fail:results.filter(r=>r[0]==='FAIL').length}));
 process.exit(results.some(r=>r[0]==='FAIL')?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
