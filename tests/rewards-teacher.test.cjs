const test=require('node:test'),assert=require('node:assert/strict');
const {rewardsTeacher}=require('../backend/functions/rewards-teacher-core.cjs');

function db(tree){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:structuredClone(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??=( {} );if(v===null)delete o[last];else o[last]=structuredClone(v)};
 return {tree,get,update:async u=>{for(const [p,v] of Object.entries(u))set(p,v)},tx:async(p,f)=>{const v=f(await get(p));if(v!==undefined)set(p,v);return {committed:v!==undefined,snapshot:{val:()=>v}}}};
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
 assert.ok(Object.values(root.students).every(s=>['moshe','yoi'].includes(s.b3StudentId)));assert.equal(root.students.old_levi,undefined);assert.equal(root.pointRequests.r2,undefined)});
test('classes without Student Rewards turned on are refused',async()=>{const d=seed();await assert.rejects(call(d,OTHER,{action:'load'}),{code:403})});
test('non-Google or unverified accounts are refused',async()=>{const d=seed();await assert.rejects(call(d,{...T,firebase:{sign_in_provider:'custom'}},{action:'load'}),{code:403})});
test('saving daily points records the day and adds only the change to the balance',async()=>{const d=seed();const {root}=await call(d,T,{action:'load'});const [a,b]=Object.keys(root.students);
 await call(d,T,{action:'saveDaily',classId:'b3_sc',date:'2026-10-02',rows:[{studentId:a,ratings:{Behavior:'Excellent'},award:10},{studentId:b,absent:true}]});
 assert.equal(d.tree.studentRewards.students[a].rewardBalance,10);assert.equal(d.tree.studentRewards.dailyRatings[a].b3_sc['2026-10-02'].Behavior.points,110);assert.equal(d.tree.studentRewards.dailyAttendance[b].b3_sc['2026-10-02'].status,'absent');
 await call(d,T,{action:'saveDaily',classId:'b3_sc',date:'2026-10-02',rows:[{studentId:a,ratings:{Behavior:'Good'},award:15}]});
 assert.equal(d.tree.studentRewards.students[a].rewardBalance,15)});
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
