'use strict';
// Student Rewards for every teacher: a signed-in teacher can award points,
// save daily points, comment, and approve activity points for students in
// their own classes (classes with the Student Rewards tool turned on).
// All reads and writes go through here, so the database rules can stay
// owner-only for the studentRewards tree.
const crypto=require('node:crypto');
const SR='studentRewards',WS='b3-2026',ADMIN_EMAIL='simcha5770@gmail.com';
const PROGRESS={Excellent:110,Good:100,Fair:80,'Needs Improvement':50,Average:80,Poor:50};
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const key=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(s);
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const initials=n=>String(n||'?').trim().split(/\s+/).map(w=>w[0]||'').slice(0,2).join('').toUpperCase()||'?';
const categoryKey=n=>String(n||'category').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'')||'category';
const pick=(obj,ids)=>Object.fromEntries(ids.filter(id=>obj&&obj[id]!==undefined).map(id=>[id,obj[id]]));

async function teacherAccess(store,identity){
 if(!identity?.uid||identity.email_verified!==true||identity.firebase?.sign_in_provider!=='google.com')fail(403,'Verified Google teacher sign-in required.');
 const email=String(identity.email||'').toLowerCase();
 const admin=await store.get('b3Games/admins/'+identity.uid);
 const owner=email===ADMIN_EMAIL||Boolean(admin&&admin.active!==false);
 const classes=await store.get('b3Games/workspaces/'+WS+'/classes')||{};
 const granted=id=>classes[id]&&classes[id].active!==false&&classes[id].toolGrants?.['student-rewards']===true;
 let ids;
 if(owner)ids=Object.keys(classes).filter(granted);
 else{
  const row=await store.get('b3Games/workspaces/'+WS+'/teachers/'+identity.uid);
  if(!row||row.active===false)fail(403,'Your teacher account is not active.');
  ids=Object.keys(row.classIds||{}).filter(id=>id!=='*'&&row.classIds[id]===true&&granted(id));
 }
 if(!ids.length)fail(403,'Student Rewards is not turned on for your classes.');
 return {email,owner,workspaceClasses:Object.fromEntries(ids.map(id=>[id,classes[id]]))};
}

// Make sure each teacher class has a rewards class, and every active class
// member has a rewards account enrolled in it (same ids the student login uses).
async function syncClasses(store,access){
 const rewardStudents=await store.get(SR+'/students')||{};
 const byB3={};for(const [rid,row] of Object.entries(rewardStudents))if(row?.b3StudentId&&row.active!==false)(byB3[row.b3StudentId]??=[]).push(rid);
 const updates={},rewardClassIds=[];
 for(const [cid,cls] of Object.entries(access.workspaceClasses)){
  const rcid='b3_'+cid;rewardClassIds.push(rcid);
  if(!await store.get(SR+'/classes/'+rcid))updates[SR+'/classes/'+rcid]={id:rcid,name:cls.name||cid,active:true,b3ClassId:cid};
  const enrolled=await store.get(SR+'/enrollments/'+rcid)||{};
  for(const [sid,m] of Object.entries(cls.members||{})){
   if(!key(sid)||m?.active===false)continue;
   let rid=(byB3[sid]||[])[0];
   if(!rid){
    rid='b3_'+sha(sid).slice(0,28);
    if(!rewardStudents[rid]){const name=String(m?.name||sid);updates[SR+'/students/'+rid]={id:rid,b3StudentId:sid,name,initials:initials(name),classId:rcid,rewardBalance:0,active:true};rewardStudents[rid]=updates[SR+'/students/'+rid];}
    byB3[sid]=[rid];
   }
   if(enrolled[rid]!==true)updates[SR+'/enrollments/'+rcid+'/'+rid]=true;
  }
 }
 if(Object.keys(updates).length)await store.update(updates);
 return rewardClassIds;
}

async function scopeFor(store,access){
 const rewardClassIds=await syncClasses(store,access);
 const enrollments=pick(await store.get(SR+'/enrollments')||{},rewardClassIds);
 const studentIds=[...new Set(Object.values(enrollments).flatMap(e=>Object.keys(e||{}).filter(id=>e[id]===true)))];
 return {rewardClassIds,enrollments,studentIds};
}
function requireClass(scope,classId){if(!scope.rewardClassIds.includes(classId))fail(403,'This class is not one of your Student Rewards classes.');}
function requireStudent(scope,classId,studentId){requireClass(scope,classId);if(scope.enrollments[classId]?.[studentId]!==true)fail(403,'This student is not in your class.');}

async function loadRoot(store,scope){
 const {rewardClassIds,enrollments,studentIds}=scope;
 const [classes,students,categories,rewards,catalog,settings,requests,adjustments,rounds]=await Promise.all(
  ['classes','students','categories','rewards','classRewardCatalog','settings','pointRequests','pointAdjustments','classRewardRounds'].map(p=>store.get(SR+'/'+p)));
 const ids=new Set(studentIds),root={
  classes:pick(classes||{},rewardClassIds),enrollments,students:pick(students||{},studentIds),
  categories:categories||{},
  // Each teacher class has its own store: only that class's items.
  rewards:Object.fromEntries(Object.entries(rewards||{}).filter(([,r])=>rewardClassIds.includes(r?.ownerClassId))),
  classRewardCatalog:Object.fromEntries(Object.entries(catalog||{}).filter(([,r])=>rewardClassIds.includes(r?.ownerClassId))),
  settings:{studentWebsiteEnabled:settings?.studentWebsiteEnabled,schoolYear:settings?.schoolYear,
   classStoreEnabled:pick(settings?.classStoreEnabled||{},rewardClassIds),
   classRewardAvailability:Object.fromEntries(Object.entries(settings?.classRewardAvailability||{}).filter(([id])=>rewardClassIds.includes(catalog?.[id]?.ownerClassId)))},
  pointRequests:Object.fromEntries(Object.entries(requests||{}).filter(([,r])=>ids.has(String(r?.rewardStudentId||'')))),
  pointAdjustments:Object.fromEntries(Object.entries(adjustments||{}).filter(([,r])=>ids.has(String(r?.studentId||'')))),
  classRewardRounds:pick(rounds||{},rewardClassIds),
  dailyRatings:{},dailyAwards:{},dailyAttendance:{},commentsByStudent:{},redemptionsByStudent:{},classRewardContributionsByStudent:{}
 };
 const ownRewards=new Set(Object.keys(root.rewards));
 await Promise.all(studentIds.map(async sid=>{
  for(const p of ['dailyRatings','dailyAwards','dailyAttendance','commentsByStudent','redemptionsByStudent','classRewardContributionsByStudent']){
   let v=await store.get(SR+'/'+p+'/'+sid);
   if(v&&p==='redemptionsByStudent')v=Object.fromEntries(Object.entries(v).filter(([,r])=>ownRewards.has(String(r?.rewardId||''))));
   if(v&&Object.keys(v).length)root[p][sid]=v;
  }
 }));
 return root;
}

async function addToBalance(store,studentId,amount){
 let applied=0;
 const r=await store.tx(SR+'/students/'+studentId+'/rewardBalance',cur=>{const old=Number(cur||0),next=Math.max(0,old+amount);applied=next-old;return next});
 return {applied,balance:Number(r?.snapshot?.val?.()??0)};
}

async function decideRequest(store,scope,email,requestId,approve,now){
 if(!key(requestId))fail(400,'Invalid point request.');
 const path=SR+'/pointRequests/'+requestId;
 const live=await store.get(path);
 if(!live||live.status!=='pending')fail(409,'This request was already handled.');
 if(!scope.studentIds.includes(String(live.rewardStudentId||'')))fail(403,'This request is not for a student in your class.');
 let result;
 if(approve){
  let locked=false;
  await store.tx(path,cur=>{if(cur&&cur.status==='pending'){locked=true;return {...cur,status:'processing',reviewedBy:email,reviewStartedAt:now}}locked=false;return undefined});
  if(!locked)fail(409,'This request was already handled.');
  try{
   const {applied,balance}=await addToBalance(store,live.rewardStudentId,Number(live.amount||0));
   await store.update({[path+'/status']:'approved',[path+'/actualAmount']:applied,[path+'/balanceAfter']:balance,[path+'/reviewedBy']:email,[path+'/reviewedAt']:now});
   result={ok:true,status:'approved',actualAmount:applied};
  }catch(error){await store.update({[path+'/status']:'pending',[path+'/reviewStartedAt']:null,[path+'/lastError']:String(error?.message||error)});throw error}
 }else{
  await store.update({[path+'/status']:'rejected',[path+'/reviewedBy']:email,[path+'/reviewedAt']:now});
  result={ok:true,status:'rejected'};
 }
 if(live.eventId&&live.practiceStudentId&&key(String(live.eventId))&&key(String(live.practiceStudentId))){
  const field=Number(live.amount||0)<0?'removalPointRequestStatus':'pointRequestStatus';
  await store.update({['posukPractice/chazara/events/'+live.practiceStudentId+'/'+live.eventId+'/'+field]:result.status}).catch(()=>{});
 }
 return result;
}


// ---- Teacher-run class stores --------------------------------------------
const num=(v,min,max,dflt)=>{const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):dflt};
const text=(v,max,dflt='')=>String(v??dflt).slice(0,max);
function cleanReward(v,ownerClassId,id){
 if(!v||typeof v!=='object')fail(400,'Invalid reward.');
 const name=text(v.name,100).trim();if(!name)fail(400,'Enter a reward name.');
 const qty=Math.round(num(v.quantity,-1,100000,-1));
 return {id,name,cost:Math.round(num(v.cost,0,100000,0)),icon:text(v.icon,12,'🎁'),color:/^#[0-9a-f]{6}$/i.test(String(v.color||''))?v.color:'#ede9fe',
  active:v.active!==false,available:v.available!==false,quantity:qty<0?-1:qty,rewardType:'personal',cooldownDays:num(v.cooldownDays,0,365,0),
  lastRedeemedAt:Number.isFinite(Number(v.lastRedeemedAt))&&v.lastRedeemedAt?Number(v.lastRedeemedAt):null,
  cooldownUntil:Number.isFinite(Number(v.cooldownUntil))&&v.cooldownUntil?Number(v.cooldownUntil):null,ownerClassId};
}
function cleanClassReward(v,ownerClassId,id){
 if(!v||typeof v!=='object')fail(400,'Invalid class reward.');
 const name=text(v.name,100).trim();if(!name)fail(400,'Enter a class reward name.');
 const out={id,name,costPerStudent:Math.round(num(v.costPerStudent,1,100000,100)),icon:text(v.icon,12,'⭐'),active:v.active!==false,available:v.available!==false,cooldownDays:num(v.cooldownDays,0,365,0),ownerClassId};
 if(v.modeVotingEnabled===true&&v.modes&&typeof v.modes==='object'){
  out.modeVotingEnabled=true;out.modes={};
  for(const [mid,m] of Object.entries(v.modes).slice(0,30))if(key(mid))out.modes[mid]={id:mid,name:text(m?.name,60,'Mode'),active:m?.active!==false};
 }
 return out;
}
// Applies the database writes the store editor makes, but only to this
// teacher's own class items, with every value checked and cleaned.
async function storeWrite(store,scope,classId,updates){
 requireClass(scope,classId);
 const entries=Object.entries(updates||{});if(!entries.length||entries.length>20)fail(400,'Nothing to save.');
 const out={},created=new Set();
 const owned=async(kind,id)=>{
  if(!key(id))fail(400,'Invalid item.');
  if(created.has(kind+'/'+id))return classId;
  const item=await store.get(SR+'/'+kind+'/'+id);
  if(!item)return null;
  if(!scope.rewardClassIds.includes(item.ownerClassId))fail(403,'You can only change your own class store.');
  return item.ownerClassId;
 };
 // Whole-item saves first, so a new item and its availability can be saved together.
 entries.sort(([a],[b])=>a.split('/').length-b.split('/').length);
 for(const [path,value] of entries){
  const p=String(path).split('/');
  if(p[0]!==SR)fail(403,'You can only change your class store.');
  const [,kind,id,field,...rest]=p;
  if((kind==='rewards'||kind==='classRewardCatalog')&&id&&!field){
   const owner=await owned(kind,id)||classId;
   out[path]=kind==='rewards'?cleanReward(value,owner,id):cleanClassReward(value,owner,id);
   created.add(kind+'/'+id);
  }else if((kind==='rewards'||kind==='classRewardCatalog')&&['available','active'].includes(field)&&!rest.length){
   if(!await owned(kind,id))fail(404,'That item no longer exists.');
   out[path]=value===true;
  }else if(kind==='settings'&&id==='classRewardAvailability'&&field&&!rest.length){
   if(!await owned('classRewardCatalog',field))fail(404,'That item no longer exists.');
   out[path]=value===true;
  }else if(kind==='classRewardRounds'&&scope.rewardClassIds.includes(id)&&field){
   if(!await owned('classRewardCatalog',field))fail(403,'You can only change your own class rewards.');
   const sub=rest[0];
   if(!sub&&value===null)out[path]=null;
   else if(!sub&&value&&typeof value==='object'){const v={};if('status' in value)v.status=text(value.status,20);if('cooldownUntil' in value)v.cooldownUntil=value.cooldownUntil?Number(value.cooldownUntil):null;if('byStudent' in value)v.byStudent={};if('updatedAt' in value)v.updatedAt=Date.now();for(const [k2,v2] of Object.entries(v))out[path+'/'+k2]=v2;}
   else if(sub&&rest.length===1&&['status','cooldownUntil','byStudent','updatedAt'].includes(sub))out[path]=sub==='status'?text(value,20):sub==='byStudent'?{}:sub==='updatedAt'?Date.now():(value?Number(value):null);
   else fail(400,'Invalid class reward change.');
  }else fail(403,'You can only change your class store.');
 }
 await store.update(out);
 return {ok:true};
}
async function reviewRedemption(store,scope,email,studentId,keyId,decision,now){
 if(!scope.studentIds.includes(studentId)||!key(keyId))fail(403,'This request is not for a student in your class.');
 const path=SR+'/redemptionsByStudent/'+studentId+'/'+keyId,item=await store.get(path);
 if(!item)fail(404,'That request no longer exists.');
 const reward=await store.get(SR+'/rewards/'+item.rewardId);
 if(!reward||!scope.rewardClassIds.includes(reward.ownerClassId))fail(403,'This request is not from your class store.');
 const status=decision==='approve'?'ready':decision==='collect'?'collected':decision==='decline'?'declined':null;
 if(!status)fail(400,'Choose approve, given or decline.');
 const expected=decision==='collect'?'ready':'pending';
 if(String(item.status||'pending')!==expected)fail(409,item.status==='canceled'?'The student canceled this request.':'This request was already handled.');
 const claim=await store.tx(path+'/status',cur=>String(cur||'pending')===expected?status:undefined);
 if(!claim?.committed)fail(409,'This request was already handled.');
 await store.update({[path+'/reviewedBy']:email,[path+'/reviewedAt']:now});
 if(decision==='decline'){
  await addToBalance(store,studentId,Number(item.cost||0));
  const requestMs=Date.parse(item.requestedAt)||0,lastMs=Number(reward.lastRedeemedAt)||Date.parse(reward.lastRedeemedAt)||0;
  if(requestMs&&lastMs&&Math.abs(requestMs-lastMs)<5000)await store.update({[SR+'/rewards/'+item.rewardId+'/lastRedeemedAt']:null,[SR+'/rewards/'+item.rewardId+'/cooldownUntil']:null});
 }
 return {ok:true,status};
}

async function rewardsTeacher(store,identity,body,nowMs=Date.now()){
 const now=new Date(nowMs).toISOString();
 const access=await teacherAccess(store,identity);
 const scope=await scopeFor(store,access);
 const action=String(body?.action||''),email=access.email;
 if(action==='load')return {ok:true,root:await loadRoot(store,scope)};
 if(action==='saveDaily'){
  const classId=String(body.classId||''),date=String(body.date||'');requireClass(scope,classId);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail(400,'Choose a valid date.');
  const rows=Array.isArray(body.rows)?body.rows:[];if(!rows.length||rows.length>200)fail(400,'No students to save.');
  const updates={},deltas=[];
  for(const row of rows){
   const sid=String(row?.studentId||'');requireStudent(scope,classId,sid);
   const absent=row.absent===true,ratings={};
   if(!absent)for(const [category,rating] of Object.entries(row.ratings||{})){
    if(typeof category!=='string'||!category||category.length>60||!(rating in PROGRESS))fail(400,'Invalid rating.');
    ratings[categoryKey(category)]={category,rating,points:PROGRESS[rating],teacherEmail:email,savedAt:now};
   }
   const award=absent?0:Math.round(Number(row.award??10));
   if(!Number.isFinite(award)||award<0||award>1000)fail(400,'Daily points must be between 0 and 1000.');
   const old=Number((await store.get(SR+'/dailyAwards/'+sid+'/'+classId+'/'+date))?.points||0);
   updates[SR+'/dailyRatings/'+sid+'/'+classId+'/'+date]=absent?null:ratings;
   updates[SR+'/dailyAwards/'+sid+'/'+classId+'/'+date]={points:award,teacherEmail:email,savedAt:now};
   updates[SR+'/dailyAttendance/'+sid+'/'+classId+'/'+date]={status:absent?'absent':'present',teacherEmail:email,savedAt:now};
   if(award!==old)deltas.push([sid,award-old]);
  }
  await store.update(updates);
  for(const [sid,delta] of deltas)await addToBalance(store,sid,delta);
  return {ok:true,saved:rows.length};
 }
 if(action==='adjust'){
  const classId=String(body.classId||''),sid=String(body.studentId||'');requireStudent(scope,classId,sid);
  const amount=Number(body.amount);if(!Number.isInteger(amount)||amount===0||Math.abs(amount)>1000)fail(400,'Enter a whole number between -1000 and 1000.');
  const reason=String(body.reason||'Teacher adjustment').slice(0,200);
  const {applied,balance}=await addToBalance(store,sid,amount);
  const id='adj_'+nowMs+'_'+sha(sid+nowMs+Math.random()).slice(0,8);
  await store.update({[SR+'/pointAdjustments/'+id]:{id,studentId:sid,classId,amount:applied,action:'teacher',reason,teacherEmail:email,createdAt:now}});
  return {ok:true,applied,balance};
 }
 if(action==='comment'){
  const classId=String(body.classId||''),sid=String(body.studentId||'');requireStudent(scope,classId,sid);
  const text=String(body.body||'').trim();if(!text||text.length>2000)fail(400,'Write a comment (up to 2000 characters).');
  const id='c_'+nowMs+'_'+sha(sid+nowMs+Math.random()).slice(0,8);
  await store.update({[SR+'/commentsByStudent/'+sid+'/'+id]:{id,studentId:sid,body:text,visibleToStudent:body.visibleToStudent!==false,teacherEmail:email,createdAt:now}});
  return {ok:true};
 }
 if(action==='approve'||action==='reject')return decideRequest(store,scope,email,String(body.requestId||''),action==='approve',now);
 if(action==='storeWrite')return storeWrite(store,scope,String(body.classId||''),body.updates);
 if(action==='setStore'){const classId=String(body.classId||'');requireClass(scope,classId);await store.update({[SR+'/settings/classStoreEnabled/'+classId]:body.open===true});return {ok:true,open:body.open===true}}
 if(action==='review')return reviewRedemption(store,scope,email,String(body.studentId||''),String(body.key||''),String(body.decision||''),now);
 fail(400,'Unknown action.');
}
module.exports={rewardsTeacher,PROGRESS};
