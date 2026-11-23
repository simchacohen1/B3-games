'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {manageClassAccess,CLASS_TOOL_GRANTS}=require('../backend/functions/class-access-core.cjs');
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
 assert.deepEqual(s.data.writes,[{'b3Games/workspaces/b3-2026/classes/wt/access/mode':'locked','b3Games/workspaces/b3-2026/classes/wt/siteEnabled':false,'b3Games/workspaces/b3-2026/classes/wt/access/openUntil':null}]);
});
test('teacher grant allowlist matches every classroom tool and excludes owner-only keys',async()=>{
 const expected=["sefer-hamitzvos","halacha","yiddish","posuk-practice-scroll","rashi-letters","gematria","shorashim","chazara","game-show","student-rewards","weekly-quiz","multiplayer-center","homework","gallery","tag","davening","chavrusa","name-picker","daily-checklist","class-pointer","sync-to-nigri"];
 assert.deepEqual([...CLASS_TOOL_GRANTS].sort(),expected.slice().sort());
 for(const toolId of CLASS_TOOL_GRANTS){
  const s=store();await manageClassAccess(s,identity,{classId:'et',action:'grant',toolId,enabled:true});
  assert.deepEqual(s.data.writes,[{["b3Games/workspaces/b3-2026/classes/et/toolGrants/"+toolId]:true}]);
 }
 for(const toolId of ['class-dashboard','owner-admin','school-settings','unknown-tool']){
  const s=store();await assert.rejects(manageClassAccess(s,identity,{classId:'et',action:'grant',toolId,enabled:true}),{code:400});
  assert.equal(s.data.writes.length,0,`refused grant ${toolId} must not write`);
 }
});
test('teacher cannot change grants for an unassigned class',async()=>{
 const s=store();await assert.rejects(manageClassAccess(s,identity,{classId:'wt',action:'grant',toolId:'posuk-practice-scroll',enabled:true}),{code:403});
 assert.equal(s.data.writes.length,0);
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
test('timed unlock sets openUntil for the assigned class only, and choosing a mode ends it',async()=>{
 const s=store();s.data.settings.classAccess={et:{mode:'locked',lockWindows:{}},wt:{mode:'locked',lockWindows:{}}};
 const now=1000000;
 await manageClassAccess(s,identity,{classId:'et',action:'timedOpen',minutes:15},now);
 assert.equal(s.data.settings.classAccess.et.openUntil,now+15*60000);
 assert.equal(s.data.settings.classAccess.wt.openUntil,undefined);
 await manageClassAccess(s,identity,{classId:'et',action:'mode',mode:'locked'},now);
 assert.equal(s.data.settings.classAccess.et.openUntil,undefined);
 await manageClassAccess(s,identity,{classId:'et',action:'timedOpen',minutes:30},now);
 await manageClassAccess(s,identity,{classId:'et',action:'timedOpen',minutes:0},now);
 assert.equal(s.data.settings.classAccess.et.openUntil,undefined);
 await assert.rejects(manageClassAccess(s,identity,{classId:'et',action:'timedOpen',minutes:9999},now),{code:400});
 await assert.rejects(manageClassAccess(s,identity,{classId:'wt',action:'timedOpen',minutes:15},now),{code:403});
});
test('timed unlock opens a locked class until it runs out (server rules, game gate, browser rules)',()=>{
 const policy=require('../backend/functions/multiplayer-lock-policy.cjs');
 const t=new Date('2026-11-23T16:00:00Z');
 const open=(until)=>policy.allowsMultiplayer({actorRole:'student',classId:'et',studentId:'x',settings:{siteEnabled:true,classAccess:{et:{mode:'locked',openUntil:until}}},date:t});
 assert.equal(open(undefined),false);
 assert.equal(open(t.getTime()+60000),true,'timed unlock opens a manually locked class');
 assert.equal(open(t.getTime()-60000),false,'and it locks again when the time is up');
 assert.match(fs.readFileSync(__dirname+'/../game-gate.js','utf8'),/Number\(access\.openUntil\) > Date\.now\(\)/);
 assert.match(fs.readFileSync(__dirname+'/../site-settings.js','utf8'),/openUntil > \(date instanceof Date/);
});
test('platformStar saves and clears a star under access/stars, and opening the class clears every star',async()=>{
 const s=store(),now=1000000,root='b3Games/workspaces/b3-2026/classes/et/access/';
 await manageClassAccess(s,identity,{classId:'et',action:'platformStar',toolId:'halacha',keepOpen:true,expiresAt:now+3600000},now);
 assert.deepEqual(s.data.writes.at(-1),{[root+'stars/halacha']:now+3600000});
 await manageClassAccess(s,identity,{classId:'et',action:'platformStar',toolId:'halacha',keepOpen:false},now);
 assert.deepEqual(s.data.writes.at(-1),{[root+'stars/halacha']:null});
 await assert.rejects(manageClassAccess(s,identity,{classId:'et',action:'platformStar',toolId:'owner-admin',keepOpen:true},now),{code:400});
 await manageClassAccess(s,identity,{classId:'et',action:'platform',mode:'open'},now);
 assert.equal(s.data.writes.at(-1)[root+'stars'],null);
 await manageClassAccess(s,identity,{classId:'et',action:'platform',mode:'locked'},now);
 assert.equal(Object.hasOwn(s.data.writes.at(-1),root+'stars'),false,'locking keeps the stars');
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
