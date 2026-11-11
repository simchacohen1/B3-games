// Issue #667: sign-in must not download the whole b3Games/students tree (several MB
// of Halacha work and progress). These tests use a tracing in-memory database and a
// `keys` function standing in for the REST shallow read used in production.
const test=require('node:test'),assert=require('node:assert/strict');
const {studentAuth}=require('../backend/functions/student-auth-core.cjs');
const {resolveStudent}=require('../backend/functions/student-login-core.cjs');
const {loadStudentProfiles}=require('../backend/functions/student-directory.cjs');

const BIG='x'.repeat(50000);
function db(tree,{withKeys=true,keysFail=false}={}){
 const parts=p=>p.split('/').filter(Boolean);
 const reads=[];
 const get=async p=>{reads.push(p);return parts(p).reduce((o,k)=>o?.[k],tree)??null;};
 const set=(p,v)=>{const k=parts(p),last=k.pop();let o=tree;for(const x of k)o=o[x]??=( {} );if(v===null)delete o[last];else o[last]=structuredClone(v)};
 const store={tree,reads,get,update:async u=>{for(const [p,v] of Object.entries(u))set(p,v)},tx:async(p,f)=>{const v=f(structuredClone(await get(p)));if(v!==undefined)set(p,v);return {committed:v!==undefined,snapshot:{val:()=>v}}}};
 if(withKeys)store.keys=async p=>{if(keysFail)throw new Error('offline');return Object.keys(parts(p).reduce((o,k)=>o?.[k],tree)||{});};
 return store;
}
const seed=opts=>db({
 b3Games:{students:{
  moshe:{profile:{name:'Moshe Levi',active:true},halacha:{work:BIG},memberships:{m:{workspaceId:'b3-2026',classId:'et',active:true}}},
  dovid:{profile:{name:'Dovid',active:true},halacha:{work:BIG}},
  twin_a:{profile:{name:'Twin',active:true}},
  twin_b:{profile:{name:'Twin',active:true}},
  off:{profile:{name:'Blocked Boy',active:false}}
 },workspaces:{'b3-2026':{classes:{et:{name:'ET',active:true,members:{moshe:{active:true},dovid:{active:true}}}}}}},
 posukPractice:{allowedStudents:{dovid:{name:'Dovid',passcode:'3333'},yossi:{name:'Yossi'}}},
 b3Private:{passcodes:{moshe:{passcode:'1111'},twin_a:{passcode:'4444'},twin_b:{passcode:'4444'},off:{passcode:'2222'}}}
},opts);
const fullReads=d=>d.reads.filter(p=>p==='b3Games/students'||/^b3Games\/students\/[^/]+$/.test(p));
const login=(d,name,pin,extra={})=>studentAuth(d,{action:'login',name,pin,...extra},'1.2.3.4',1000);

test('name sign-in reads only profiles, never whole student records',async()=>{
 const d=seed();
 const r=await login(d,'moshe levi','1111');
 assert.equal(r.id,'moshe');assert.equal(r.classId,'et');
 assert.deepEqual(fullReads(d),[]);
 assert.ok(!d.reads.some(p=>p.includes('halacha')));
});
test('same results as before: legacy, duplicates, blocked, wrong passcode',async()=>{
 assert.equal((await login(seed(),'Dovid','3333')).id,'dovid');
 assert.equal((await login(seed(),'Yossi','5770')).id,'yossi');
 await assert.rejects(login(seed(),'Twin','4444'),{code:409});
 await assert.rejects(login(seed(),'Blocked Boy','2222'),{code:401});
 await assert.rejects(login(seed(),'Moshe Levi','0000'),{code:401});
});
test('choosePin still refuses a PIN another student uses, without full reads',async()=>{
 const d=seed();
 await assert.rejects(login(d,'Moshe Levi','1111',{action:'choosePin',newPin:'4444',confirmPin:'4444'}),{code:409});
 assert.deepEqual(fullReads(d),[]);
 const r=await login(d,'Moshe Levi','1111',{action:'choosePin',newPin:'8080',confirmPin:'8080'});
 assert.equal(r.id,'moshe');assert.equal(d.tree.b3Private.passcodes.moshe.passcode,'8080');
});
test('if the shallow read fails, sign-in falls back to the full read and still works',async()=>{
 const d=seed({keysFail:true});
 assert.equal((await login(d,'Moshe Levi','1111')).id,'moshe');
 assert.ok(d.reads.includes('b3Games/students'));
});
test('resolveStudent with a known id never reads the student list or old list',async()=>{
 const d=seed();
 const r=await resolveStudent(d.get,{name:'Moshe Levi',pin:'1111',b3StudentId:'moshe'});
 assert.equal(r.id,'moshe');assert.equal(r.classId,'et');
 assert.deepEqual(fullReads(d),[]);
 assert.ok(!d.reads.includes('posukPractice/allowedStudents'));
});
test('resolveStudent by name uses profiles only and keeps duplicate protection',async()=>{
 const d=seed();d.get.keys=d.keys;
 assert.equal((await resolveStudent(d.get,{name:'Moshe Levi',pin:'1111'})).id,'moshe');
 assert.deepEqual(fullReads(d),[]);
 await assert.rejects(resolveStudent(d.get,{name:'Twin',pin:'4444'}),{code:409});
});
test('loadStudentProfiles returns the same profiles either way',async()=>{
 const a=seed(),b=seed({withKeys:false});
 const viaKeys=await loadStudentProfiles(a.get,a.keys),viaFull=await loadStudentProfiles(b.get);
 assert.deepEqual(viaKeys.profiles,viaFull.profiles);
 assert.deepEqual(viaKeys.ids.sort(),viaFull.ids.sort());
});
test('bytes read for one name sign-in drop by more than 90%',async()=>{
 const size=async(d)=>{let n=0;const g=d.get;d.get=async p=>{const v=await g(p);n+=Buffer.byteLength(JSON.stringify(v));return v;};await login(d,'Moshe Levi','1111');return n;};
 const before=await size(seed({withKeys:false})),after=await size(seed());
 assert.ok(after<before*0.1,`before ${before} B, after ${after} B`);
});
