const test=require('node:test'),assert=require('node:assert/strict');
const {makeService,defaults}=require('../backend/functions/yiddish-service/core.cjs');
const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
function setup(classId='alpha',{storyGranted=true}={}){
 const profile={name:'Same Name',passcode:'1234',active:true};
 const config=defaults();config.unlocked=classId==='et'?{et:1,wt:0}:{[classId]:1};config.sections[0].verified=true;
 const data={['b3Games/students/student_unique/profile']:profile,['b3Games/students/student_unique/memberships']:{a:{workspaceId:'b3-2026',classId,active:true}},['b3Games/workspaces/b3-2026/classes/'+classId]:{active:true,members:{student_unique:{name:'Same Name',active:true}},toolGrants:{yiddish:true}},[classId==='et'?'yiddishPrivate/config':'yiddishPrivate/classes/b3-2026/'+classId+'/config']:config,'b3Games/siteSettings':{classAccess:{et:{mode:'open'}}}};
 if(storyGranted&&!['et','wt'].includes(classId))data['b3Games/workspaces/b3-2026/contentGrants/'+classId+'/yiddishWineMerchant']=true;
 const store={get:async p=>data[p]??null,set:async(p,v)=>data[p]=v,tx:async(p,f)=>{const v=f(structuredClone(data[p]??null));if(v!==undefined)data[p]=v},update:async changes=>Object.assign(data,changes)};
 return {data,store,service:makeService(store,async token=>token==='owner'?{uid:'owner',email:'simcha5770@gmail.com',email_verified:true}:{uid:'teacher',email:'teacher@test',email_verified:true})};
}
async function login(x,classId='alpha',pin='1234'){return x.service({action:'login',studentId:'student_unique',classId,pin})}
test('Yiddish accepts central individual passcodes and rejects old shared PIN',async()=>{const x=setup();await assert.rejects(login(x,'alpha','5770'),/individual passcode/);assert.ok((await login(x)).token)});
test('blocked student is denied with an existing Yiddish session',async()=>{const x=setup(),{token}=await login(x);x.data['b3Games/students/student_unique/profile'].active=false;await assert.rejects(x.service({action:'status',token}),/turned off/)});
test('changed passcode invalidates a previously issued session',async()=>{const x=setup(),{token}=await login(x);x.data['b3Games/students/student_unique/profile'].passcode='9999';await assert.rejects(x.service({action:'status',token}),/passcode changed/)});
test('class tool revocation blocks Yiddish sessions',async()=>{const x=setup(),{token}=await login(x);x.data['b3Games/workspaces/b3-2026/classes/alpha'].toolGrants.yiddish=false;await assert.rejects(x.service({action:'status',token}),/closed/)});

test('individual Yiddish restriction blocks existing sessions and can be restored',async()=>{
 for(const classId of ['alpha','et']){
  const x=setup(classId),{token}=await login(x,classId),member=x.data['b3Games/workspaces/b3-2026/classes/'+classId].members.student_unique;
  member.toolAccess={yiddish:false};await assert.rejects(x.service({action:'status',token}),/turned off Yiddish/);
  delete member.toolAccess.yiddish;await x.service({action:'status',token});
 }
});
test('Yiddish rounds support retried answers without advancing twice',async()=>{const x=setup(),{token}=await login(x),{round}=await x.service({action:'start',token,group:0});const body={action:'answer',token,roundId:round.id,index:0,answer:round.question.wordId,requestId:'12345678-1234-1234-1234-123456789012'};const first=await x.service(body),retry=await x.service(body);assert.equal(first.round.index,1);assert.deepEqual(retry,first);assert.ok(x.data['yiddishPrivate/classes/b3-2026/alpha/students/student_unique']);assert.equal(x.data['yiddishPrivate/students/student_unique'],undefined)});
test('B3 retains its legacy progress path with individual passcodes',async()=>{const x=setup('et'),{token}=await login(x,'et');await x.service({action:'start',token,group:0});assert.ok(x.data['yiddishPrivate/students/student_unique'])});
test('teacher cannot load another class Yiddish progress',async()=>{const x=setup();x.data['b3Games/workspaces/b3-2026/teachers/teacher']={active:true,classIds:{beta:true}};await assert.rejects(x.service({action:'teacherLoad',idToken:'teacher',classId:'alpha'}),/not assigned/)});
test('teacher claim preserves class assignments and records UID metadata',async()=>{const x=setup();x.data['b3Games/workspaces/b3-2026/teacherInvites']={inv:{email:'teacher@test',name:'Teacher',active:true,role:'admin',classIds:{alpha:true,'*':true}}};const r=await claimTeacher(x.store,{uid:'new',email:'teacher@test',email_verified:true,firebase:{sign_in_provider:'google.com'}});assert.equal(r.role,'teacher');assert.deepEqual(r.classIds,['alpha']);assert.equal(x.data['b3Games/workspaces/b3-2026/teachers/new'].inviteId,'inv');assert.equal(x.data['b3Games/workspaces/b3-2026/teacherInvites/inv/claimedUid'],'new')});
test('teacher claim rejects unverified or disabled accounts',async()=>{const x=setup();await assert.rejects(claimTeacher(x.store,{uid:'new',email:'teacher@test',email_verified:false}),/verified/);x.data['b3Games/workspaces/b3-2026/teachers/new']={active:false};await assert.rejects(claimTeacher(x.store,{uid:'new',email:'teacher@test',email_verified:true,firebase:{sign_in_provider:'google.com'}}),/disabled/)});

test('Yiddish rejects an explicitly selected class outside the membership',async()=>{const x=setup();await assert.rejects(login(x,'beta'),/Choose an active class/)});
test('Yiddish keeps a previous round usable after a second tab starts another',async()=>{const x=setup(),{token}=await login(x);const first=await x.service({action:'start',token,group:0});await x.service({action:'start',token,group:0});const answer=await x.service({action:'answer',token,roundId:first.round.id,index:0,answer:first.round.question.wordId,requestId:'12345678-1234-1234-1234-123456789012'});assert.equal(answer.round.index,1);assert.equal(answer.round.id,first.round.id)});
test('Yiddish accepts legacy persisted rounds missing result bookkeeping',async()=>{const x=setup('et'),{token}=await login(x,'et'),{round}=await x.service({action:'start',token,group:0});const saved=x.data['yiddishPrivate/students/student_unique'];delete saved.round.results;delete saved.round.responses;const answer=await x.service({action:'answer',token,roundId:round.id,index:0,answer:round.question.wordId,requestId:'12345678-1234-1234-1234-123456789012'});assert.equal(answer.round.index,1)});
function legacySetup(oldRow){const x=setup('et');delete x.data['b3Games/students/student_unique/profile'].passcode;if(oldRow)x.data['posukPractice/allowedStudents/student_unique']=oldRow;return x}
test('ET/WT student without a central passcode can use their individual legacy passcode',async()=>{const x=legacySetup({name:'Same Name',passcode:'4321'});await assert.rejects(login(x,'et','1234'),/individual passcode/);const {token}=await login(x,'et','4321');assert.ok((await x.service({action:'status',token})).student)});
test('legacy fallback never accepts the shared 5770 default or a missing/blocked legacy row',async()=>{for(const row of [{name:'Same Name'},{name:'Same Name',passcode:'5770'},{name:'Same Name',passcode:'4321',active:false},null]){const x=legacySetup(row);await assert.rejects(login(x,'et',row?.passcode||'5770'),/individual passcode/)}});
test('legacy fallback does not apply to new classes',async()=>{const x=setup('alpha');delete x.data['b3Games/students/student_unique/profile'].passcode;x.data['posukPractice/allowedStudents/student_unique']={name:'Same Name',passcode:'4321'};await assert.rejects(login(x,'alpha','4321'),/individual passcode/)});
test('setting a central passcode replaces the legacy one and ends old sessions',async()=>{const x=legacySetup({name:'Same Name',passcode:'4321'}),{token}=await login(x,'et','4321');x.data['b3Games/students/student_unique/profile'].passcode='8888';await assert.rejects(x.service({action:'status',token}),/passcode changed/);await assert.rejects(login(x,'et','4321'),/individual passcode/);assert.ok((await login(x,'et','8888')).token)});
test('Yiddish uses the private passcode when one exists',async()=>{const x=setup();x.data['b3Private/passcodes/student_unique']={passcode:'6543'};await assert.rejects(login(x,'alpha','1234'),/individual passcode/);assert.ok((await login(x,'alpha','6543')).token)});

test('a new class without the admin story grant sees nothing open and cannot practice',async()=>{const x=setup('alpha',{storyGranted:false}),{token}=await login(x);const st=await x.service({action:'status',token});assert.equal(st.noStory,true);assert.equal(st.config.unlocked.alpha,0);assert.deepEqual(st.progress,{});await assert.rejects(x.service({action:'start',token,group:0}),/does not have a Yiddish story/)});
test('teacher of a class without the story grant cannot save lesson settings',async()=>{const x=setup('alpha',{storyGranted:false});x.data['b3Games/workspaces/b3-2026/teachers/teacher']={active:true,classIds:{alpha:true}};const r=await x.service({action:'teacherLoad',idToken:'t',classId:'alpha'});assert.equal(r.storyGranted,false);await assert.rejects(x.service({action:'teacherSave',idToken:'t',classId:'alpha',config:r.config}),/has not given this class/)});
test('admin story grant opens Yiddish for a new class',async()=>{const x=setup('alpha'),{token}=await login(x);const st=await x.service({action:'status',token});assert.equal(st.noStory,undefined);assert.ok((await x.service({action:'start',token,group:0})).round)});
test('B3 classes keep the story without any grant',async()=>{const x=setup('et',{storyGranted:false}),{token}=await login(x,'et');const st=await x.service({action:'status',token});assert.equal(st.noStory,undefined)});

// All persistence checks below use the in-memory store and synthetic identities.
function unlockSetup(){const x=setup('et');const c=x.data['yiddishPrivate/config'];c.sections.forEach(s=>s.verified=true);c.unlocked={et:1,wt:1};c.unlockedSteps={et:2,wt:2};return x}
const setUnlock=(x,track,steps,expectedSteps)=>x.service({action:'teacherSetUnlock',idToken:'owner',classId:track,track,steps,expectedSteps});
test('WT levels 4 and 5 survive fresh teacher sessions and leave ET and progress unchanged',async()=>{
 const x=unlockSetup();x.data['yiddishPrivate/students/test_wt']={words:{saved:{credits:2}}};
 const progress=structuredClone(x.data['yiddishPrivate/students/test_wt']);
 for(const [steps,previous] of [[4,2],[5,4]]){
  await setUnlock(x,'wt',steps,previous);
  const reopened=makeService(x.store,async()=>({email:'simcha5770@gmail.com',email_verified:true}));
  for(const classId of ['et','wt','et','wt']){
   const loaded=await reopened({action:'teacherLoad',idToken:'new-session',classId});
   assert.equal(loaded.config.unlockedSteps.wt,steps);assert.equal(loaded.config.unlockedSteps.et,2);
  }
  assert.deepEqual(x.data['yiddishPrivate/students/test_wt'],progress);
 }
});
test('independent ET/WT edits preserve each other; stale same-class edits fail',async()=>{
 const x=unlockSetup();await setUnlock(x,'wt',5,2);await setUnlock(x,'et',4,2);
 assert.deepEqual(x.data['yiddishPrivate/config'].unlockedSteps,{et:4,wt:5});
 await assert.rejects(setUnlock(x,'wt',2,2),/changed elsewhere/);
 assert.equal(x.data['yiddishPrivate/config'].unlockedSteps.wt,5);
});
test('stale whole-form saves cannot undo an immediate unlock save',async()=>{
 const x=unlockSetup(),old=structuredClone(x.data['yiddishPrivate/config']);await setUnlock(x,'wt',5,2);
 await assert.rejects(x.service({action:'teacherSave',idToken:'owner',classId:'et',config:old}),/changed elsewhere/);
 assert.equal(x.data['yiddishPrivate/config'].unlockedSteps.wt,5);
});
test('invalid and unauthorized unlock writes do not change settings',async()=>{
 const x=unlockSetup(),old=structuredClone(x.data['yiddishPrivate/config']);
 for(const steps of [-1,9,4.5])await assert.rejects(setUnlock(x,'wt',steps,2),/valid number/);
 await assert.rejects(x.service({action:'teacherSetUnlock',idToken:'owner',classId:'et',track:'alpha',steps:4,expectedSteps:0}),/selected class/);
 await assert.rejects(x.service({action:'teacherSetUnlock',idToken:'teacher',classId:'et',track:'wt',steps:5,expectedSteps:2}),/not assigned/);
 assert.deepEqual(x.data['yiddishPrivate/config'],old);
});
test('student status and server practice gates use exact saved steps after a new login',async()=>{
 const x=unlockSetup();await setUnlock(x,'et',5,2);
 const {token}=await login(x,'et');const st=await x.service({action:'status',token});
 assert.equal(st.config.unlockedSteps.et,5);
 await x.service({action:'start',token,group:2,part:0});
 await assert.rejects(x.service({action:'start',token,group:2,part:1}),/not open yet/);
});
