const test=require('node:test'),assert=require('node:assert/strict');
const {studentAuth}=require('../backend/functions/student-auth-core.cjs');
const {manageStudents}=require('../backend/functions/student-management-core.cjs');
const {readPasscode}=require('../backend/functions/student-passcodes.cjs');

// A tiny in-memory database: paths resolve inside nested objects like RTDB.
function db(tree){
 const parts=p=>p.split('/').filter(Boolean);
 const get=async p=>parts(p).reduce((o,k)=>o?.[k],tree)??null;
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??=( {} );if(v===null)delete o[last];else o[last]=structuredClone(v)};
 return {tree,get,update:async u=>{for(const [p,v] of Object.entries(u))set(p,v)},tx:async(p,f)=>{const v=f(structuredClone(await get(p)));if(v!==undefined)set(p,v)}};
}
const seed=()=>db({
 b3Games:{students:{
  moshe:{profile:{name:'Moshe Levi',passcode:'1111',active:true}},
  dovid:{profile:{name:'Dovid',active:true}},
  off:{profile:{name:'Blocked Boy',passcode:'2222',active:false}}
 },workspaces:{'b3-2026':{classes:{et:{name:'ET',active:true,members:{moshe:{active:true,passcode:'1111'},dovid:{active:true}}}}}}},
 posukPractice:{allowedStudents:{dovid:{name:'Dovid',passcode:'3333'},yossi:{name:'Yossi'}}}
});
const login=(d,name,pin)=>studentAuth(d,{action:'login',name,pin},'1.2.3.4',1000);

test('central passcode signs in and is moved to private storage',async()=>{const d=seed();const r=await login(d,'moshe levi','1111');assert.equal(r.id,'moshe');assert.equal(d.tree.b3Private.passcodes.moshe.passcode,'1111');assert.equal(d.tree.b3Games.students.moshe.profile.passcode,undefined)});
test('once private, the old public passcode no longer works',async()=>{const d=seed();d.tree.b3Private={passcodes:{moshe:{passcode:'7777'}}};await assert.rejects(login(d,'Moshe Levi','1111'),{code:401});assert.equal((await login(d,'Moshe Levi','7777')).id,'moshe')});
test('legacy passcode works when the central profile has none',async()=>{const d=seed();assert.equal((await login(d,'Dovid','3333')).id,'dovid');assert.equal(d.tree.b3Private.passcodes.dovid.passcode,'3333')});
test('legacy-only student keeps the historic 5770 default and gets a profile',async()=>{const d=seed();const r=await login(d,'Yossi','5770');assert.equal(r.id,'yossi');assert.equal(d.tree.b3Games.students.yossi.profile.name,'Yossi')});
test('wrong passcode, blocked student and duplicate matches are refused',async()=>{const d=seed();await assert.rejects(login(d,'Moshe Levi','0000'),{code:401});await assert.rejects(login(d,'Blocked Boy','2222'),{code:401});d.tree.b3Games.students.twin={profile:{name:'Moshe Levi',passcode:'1111',active:true}};await assert.rejects(login(d,'Moshe Levi','1111'),{code:409})});
test('login responses never include a passcode',async()=>{const d=seed();assert.equal(JSON.stringify(await login(d,'Moshe Levi','1111')).includes('1111'),false)});
test('verify accepts the current passcode and rejects a changed one',async()=>{const d=seed();assert.ok((await studentAuth(d,{action:'verify',studentId:'moshe',pin:'1111'})).ok);d.tree.b3Private={passcodes:{moshe:{passcode:'8888'}}};await assert.rejects(studentAuth(d,{action:'verify',studentId:'moshe',pin:'1111'}),{code:401})});
test('too many sign-in attempts are slowed down',async()=>{const d=seed();for(let i=0;i<40;i++)await login(d,'Moshe Levi','0000').catch(()=>{});await assert.rejects(login(d,'Moshe Levi','1111'),{code:429})});

const owner={uid:'o',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const teacher={uid:'t',email:'t@x',email_verified:true,firebase:{sign_in_provider:'google.com'}};
test('owner migration copies passcodes privately, then clears every public copy',async()=>{const d=seed();
 const first=await manageStudents(d,owner,{action:'migratePasscodes',deletePublic:false},5);assert.equal(first.copied,3);assert.equal(d.tree.b3Games.students.moshe.profile.passcode,'1111');
 await manageStudents(d,owner,{action:'migratePasscodes',deletePublic:true},6);
 assert.equal(d.tree.b3Private.passcodes.moshe.passcode,'1111');assert.equal(d.tree.b3Private.passcodes.dovid.passcode,'3333');
 assert.equal(JSON.stringify(d.tree.b3Games).includes('"passcode"'),false);assert.equal(JSON.stringify(d.tree.posukPractice).includes('"passcode"'),false);
 assert.equal((await login(d,'Moshe Levi','1111')).id,'moshe');assert.equal((await login(d,'Dovid','3333')).id,'dovid');assert.equal((await login(d,'Yossi','5770')).id,'yossi')});
test('only the owner can run the migration',async()=>{const d=seed();await assert.rejects(manageStudents(d,teacher,{action:'migratePasscodes'}),{code:403})});
test('teachers list passcodes only for their own class; owner can list all',async()=>{const d=seed();d.tree.b3Games.workspaces['b3-2026'].teachers={t:{active:true,classIds:{et:true}}};
 const mine=await manageStudents(d,teacher,{action:'list',classId:'et'});assert.deepEqual(mine.passcodes,{moshe:'1111',dovid:'3333'});
 d.tree.b3Games.workspaces['b3-2026'].classes.wt={active:true,members:{}};await assert.rejects(manageStudents(d,teacher,{action:'list',classId:'wt'}),{code:403});
 const all=await manageStudents(d,owner,{action:'list',all:true});assert.equal(all.passcodes.yossi,'5770')});
test('creating a student stores the passcode privately only',async()=>{const d=seed();const r=await manageStudents(d,owner,{action:'create',classId:'et',name:'New Boy',passcode:'4444'});assert.equal(d.tree.b3Private.passcodes[r.studentId].passcode,'4444');assert.equal(d.tree.b3Games.students[r.studentId].profile.passcode,undefined);assert.equal((await readPasscode(d.get,r.studentId)).passcode,'4444')});
test('an active site administrator can run the owner migration',async()=>{const d=seed();d.tree.b3Games.admins={t:{active:true}};const r=await manageStudents(d,teacher,{action:'migratePasscodes',deletePublic:true});assert.ok(r.ok);d.tree.b3Games.admins.t.active=false;await assert.rejects(manageStudents(d,teacher,{action:'migratePasscodes'}),{code:403})});
