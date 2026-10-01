const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function settings(data,user){
 const writes=[];
 const db={ref:path=>({once:async()=>({val:()=>data[path]??null}),set:async value=>writes.push([path,value]),update:async value=>writes.push([path,value])})};
 const firebase={apps:[{}],database:()=>db,auth:()=>({currentUser:user})};
 const window={firebase,B3_FIREBASE_CONFIG:Object.fromEntries(['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'].map(k=>[k,'test']))};
 const ctx={window,firebase,localStorage:{getItem:()=>null,setItem(){}},console,Intl,Date};
 const source=fs.readFileSync('site-settings.js','utf8').replace('  window.B3SiteSettings = {','  window.readAccessForTest=readUserAccess;window.migrateForTest=migrateWorkspaceData;\n  window.B3SiteSettings = {');
 vm.runInNewContext(source,ctx);return {window,writes};
}
const teacher={uid:'regular',email:'teacher@example.test',getIdToken:async()=>''};
test('teacher record cannot confer admin role or wildcard class access',async()=>{const t=settings({'b3Games/workspaces/b3-2026/teachers/regular':{active:true,role:'admin',classIds:{own:true,'*':true,other:false}}},teacher);const a=await t.window.readAccessForTest(teacher);assert.equal(a.role,'teacher');assert.deepEqual(Array.from(a.classIds),['own'])});
test('disabled teacher cannot regain access through an old invitation',async()=>{const t=settings({'b3Games/workspaces/b3-2026/teachers/regular':{active:false},'b3Games/workspaces/b3-2026/teacherInvites':{old:{email:teacher.email,active:true}}},teacher);assert.equal((await t.window.readAccessForTest(teacher)).authorized,false)});
test('ordinary teacher cannot save global activity settings',async()=>{const t=settings({'b3Games/workspaces/b3-2026/teachers/regular':{active:true,classIds:{own:true}}},teacher);await assert.rejects(t.window.B3SiteSettings.updateGameEnabled('yiddish',false),/administrator/);assert.equal(t.writes.length,0)});
test('owner retains administrator access',async()=>{const owner={...teacher,email:'simcha5770@gmail.com'};const t=settings({},owner);assert.equal((await t.window.readAccessForTest(owner)).role,'admin')});

test('repeated owner migration does not erase passcodes or reactivate blocked memberships',async()=>{
 const owner={...teacher,uid:'owner',email:'simcha5770@gmail.com'};
 const central={child:{profile:{name:'Child',passcode:'9876',active:false},memberships:{'b3-2026_et':{workspaceId:'b3-2026',classId:'et',active:false}}}};
 const t=settings({'posukPractice/allowedStudents':{child:{name:'Child',classId:'et',active:true}},'b3Games/students':central,'b3Games/workspaces/b3-2026/classes':{et:{members:{child:{active:false}}}}},owner);
 const db={ref:path=>({once:async()=>({val:()=>({'posukPractice/allowedStudents':{child:{name:'Child',classId:'et'}},'b3Games/students':central,'b3Games/workspaces/b3-2026/classes':{et:{members:{child:{active:false}}}}})[path]??null}),update:async v=>t.writes.push([path,v])})};
 await t.window.migrateForTest({db},owner);
 const updates=t.writes[0][1];assert.equal(updates['b3Games/students/child/profile'],undefined);assert.equal(updates['b3Games/students/child/memberships/b3-2026_et'],undefined);assert.equal(updates['b3Games/workspaces/b3-2026/classes/et/members/child'],undefined);
});
