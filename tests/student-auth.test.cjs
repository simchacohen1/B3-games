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

// ---- Issue #421: correct sign-ins must never lock students out; guessing still must ----
const verify=(d,ip,now=1000,studentId='moshe',pin='1111')=>studentAuth(d,{action:'verify',studentId,pin},ip,now);
const limiterText=d=>JSON.stringify([d.tree.b3Private?.studentLoginFailures,d.tree.b3Private?.studentLoginVolume]);

test('a classroom on one shared address can sign in far more than 40 times without any lockout',async()=>{
 const d=seed(),ip='classroom-ip';
 for(let i=0;i<60;i++)assert.ok((await studentAuth(d,{action:'login',name:['Moshe Levi','Dovid','Yossi'][i%3],pin:['1111','3333','5770'][i%3]},ip,1000)).ok);
 for(let i=0;i<150;i++)assert.ok((await verify(d,ip,1000)).ok);
});
test('dozens of correct sign-ins happening at the same moment all succeed',async()=>{
 const d=seed();
 const results=await Promise.all(Array.from({length:50},(_,i)=>studentAuth(d,{action:'login',name:i%2?'Dovid':'Moshe Levi',pin:i%2?'3333':'1111'},'shared-ip',1000)));
 assert.equal(results.every(r=>r.ok),true);
});
test('correct sign-ins and checks do not use up the wrong-passcode allowance',async()=>{
 const d=seed(),ip='ip-a';
 for(let i=0;i<7;i++)await login(d,'Moshe Levi','0000').catch(()=>{});          // 7 slips, still under the limit of 8
 for(let i=0;i<30;i++){await login(d,'Moshe Levi','1111');await verify(d,ip)}   // many correct uses in between
 assert.equal((await studentAuth(d,{action:'login',name:'Moshe Levi',pin:'1111'},'1.2.3.4',1000)).id,'moshe');
});
test('repeated wrong guesses for one student are still blocked, even if the next try is correct',async()=>{
 const d=seed();
 for(let i=0;i<8;i++)await assert.rejects(login(d,'Moshe Levi','000'+i),{code:401});
 await assert.rejects(login(d,'Moshe Levi','1111'),{code:429});
 await assert.rejects(login(d,'Moshe Levi','0000'),{code:429});
});
test('one boy fumbling his passcode does not block his classmates on the same address',async()=>{
 const d=seed();
 for(let i=0;i<8;i++)await login(d,'Moshe Levi','000'+i).catch(()=>{});
 await assert.rejects(login(d,'Moshe Levi','1111'),{code:429});
 assert.equal((await login(d,'Dovid','3333')).id,'dovid');
 assert.equal((await login(d,'Yossi','5770')).id,'yossi');
});
test('wrong guesses spread across many names from one address are capped',async()=>{
 const d=seed();
 for(let i=0;i<100;i++)await assert.rejects(login(d,'Nobody'+i,'0000'),{code:401});
 await assert.rejects(login(d,'Dovid','3333'),{code:429});
});
test('a different address is not affected by someone else being blocked',async()=>{
 const d=seed();
 for(let i=0;i<8;i++)await login(d,'Moshe Levi','000'+i).catch(()=>{});
 await assert.rejects(login(d,'Moshe Levi','1111'),{code:429});
 assert.equal((await studentAuth(d,{action:'login',name:'Moshe Levi',pin:'1111'},'other-home-ip',1000)).id,'moshe');
});
test('the block ends by itself after ten minutes',async()=>{
 const d=seed();
 for(let i=0;i<8;i++)await login(d,'Moshe Levi','000'+i).catch(()=>{});
 await assert.rejects(login(d,'Moshe Levi','1111'),{code:429});
 assert.equal((await studentAuth(d,{action:'login',name:'Moshe Levi',pin:'1111'},'1.2.3.4',1000+600001)).id,'moshe');
});
test('wrong checks of a remembered session are counted per student, not as free guesses',async()=>{
 const d=seed();
 for(let i=0;i<8;i++)await assert.rejects(verify(d,'ip-v',1000,'moshe','000'+i),{code:401});
 await assert.rejects(verify(d,'ip-v',1000,'moshe','1111'),{code:429});
 assert.ok((await verify(d,'ip-v',1000,'dovid','3333')).ok);
});
test('missing or malformed credentials are not counted as guesses',async()=>{
 const d=seed();
 for(let i=0;i<200;i++)await assert.rejects(studentAuth(d,{action:'verify',studentId:'',pin:''},'1.2.3.4',1000),{code:401});
 for(let i=0;i<200;i++)await assert.rejects(studentAuth(d,{action:'login',name:'',pin:''},'1.2.3.4',1000),{code:400});
 assert.equal((await login(d,'Moshe Levi','1111')).id,'moshe');
});
test('unknown names and wrong passcodes get the same message and both count toward the limit',async()=>{
 const d=seed();
 const unknown=await login(d,'Nobody Here','1111').catch(e=>e),wrong=await login(d,'Moshe Levi','0000').catch(e=>e);
 assert.equal(unknown.code,401);assert.equal(wrong.code,401);assert.equal(unknown.message,wrong.message);
 for(let i=0;i<7;i++)await login(d,'Nobody Here','1111').catch(()=>{});
 await assert.rejects(login(d,'Nobody Here','1111'),{code:429});
});
test('a student who is turned off or has a duplicate name is told so without using up the allowance',async()=>{
 const d=seed();d.tree.b3Games.students.twin={profile:{name:'Moshe Levi',passcode:'1111',active:true}};
 for(let i=0;i<20;i++)await assert.rejects(login(d,'Moshe Levi','1111'),{code:409});
 assert.equal((await login(d,'Dovid','3333')).id,'dovid');
});
test('runaway traffic from one address is still stopped by the high volume cap',async()=>{
 const d=seed();
 for(let i=0;i<1000;i++)await verify(d,'bot-ip');
 await assert.rejects(verify(d,'bot-ip'),{code:429});
 assert.ok((await verify(d,'real-ip')).ok);
});
test('the limiter stores only hashes: no names, ids or passcodes',async()=>{
 const d=seed();
 await login(d,'Moshe Levi','0000').catch(()=>{});await verify(d,'1.2.3.4',1000,'moshe','9999').catch(()=>{});
 const text=limiterText(d).toLowerCase();
 for(const secret of ['moshe','levi','0000','9999','1.2.3.4'])assert.equal(text.includes(secret),false,secret);
});
test('choosing a PIN also counts only wrong passcodes',async()=>{
 const d=seed();
 for(let i=0;i<7;i++)await assert.rejects(choose(d,'4567',{pin:'000'+i}),{code:401});
 assert.equal((await choose(d)).requiresPinChange,false);
});

const owner={uid:'o',email:'simcha5770@gmail.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
const teacher={uid:'t',email:'t@x',email_verified:true,firebase:{sign_in_provider:'google.com'}};
test('owner migration copies passcodes privately, then clears every public copy',async()=>{const d=seed();
 const first=await manageStudents(d,owner,{action:'migratePasscodes',deletePublic:false},5);assert.equal(first.copied,3);assert.equal(d.tree.b3Games.students.moshe.profile.passcode,'1111');
 await manageStudents(d,owner,{action:'migratePasscodes',deletePublic:true,migrationProtocol:'passcodes-v2-preview-20261015',backupConfirmed:true},6);
 assert.equal(d.tree.b3Private.passcodes.moshe.passcode,'1111');assert.equal(d.tree.b3Private.passcodes.dovid.passcode,'3333');
 assert.equal(JSON.stringify(d.tree.b3Games).includes('"passcode"'),false);assert.equal(JSON.stringify(d.tree.posukPractice).includes('"passcode"'),false);
 assert.equal((await login(d,'Moshe Levi','1111')).id,'moshe');assert.equal((await login(d,'Dovid','3333')).id,'dovid');assert.equal((await login(d,'Yossi','5770')).id,'yossi')});
test('only the owner can run the migration',async()=>{const d=seed();await assert.rejects(manageStudents(d,teacher,{action:'migratePasscodes'}),{code:403})});
test('teachers list passcodes only for their own class; owner can list all',async()=>{const d=seed();d.tree.b3Games.workspaces['b3-2026'].teachers={t:{active:true,classIds:{et:true}}};
 const mine=await manageStudents(d,teacher,{action:'list',classId:'et'});assert.deepEqual(mine.passcodes,{moshe:'1111',dovid:'3333'});
 d.tree.b3Games.workspaces['b3-2026'].classes.wt={active:true,members:{}};await assert.rejects(manageStudents(d,teacher,{action:'list',classId:'wt'}),{code:403});
 const all=await manageStudents(d,owner,{action:'list',all:true});assert.equal(all.passcodes.yossi,'5770')});
test('creating a student stores the passcode privately only',async()=>{const d=seed();const r=await manageStudents(d,owner,{action:'create',classId:'et',name:'New Boy',passcode:'4444'});assert.equal(d.tree.b3Private.passcodes[r.studentId].passcode,'4444');assert.equal(d.tree.b3Games.students[r.studentId].profile.passcode,undefined);assert.equal((await readPasscode(d.get,r.studentId)).passcode,'4444')});
test('an active site administrator can run the owner migration',async()=>{const d=seed();d.tree.b3Games.admins={t:{active:true}};const r=await manageStudents(d,teacher,{action:'migratePasscodes',deletePublic:true,migrationProtocol:'passcodes-v2-preview-20261015',backupConfirmed:true});assert.ok(r.ok);d.tree.b3Games.admins.t.active=false;await assert.rejects(manageStudents(d,teacher,{action:'migratePasscodes'}),{code:403})});
test('homepage sign-in refuses a blocked central profile even with an old-list passcode',async()=>{const d=seed();d.tree.posukPractice.allowedStudents.off={name:'Blocked Boy',passcode:'5555'};await assert.rejects(login(d,'Blocked Boy','5555'));await assert.rejects(login(d,'Blocked Boy','2222'))});

const choose=(d,newPin='4567',extra={})=>studentAuth(d,{action:'choosePin',name:'Moshe Levi',pin:'1111',newPin,confirmPin:newPin,...extra},'1.2.3.4',2000);
test('every existing boy must choose once, then old PIN is rejected and new PIN restores normally',async()=>{
 const d=seed();assert.equal((await login(d,'Moshe Levi','1111')).requiresPinChange,true);
 assert.equal((await studentAuth(d,{action:'verify',studentId:'moshe',pin:'1111'})).requiresPinChange,true);
 const r=await choose(d);assert.equal(r.requiresPinChange,false);assert.equal(JSON.stringify(r).includes('4567'),false);
 await assert.rejects(login(d,'Moshe Levi','1111'),{code:401});
 assert.equal((await login(d,'Moshe Levi','4567')).requiresPinChange,false);
 assert.equal((await studentAuth(d,{action:'verify',studentId:'moshe',pin:'4567'})).requiresPinChange,false);
});
test('choosing a PIN requires the existing credentials and matching 4 to 8 digit PINs',async()=>{
 const d=seed();await assert.rejects(choose(d,'4567',{pin:'wrong'}),{code:401});
 for(const pin of ['123','123456789','abcd','1111','5770'])await assert.rejects(choose(d,pin),{code:400});
 await assert.rejects(choose(d,'4567',{confirmPin:'4568'}),{code:400});
 assert.equal((await login(d,'Moshe Levi','1111')).requiresPinChange,true);
});
test('PINs held in legacy or private storage cannot be selected; error reveals no owner',async()=>{
 const d=seed();await assert.rejects(choose(d,'3333'),{code:409,message:'That PIN is already in use. Choose a different PIN.'});
 d.tree.b3Private.passcodes.dovid={passcode:'6789',chosenPinVersion:1};
 await assert.rejects(choose(d,'6789'),{code:409});
 assert.equal(d.tree.b3Private.passcodes.moshe.passcode,'1111');
});
test('future changes are refused until the teacher approves a reset using a temporary passcode',async()=>{
 const d=seed();await choose(d);
 await assert.rejects(choose(d,'5678',{pin:'4567'}),{code:403});
 await assert.rejects(manageStudents(d,teacher,{action:'passcode',classId:'et',studentId:'moshe',passcode:'8765'}),{code:403});
 await manageStudents(d,owner,{action:'passcode',classId:'et',studentId:'moshe',passcode:'8765'});
 assert.equal((await login(d,'Moshe Levi','8765')).requiresPinChange,true);
 assert.equal((await choose(d,'5678',{pin:'8765'})).requiresPinChange,false);
 await assert.rejects(choose(d,'6789',{pin:'5678'}),{code:403});
});
test('transaction rechecks concurrent PIN reservations and teacher resets',async()=>{
 const d=seed(),tx=d.tx;let collide=true;
 d.tx=async(path,fn)=>{if(path==='b3Private/passcodes'&&collide){d.tree.b3Private.passcodes.dovid={passcode:'4567'};collide=false;}return tx(path,fn);};
 await assert.rejects(choose(d),{code:409});assert.equal(d.tree.b3Private.passcodes.moshe.passcode,'1111');
 d.tx=async(path,fn)=>{if(path==='b3Private/passcodes')d.tree.b3Private.passcodes.moshe={passcode:'8888'};return tx(path,fn);};
 await assert.rejects(choose(d,'5678'),{code:401});assert.equal(d.tree.b3Private.passcodes.moshe.passcode,'8888');
});
test('empty RTDB local cache is retried before approving the server-side PIN change',async()=>{
 const d=seed(),tx=d.tx;d.tx=async(path,fn)=>{if(path==='b3Private/passcodes')assert.deepEqual(fn(null),{});return tx(path,fn);};
 assert.equal((await choose(d)).requiresPinChange,false);
});
