const test=require('node:test'),assert=require('node:assert/strict');
const {rewardsTeacher}=require('../backend/functions/rewards-teacher-core.cjs');

function db(tree){
 const reads=[],readSnapshots=[];
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{reads.push(p);const v=parts(p).reduce((o,k)=>o?.[k],tree);readSnapshots.push({path:p,bytes:Buffer.byteLength(JSON.stringify(v??null))});return v===undefined?null:structuredClone(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??=( {} );if(v===null)delete o[last];else o[last]=structuredClone(v)};
 return {tree,reads,readSnapshots,get,update:async u=>{for(const [p,v] of Object.entries(u))set(p,v)},tx:async(p,f)=>{const v=f(await get(p));if(v!==undefined)set(p,v);return {committed:v!==undefined,snapshot:{val:()=>v}}}};
}
const google=(uid,email)=>({uid,email,email_verified:true,firebase:{sign_in_provider:'google.com'}});
const T=google('t1','teacher@school.test'),OTHER=google('t2','other@school.test');
function seed(){return db({
 b3Games:{workspaces:{'b3-2026':{
  teachers:{t1:{active:true,classIds:{sc:true}},t2:{active:true,classIds:{wt:true}}},
  classes:{sc:{name:'SC',active:true,toolGrants:{'student-rewards':true},members:{moshe:{name:'Moshe',active:true},yoi:{name:'Yoi',active:true},gone:{name:'Gone',active:false}}},
           wt:{name:'WT',active:true,members:{levi:{name:'Levi',active:true}}}}
 }}},
 studentRewards:{students:{old_levi:{id:'old_levi',name:'Levi',b3StudentId:'levi',rewardBalance:40,active:true}},categories:{c1:{name:'Behavior',active:true}},
  pointRequests:{r1:{rewardStudentId:'PLACEHOLDER',amount:5,status:'pending',practiceStudentId:'moshe',eventId:'ev1',source:'chazara'},r2:{rewardStudentId:'old_levi',amount:5,status:'pending'}}}
});}
const call=(d,who,body)=>rewardsTeacher(d,who,body,Date.parse('2026-10-02T15:00:00Z'));

test('a teacher sees only their own Student Rewards class, created from Teacher Center',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});
 assert.deepEqual(Object.keys(root.classes),['b3_sc']);assert.equal(Object.keys(root.students).length,2);
 assert.ok(Object.values(root.students).every(s=>['moshe','yoi'].includes(s.b3StudentId)));assert.equal(root.students.old_levi,undefined);assert.equal(root.pointRequests.r2,undefined);
 assert.equal(d.reads.filter(p=>p==='b3Games/workspaces/b3-2026/classes').length,0,'regular teacher does not download the workspace class root');
 assert.equal(d.reads.filter(p=>p==='b3Games/workspaces/b3-2026/classes/sc').length,1,'regular teacher reads the assigned class directly')});
test('regular teacher reads assigned class nodes and filters ungranted classes',async()=>{const d=seed();
 d.tree.b3Games.workspaces['b3-2026'].teachers.t1.classIds.wt=true;
 const {root}=await call(d,T,{action:'load'});
 assert.deepEqual(Object.keys(root.classes),['b3_sc']);
 assert.equal(d.reads.filter(p=>p==='b3Games/workspaces/b3-2026/classes').length,0);
 assert.equal(d.reads.filter(p=>p==='b3Games/workspaces/b3-2026/classes/sc').length,1);
 assert.equal(d.reads.filter(p=>p==='b3Games/workspaces/b3-2026/classes/wt').length,1,'assigned but ungranted class is checked and excluded');
});
test('owner Rewards access retains complete granted class discovery',async()=>{const d=seed();
 d.tree.b3Games.admins={admin:{active:true}};
 const owner=google('admin','simcha5770@gmail.com');
 const {root}=await call(d,owner,{action:'load'});
 assert.deepEqual(Object.keys(root.classes),['b3_sc']);
 assert.equal(d.reads.filter(p=>p==='b3Games/workspaces/b3-2026/classes').length,1,'owner reads the class root to discover granted classes');
});
test('teacher scope reuses the already-read class enrollment instead of rereading all classes',async()=>{const d=seed();
 d.tree.studentRewards.enrollments={};
 for(let c=0;c<30;c++){const rows={};for(let s=0;s<20;s++)rows[`synthetic-${c}-${s}`]=true;d.tree.studentRewards.enrollments[`b3_unrelated_${c}`]=rows;}
 const {root}=await call(d,T,{action:'load'});
 const baselineBytes=Buffer.byteLength(JSON.stringify(d.tree.studentRewards.enrollments));
 const scopedBytes=Buffer.byteLength(JSON.stringify(root.enrollments));
 assert.deepEqual(Object.keys(root.enrollments),['b3_sc']);
 assert.equal(d.reads.filter(p=>p==='studentRewards/enrollments').length,0,'does not download the all-class enrollment root');
 assert.equal(d.reads.filter(p=>p==='studentRewards/enrollments/b3_sc').length,1,'reuses the class enrollment snapshot read during class sync');
 assert.ok(Object.keys(root.students).every(id=>root.enrollments.b3_sc[id]===true));
 assert.ok(scopedBytes<baselineBytes);
 const actualClassReadBytes=d.readSnapshots.filter(x=>x.path==='studentRewards/enrollments/b3_sc').reduce((n,x)=>n+x.bytes,0);
 assert.equal(actualClassReadBytes,4,'empty class enrollment node reads as JSON null');
 console.log(JSON.stringify({measurement:'mock-store RTDB get() JSON snapshot trace; not emulator wire bytes/billing',unrelatedClasses:30,unrelatedStudents:600,broadEnrollmentRootBytesAvoided:baselineBytes,broadEnrollmentRootReadCountBefore:1,broadEnrollmentRootReadCountAfter:0,authorizedClassSnapshotReadBytes:actualClassReadBytes,scopedResponseBytes:scopedBytes}));
});
test('Rewards load reads class metadata and reward rounds only for authorized classes',async()=>{const d=seed();
 d.tree.studentRewards.classes??={};d.tree.studentRewards.classRewardRounds??={};
 for(let i=0;i<40;i++){
  d.tree.studentRewards.classes[`b3_unrelated_${i}`]={id:`b3_unrelated_${i}`,name:`Unrelated class ${i}`,b3ClassId:`unrelated_${i}`};
  d.tree.studentRewards.classRewardRounds[`b3_unrelated_${i}`]={reward:{status:'active',totalContributed:i}};
 }
 const broadClassesBytes=Buffer.byteLength(JSON.stringify(d.tree.studentRewards.classes));
 const broadRoundsBytes=Buffer.byteLength(JSON.stringify(d.tree.studentRewards.classRewardRounds));
 const {root}=await call(d,T,{action:'load'});
 assert.deepEqual(Object.keys(root.classes),['b3_sc']);
 assert.deepEqual(Object.keys(root.classRewardRounds),[]);
 assert.equal(d.reads.filter(p=>p==='studentRewards/classes').length,0,'class snapshots are reused from sync, not fetched as a root');
 assert.equal(d.reads.filter(p=>p==='studentRewards/classes/b3_sc').length,1,'only the authorized rewards class is checked');
 assert.equal(d.reads.filter(p=>p==='studentRewards/classRewardRounds').length,0,'round history is not fetched at the root');
 assert.equal(d.reads.filter(p=>p==='studentRewards/classRewardRounds/b3_sc').length,1,'only the authorized class round is read');
 const targetedClassBytes=d.readSnapshots.filter(x=>x.path==='studentRewards/classes/b3_sc').reduce((n,x)=>n+x.bytes,0);
 const targetedRoundsBytes=d.readSnapshots.filter(x=>x.path==='studentRewards/classRewardRounds/b3_sc').reduce((n,x)=>n+x.bytes,0);
 assert.ok(targetedClassBytes<broadClassesBytes);
 assert.ok(targetedRoundsBytes<broadRoundsBytes);
 console.log(JSON.stringify({measurement:'mock-store RTDB get() JSON snapshot trace; not emulator wire bytes/billing',unrelatedClasses:40,broadClassMetadataBytes:broadClassesBytes,authorizedClassReadBytes:targetedClassBytes,broadRoundHistoryBytes:broadRoundsBytes,authorizedRoundReadBytes:targetedRoundsBytes}));
});
test('Rewards refresh reads enrolled student records only after initial class sync',async()=>{const d=seed();
 for(let i=0;i<600;i++)d.tree.studentRewards.students[`unrelated-${i}`]={id:`unrelated-${i}`,name:`Synthetic unrelated student ${i}`,b3StudentId:`outside-${i}`,active:true,rewardBalance:i};
 await call(d,T,{action:'load'}); // Initial compatibility lookup creates/enrolls missing accounts.
 d.reads.length=0;d.readSnapshots.length=0;
 const {root}=await call(d,T,{action:'load'});
 const fullRootBytes=Buffer.byteLength(JSON.stringify(d.tree.studentRewards.students));
 const scopedBytes=Buffer.byteLength(JSON.stringify(root.students));
 assert.equal(d.reads.filter(p=>p==='studentRewards/students').length,0,'steady-state refresh does not scan the full student root');
 assert.ok(Object.values(root.students).every(s=>['moshe','yoi'].includes(s.b3StudentId)));
 assert.equal(Object.keys(root.students).length,2);
 const targetedStudentReadBytes=d.readSnapshots.filter(x=>x.path.startsWith('studentRewards/students/')).reduce((n,x)=>n+x.bytes,0);
 assert.ok(targetedStudentReadBytes<fullRootBytes,'steady-state student reads include enrolled records but exclude unrelated students');
 console.log(JSON.stringify({measurement:'mock-store RTDB get() JSON snapshot trace; not emulator wire bytes/billing',unrelatedStudents:600,fullStudentRootBytes:fullRootBytes,steadyStateScopedStudentReadBytes:targetedStudentReadBytes,steadyStateFullRootReadCount:d.reads.filter(p=>p==='studentRewards/students').length,authorizedStudentResponseBytes:scopedBytes}));
});
test('multi-class teacher scope preserves every authorized class enrollment',async()=>{const d=seed();
 d.tree.b3Games.workspaces['b3-2026'].teachers.t1.classIds.wt=true;
 d.tree.b3Games.workspaces['b3-2026'].classes.wt.toolGrants={'student-rewards':true};
 const {root}=await call(d,T,{action:'load'});
 assert.deepEqual(Object.keys(root.classes).sort(),['b3_sc','b3_wt']);
 assert.equal(root.students.old_levi.b3StudentId,'levi','reuses the existing legacy Rewards account');
 assert.ok(Object.keys(root.students).every(id=>root.enrollments.b3_sc[id]===true||root.enrollments.b3_wt[id]===true));
 assert.equal(d.reads.filter(p=>p==='studentRewards/enrollments').length,0);
 assert.equal(d.reads.filter(p=>p==='studentRewards/enrollments/b3_sc').length,1);
 assert.equal(d.reads.filter(p=>p==='studentRewards/enrollments/b3_wt').length,1);
});
test('classes without Student Rewards turned on are refused',async()=>{const d=seed();await assert.rejects(call(d,OTHER,{action:'load'}),{code:403})});
test('non-Google or unverified accounts are refused',async()=>{const d=seed();await assert.rejects(call(d,{...T,firebase:{sign_in_provider:'custom'}},{action:'load'}),{code:403})});
test('saving daily points records the day and adds only the change to the balance',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});const [a,b]=Object.keys(root.students);
 await call(d,T,{action:'saveDaily',classId:'b3_sc',date:'2026-10-02',rows:[{studentId:a,ratings:{Behavior:'Excellent',Davening:'Good'},award:999},{studentId:b,absent:true}]});
 assert.equal(d.tree.studentRewards.students[a].rewardBalance,7);
 assert.deepEqual(d.tree.studentRewards.dailyAwards[a].b3_sc['2026-10-02'].byCategory,{Behavior:{category:'Behavior',rating:'Excellent',points:4},Davening:{category:'Davening',rating:'Good',points:3}});
 assert.equal(d.tree.studentRewards.dailyAwards[b].b3_sc['2026-10-02'].points,0);assert.equal(d.tree.studentRewards.dailyRatings[a].b3_sc['2026-10-02'].Behavior.points,110);assert.equal(d.tree.studentRewards.dailyAttendance[b].b3_sc['2026-10-02'].status,'absent');
 await call(d,T,{action:'saveDaily',classId:'b3_sc',date:'2026-10-02',rows:[{studentId:a,ratings:{Behavior:'Fair',Davening:'Good'}}]});
 assert.equal(d.tree.studentRewards.students[a].rewardBalance,5)});
test('a teacher cannot award points outside their class or with bad values',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});const a=Object.keys(root.students)[0];
 await assert.rejects(call(d,T,{action:'adjust',classId:'b3_sc',studentId:'old_levi',amount:5}),{code:403});
 await assert.rejects(call(d,T,{action:'adjust',classId:'b3_wt',studentId:a,amount:5}),{code:403});
 await assert.rejects(call(d,T,{action:'adjust',classId:'b3_sc',studentId:a,amount:5000}),{code:400});
 await assert.rejects(call(d,T,{action:'saveDaily',classId:'b3_sc',date:'2026-10-02',rows:[{studentId:a,ratings:{Behavior:'Amazing'}}]}),{code:400})});
test('point adjustments never take a balance below zero and are recorded',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});const a=Object.keys(root.students)[0];
 const r=await call(d,T,{action:'adjust',classId:'b3_sc',studentId:a,amount:-7,reason:'Test'});assert.equal(r.applied,0);
 await call(d,T,{action:'adjust',classId:'b3_sc',studentId:a,amount:12});assert.equal(d.tree.studentRewards.students[a].rewardBalance,12);
 assert.equal(Object.values(d.tree.studentRewards.pointAdjustments).length,2)});
test('a teacher approves activity points only for their own students, once',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});
 const moshe=Object.values(root.students).find(s=>s.b3StudentId==='moshe').id;d.tree.studentRewards.pointRequests.r1.rewardStudentId=moshe;
 const ok=await call(d,T,{action:'approve',requestId:'r1'});assert.equal(ok.status,'approved');assert.equal(d.tree.studentRewards.students[moshe].rewardBalance,5);
 assert.equal(d.tree.posukPractice.chazara.events.moshe.ev1.pointRequestStatus,'approved');
 await assert.rejects(call(d,T,{action:'approve',requestId:'r1'}),{code:409});await assert.rejects(call(d,T,{action:'approve',requestId:'r2'}),{code:403})});
test('comments are saved for the teacher’s own students',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});const a=Object.keys(root.students)[0];
 await call(d,T,{action:'comment',classId:'b3_sc',studentId:a,body:'Great job',visibleToStudent:true});assert.equal(Object.values(d.tree.studentRewards.commentsByStudent[a])[0].body,'Great job')});
test('existing rewards accounts are reused instead of duplicated',async()=>{const d=seed();d.tree.b3Games.workspaces['b3-2026'].classes.wt.toolGrants={'student-rewards':true};
 const {root}=await call(d,OTHER,{action:'load'});assert.deepEqual(Object.keys(root.students),['old_levi']);assert.equal(root.students.old_levi.rewardBalance,40)});

const store=require('../backend/functions/rewards-store.cjs');
test('class stores: Teacher Center classes use their own items; ET/WT keep the shared store',()=>{
 const root={classes:{b3_sc:{b3ClassId:'sc'},b3_et:{b3ClassId:'et'},old:{}},settings:{rewardStoreEnabled:true,classStoreEnabled:{b3_sc:false}}};
 assert.equal(store.isTeacherStore(root,'b3_sc'),true);assert.equal(store.isTeacherStore(root,'b3_et'),false);assert.equal(store.isTeacherStore(root,'old'),false);
 assert.equal(store.itemInStore(root,'b3_sc',{ownerClassId:'b3_sc'}),true);assert.equal(store.itemInStore(root,'b3_sc',{}),false);assert.equal(store.itemInStore(root,'b3_et',{ownerClassId:'b3_sc'}),false);assert.equal(store.itemInStore(root,'b3_et',{}),true);
 assert.equal(store.storeOpenFor(root,'b3_sc'),false);assert.equal(store.storeOpenFor(root,'b3_et'),true)});
test('a teacher creates, edits and closes items only in their own class store',async()=>{const d=seed();await call(d,T,{action:'load'});
 await call(d,T,{action:'storeWrite',classId:'b3_sc',updates:{'studentRewards/rewards/r-new':{name:'Sticker',cost:20,quantity:-1,available:true}}});
 assert.equal(d.tree.studentRewards.rewards['r-new'].ownerClassId,'b3_sc');assert.equal(d.tree.studentRewards.rewards['r-new'].cost,20);
 await call(d,T,{action:'storeWrite',classId:'b3_sc',updates:{'studentRewards/rewards/r-new/available':false}});assert.equal(d.tree.studentRewards.rewards['r-new'].available,false);
 d.tree.studentRewards.rewards.global={id:'global',name:'Owner prize',cost:5};
 await assert.rejects(call(d,T,{action:'storeWrite',classId:'b3_sc',updates:{'studentRewards/rewards/global/available':false}}),{code:403});
 await assert.rejects(call(d,T,{action:'storeWrite',classId:'b3_sc',updates:{'studentRewards/students/x/rewardBalance':999}}),{code:403});
 await assert.rejects(call(d,T,{action:'storeWrite',classId:'b3_sc',updates:{'studentRewards/settings/rewardStoreEnabled':true}}),{code:403});
 const {root}=await call(d,T,{action:'load'});assert.deepEqual(Object.keys(root.rewards),['r-new'])});
test('a teacher adds a class reward with availability in one save and opens their own store',async()=>{const d=seed();await call(d,T,{action:'load'});
 await call(d,T,{action:'storeWrite',classId:'b3_sc',updates:{'studentRewards/classRewardCatalog/cr1':{name:'Extra recess',costPerStudent:50,available:true},'studentRewards/settings/classRewardAvailability/cr1':true}});
 assert.equal(d.tree.studentRewards.classRewardCatalog.cr1.ownerClassId,'b3_sc');assert.equal(d.tree.studentRewards.settings.classRewardAvailability.cr1,true);
 await call(d,T,{action:'setStore',classId:'b3_sc',open:true});assert.equal(d.tree.studentRewards.settings.classStoreEnabled.b3_sc,true);
 await assert.rejects(call(d,T,{action:'setStore',classId:'b3_wt',open:true}),{code:403})});
test('a teacher approves and declines purchases from their own store, refunding on decline',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});const a=Object.keys(root.students)[0];
 (d.tree.studentRewards.rewards??={}).mine={id:'mine',name:'Pencil',cost:30,ownerClassId:'b3_sc'};d.tree.studentRewards.students[a].rewardBalance=0;
 d.tree.studentRewards.redemptionsByStudent={[a]:{k1:{rewardId:'mine',cost:30,status:'pending',requestedAt:'2026-10-02T10:00:00Z'},k2:{rewardId:'mine',cost:30,status:'pending'}}};
 assert.equal((await call(d,T,{action:'review',studentId:a,key:'k1',decision:'approve'})).status,'ready');
 assert.equal((await call(d,T,{action:'review',studentId:a,key:'k1',decision:'collect'})).status,'collected');
 await call(d,T,{action:'review',studentId:a,key:'k2',decision:'decline'});assert.equal(d.tree.studentRewards.students[a].rewardBalance,30);
 await assert.rejects(call(d,T,{action:'review',studentId:a,key:'k2',decision:'decline'}),{code:409})});
