'use strict';
// Issue #728: split the legacy classes ET and WT into morning and afternoon
// classes, and retire ET and WT later without deleting anything.
// Fictional students and an in-memory database only.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT_DIR=path.join(__dirname,'..');
const DIR=process.env.STUDENT_FUNCTIONS_DIR||path.join(ROOT_DIR,'backend','functions');
const {manageStudents}=require(path.join(DIR,'student-management-core.cjs'));
const {studentAuth}=require(path.join(DIR,'student-auth-core.cjs'));
// The activity sign-in check exists only in the production folder; it is not changed here.
const {resolveStudent}=require(path.join(ROOT_DIR,'backend','functions','student-login-core.cjs'));
const UI=require('../class-split.js');

const OWNER={uid:'owner_uid',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const TEACHER={uid:'teacher_uid',email:'teacher@test.example',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const WSROOT='b3Games/workspaces/b3-2026';
const copy=v=>structuredClone(v);

function db(tree){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>{const v=parts(p).reduce((o,k)=>o?.[k],tree);return v===undefined?null:copy(v)};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??={};if(v===null||v===undefined)delete o[last];else o[last]=copy(v)};
 const store={tree,get,writes:[],failOn:null,
  update:async u=>{if(store.failOn&&Object.keys(u).some(store.failOn))throw new Error('connection lost');store.writes.push(...Object.keys(u));for(const [p,v] of Object.entries(u))set(p,v)},
  tx:async(p,f)=>{const v=f(await get(p));if(v!==undefined)set(p,v);return {committed:v!==undefined}}};
 return store;
}
const member=(id,name,extra={})=>({studentId:id,name,active:true,...extra});
const link=(classId,active=true)=>({workspaceId:'b3-2026',classId,active});
function site(){
 return db({
  b3Private:{passcodes:{s_arik:{passcode:'111111'},s_benny:{passcode:'222222'},s_legacy:{passcode:'333333'},s_wt1:{passcode:'444444'},s_blocked:{passcode:'555555'},s_off:{passcode:'666666'},s_removed:{passcode:'777777'}}},
  assignmentCenter:{workspaces:{'b3-2026':{classes:{et:{items:{hw1:{title:'Chumash sheet'}},records:{s_arik:{hw1:{done:true}}}},wt:{items:{hw2:{title:'Mishnayos'}}}}}}},
  posukPractice:{allowedStudents:{s_old_list:{name:'Old List',classId:'et',active:true}}},
  b3Games:{
   students:{
    s_arik:{profile:{id:'s_arik',name:'Arik Test',active:true},memberships:{'b3-2026_et':link('et')},halacha:{done:4}},
    s_benny:{profile:{id:'s_benny',name:'Benny Test',active:true},memberships:{'b3-2026_et':link('et')}},
    // Legacy account: reaches ET only through profile.classId, no membership records.
    s_legacy:{profile:{id:'s_legacy',name:'Legacy Test',active:true,classId:'et'}},
    s_wt1:{profile:{id:'s_wt1',name:'Wolf Test',active:true},memberships:{'b3-2026_wt':link('wt')}},
    s_blocked:{profile:{id:'s_blocked',name:'Blocked Test',active:true},memberships:{'b3-2026_et':link('et')}},
    s_off:{profile:{id:'s_off',name:'Off Test',active:false},memberships:{'b3-2026_et':link('et')}},
    s_removed:{profile:{id:'s_removed',name:'Removed Test',active:true},memberships:{'b3-2026_et':link('et',false)}}
   },
   workspaces:{'b3-2026':{
    schools:{school_a:{name:'School A'},school_b:{name:'School B'}},
    students:{s_arik:{schoolId:'school_a',classIds:{et:true}}},
    teachers:{teacher_uid:{active:true,classIds:{et:true}}},
    classes:{
     et:{name:'ET',active:true,schoolId:'school_a',teacherIds:{teacher_uid:true},toolGrants:{halacha:true},managementAudit:{a1:{action:'create',at:1}},
      members:{s_arik:member('s_arik','Arik Test',{toolAccess:{halacha:false}}),s_benny:member('s_benny','Benny Test'),s_legacy:member('s_legacy','Legacy Test'),
       s_blocked:member('s_blocked','Blocked Test',{active:false}),s_off:member('s_off','Off Test'),s_removed:member('s_removed','Removed Test'),
       s_old_list:member('s_old_list','Old List'),demo_abc:member('demo_abc','Teacher (demo)',{demo:true})}},
     wt:{name:'WT',schoolId:'school_a',members:{s_wt1:member('s_wt1','Wolf Test')}},
     other:{name:'Grade 4',active:true,schoolId:'school_b'}
    }
   }}
  }
 });
}
const call=(store,body,who=OWNER,now=1000)=>manageStudents(store,who,body,now);
const src=(r,id)=>r.sources.find(s=>s.source===id);
const cls=(store,id)=>store.tree.b3Games.workspaces['b3-2026'].classes[id];
const allTicked=s=>Object.fromEntries(s.students.map(r=>[r.studentId,{morning:true,afternoon:true}]));
async function created(){const store=site();const r=await call(store,{action:'classSplitCreate'});return {store,r};}
async function enrolled(){
 const {store,r}=await created();
 const et=src(r,'et'),wt=src(r,'wt');
 await call(store,{action:'classSplitEnroll',source:'et',picks:allTicked(et),planHash:et.planHash});
 await call(store,{action:'classSplitEnroll',source:'wt',picks:allTicked(wt),planHash:wt.planHash});
 return store;
}

test('only the owner can use any split action; a teacher of ET cannot',async()=>{
 for(const action of ['classSplitPreview','classSplitCreate','classSplitEnroll','classSplitRetire','classSplitRestore']){
  const store=site(),before=copy(store.tree);
  await assert.rejects(call(store,{action,source:'et'},TEACHER),e=>e.code===403);
  await assert.rejects(call(store,{action,source:'et'},{...OWNER,email_verified:false}),e=>e.code===403);
  assert.deepEqual(store.tree,before);
 }
});

test('preview writes nothing and lists who would be enrolled, and who is left out and why',async()=>{
 const store=site(),before=copy(store.tree);
 const r=await call(store,{action:'classSplitPreview'});
 assert.deepEqual(store.tree,before);assert.deepEqual(store.writes,[]);
 const et=src(r,'et');
 assert.deepEqual(et.students.map(s=>s.name),['Arik Test','Benny Test','Legacy Test']);
 assert.ok(et.students.every(s=>s.morning==='add'&&s.afternoon==='add'&&s.tick.morning&&s.tick.afternoon),'everyone starts ticked for both sessions');
 assert.deepEqual(et.skipped.map(s=>s.studentId).sort(),['s_blocked','s_off','s_old_list','s_removed']);
 assert.ok(!JSON.stringify(r).includes('demo_abc'),'a teacher demo student is never listed');
 assert.equal(et.targets.morning.name,'B3 ET morning');assert.equal(et.targets.afternoon.name,'B3 ET afternoon');
 assert.equal(src(r,'wt').targets.morning.name,'B3 WT morning');assert.equal(src(r,'wt').targets.afternoon.name,'B3 WT afternoon');
 assert.ok(!JSON.stringify(r).match(/111111|222222|333333/),'no passcode is ever returned');
});

test('create: four classes, in the same school as ET and WT, and ET and WT are untouched',async()=>{
 const store=site(),etBefore=copy(cls(store,'et')),wtBefore=copy(cls(store,'wt'));
 const r=await call(store,{action:'classSplitCreate'});
 assert.equal(r.created.length,4);
 const want={b3_et_morning:['B3 ET morning','et','morning'],b3_et_afternoon:['B3 ET afternoon','et','afternoon'],b3_wt_morning:['B3 WT morning','wt','morning'],b3_wt_afternoon:['B3 WT afternoon','wt','afternoon']};
 for(const [id,[name,from,session]] of Object.entries(want))
  assert.deepEqual(cls(store,id),{name,active:true,schoolId:'school_a',createdAt:1000,createdBy:'owner_uid',splitFrom:from,session});
 assert.deepEqual(cls(store,'et'),etBefore);assert.deepEqual(cls(store,'wt'),wtBefore);
 assert.ok(src(r,'et').targets.morning.ready&&src(r,'wt').targets.afternoon.ready);
 // Running it again makes nothing new.
 const before=copy(store.tree),again=await call(store,{action:'classSplitCreate'});
 assert.equal(again.created.length,0);assert.deepEqual(store.tree,before);
});

test('create: a legacy class with no school gives new classes with no school',async()=>{
 const store=site();delete cls(store,'et').schoolId;
 await call(store,{action:'classSplitCreate'});
 assert.equal(Object.hasOwn(cls(store,'b3_et_morning'),'schoolId'),false);
 assert.equal(cls(store,'b3_wt_morning').schoolId,'school_a');
});

test('create: same-named classes already on the site are never picked or duplicated silently (Issue #665)',async()=>{
 const withDupes=()=>{const store=site();Object.assign(store.tree.b3Games.workspaces['b3-2026'].classes,{
  b3_et_morning:{name:'B3 ET � Morning',active:true,schoolId:'school_a'},
  b3_et_morning_716001:{name:'B3 ET · Morning',active:true,schoolId:'school_a',members:{imp1:member('imp1','Arik Test')}},
  b3_et_afternoon_716058:{name:'B3 ET · Afternoon',active:true,schoolId:'school_b'},
  b3_wt_morning_716116:{name:'B3 WT Morning',active:false,schoolId:'school_a'}});return store;};
 let store=withDupes(),before=copy(store.tree);
 const p=await call(store,{action:'classSplitPreview'});
 assert.deepEqual(src(p,'et').targets.morning.candidates.map(c=>c.classId),['b3_et_morning','b3_et_morning_716001']);
 assert.deepEqual(UI.defaultChoices(p),{et:{morning:'',afternoon:''},wt:{morning:'',afternoon:'new'}});
 await assert.rejects(call(store,{action:'classSplitCreate'}),e=>e.code===400&&/Choose which class/.test(e.message));
 await assert.rejects(call(store,{action:'classSplitCreate',choices:{et:{morning:'other',afternoon:'new'},wt:{morning:'new'}}}),e=>e.code===400,'a class with another name cannot be chosen');
 await assert.rejects(call(store,{action:'classSplitCreate',choices:{et:{morning:'b3_et_morning_716001',afternoon:'b3_et_afternoon_716058'},wt:{morning:'new'}}}),e=>e.code===409&&/same school/.test(e.message));
 await assert.rejects(call(store,{action:'classSplitCreate',choices:{et:{morning:'b3_et_morning_716001',afternoon:'new'},wt:{morning:'b3_wt_morning_716116'}}}),e=>e.code===409&&/turned off/.test(e.message));
 assert.deepEqual(store.tree,before,'a refused request writes nothing');
 const r=await call(store,{action:'classSplitCreate',choices:{et:{morning:'b3_et_morning_716001',afternoon:'new'},wt:{morning:'new'}}});
 assert.deepEqual(r.linked,['b3_et_morning_716001']);assert.equal(r.created.length,3);
 for(const id of ['b3_et_morning','b3_et_morning_716001','b3_et_afternoon_716058','b3_wt_morning_716116'])assert.deepEqual(cls(store,id),before.b3Games.workspaces['b3-2026'].classes[id],'existing class '+id+' is not changed');
 const t=src(r,'et').targets;
 assert.equal(t.morning.classId,'b3_et_morning_716001');assert.equal(t.morning.others,1,'students there who are not in ET are counted for the owner');
 assert.match(t.afternoon.classId,/^b3_et_afternoon_[a-f0-9]{6}$|^b3_et_afternoon$/);
 assert.equal(cls(store,t.afternoon.classId).name,'B3 ET afternoon');
});

test('enroll: every ticked student joins both new classes; ET, homework, passcodes and profiles are untouched',async()=>{
 const {store,r}=await created();
 const keep=()=>copy({et:cls(store,'et'),wt:cls(store,'wt'),hw:store.tree.assignmentCenter,pass:store.tree.b3Private.passcodes,legacy:store.tree.posukPractice,
  profiles:Object.fromEntries(Object.entries(store.tree.b3Games.students).map(([id,s])=>[id,{profile:s.profile,halacha:s.halacha}])),teachers:store.tree.b3Games.workspaces['b3-2026'].teachers});
 const before=keep(),et=src(r,'et');
 const out=await call(store,{action:'classSplitEnroll',source:'et',picks:allTicked(et),planHash:et.planHash},OWNER,2000);
 assert.deepEqual(out.counts,{students:3,memberships:6,unchanged:0,keptSource:1,failed:0,ignored:0});
 for(const id of ['s_arik','s_benny','s_legacy'])for(const c of ['b3_et_morning','b3_et_afternoon']){
  assert.deepEqual(cls(store,c).members[id],{studentId:id,name:store.tree.b3Games.students[id].profile.name,active:true},'a plain member row: nothing copied from ET');
  assert.deepEqual(store.tree.b3Games.students[id].memberships['b3-2026_'+c],link(c));
 }
 assert.deepEqual(keep(),before);
 assert.deepEqual(store.tree.b3Games.students.s_arik.memberships['b3-2026_et'],link('et'),'still in ET');
 assert.equal(cls(store,'b3_wt_morning').members,undefined,'ET students never go into a WT class');
 for(const id of ['s_blocked','s_off','s_removed','s_old_list','demo_abc'])assert.equal(cls(store,'b3_et_morning').members[id],undefined,id+' is not enrolled');
 assert.deepEqual(store.tree.b3Games.workspaces['b3-2026'].students.s_arik.classIds,{et:true,b3_et_morning:true,b3_et_afternoon:true},'owner panel copy follows');
 assert.equal(store.tree.b3Games.workspaces['b3-2026'].students.s_benny,undefined,'no owner record is invented');
 assert.ok(!store.writes.some(p=>p.startsWith(WSROOT+'/classes/et/')||p.startsWith(WSROOT+'/classes/wt/')||p.startsWith('b3Private/passcodes')||p.startsWith('assignmentCenter')),'no write under ET, WT, passcodes or homework');
 assert.ok(!store.writes.some(p=>/\/profile(\/|$)/.test(p)),'no profile write');
 const audit=Object.values(store.tree.b3Private.studentAudit).find(a=>a.action==='classSplitEnroll');
 assert.deepEqual(audit.counts,out.counts);
});

test('enroll: an unticked session is left out, and stays unticked next time',async()=>{
 const {store,r}=await created(),et=src(r,'et');
 const picks=allTicked(et);picks.s_benny.afternoon=false;picks.s_legacy={morning:false,afternoon:false};
 const out=await call(store,{action:'classSplitEnroll',source:'et',picks,planHash:et.planHash});
 assert.deepEqual(out.counts,{students:2,memberships:3,unchanged:1,keptSource:0,failed:0,ignored:0});
 assert.ok(cls(store,'b3_et_morning').members.s_benny);assert.equal(cls(store,'b3_et_afternoon').members.s_benny,undefined);
 assert.equal(store.tree.b3Games.students.s_benny.memberships['b3-2026_b3_et_afternoon'],undefined);
 assert.equal(store.tree.b3Games.students.s_legacy.memberships,undefined,'a student left out of both gets no membership record at all');
 const benny=src(out,'et').students.find(s=>s.studentId==='s_benny'),legacy=src(out,'et').students.find(s=>s.studentId==='s_legacy');
 assert.deepEqual([benny.morning,benny.afternoon,benny.tick.afternoon],['in','add',false]);
 assert.deepEqual(legacy.tick,{morning:false,afternoon:false});
 // The owner changes their mind: ticking it later still works.
 const later=await call(store,{action:'classSplitEnroll',source:'et',picks:{s_benny:{morning:true,afternoon:true}},planHash:src(out,'et').planHash});
 assert.equal(later.counts.memberships,1);assert.ok(cls(store,'b3_et_afternoon').members.s_benny);
});

test('enroll: a legacy student with no membership records keeps ET exactly as before',async()=>{
 const {store,r}=await created(),et=src(r,'et');
 const signIn=classId=>resolveStudent(store.get,{name:'Legacy Test',pin:'333333',classId});
 assert.equal((await signIn('et')).classId,'et','before: reaches ET through the old fallback');
 await call(store,{action:'classSplitEnroll',source:'et',picks:allTicked(et),planHash:et.planHash});
 assert.deepEqual(store.tree.b3Games.students.s_legacy.memberships['b3-2026_et'],link('et'),'the ET membership they relied on is written down');
 assert.equal((await signIn('et')).classId,'et','after: ET still opens with the same passcode');
 assert.equal((await signIn('b3_et_morning')).classId,'b3_et_morning');
 const login=await studentAuth(store,{action:'login',name:'Legacy Test',pin:'333333'});
 assert.equal(login.id,'s_legacy');
 // A student who already had an ET membership gets no extra ET write.
 assert.ok(!store.writes.includes('b3Games/students/s_arik/memberships/b3-2026_et'));
});

test('enroll: refused when the site changed since the preview, before the classes exist, or for a turned-off new class',async()=>{
 const store=site(),p=await call(store,{action:'classSplitPreview'});
 await assert.rejects(call(store,{action:'classSplitEnroll',source:'et',picks:{},planHash:src(p,'et').planHash}),e=>e.code===409&&/Create the new classes first/.test(e.message));
 await assert.rejects(call(store,{action:'classSplitEnroll',source:'grade4',picks:{}}),e=>e.code===400);
 const r=await call(store,{action:'classSplitCreate'}),et=src(r,'et');
 cls(store,'et').members.s_new=member('s_new','New Test');store.tree.b3Games.students.s_new={profile:{id:'s_new',name:'New Test',active:true},memberships:{'b3-2026_et':link('et')}};
 const before=copy(store.tree);
 await assert.rejects(call(store,{action:'classSplitEnroll',source:'et',picks:allTicked(et),planHash:et.planHash}),e=>e.code===409&&/changed/.test(e.message));
 assert.deepEqual(store.tree,before);
 cls(store,'b3_et_afternoon').active=false;
 const fresh=src(await call(store,{action:'classSplitPreview'}),'et');
 await assert.rejects(call(store,{action:'classSplitEnroll',source:'et',picks:allTicked(fresh),planHash:fresh.planHash}),e=>e.code===409&&/turned off/.test(e.message));
});

test('enroll: never re-enables a student blocked in a new class, and never re-ticks one who was taken out',async()=>{
 const {store,r}=await created();
 cls(store,'b3_et_morning').members={s_arik:member('s_arik','Arik Test',{active:false})};
 store.tree.b3Games.students.s_benny.memberships['b3-2026_b3_et_morning']={...link('b3_et_morning',false),removedAt:5};
 const et=src(await call(store,{action:'classSplitPreview'}),'et');
 const arik=et.students.find(s=>s.studentId==='s_arik'),benny=et.students.find(s=>s.studentId==='s_benny');
 assert.equal(arik.morning,'blocked');assert.deepEqual([benny.morning,benny.tick.morning],['out',false]);
 await call(store,{action:'classSplitEnroll',source:'et',picks:{s_arik:{morning:true,afternoon:true},s_benny:{morning:false,afternoon:true},s_ghost:{morning:true}},planHash:et.planHash});
 assert.equal(cls(store,'b3_et_morning').members.s_arik.active,false,'still blocked');
 assert.equal(cls(store,'b3_et_morning').members.s_benny,undefined,'still out');
 assert.equal(cls(store,'b3_et_morning').members.s_ghost,undefined,'an id that is not an ET student is ignored');
 assert.ok(cls(store,'b3_et_afternoon').members.s_arik&&cls(store,'b3_et_afternoon').members.s_benny);
});

test('enroll: one student failing never leaves half a student, and running again finishes',async()=>{
 const {store,r}=await created(),et=src(r,'et');
 store.failOn=p=>p.includes('/members/s_benny');
 const out=await call(store,{action:'classSplitEnroll',source:'et',picks:allTicked(et),planHash:et.planHash});
 assert.equal(out.counts.failed,1);assert.equal(out.failed[0].studentId,'s_benny');
 assert.deepEqual(Object.keys(store.tree.b3Games.students.s_benny.memberships),['b3-2026_et'],'nothing half-written');
 store.failOn=null;
 const again=await call(store,{action:'classSplitEnroll',source:'et',picks:{s_benny:{morning:true,afternoon:true}},planHash:src(out,'et').planHash});
 assert.equal(again.counts.students,1);assert.ok(cls(store,'b3_et_morning').members.s_benny&&cls(store,'b3_et_afternoon').members.s_benny);
});

test('retire: refused until the new classes exist, the text is typed, and nobody is left without a class',async()=>{
 const store=site(),p=await call(store,{action:'classSplitPreview'});
 await assert.rejects(call(store,{action:'classSplitRetire',source:'et',planHash:src(p,'et').planHash,confirmText:'RETIRE ET'}),e=>e.code===409&&/must exist/.test(e.message));
 const r=await call(store,{action:'classSplitCreate'}),et=src(r,'et');
 assert.deepEqual(et.stranded.map(s=>s.studentId).sort(),['s_arik','s_benny','s_legacy']);
 const before=copy(store.tree);
 await assert.rejects(call(store,{action:'classSplitRetire',source:'et',planHash:et.planHash,confirmText:'RETIRE ET'}),e=>e.code===409&&/3 student\(s\) would have no class left/.test(e.message));
 await assert.rejects(call(store,{action:'classSplitRetire',source:'et',planHash:et.planHash,allowNoClass:true,confirmText:'retire wt'}),e=>e.code===400);
 await assert.rejects(call(store,{action:'classSplitRetire',source:'et',planHash:'old',allowNoClass:true,confirmText:'RETIRE ET'}),e=>e.code===409);
 assert.deepEqual(store.tree,before);
});

test('retire: turns ET off and deletes nothing; restore puts it back exactly',async()=>{
 const store=await enrolled();
 const etBefore=copy(cls(store,'et')),wtBefore=copy(cls(store,'wt')),rest=()=>copy({hw:store.tree.assignmentCenter,pass:store.tree.b3Private.passcodes,students:store.tree.b3Games.students,
  owner:store.tree.b3Games.workspaces['b3-2026'].students,teachers:store.tree.b3Games.workspaces['b3-2026'].teachers,am:cls(store,'b3_et_morning'),pm:cls(store,'b3_et_afternoon')}),before=rest();
 const p=src(await call(store,{action:'classSplitPreview'}),'et');
 assert.deepEqual(p.stranded,[],'everyone enrolled has another class');
 const r=await call(store,{action:'classSplitRetire',source:'et',planHash:p.planHash,confirmText:' retire et '},OWNER,5000);
 assert.equal(src(r,'et').active,false);assert.deepEqual(src(r,'et').retired,{at:5000});
 assert.deepEqual(cls(store,'et'),{...etBefore,active:false,retiredAt:5000,retiredBy:'owner_uid'},'only active/retiredAt/retiredBy changed: members, tools, teachers and audit are all still there');
 assert.deepEqual(cls(store,'wt'),wtBefore,'WT is separate');assert.deepEqual(rest(),before,'students, memberships, passcodes, homework and the new classes are untouched');
 // Existing checks already treat a turned-off class as closed; the new class still opens.
 await assert.rejects(resolveStudent(store.get,{name:'Arik Test',pin:'111111',classId:'et'}),e=>e.code===403);
 assert.equal((await resolveStudent(store.get,{name:'Arik Test',pin:'111111',classId:'b3_et_morning'})).classId,'b3_et_morning');
 await assert.rejects(call(store,{action:'list',classId:'et'},TEACHER),e=>e.code===403);
 await assert.rejects(call(store,{action:'classSplitRetire',source:'et',planHash:src(r,'et').planHash,confirmText:'RETIRE ET'}),e=>e.code===409&&/already turned off/.test(e.message));
 const back=await call(store,{action:'classSplitRestore',source:'et'},OWNER,6000);
 assert.deepEqual(cls(store,'et'),etBefore,'ET is exactly as it was');assert.equal(src(back,'et').retired,null);
 assert.equal((await resolveStudent(store.get,{name:'Arik Test',pin:'111111',classId:'et'})).classId,'et');
 assert.deepEqual(Object.values(store.tree.b3Private.studentAudit).map(a=>a.action).filter(a=>/Retire|Restore/.test(a)).sort(),['classSplitRestore','classSplitRetire']);
});

test('retire WT, which never had an "active" flag: restore removes the flag again',async()=>{
 const store=await enrolled(),wtBefore=copy(cls(store,'wt'));
 const p=src(await call(store,{action:'classSplitPreview'}),'wt');
 await call(store,{action:'classSplitRetire',source:'wt',planHash:p.planHash,confirmText:'RETIRE WT'});
 assert.equal(cls(store,'wt').active,false);
 await call(store,{action:'classSplitRestore',source:'wt'});
 assert.deepEqual(cls(store,'wt'),wtBefore);
 await assert.rejects(call(store,{action:'classSplitRestore',source:'wt'}),e=>e.code===409,'nothing to bring back twice');
});

test('retire anyway: allowed with the tick, and the students left without a class are recorded',async()=>{
 const {store,r}=await created(),et=src(r,'et');
 await call(store,{action:'classSplitEnroll',source:'et',picks:{s_arik:{morning:true,afternoon:false}},planHash:et.planHash});
 const p=src(await call(store,{action:'classSplitPreview'}),'et');
 assert.deepEqual(p.stranded.map(s=>s.studentId).sort(),['s_benny','s_legacy']);
 await call(store,{action:'classSplitRetire',source:'et',planHash:p.planHash,allowNoClass:true,confirmText:'RETIRE ET'});
 assert.deepEqual(store.tree.b3Private.classSplits.et.retired.noClass.sort(),['s_benny','s_legacy']);
 assert.ok(cls(store,'et').members.s_benny,'they are still on the ET roster');
});

test('the staging copy is the same code, and both copies register the actions behind the existing owner gate',()=>{
 const read=f=>fs.readFileSync(path.join(ROOT_DIR,f),'utf8').replace(/\r\n/g,'\n');
 assert.equal(read('backend/functions-staging/class-split-core.cjs'),read('backend/functions/class-split-core.cjs'));
 for(const dir of ['backend/functions','backend/functions-staging']){
  const core=read(dir+'/student-management-core.cjs');
  const table=core.slice(core.indexOf('const BULK_ACTIONS={'),core.indexOf('};',core.indexOf('const BULK_ACTIONS={')));
  for(const a of ['classSplitPreview','classSplitCreate','classSplitEnroll','classSplitRetire','classSplitRestore'])assert.ok(table.includes(a+':classSplit.'+a),dir+' registers '+a);
  assert.ok(core.includes("if(Object.hasOwn(BULK_ACTIONS,body.action)){\n  if(!owner)fail(403,'Owner or administrator access required.');"),'the owner gate is unchanged');
 }
});

test('the card: every student has a morning and an afternoon tick; unticked boxes are not enrolled',async()=>{
 const {store,r}=await created(),et=src(r,'et');
 const html=UI.render(r,id=>({school_a:'School A'}[id]||id));
 for(const id of ['s_arik','s_benny','s_legacy'])for(const x of ['morning','afternoon'])assert.ok(html.includes('data-split-tick="'+id+':'+x+'" checked'),id+' '+x+' starts ticked');
 assert.ok(html.includes('data-split-enroll="et"')&&html.includes('data-split-enroll="wt"')&&html.includes('data-split-retire="et"'));
 assert.ok(html.includes('no teacher yet')&&html.includes('no tools turned on yet'),'warns that the new classes are empty');
 const ticks={'s_arik:morning':true,'s_arik:afternoon':true,'s_benny:morning':true,'s_benny:afternoon':false,'s_legacy:morning':false,'s_legacy:afternoon':false};
 const picks=UI.collectPicks(et,ticks);
 assert.deepEqual(picks,{s_arik:{morning:true,afternoon:true},s_benny:{morning:true,afternoon:false},s_legacy:{morning:false,afternoon:false}});
 assert.deepEqual(UI.countPicks(picks),{students:2,places:3});
 const out=await call(store,{action:'classSplitEnroll',source:'et',picks,planHash:et.planHash});
 const after=UI.render(out,id=>id);
 assert.ok(after.includes('already in')&&after.includes('data-split-tick="s_benny:afternoon" aria'),'the session Benny was left out of is shown unticked');
 // Before the classes exist the card offers to create them, with no enroll button yet.
 const first=UI.render(await call(site(),{action:'classSplitPreview'}),id=>'School A');
 assert.ok(first.includes('data-split-create')&&first.includes('will be created in School A')&&!first.includes('data-split-enroll'));
 assert.ok(!UI.render({sources:[{...et,name:'<img src=x>',students:[{studentId:'x',name:'<b>x</b>',morning:'add',afternoon:'add',tick:{morning:true,afternoon:true}}]}]},id=>id).includes('<img'),'names are escaped');
});

test('owner-admin.html has the card, and class-split.js never writes to the database itself',()=>{
 const page=fs.readFileSync(path.join(ROOT_DIR,'owner-admin.html'),'utf8'),ui=fs.readFileSync(path.join(ROOT_DIR,'class-split.js'),'utf8');
 for(const piece of ['id="classSplitCard"','id="classSplitOpen"','id="classSplitArea"','data-view="split"','["split","✂️","Split ET / WT"]','SECTIONS.filter(showSection)','src="class-split.js','FTTClassSplit.mount('])assert.ok(page.includes(piece),piece);
 assert.ok(!/db\.ref|firebase\.|\.set\(|\.update\(|fetch\(/.test(ui),'all writes go through funTorahManageStudents');
});
