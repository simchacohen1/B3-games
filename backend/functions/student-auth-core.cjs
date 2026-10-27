'use strict';
// Server-side student sign-in for the Fun Torah Tools homepage. Browsers never
// receive passcodes; they send what the student typed and get back only the
// student's id and name.
const crypto=require('node:crypto');
const {PRIVATE,clean,key,equal,readPasscode,passcodeWrites}=require('./student-passcodes.cjs');
const fail=(code,message,extra)=>{throw Object.assign(new Error(message),{code},extra);};
const normalize=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');

// ---- Abuse protection -------------------------------------------------------
// Only WRONG passcodes use up the lockout allowance. Correct sign-ins and routine
// "is my remembered sign-in still good?" checks never do, so a whole classroom
// sharing one internet address cannot lock itself out (issue #421). Windows are
// ten minutes. Every counter key is a hash, so no names, ids or passcodes are stored.
const WINDOW_MS=600000;
const LIMITS={
 volumePerIp:1000,        // all calls from one address: stops runaway traffic only
 wrongPerIp:100,          // wrong passcodes from one address, across every student
 wrongPerStudentAndIp:8   // wrong passcodes for one name from one address
};
const TOO_MANY='Too many sign-in attempts. Try again in 10 minutes.';

function limitPaths(action,body,ip){
 const address=hash('ip:'+(ip||'unknown'));
 const who=normalize(action==='verify'?body?.studentId:body?.name);
 const kind=action==='verify'?'verify':'login';
 return {
  volume:'b3Private/studentLoginVolume/'+address,
  wrongIp:'b3Private/studentLoginFailures/ip/'+address,
  wrongPair:'b3Private/studentLoginFailures/pair/'+hash(kind+':'+who+'|'+(ip||'unknown'))
 };
}

// Counts every call, but with a limit high enough that normal classrooms never reach it.
async function countVolume(store,path,now){
 let blocked=false;
 await store.tx(path,p=>{blocked=false;if(!p||p.until<now)p={count:0,until:now+WINDOW_MS};if(p.count>=LIMITS.volumePerIp){blocked=true;return undefined}return {...p,count:p.count+1}});
 if(blocked)fail(429,TOO_MANY);
}

// Read-only check: refuse if a wrong-passcode counter is already full.
async function refuseIfLocked(store,checks,now){
 const rows=await Promise.all(checks.map(([path])=>store.get(path)));
 if(rows.some((row,i)=>row&&row.until>=now&&row.count>=checks[i][1]))fail(429,TOO_MANY);
}

const recordWrong=(store,path,now)=>store.tx(path,p=>{if(!p||p.until<now)p={count:0,until:now+WINDOW_MS};return {...p,count:p.count+1}});

async function studentAuth(store,body,ip='unknown',now=Date.now()){
 const action=String(body?.action||'');
 if(action!=='login'&&action!=='choosePin'&&action!=='verify')return authenticate(store,body,now);
 const paths=limitPaths(action,body,ip);
 await countVolume(store,paths.volume,now);
 await refuseIfLocked(store,[[paths.wrongIp,LIMITS.wrongPerIp],[paths.wrongPair,LIMITS.wrongPerStudentAndIp]],now);
 try{
  return await authenticate(store,body,now);
 }catch(error){
  // Only a real passcode check that did not match counts. Missing input, ambiguous
  // names, turned-off accounts and server errors never use up the allowance.
  if(error?.wrongCredentials)await Promise.all([recordWrong(store,paths.wrongIp,now),recordWrong(store,paths.wrongPair,now)]);
  throw error;
 }
}

async function authenticate(store,body,now){
 const get=store.get;
 const action=String(body?.action||'');
 if(action==='login'||action==='choosePin'){
  const typed=clean(body.name),pin=clean(body.pin);
  if(!normalize(typed))fail(400,'Please type your name.');
  if(!pin||pin.length>100)fail(400,'Please enter your passcode.');
  const [central,legacyRows]=await Promise.all([get('b3Games/students'),get('posukPractice/allowedStudents')]);
  const sameName=(id,row)=>normalize(row?.name)===normalize(typed)||normalize(id)===normalize(typed);
  const ids=new Set();
  Object.entries(central||{}).forEach(([id,row])=>{if(key(id)&&row?.profile&&row.profile.active!==false&&sameName(id,row.profile))ids.add(id)});
  Object.entries(legacyRows||{}).forEach(([id,row])=>{if(key(id)&&row&&row.active!==false&&!central?.[id]?.profile&&sameName(id,row))ids.add(id)});
  const matches=[];
  for(const id of ids){const code=await readPasscode(get,id,{allowLegacyDefault:true});if(equal(code.passcode,pin))matches.push({id,code});}
  if(matches.length>1)fail(409,'More than one student has this name and passcode. Ask your teacher for a different passcode.');
  if(!matches.length)fail(401,'Check your name and passcode.',{wrongCredentials:true});
  const {id,code}=matches[0];
  const profile=central?.[id]?.profile||null,legacy=legacyRows?.[id]||null;
  if(profile?.active===false)fail(403,'Your access is turned off. Ask your teacher.');
  const name=String(profile?.name||legacy?.name||typed);
  // Move a passcode found in an old public location into private storage.
  if(code.source!=='private'){
   const updates=passcodeWrites(id,code.passcode,now,{profileExists:true});
   if(!profile){updates['b3Games/students/'+id+'/profile/id']=id;updates['b3Games/students/'+id+'/profile/name']=name;updates['b3Games/students/'+id+'/profile/active']=true;if(legacy?.classId)updates['b3Games/students/'+id+'/profile/classId']=legacy.classId;}
   await store.update(updates);
  }
  if(action==='choosePin'){
   const next=clean(body.newPin);
   if(!/^[0-9]{4,8}$/.test(next))fail(400,'Choose a PIN with 4 to 8 numbers.');
   if(!equal(next,clean(body.confirmPin)))fail(400,'The two new PINs do not match.');
   if(equal(next,pin)||next==='5770')fail(400,'Choose a new PIN, different from your old one.');
   // Check legacy accounts too. Private values are rechecked inside a single
   // transaction so two boys cannot claim the same PIN at the same time.
   const fallback={};
   for(const other of new Set([...Object.keys(central||{}),...Object.keys(legacyRows||{})].filter(key))){
    fallback[other]=(await readPasscode(get,other,{allowLegacyDefault:true})).passcode;
   }
   let reason=null;
   const transaction=await store.tx('b3Private/passcodes',rows=>{
    // RTDB may first call with an empty local cache; returning a value lets
    // it retry with the server's current data instead of aborting locally.
    if(!rows){reason='stale';return {};}
    reason=null;
    if(!equal(rows[id]?.passcode,pin)){reason='stale';return undefined;}
    if(rows[id]?.chosenPinVersion===1){reason='approval';return undefined;}
    const ids=new Set([...Object.keys(fallback),...Object.keys(rows)]);
    if([...ids].some(other=>other!==id&&equal(clean(rows[other]?.passcode)||fallback[other],next))){reason='taken';return undefined;}
    return {...rows,[id]:{...rows[id],passcode:next,updatedAt:now,chosenPinVersion:1}};
   });
   if(reason==='stale')fail(401,'Your passcode changed. Please sign in again.');
   if(reason==='taken')fail(409,'That PIN is already in use. Choose a different PIN.');
   if(reason==='approval')fail(403,'Ask your teacher to approve a PIN reset before changing your PIN.');
   if(transaction?.committed===false)fail(409,'Could not save your PIN. Please try again.');
   // Do not overwrite the private transaction with passcodeWrites here.
   const updates={['b3Games/students/'+id+'/profile/passcode']:null,['b3Games/students/'+id+'/profile/passcodeUpdatedAt']:now,['posukPractice/allowedStudents/'+id+'/passcode']:null};
   await store.update(updates);
  }
  const privateCode=await get(PRIVATE+id);
  const memberships=central?.[id]?.memberships||{};
  const activeMembership=Object.values(memberships).find(m=>m&&m.active!==false&&m.workspaceId==='b3-2026'&&m.classId);
  const legacyClassId=profile?.classId||legacy?.classId||null;
  const removedOnPurpose=legacyClassId&&memberships['b3-2026_'+legacyClassId]?.active===false;
  const classId=activeMembership?.classId||(!removedOnPurpose?legacyClassId:null);
  return {ok:true,id,name,classId,requiresPinChange:privateCode?.chosenPinVersion!==1};
 }
 if(action==='verify'){
  const id=clean(body.studentId),pin=clean(body.pin);
  if(!key(id)||!pin)fail(401,'Please sign in again.');
  const profile=await get('b3Games/students/'+id+'/profile');
  if(profile?.active===false)fail(403,'Your access is turned off. Ask your teacher.');
  const code=await readPasscode(get,id,{allowLegacyDefault:true});
  if(!equal(code.passcode,pin))fail(401,'Your passcode changed. Please sign in again.',{wrongCredentials:true});
  const privateCode=await get(PRIVATE+id);
  return {ok:true,requiresPinChange:privateCode?.chosenPinVersion!==1};
 }
 fail(400,'Unknown action.');
}
module.exports={studentAuth};
