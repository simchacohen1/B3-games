#!/usr/bin/env node
'use strict';
// Issue #51 staging check (Student Management & Class Membership).
// STAGING ONLY: refuses any other project.
//
//   ACCESS_TOKEN=$(gcloud auth print-access-token) \
//   FTT_STAGING_CREDENTIALS_FILE=<path to staging/test-credentials.local.json> \
//   node scripts/staging-test-51.cjs
//
// Signs in as the FICTIONAL staging owner, principal and teachers and calls the
// DEPLOYED staging funTorahManageStudents function exactly as the pages do.
// It makes fictional "T51" classes and students, checks that every student who
// was on staging before is unchanged, and then removes only what it created.
// No credential or passcode is printed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const R=require('../bulk-roster.js');
const PROJECT='fun-torah-tools-staging';
const SITE='https://'+PROJECT+'.web.app';
const DB='https://'+PROJECT+'-default-rtdb.firebaseio.com';
const FN='https://us-central1-'+PROJECT+'.cloudfunctions.net/funTorahManageStudents';
const token=process.env.ACCESS_TOKEN,credFile=process.env.FTT_STAGING_CREDENTIALS_FILE;
if(!token)throw new Error('ACCESS_TOKEN required');
if(!credFile||!fs.existsSync(credFile))throw new Error('FTT_STAGING_CREDENTIALS_FILE required');
if(![SITE,DB,FN].every(u=>u.includes('fun-torah-tools-staging'))||/b3-games/.test(SITE+DB+FN))throw new Error('staging only');
const creds=JSON.parse(fs.readFileSync(credFile,'utf8'));
if(creds.website!==SITE)throw new Error('credentials file is not for the staging site');

const W='b3-2026',C='b3Games/workspaces/'+W+'/classes';
const dbUrl=p=>DB+'/'+p.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'.json?access_token='+encodeURIComponent(token);
// Administrator reads, used only to CHECK results and to remove this run's own test records.
const read=async p=>{const r=await fetch(dbUrl(p));if(!r.ok)throw new Error('GET '+p+' '+r.status);return r.json();};
const patch=async u=>{const r=await fetch(DB+'/.json?access_token='+encodeURIComponent(token),{method:'PATCH',body:JSON.stringify(u)});if(!r.ok)throw new Error('PATCH '+r.status+' '+await r.text());};

let apiKey='';
async function signIn(role,classId){
 const account=creds.adultAccounts.find(a=>a.role===role&&(classId===undefined||a.classId===classId));
 if(!account||!/@funtorahtools-staging\.test$/.test(account.email))throw new Error('no fictional '+role+' account');
 const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+apiKey,{method:'POST',headers:{'Content-Type':'application/json',Referer:SITE+'/'},body:JSON.stringify({email:account.email,password:account.password,returnSecureToken:true})});
 const body=await r.json();if(!r.ok)throw new Error('sign-in as fictional '+role+' failed: '+(body.error?.message||r.status));
 return {role,email:account.email,uid:body.localId,idToken:body.idToken};
}
const call=async(who,body)=>{
 const started=Date.now();
 const r=await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json',Origin:SITE,...(who?{Authorization:'Bearer '+who.idToken}:{})},body:JSON.stringify(body)});
 return {status:r.status,ms:Date.now()-started,body:await r.json().catch(()=>({}))};
};
const ok=async(who,body)=>{const r=await call(who,body);assert.equal(r.status,200,(body.action||'')+' -> '+r.status+' '+(r.body.error||''));return r.body;};
const results=[];
const step=async(name,fn)=>{try{await fn();results.push(['PASS',name]);console.log('PASS',name);}catch(e){results.push(['FAIL',name,e.message]);console.log('FAIL',name,'-',e.message);}};

(async()=>{
 const config=await (await fetch(SITE+'/staging/firebase-config.generated.js')).text();
 apiKey=(config.match(/apiKey["']?\s*:\s*["']([A-Za-z0-9_-]{20,})["']/)||[])[1]||'';
 if(!apiKey||!config.includes(PROJECT))throw new Error('could not read the staging web configuration');
 const owner=await signIn('owner'),principal=await signIn('principal');
 const alef=await signIn('teacher','TEST-ALEF'),beis=await signIn('teacher','TEST-BEIS');

 const before=await read('b3Games/students')||{},beforeIds=Object.keys(before);
 const beforeClasses=await read(C)||{};
 if(beforeIds.some(id=>/^T51 /.test(before[id]?.profile?.name||''))||Object.values(beforeClasses).some(c=>/^T51 /.test(c?.name||'')))throw new Error('T51 test records already exist on staging; remove them first');
 const created=new Set(),batchIds=new Set();
 const t51=async()=>Object.entries(await read('b3Games/students')||{}).filter(([,s])=>/^T51 /.test(s?.profile?.name||''));
 const named=async n=>(await t51()).filter(([,s])=>s.profile.name===n);
 const HEADER='Type,Name,Email,Passcode,Classes';
 const ROSTER=[HEADER,'Class,T51 ET,,,','Class,T51 WT,,,','Student,T51 Both,,510001,T51 ET; T51 WT','Student,T51 EtOnly,,510002,T51 ET','Student,T51 WtOnly,,510003,T51 WT'].join('\n');
 const importBody=async text=>{
  const names=Object.values(await read(C)||{}).map(c=>c?.name).filter(Boolean),plan=R.plan(R.parse(text),names);
  assert.deepEqual(plan.errors,[],'file is valid');
  const body={batchId:R.batchIdFor(text),label:'staging-test-51',classes:plan.classesToCreate.concat(plan.existingClassesInFile),staff:[],students:plan.students.map(s=>({key:s.key,name:s.name,passcode:s.passcode,rosterId:s.rosterId||'',classes:s.classes}))};
  batchIds.add(body.batchId);return body;
 };
 const runImport=async text=>{const body=await importBody(text),preview=await ok(owner,{action:'importPreview',...body});const result=await ok(owner,{action:'importApply',...body,planHash:preview.planHash});(result.students||[]).filter(s=>s.status==='create').forEach(s=>created.add(s.studentId));return {preview,result};};
 let et='',wt='',both='',etOnly='',wtOnly='';

 try{
  // ---- 1 & 2: CSV import, then the same CSV again -----------------------------
  await step('1. import a CSV as the fictional owner: 2 classes, 3 students, one account each',async()=>{
   const {preview,result}=await runImport(ROSTER);
   assert.equal(preview.summary.studentsCreate,3);assert.equal(preview.conflicts.length,0);assert.equal(result.counts.studentsCreated,3);
   for(const n of ['T51 Both','T51 EtOnly','T51 WtOnly'])assert.equal((await named(n)).length,1,n);
   const classes=await read(C);
   et=Object.keys(classes).find(id=>classes[id]?.name==='T51 ET');wt=Object.keys(classes).find(id=>classes[id]?.name==='T51 WT');assert.ok(et&&wt&&et!==wt);
   both=(await named('T51 Both'))[0][0];etOnly=(await named('T51 EtOnly'))[0][0];wtOnly=(await named('T51 WtOnly'))[0][0];
  });
  await step('2. import the same CSV a second and third time: nothing new, records unchanged',async()=>{
   const snapshot=JSON.stringify(await t51());
   for(let i=0;i<2;i++){const {preview,result}=await runImport(ROSTER);assert.equal(preview.summary.studentsCreate,0);assert.equal(preview.summary.studentsUnchanged,3);assert.equal(result.counts.studentsCreated,0);}
   assert.equal((await t51()).length,3);assert.equal(JSON.stringify(await t51()),snapshot);
  });
  await step('2b. import an edited copy (reordered, one new boy): known boys recognised, only the new one created',async()=>{
   const edited=[HEADER,'Student,T51 WtOnly,,510003,T51 WT','Student,T51 Extra,,510004,T51 ET','Student,T51 Both,,510001,T51 ET; T51 WT','Student,T51 EtOnly,,510002,T51 ET'].join('\n');
   const {preview,result}=await runImport(edited);
   assert.equal(preview.conflicts.length,0);assert.equal(preview.summary.studentsCreate,1);assert.equal(result.counts.studentsCreated,1);
   assert.equal((await t51()).length,4);for(const n of ['T51 Both','T51 EtOnly','T51 WtOnly','T51 Extra'])assert.equal((await named(n)).length,1,n);
  });
  await step('2c. same name with a different passcode is not matched or created without a decision',async()=>{
   const body=await importBody([HEADER,'Student,T51 EtOnly,,519999,T51 WT'].join('\n'));
   const p=await ok(owner,{action:'importPreview',...body});assert.equal(p.conflicts.length,1);
   const r=await ok(owner,{action:'importApply',...body,planHash:p.planHash});assert.equal(r.counts.studentsCreated,0);assert.equal(r.counts.conflictsSkipped,1);
   assert.equal((await named('T51 EtOnly')).length,1);assert.equal((await read(C+'/'+wt+'/members/'+etOnly)),null);
  });

  // ---- 3 & 4: lists as teacher and as principal / owner ------------------------
  await step('3. teacher list loads without error and shows only his own class',async()=>{
   const members=Object.keys((await read(C+'/TEST-ALEF/members'))||{});
   const r=await call(alef,{action:'list',classId:'TEST-ALEF'});
   assert.equal(r.status,200,r.body.error);assert.deepEqual(Object.keys(r.body.passcodes).sort(),members.sort());
   assert.ok(r.ms<15000,'answered in '+r.ms+' ms');
   for(const classId of ['TEST-BEIS',et,wt,'CUSTOM-PRINCIPAL'])assert.equal((await call(alef,{action:'list',classId})).status,403,'refused for '+classId);
   assert.equal((await call(alef,{action:'list',all:true})).status,400,'no whole-school list for a teacher');
   assert.equal((await call(beis,{action:'list',classId:'TEST-ALEF'})).status,403);
  });
  await step('4. principal list loads for the classes he is assigned, and the owner for every class',async()=>{
   const mine=Object.keys((await read('b3Games/workspaces/'+W+'/teachers/'+principal.uid+'/classIds'))||{});
   assert.ok(mine.length,'principal has at least one class');
   for(const classId of mine){const r=await call(principal,{action:'list',classId});assert.equal(r.status,200,classId+' '+r.body.error);}
   const classes=await read(C);
   for(const classId of Object.keys(classes).filter(id=>!mine.includes(id)))assert.equal((await call(principal,{action:'list',classId})).status,403,'principal refused for '+classId);
   for(const classId of Object.keys(classes).filter(id=>classes[id]?.active!==false)){
    const r=await call(owner,{action:'list',classId});assert.equal(r.status,200,classId+' '+r.body.error);
    assert.deepEqual(Object.keys(r.body.passcodes).sort(),Object.keys(classes[classId].members||{}).sort(),classId);
    assert.ok(r.ms<15000,classId+' answered in '+r.ms+' ms');
   }
   const all=await call(owner,{action:'list',all:true});assert.equal(all.status,200);assert.ok(all.ms<15000,'whole-school list answered in '+all.ms+' ms');
  });

  // ---- 5: ET and WT are independent ---------------------------------------------
  await step('5. ET and WT lists are separate: a boy in both is on both, the others on one',async()=>{
   const a=await ok(owner,{action:'list',classId:et}),b=await ok(owner,{action:'list',classId:wt});
   assert.ok(a.passcodes[both]&&b.passcodes[both]);assert.ok(a.passcodes[etOnly]&&!b.passcodes[etOnly]);assert.ok(b.passcodes[wtOnly]&&!a.passcodes[wtOnly]);
  });
  await step('5b. blocking a boy in ET leaves him enabled in WT and his account on; then enabled again',async()=>{
   await ok(owner,{action:'active',classId:et,studentId:both,active:false});
   assert.equal(await read(C+'/'+et+'/members/'+both+'/active'),false);
   assert.equal(await read(C+'/'+wt+'/members/'+both+'/active'),true);
   assert.equal(await read('b3Games/students/'+both+'/memberships/'+W+'_'+wt+'/active'),true);
   assert.equal(await read('b3Games/students/'+both+'/profile/active'),true);
   await ok(owner,{action:'active',classId:et,studentId:both,active:true});
   assert.equal(await read(C+'/'+et+'/members/'+both+'/active'),true);
  });
  await step('5c. removing a boy from WT keeps him in ET; adding him back restores WT only',async()=>{
   await ok(owner,{action:'remove',classId:wt,studentId:both});
   assert.equal(await read(C+'/'+wt+'/members/'+both),null);assert.ok(await read(C+'/'+et+'/members/'+both));
   assert.equal(await read('b3Games/students/'+both+'/memberships/'+W+'_'+et+'/active'),true);
   await ok(owner,{action:'add',classId:wt,studentId:both});
   assert.ok(await read(C+'/'+wt+'/members/'+both));assert.equal((await named('T51 Both')).length,1);
  });

  // ---- Duplicate check when adding one student ----------------------------------
  await step('adding a student who is already in the class is refused',async()=>{
   const r=await call(owner,{action:'create',classId:et,name:'t51  etonly',passcode:'518888'});
   assert.equal(r.status,409);assert.equal(r.body.duplicate,'in-class');assert.equal((await named('T51 EtOnly')).length,1);
  });
  await step('adding a same-name student from another class asks first; same name and passcode is always refused',async()=>{
   const a=await call(owner,{action:'create',classId:et,name:'T51 WtOnly',passcode:'518888'});
   assert.equal(a.status,409);assert.equal(a.body.duplicate,'same-name');
   const b=await call(owner,{action:'create',classId:et,name:'T51 WtOnly',passcode:'510003',confirmNew:true});
   assert.equal(b.status,409);assert.equal(b.body.duplicate,'same-passcode');
   assert.equal((await t51()).length,4,'nothing was created');
  });

  // ---- 6: passcodes ---------------------------------------------------------------
  await step('6. passcode management: change is saved privately and shown in the list',async()=>{
   await ok(owner,{action:'passcode',classId:et,studentId:etOnly,passcode:'515151'});
   assert.equal((await ok(owner,{action:'list',classId:et})).passcodes[etOnly],'515151');
   assert.equal(await read('b3Games/students/'+etOnly+'/profile/passcode'),null,'not stored in the public profile');
   assert.equal(await read(C+'/'+et+'/members/'+etOnly+'/passcode'),null,'not stored on the class list');
  });
  await step('6b. a passcode already used by a same-name student is refused',async()=>{
   const twin=await ok(owner,{action:'create',classId:wt,name:'T51 EtOnly',passcode:'516161',confirmNew:true});created.add(twin.studentId);
   const r=await call(owner,{action:'passcode',classId:wt,studentId:twin.studentId,passcode:'515151'});
   assert.equal(r.status,409);assert.equal(r.body.duplicate,'same-passcode');
   assert.equal((await ok(owner,{action:'list',classId:wt})).passcodes[twin.studentId],'516161','unchanged');
  });
  await step('6c. teachers and the principal cannot change passcodes outside their classes',async()=>{
   const beisStudent=Object.keys((await read(C+'/TEST-BEIS/members'))||{})[0];assert.ok(beisStudent);
   const codeBefore=(await ok(owner,{action:'list',classId:'TEST-BEIS'})).passcodes[beisStudent];
   assert.equal((await call(alef,{action:'passcode',classId:'TEST-BEIS',studentId:beisStudent,passcode:'517171'})).status,403);
   assert.equal((await call(alef,{action:'passcode',classId:'TEST-ALEF',studentId:beisStudent,passcode:'517171'})).status,403);
   assert.equal((await call(alef,{action:'passcode',classId:et,studentId:etOnly,passcode:'517171'})).status,403);
   const mine=Object.keys((await read('b3Games/workspaces/'+W+'/teachers/'+principal.uid+'/classIds'))||{});
   if(!mine.includes(et))assert.equal((await call(principal,{action:'passcode',classId:et,studentId:etOnly,passcode:'517171'})).status,403);
   assert.equal((await ok(owner,{action:'list',classId:'TEST-BEIS'})).passcodes[beisStudent],codeBefore,'unchanged');
  });

  // ---- 7: editing permissions -----------------------------------------------------
  await step('7. teacher editing is limited to his own class; principal to his assigned classes',async()=>{
   const beisStudent=Object.keys((await read(C+'/TEST-BEIS/members'))||{})[0];
   for(const body of [{action:'active',classId:'TEST-BEIS',studentId:beisStudent,active:false},{action:'remove',classId:'TEST-BEIS',studentId:beisStudent},{action:'create',classId:'TEST-BEIS',name:'T51 Nope',passcode:'518181'},{action:'add',classId:'TEST-ALEF',studentId:beisStudent},{action:'active',classId:et,studentId:both,active:false}])
    assert.equal((await call(alef,body)).status,403,'teacher refused: '+body.action+' '+body.classId);
   const mine=Object.keys((await read('b3Games/workspaces/'+W+'/teachers/'+principal.uid+'/classIds'))||{});
   const other=['TEST-ALEF','TEST-BEIS',et].find(id=>!mine.includes(id));
   if(other)assert.equal((await call(principal,{action:'create',classId:other,name:'T51 Nope',passcode:'518181'})).status,403,'principal refused in '+other);
   assert.equal((await named('T51 Nope')).length,0);
   assert.equal(await read(C+'/TEST-BEIS/members/'+beisStudent+'/active'),beforeClasses['TEST-BEIS'].members[beisStudent].active??null);
  });
  await step('7b. principal can edit a student in a class he is assigned (block, then enable again)',async()=>{
   const mine=Object.keys((await read('b3Games/workspaces/'+W+'/teachers/'+principal.uid+'/classIds'))||{});
   const classId=mine[0],sid=Object.keys((await read(C+'/'+classId+'/members'))||{})[0];assert.ok(sid,'a student in '+classId);
   const was=await read(C+'/'+classId+'/members/'+sid),wasShip=await read('b3Games/students/'+sid+'/memberships/'+W+'_'+classId);
   await ok(principal,{action:'active',classId,studentId:sid,active:false});
   assert.equal(await read(C+'/'+classId+'/members/'+sid+'/active'),false);
   await ok(principal,{action:'active',classId,studentId:sid,active:true});
   // Put the fictional fixture back exactly as it was.
   await patch({[C+'/'+classId+'/members/'+sid]:was,['b3Games/students/'+sid+'/memberships/'+W+'_'+classId]:wasShip});
  });
  await step('7c. owner-only tools are refused for teachers and the principal',async()=>{
   for(const who of [alef,beis,principal])for(const action of ['duplicateReport','studentsOverview','importPreview','bulkDelete','rollbackPreview'])
    assert.equal((await call(who,{action,batchId:'imp_0123456789abcdef'})).status,403,who.role+' '+action);
   assert.equal((await call(null,{action:'duplicateReport'})).status,403,'no sign-in');
  });

  // ---- Duplicate report ------------------------------------------------------------
  await step('duplicate report: lists the two T51 EtOnly accounts, changes nothing, shows no passcode',async()=>{
   const snapshot=JSON.stringify(await read('b3Games/students'));
   const r=await ok(owner,{action:'duplicateReport'});
   assert.equal(r.readOnly,true);
   const g=r.studentGroups.find(x=>/^t51 etonly$/i.test(x.name));assert.ok(g,'group found');assert.equal(g.accounts.length,2);assert.equal(g.samePasscode,false);
   const text=JSON.stringify(r);for(const code of ['510001','510003','515151','516161'])assert.ok(!text.includes(code),'no passcode');
   assert.equal(JSON.stringify(await read('b3Games/students')),snapshot,'nothing changed');
   console.log('     staging report summary:',JSON.stringify(r.summary));
   const others=r.studentGroups.filter(x=>!/^t51 /i.test(x.name));
   console.log('     same-name groups on staging apart from this test:',others.length,others.map(x=>x.name+' x'+x.accounts.length).join('; '));
   console.log('     same-name class groups on staging:',r.classGroups.length,r.classGroups.map(x=>x.name+' x'+x.classes.length).join('; '));
  });
 }finally{
  // ---- Remove ONLY this run's fictional T51 records --------------------------------
  const cleanup={};
  const students=await read('b3Games/students')||{},classes=await read(C)||{};
  for(const [id,s] of Object.entries(students)){
   if(!/^T51 /.test(s?.profile?.name||''))continue;
   if(beforeIds.includes(id))throw new Error('refusing to remove a record that existed before this test: '+id);
   cleanup['b3Games/students/'+id]=null;cleanup['b3Private/passcodes/'+id]=null;
   for(const cid of Object.keys(classes))if(classes[cid]?.members?.[id])cleanup[C+'/'+cid+'/members/'+id]=null;
  }
  for(const [cid,c] of Object.entries(classes))if(/^T51 /.test(c?.name||'')&&!beforeClasses[cid]){for(const k of Object.keys(cleanup))if(k.startsWith(C+'/'+cid+'/'))delete cleanup[k];cleanup[C+'/'+cid]=null;}
  for(const id of batchIds)cleanup['b3Private/importBatches/'+id]=null;
  if(Object.keys(cleanup).length)await patch(cleanup);
  await step('clean-up: no T51 student or class is left on staging',async()=>{
   assert.equal((await t51()).length,0);assert.ok(!Object.values(await read(C)||{}).some(c=>/^T51 /.test(c?.name||'')));
  });
  await step('every student who was on staging before is unchanged, and none was added or removed',async()=>{
   const after=await read('b3Games/students')||{};
   assert.deepEqual(Object.keys(after).sort(),[...beforeIds].sort());
   for(const id of beforeIds)assert.deepEqual(after[id],before[id],id);
  });
  await step('every class that was on staging before still has the same members',async()=>{
   const after=await read(C)||{};
   assert.deepEqual(Object.keys(after).sort(),Object.keys(beforeClasses).sort());
   for(const id of Object.keys(beforeClasses))assert.deepEqual(after[id].members||null,beforeClasses[id].members||null,id);
  });
 }
 console.log(JSON.stringify({pass:results.filter(r=>r[0]==='PASS').length,fail:results.filter(r=>r[0]==='FAIL').length}));
 process.exit(results.some(r=>r[0]==='FAIL')?1:0);
})().catch(e=>{console.error(e.message||e);process.exit(1);});
