'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {manageClassAccess}=require('../backend/functions/class-access-core.cjs');
const settings=()=>({classAccess:{et:{mode:'auto',lockWindows:Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].map(d=>[d,[]]))},wt:{mode:'locked',lockWindows:{}}},classGames:{et:{quiz:true},wt:{quiz:false}},classLockedGameOverride:{et:'',wt:'keep'},classLockedGameOverrideUntil:{et:{},wt:{keep:1}}});
function store({assigned=['et'],admin=null}={}){
 const data={settings:settings(),writes:[],classes:{et:{active:true},wt:{active:true}},teacher:{active:true,classIds:Object.fromEntries(assigned.map(id=>[id,true]))},admin};
 return {data,get:async p=>p==='b3Games/admins/u'?data.admin:p==='b3Games/workspaces/b3-2026/teachers/u'?data.teacher:data.classes[p.split('/').pop()],update:async u=>data.writes.push(u),updateSettings:async mutate=>{const next=mutate(structuredClone(data.settings));if(!next)return{committed:false};data.settings=next;return{committed:true}}};
}
const identity={uid:'u',email:'teacher@example.com',email_verified:true};
test('assigned teacher updates only ET mode and preserves WT and its schedule',async()=>{
 const s=store();await manageClassAccess(s,identity,{classId:'et',action:'mode',mode:'locked'});
 assert.equal(s.data.settings.classAccess.et.mode,'locked');assert.equal(s.data.settings.classAccess.wt.mode,'locked');assert.equal(s.data.settings.classGames.wt.quiz,false);
});
test('teacher cannot write an unassigned class even when requesting a valid class id',async()=>{
 const s=store();await assert.rejects(manageClassAccess(s,identity,{classId:'wt',action:'mode',mode:'open'}),{code:403});assert.equal(s.data.writes.length,0);
});
test('revoked or inactive assignment fails closed',async()=>{
 const s=store();s.data.teacher.active=false;
 await assert.rejects(manageClassAccess(s,identity,{classId:'et',action:'platform',mode:'locked'}),{code:403});
});
test('assigned teacher can set schedule and stars only for assigned class',async()=>{
 const s=store();const windows=Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].map(d=>[d,[{start:'08:30',end:'09:15'}]]));
 await manageClassAccess(s,identity,{classId:'et',action:'lockWindows',lockWindows:windows});
 await manageClassAccess(s,identity,{classId:'et',action:'star',gameId:'quiz',keepOpen:true,expiresAt:1234});
 assert.deepEqual(s.data.settings.classAccess.et.lockWindows,windows);assert.equal(s.data.settings.classLockedGameOverride.et,'quiz');assert.equal(s.data.settings.classLockedGameOverrideUntil.et.quiz,1234);assert.equal(s.data.settings.classLockedGameOverride.wt,'keep');
});
test('owner admin retains access across classes while platform writes remain class-scoped',async()=>{
 const s=store({assigned:['et'],admin:{active:true}});
 await manageClassAccess(s,identity,{classId:'wt',action:'platform',mode:'locked'});
 assert.deepEqual(s.data.writes,[{'b3Games/workspaces/b3-2026/classes/wt/access/mode':'locked','b3Games/workspaces/b3-2026/classes/wt/siteEnabled':false}]);
});
test('assigned teacher tool writes target only that class',async()=>{
 const s=store();await manageClassAccess(s,identity,{classId:'et',action:'grant',toolId:'halacha',enabled:true});
 assert.deepEqual(s.data.writes,[{'b3Games/workspaces/b3-2026/classes/et/toolGrants/halacha':true}]);
});
test('owner Teacher View is limited to classes in the current owner invitation',async()=>{
 const s=store({assigned:[],admin:{active:true}});
 const prior=s.get;
 s.get=async path=>path.endsWith('/teacherInvites/simcha5770_gmail_com')?{active:true,email:'simcha5770@gmail.com',classIds:{et:true,wt:true}}:prior(path);
 await manageClassAccess(s,{uid:'u',email:'simcha5770@gmail.com',email_verified:true},{classId:'wt',action:'mode',mode:'open',actorMode:'teacher'});
 await assert.rejects(manageClassAccess(s,{uid:'u',email:'simcha5770@gmail.com',email_verified:true},{classId:'other',action:'mode',mode:'open',actorMode:'teacher'}),{code:403});
});
test('invalid schedule and action are rejected without writes',async()=>{
 const s=store();await assert.rejects(manageClassAccess(s,identity,{classId:'et',action:'lockWindows',lockWindows:{mon:[{start:'99:99',end:'10:00'}]}}),{code:400});
 await assert.rejects(manageClassAccess(s,identity,{classId:'et',action:'wat'}),{code:400});assert.equal(s.data.writes.length,0);
});
test('Teacher View uses the shared full control panel and assignment-scoped class reads',()=>{
 const html=fs.readFileSync('admin.html','utf8');
 assert.match(html,/if\(access\.role!=="admin"\)[\s\S]*?const ids=\(access\.classIds\|\|\[\]\)/);
 assert.match(html,/panel\.style\.display="none";[\s\S]*?startOwnerControl\(\)/);
 assert.match(html,/auth\?\.authStateReady\)[\s\S]*?waitForTeacherAuth/);
 assert.doesNotMatch(html,/This class follows the B3 master schedule/);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length);new vm.Script(scripts.at(-1)[1],{filename:'admin.html'});
});
