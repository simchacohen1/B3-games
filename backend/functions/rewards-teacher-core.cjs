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
  categories:categories||{},rewards:rewards||{},classRewardCatalog:catalog||{},
  settings:{studentWebsiteEnabled:settings?.studentWebsiteEnabled,rewardStoreEnabled:settings?.rewardStoreEnabled,schoolYear:settings?.schoolYear},
  pointRequests:Object.fromEntries(Object.entries(requests||{}).filter(([,r])=>ids.has(String(r?.rewardStudentId||'')))),
  pointAdjustments:Object.fromEntries(Object.entries(adjustments||{}).filter(([,r])=>ids.has(String(r?.studentId||'')))),
  classRewardRounds:pick(rounds||{},rewardClassIds),
  dailyRatings:{},dailyAwards:{},dailyAttendance:{},commentsByStudent:{},redemptionsByStudent:{},classRewardContributionsByStudent:{}
 };
 await Promise.all(studentIds.map(async sid=>{
  for(const p of ['dailyRatings','dailyAwards','dailyAttendance','commentsByStudent','redemptionsByStudent','classRewardContributionsByStudent']){
   const v=await store.get(SR+'/'+p+'/'+sid);if(v)root[p][sid]=v;
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
 fail(400,'Unknown action.');
}
module.exports={rewardsTeacher,PROGRESS};
