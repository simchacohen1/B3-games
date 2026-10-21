// Regression tests for the Yiddish ET/WT unlock save bug (Oct 2026):
// changing WT from Steps 1–2 to a higher level failed with
// "Settings changed elsewhere. Reload before saving." because the Realtime
// Database transaction first runs with the locally cached value (null in Cloud
// Functions); the handler treated that as version 0 and aborted, so Firebase
// never checked the real server value.
const test=require('node:test'),assert=require('node:assert/strict');
const {makeService,defaults}=require('../backend/functions/yiddish-service/core.cjs');

// Behaves like firebase-admin's ref.transaction(): the first pass sees the
// local cache (null here, or a stale value), returning undefined aborts at
// once, and a write computed from the wrong value is rejected by the server
// and re-run with the real value.
function firebaseLikeTx(data,staleCache={}){
 return async(p,f)=>{
  let assumed=Object.hasOwn(staleCache,p)?structuredClone(staleCache[p]):null;
  for(let pass=0;pass<25;pass++){
   const out=f(structuredClone(assumed));
   if(out===undefined)return {committed:false};
   const actual=data[p]??null;
   if(JSON.stringify(assumed)===JSON.stringify(actual)){if(out===null)delete data[p];else data[p]=structuredClone(out);return {committed:true}}
   assumed=structuredClone(actual);
  }
  throw Error('maxretry');
 };
}
const STUDENTS={et_kid:'et',wt_kid:'wt'};
function setup({staleCache}={}){
 const config=defaults();
 config.version=10;config.sections.forEach(s=>s.verified=true);
 config.sections.forEach(s=>s.words=s.words.slice(0,8)); // 2 steps per section
 config.unlocked={et:2,wt:1};config.unlockedSteps={et:4,wt:2};
 const data={'yiddishPrivate/config':config,'b3Games/siteSettings':{classAccess:{et:{mode:'open'},wt:{mode:'open'}}}};
 for(const [id,cls] of Object.entries(STUDENTS)){
  data['b3Games/students/'+id+'/profile']={name:id,passcode:'1234',active:true};
  data['b3Games/students/'+id+'/memberships']={a:{workspaceId:'b3-2026',classId:cls,active:true}};
  const c='b3Games/workspaces/b3-2026/classes/'+cls;data[c]=data[c]||{active:true,members:{},toolGrants:{yiddish:true}};data[c].members[id]={name:id,active:true};
  data['yiddishPrivate/students/'+id]={words:{w1:{credits:2,rounds:3}},lastActive:123};
 }
 const store={get:async p=>structuredClone(data[p]??null),set:async(p,v)=>{data[p]=v},tx:firebaseLikeTx(data,staleCache)};
 const service=makeService(store,async t=>t==='owner'?{uid:'owner',email:'simcha5770@gmail.com',email_verified:true}:null);
 return {data,service,owner:a=>service({idToken:'owner',classId:'',...a})};
}
const snapshot=x=>structuredClone({sections:x.data['yiddishPrivate/config'].sections,et:x.data['yiddishPrivate/students/et_kid'],wt:x.data['yiddishPrivate/students/wt_kid']});

test('WT can be raised to Steps 1–5 and stays there (no false conflict)',async()=>{
 const x=setup(),before=snapshot(x);
 const loaded=await x.owner({action:'teacherLoad'});
 const r=await x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:loaded.config.unlockedSteps.wt});
 assert.equal(r.config.unlockedSteps.wt,5);
 const saved=x.data['yiddishPrivate/config'];
 assert.equal(saved.unlockedSteps.wt,5);assert.equal(saved.unlocked.wt,3);
 assert.equal(saved.unlockedSteps.et,4);assert.equal(saved.unlocked.et,2); // ET untouched
 assert.equal(saved.version,10); // lesson version unchanged: students' rounds keep working
 assert.deepEqual(snapshot(x),before); // sections and student progress preserved
 const reload=await x.owner({action:'teacherLoad'}); // refresh / sign back in
 assert.equal(reload.config.unlockedSteps.wt,5);
});

test('a stale cached value in the function instance cannot cause a false conflict',async()=>{
 const stale=defaults();stale.version=7;stale.unlocked={et:1,wt:1};stale.unlockedSteps={et:2,wt:2};
 const x=setup({staleCache:{'yiddishPrivate/config':stale}});
 await x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:2});
 assert.equal(x.data['yiddishPrivate/config'].unlockedSteps.wt,5);
 assert.equal(x.data['yiddishPrivate/config'].unlockedSteps.et,4);
});

test('lesson saves no longer fail on the transaction first pass',async()=>{
 const x=setup(),loaded=await x.owner({action:'teacherLoad'});
 const sections=structuredClone(loaded.config.sections);sections[0].end=295;sections[1].start=295;
 const r=await x.owner({action:'teacherSave',config:{version:loaded.config.version,sections}});
 assert.equal(r.config.version,11);assert.equal(r.config.sections[0].end,295);
 assert.deepEqual(r.config.unlockedSteps,{et:4,wt:2});
});

test('editing ET does not reset WT, and editing WT does not reset ET',async()=>{
 const x=setup();
 await x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:2});
 // ET session that loaded before the WT change still only sends ET.
 await x.owner({action:'teacherSetUnlock',track:'et',steps:3,expectedSteps:4});
 const c=x.data['yiddishPrivate/config'];
 assert.deepEqual(c.unlockedSteps,{et:3,wt:5});assert.deepEqual(c.unlocked,{et:2,wt:3});
});

test('simultaneous sessions changing the same track get a clear conflict instead of overwriting',async()=>{
 const x=setup();
 await x.owner({action:'teacherSetUnlock',track:'wt',steps:3,expectedSteps:2}); // session B
 await assert.rejects(x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:2}),e=>e.code===409&&e.details.current===3&&e.details.track==='wt'); // session A, stale
 assert.equal(x.data['yiddishPrivate/config'].unlockedSteps.wt,3);
 // Saving the same value twice (e.g. a network retry) is fine.
 await x.owner({action:'teacherSetUnlock',track:'wt',steps:3,expectedSteps:2});
});

test('stale lesson saves are rejected without changing anything',async()=>{
 const x=setup(),loaded=await x.owner({action:'teacherLoad'});
 await x.owner({action:'teacherSave',config:{version:loaded.config.version,sections:loaded.config.sections}});
 const before=structuredClone(x.data['yiddishPrivate/config']);
 await assert.rejects(x.owner({action:'teacherSave',config:{version:loaded.config.version,sections:loaded.config.sections}}),e=>e.code===409);
 assert.deepEqual(x.data['yiddishPrivate/config'],before);
});

test('pages from before the fix cannot overwrite unlock levels with stale values',async()=>{
 const x=setup(),loaded=await x.owner({action:'teacherLoad'});
 await x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:2});
 // Old page still shows WT=2 and sends both tracks with every save.
 await assert.rejects(x.owner({action:'teacherSave',config:loaded.config}),/out of date/);
 assert.equal(x.data['yiddishPrivate/config'].unlockedSteps.wt,5);
});

test('unlocking an unchecked section is refused and nothing changes',async()=>{
 const x=setup();x.data['yiddishPrivate/config'].sections[2].verified=false;
 await assert.rejects(x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:2}),/Check the audio/);
 assert.equal(x.data['yiddishPrivate/config'].unlockedSteps.wt,2);
 x.data['yiddishPrivate/config'].sections[2].verified=true;
 await assert.rejects(x.owner({action:'teacherSetUnlock',track:'xx',steps:1}),/ET or WT/);
 await assert.rejects(x.owner({action:'teacherSetUnlock',track:'wt',steps:99,expectedSteps:2}),/valid number/);
});

test('students receive their own track\'s unlocked steps',async()=>{
 const x=setup();
 await x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:2});
 const login=async id=>(await x.service({action:'login',studentId:id,classId:STUDENTS[id],pin:'1234'})).token;
 const wt=await login('wt_kid'),et=await login('et_kid');
 const st=await x.service({action:'status',token:wt});
 assert.equal(st.config.unlockedSteps.wt,5);
 assert.ok((await x.service({action:'start',token:wt,group:2,part:0})).round); // step 5 open
 await assert.rejects(x.service({action:'start',token:wt,group:2,part:1}),/not open yet/); // step 6 closed
 // ET is still Steps 1–4: section 3 is closed for ET.
 await assert.rejects(x.service({action:'start',token:et,group:2,part:0}),/not open yet/);
 assert.ok((await x.service({action:'start',token:et,group:1,part:1})).round);
});

test('a WT unlock change does not interrupt a student round already in progress',async()=>{
 const x=setup();
 const token=(await x.service({action:'login',studentId:'et_kid',classId:'et',pin:'1234'})).token;
 const {round}=await x.service({action:'start',token,group:0,part:0});
 await x.owner({action:'teacherSetUnlock',track:'wt',steps:5,expectedSteps:2});
 const r=await x.service({action:'answer',token,roundId:round.id,index:0,answer:round.question.wordId,requestId:'12345678-1234-1234-1234-123456789012'});
 assert.equal(r.round.index,1);
});
