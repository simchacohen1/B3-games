const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

const SR_ROOT = "studentRewards";
const ADMIN_EMAIL = "simcha5770@gmail.com";
const POINTS = Object.freeze({
  reading100: 3,
  translation100: 5,
  understand100: 3,
  chazara: 1,
  "chazara-recording": 2,
});

function cors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).send(""); return true; }
  return false;
}
function normalizeName(v){
  return String(v || "").trim().toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, " ").replace(/\s+/g, " ");
}
function entries(v){
  if(Array.isArray(v)) return v.map((x,i)=>[i,x]).filter(([,x])=>x && typeof x === "object");
  if(v && typeof v === "object") return Object.keys(v).filter(k=>/^\d+$/.test(k)).map(k=>[Number(k),v[k]]).filter(([,x])=>x && typeof x === "object");
  return [];
}
function readingScore(a){
  if(!a) return null;
  return typeof a.hebrewFinalScore === "number" ? a.hebrewFinalScore : (typeof a.hebrewScore === "number" ? a.hebrewScore : null);
}
function translationScore(a){
  if(!a) return null;
  const e = entries(a.translationChunkResults);
  if(e.length){
    const maxIndex = Math.max(...e.map(([i,c])=>Number.isInteger(c.chunkIndex) ? c.chunkIndex : i)) + 1;
    const total = Math.max(Number(a.translationTotal)||0, maxIndex, e.length);
    const correct = e.filter(([,c])=>(c.finalVerdict || c.verdict) === "correct").length;
    return total ? Math.round(correct / total * 100) : null;
  }
  const n = parseFloat(String(a.translationScore || "").replace("%", ""));
  return Number.isFinite(n) ? n : null;
}
function understandScore(a){
  if(!a) return null;
  const e = entries(a.questionResults);
  if(e.length){
    const maxIndex = Math.max(...e.map(([i,q])=>Number.isInteger(q.questionIndex) ? q.questionIndex : i)) + 1;
    const total = Math.max(Number(a.questionTotal)||0, maxIndex, e.length);
    const correct = e.filter(([,q])=>(q.finalVerdict || q.verdict) === "correct").length;
    return total ? Math.round(correct / total * 100) : null;
  }
  if(typeof a.comprehensionScore === "number") return a.comprehensionScore;
  const n = parseFloat(String(a.questionScore || "").replace("%", ""));
  return Number.isFinite(n) ? n : null;
}
function bestScore(attemptMap, reader){
  let best = null;
  Object.values(attemptMap || {}).forEach(a => {
    const v = reader(a);
    if(typeof v === "number" && Number.isFinite(v) && (best === null || v > best)) best = v;
  });
  return best;
}
function parsePracticeKey(key){
  const parts = String(key || "").split("_");
  if(parts.length < 3) return null;
  const posukPart = parts.pop();
  const perek = Number(parts.pop());
  const prefix = parts.join("_");
  const m = /^(\d+)(?:-(\d+))?$/.exec(posukPart);
  if(!perek || !m) return null;
  return {prefix,perek,start:Number(m[1]),end:Number(m[2]||m[1])};
}
function evidenceCovers(evidenceKey, awardKey){
  const e=parsePracticeKey(evidenceKey), a=parsePracticeKey(awardKey);
  return !!(e && a && e.prefix===a.prefix && e.perek===a.perek && a.start===a.end && a.start>=e.start && a.start<=e.end);
}
function safeKey(v){ return String(v || "").replace(/[^A-Za-z0-9_-]/g, "-").slice(0,220); }
function reasonFor(source,perek,posuk){
  const ref=(perek&&posuk)?`Perek ${perek} · Posuk ${posuk}`:"Posuk Practice";
  if(source==="reading100") return `Reading reached 100% — ${ref}`;
  if(source==="translation100") return `Translation reached 100% — ${ref}`;
  if(source==="understand100") return `Understand reached 100% — ${ref}`;
  if(source==="chazara-recording") return `Recorded Chazara — ${ref}`;
  if(source==="chazara") return `Chazara — ${ref}`;
  return source;
}


function isChazaraRequest(item){
  return ["chazara","chazara-recording","chazara-remove"].includes(String(item?.source || ""));
}

async function requireTeacher(req){
  const header=String(req.headers.authorization || "");
  if(!header.startsWith("Bearer ")) return {ok:false,error:"Teacher sign-in required."};
  try{
    const decoded=await admin.auth().verifyIdToken(header.slice(7));
    const email=String(decoded.email || "").trim().toLowerCase();
    if(email !== ADMIN_EMAIL) return {ok:false,error:"This Google account is not authorized for Student Rewards."};
    return {ok:true,email,decoded};
  }catch(err){
    console.warn("Teacher token verification failed",err);
    return {ok:false,error:"Teacher sign-in expired. Please sign in again."};
  }
}

async function requireStudent(req){
  const header=String(req.headers.authorization || "");
  if(!header.startsWith("Bearer ")) return {ok:false,error:"Student sign-in required."};
  try{
    const decoded=await admin.auth().verifyIdToken(header.slice(7));
    const studentId=String(decoded.studentRewardsStudentId || "").trim();
    if(!studentId || decoded.studentRewardsRole !== "student") return {ok:false,error:"Student sign-in required."};
    return {ok:true,studentId,decoded};
  }catch(err){
    console.warn("Student token verification failed",err);
    return {ok:false,error:"Student sign-in expired. Please sign in again."};
  }
}

async function studentPointHistory(studentId){
  const [requestsSnap,adjustmentsSnap,classContribSnap]=await Promise.all([
    rtdb.ref(`${SR_ROOT}/pointRequests`).get(),
    rtdb.ref(`${SR_ROOT}/pointAdjustments`).get().catch(()=>null),
    rtdb.ref(`${SR_ROOT}/classRewardContributionsByStudent/${studentId}`).get().catch(()=>null),
  ]);
  const rows=[];
  requestsSnap.forEach(child=>{
    const item=child.val() || {};
    const amount=Number(item.actualAmount ?? item.amount ?? 0);
    if(String(item.rewardStudentId || "") !== studentId || item.status !== "approved" || !amount) return;
    rows.push({id:child.key,...item,actualAmount:amount});
  });
  if(adjustmentsSnap){
    adjustmentsSnap.forEach(child=>{
      const item=child.val() || {};
      const amount=Number(item.amount || 0);
      if(String(item.studentId || "") !== studentId || !amount) return;
      rows.push({
        id:child.key,
        source:"teacher-adjustment",
        reason:item.reason || "Teacher adjustment",
        actualAmount:amount,
        amount,
        createdAt:item.createdAt || null,
        reviewedAt:item.createdAt || null,
        classId:item.classId || null,
      });
    });
  }
  if(classContribSnap){
    classContribSnap.forEach(child=>{
      const item=child.val()||{}, amount=Math.abs(Number(item.amount||0));
      if(!amount)return;
      rows.push({id:child.key,source:"class-reward-contribution",reason:`Class contribution — ${item.rewardName||"Class Reward"}`,actualAmount:-amount,amount:-amount,createdAt:item.createdAt||null,reviewedAt:item.createdAt||null,classId:item.classId||null,rewardId:item.rewardId||null,roundId:item.roundId||null,balanceAfter:item.balanceAfter});
    });
  }
  rows.sort((a,b)=>(Number(b.reviewedAt || b.createdAt)||0)-(Number(a.reviewedAt || a.createdAt)||0));
  return rows;
}

async function mirrorChazaraPointStatus(item,status){
  if(!item?.practiceStudentId || !item?.eventId) return;
  const field=Number(item.amount || 0) < 0 ? "removalPointRequestStatus" : "pointRequestStatus";
  await rtdb.ref(`posukPractice/chazara/events/${item.practiceStudentId}/${item.eventId}/${field}`).set(status).catch(err=>console.warn("Could not mirror Chazara point status",err));
}

async function listPendingChazaraRequests(){
  const snap=await rtdb.ref(`${SR_ROOT}/pointRequests`).get();
  const rows=[];
  snap.forEach(child=>{
    const item=child.val() || {};
    if(item.status === "pending" && isChazaraRequest(item)) rows.push({id:child.key,...item});
  });
  rows.sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
  return rows;
}

async function approvePendingRequest(requestId,reviewedBy){
  const ref=rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`);
  const existing=await ref.get();
  if(!existing.exists()) return {ok:false,error:"Point request not found."};
  const before=existing.val() || {};
  if(!isChazaraRequest(before)) return {ok:false,error:"Only Chazara requests can be approved here."};
  if(before.status !== "pending") return {ok:true,alreadyHandled:true,status:before.status};

  // A Realtime Database transaction can call the updater first with null when
  // this Admin process has no cached value. Returning undefined at that point
  // aborts the transaction, which made the teacher's Approve button appear to
  // do nothing. Returning null lets RTDB compare with the server and retry with
  // the actual request before we claim it.
  const lock=await ref.transaction(cur=>{
    if(cur === null) return null;
    if(cur.status !== "pending") return;
    return {...cur,status:"processing",reviewedBy,reviewStartedAt:Date.now()};
  });
  if(!lock.committed){
    const live=(await ref.get()).val() || {};
    if(live.status === "pending") return {ok:false,error:"Approval did not complete. Please try again."};
    return {ok:true,alreadyHandled:true,status:live.status || "unknown"};
  }
  const item=lock.snapshot.val() || before;
  const rewardStudentId=String(item.rewardStudentId || "");
  if(!rewardStudentId){
    await ref.update({status:"pending",lastError:"Missing reward student ID",reviewStartedAt:null});
    return {ok:false,error:"Missing reward student ID."};
  }
  const amount=Number(item.amount || 0);
  let applied=0;
  const balRef=rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}/rewardBalance`);
  const bal=await balRef.transaction(cur=>{
    const old=Number(cur || 0);
    const next=Math.max(0,old+amount);
    applied=next-old;
    return next;
  });
  if(!bal.committed){
    await ref.update({status:"pending",lastError:"Balance update did not commit",reviewStartedAt:null});
    return {ok:false,error:"Could not update the point balance."};
  }
  const balanceAfter=Number(bal.snapshot.val() || 0);
  await ref.update({status:"approved",actualAmount:applied,balanceAfter,reviewedBy,reviewedAt:Date.now(),lastError:null});
  await mirrorChazaraPointStatus(item,"approved");
  return {ok:true,status:"approved",actualAmount:applied,balanceAfter,studentName:item.studentName || rewardStudentId};
}

async function rejectPendingRequest(requestId,reviewedBy){
  const ref=rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`);
  const snap=await ref.get();
  if(!snap.exists()) return {ok:false,error:"Point request not found."};
  const item=snap.val() || {};
  if(!isChazaraRequest(item)) return {ok:false,error:"Only Chazara requests can be rejected here."};
  if(item.status !== "pending") return {ok:true,alreadyHandled:true,status:item.status};
  await ref.update({status:"rejected",reviewedBy,reviewedAt:Date.now()});
  await mirrorChazaraPointStatus(item,"rejected");
  return {ok:true,status:"rejected"};
}

async function awardMilestoneImmediately({requestId,rewardStudentId,studentId,source,amount,reason,record}){
  const ref=rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`);
  const info=await studentInfo(rewardStudentId);
  const claimId=`${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const seed={
    id:requestId,status:"processing",automatic:true,amount,source,reason,
    practiceStudentId:studentId,rewardStudentId,studentName:info.name,classId:info.classId,
    createdAt:Date.now(),claimId,...record
  };
  const tx=await ref.transaction(cur=>cur ? undefined : seed);
  if(!tx.committed){
    const existing=(await ref.get()).val() || {};
    return {ok:true,newlyAwarded:false,requestId,status:existing.status || "approved",amount:Number(existing.actualAmount ?? existing.amount ?? amount)};
  }
  let applied=0;
  const balRef=rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}/rewardBalance`);
  const bal=await balRef.transaction(cur=>{
    const old=Number(cur || 0);
    const next=Math.max(0,old+amount);
    applied=next-old;
    return next;
  });
  if(!bal.committed){
    await ref.update({status:"error",lastError:"Balance update did not commit"});
    return {ok:false,error:"Could not add the reward points."};
  }
  const balanceAfter=Number(bal.snapshot.val() || 0);
  await ref.update({status:"approved",actualAmount:applied,balanceAfter,approvedAutomatically:true,reviewedBy:"Verified Posuk Practice",reviewedAt:Date.now()});
  return {ok:true,newlyAwarded:true,requestId,status:"approved",amount:applied,balanceAfter};
}

async function resolveRewardStudentId(posukStudentId){
  const direct = await rtdb.ref(`${SR_ROOT}/students/${posukStudentId}`).get();
  if(direct.exists()) return posukStudentId;

  const allowed = await rtdb.ref(`posukPractice/allowedStudents/${posukStudentId}`).get();
  const practiceStudent = await rtdb.ref(`posukPractice/students/${posukStudentId}`).get();
  const wanted = normalizeName(allowed.val()?.name || practiceStudent.val()?.name || posukStudentId);
  if(!wanted) return null;
  const all = await rtdb.ref(`${SR_ROOT}/students`).get();
  let match = null;
  all.forEach(child => {
    if(match) return;
    const row=child.val()||{};
    if(normalizeName(row.name)===wanted || normalizeName(row.displayName)===wanted) match=child.key;
  });
  return match;
}

async function verifyMilestone(studentId, source, awardPosukKey, evidencePosukKey){
  if(!evidenceCovers(evidencePosukKey, awardPosukKey)) return {ok:false,error:"That saved attempt does not cover this posuk."};
  const snap = await rtdb.ref(`posukPractice/attempts/${studentId}/${evidencePosukKey}`).get();
  if(!snap.exists()) return {ok:false,error:"No saved Posuk Practice evidence was found."};
  const attemptMap=snap.val()||{};
  const reader = source === "reading100" ? readingScore : source === "translation100" ? translationScore : understandScore;
  const score=bestScore(attemptMap,reader);
  if(!(score >= 100)) return {ok:false,error:"The verified saved score has not reached 100%."};
  return {ok:true,score};
}

async function verifyChazara(studentId, source, eventId){
  if(!eventId) return {ok:false,error:"Missing Chazara event."};
  const ref=rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`);
  const snap=await ref.get();
  if(!snap.exists()) return {ok:false,error:"Chazara event not found."};
  const e=snap.val()||{};
  if(e.reviewApplied !== true) return {ok:false,error:"The Chazara review was not fully saved."};
  if(e.removed === true) return {ok:false,error:"That Chazara has been removed."};
  if(source === "chazara"){
    if(e.recorded === true) return {ok:false,error:"Recorded Chazara must use the recorded request."};
    return {ok:true,event:e,eventRef:ref};
  }
  if(e.recorded !== true || Number(e.durationMs||0) < 5000 || e.soundDetected !== true || !e.audioURL || !e.storagePath){
    return {ok:false,error:"The recording did not pass the recorded-Chazara checks."};
  }
  try{
    const [meta] = await admin.storage().bucket().file(String(e.storagePath)).getMetadata();
    if(Number(meta.size || 0) < 1000) return {ok:false,error:"The recording file is empty."};
  }catch(err){
    console.error("Could not verify Chazara storage object", err);
    return {ok:false,error:"The recording file could not be verified."};
  }
  return {ok:true,event:e,eventRef:ref};
}

async function studentInfo(rewardStudentId){
  const snap=await rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}`).get();
  const row=snap.val()||{};
  return {name:row.name||row.displayName||rewardStudentId,classId:row.classId||null};
}

async function createPendingRequest({requestId,rewardStudentId,studentId,source,amount,reason,record}){
  const ref=rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`);
  const existing=await ref.get();
  if(existing.exists()){
    const value=existing.val()||{};
    return {created:false,requestId,status:value.status||"pending",amount:Number(value.amount||amount)};
  }
  const info=await studentInfo(rewardStudentId);
  const value={
    id:requestId,
    status:"pending",
    amount,
    source,
    reason,
    practiceStudentId:studentId,
    rewardStudentId,
    studentName:info.name,
    classId:info.classId,
    createdAt:Date.now(),
    ...record,
  };
  const tx=await ref.transaction(current=>current||value);
  const finalValue=tx.snapshot.val()||value;
  return {created:tx.committed,requestId,status:finalValue.status||"pending",amount:Number(finalValue.amount||amount)};
}

async function handleRemoval(studentId,eventId){
  if(!eventId) return {ok:false,error:"Missing Chazara event."};
  const eventRef=rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`);
  const eventSnap=await eventRef.get();
  if(!eventSnap.exists()) return {ok:false,error:"Chazara event not found."};
  const e=eventSnap.val()||{};
  if(e.reviewApplied!==true || e.removed!==true) return {ok:false,error:"That Chazara has not been removed."};

  const rewardStudentId=await resolveRewardStudentId(studentId);
  if(!rewardStudentId) return {ok:false,error:"Could not match this student to Student Rewards."};
  const originalId=safeKey(`chazara_${studentId}_${eventId}`);
  const originalRef=rtdb.ref(`${SR_ROOT}/pointRequests/${originalId}`);
  const originalSnap=await originalRef.get();
  if(!originalSnap.exists()){
    await eventRef.update({pointRequestStatus:"cancelled",removalPointRequestStatus:"none"});
    return {ok:true,action:"none",status:"none",requestId:null,amount:0};
  }
  const original=originalSnap.val()||{};
  const status=String(original.status||"pending");
  if(status==="pending"){
    await originalRef.update({status:"cancelled",cancelReason:"Chazara removed before approval",cancelledAt:Date.now()});
    await eventRef.update({pointRequestStatus:"cancelled",removalPointRequestStatus:"cancelled"});
    return {ok:true,action:"cancelled",status:"cancelled",requestId:originalId,amount:0};
  }
  if(status==="approved"){
    const amount=-Math.abs(Number(original.actualAmount ?? original.amount ?? (e.recorded?2:1)) || (e.recorded?2:1));
    const requestId=safeKey(`chazara-remove_${studentId}_${eventId}`);
    const made=await createPendingRequest({
      requestId,rewardStudentId,studentId,source:"chazara-remove",amount,
      reason:`Removed ${e.recorded?"recorded ":""}Chazara — Perek ${e.perek||"?"} · Posuk ${e.posuk||"?"}`,
      record:{eventId,perek:e.perek||null,posuk:e.posuk||null,originalRequestId:originalId,recorded:e.recorded===true}
    });
    await eventRef.update({removalPointRequestId:requestId,removalPointRequestStatus:made.status});
    return {ok:true,action:"deduction-requested",status:made.status,requestId,amount};
  }
  await eventRef.update({removalPointRequestStatus:status});
  return {ok:true,action:"none",status,requestId:originalId,amount:0};
}

async function rewardStudentClassInfo(studentId){
  const studentSnap=await rtdb.ref(`${SR_ROOT}/students/${studentId}`).get(), row=studentSnap.val()||{};
  let classId=String(row.classId||"");
  if(!classId){
    const enrollments=await rtdb.ref(`${SR_ROOT}/enrollments`).get();
    enrollments.forEach(c=>{if(!classId&&c.child(studentId).val()===true)classId=c.key});
  }
  if(!classId)throw new Error("Your class could not be found.");
  const [enrollSnap,studentsSnap,classSnap]=await Promise.all([rtdb.ref(`${SR_ROOT}/enrollments/${classId}`).get(),rtdb.ref(`${SR_ROOT}/students`).get(),rtdb.ref(`${SR_ROOT}/classes/${classId}`).get()]);
  const enrolled=enrollSnap.val()||{}, students=studentsSnap.val()||{};
  const classSize=Math.max(1,Object.keys(enrolled).filter(id=>enrolled[id]===true&&students[id]?.active!==false).length);
  return {student:row,classId,className:classSnap.val()?.name||classId,classSize};
}
function classGoalView(item,round,info,studentId){
  const catalogPerStudent=Math.max(1,Math.round(Number(item.costPerStudent||100))), perStudent=Math.max(1,Math.round(Number(round?.perStudentCost)||catalogPerStudent)), defaultGoal=perStudent*info.classSize;
  const goalPoints=Math.max(1,Number(round?.goalPoints)||defaultGoal), maxPerStudent=Math.max(1,Number(round?.maxPerStudent)||Math.min(goalPoints,Math.ceil((goalPoints/Math.max(1,Number(round?.classSize)||info.classSize))*2))), totalContributed=Math.max(0,Number(round?.totalContributed)||0), studentContributed=Math.max(0,Number(round?.byStudent?.[studentId])||0), remainingGoal=Math.max(0,goalPoints-totalContributed), remainingStudentCap=Math.max(0,maxPerStudent-studentContributed), status=round?.status||(remainingGoal<=0?"completed":"not-started");
  return {rewardId:item.id,name:item.name||"Class Reward",icon:item.icon||"⭐",active:item.active!==false,perStudentCost:perStudent,classId:info.classId,className:info.className,classSize:Number(round?.classSize)||info.classSize,goalPoints,maxPerStudent,totalContributed,studentContributed,remainingGoal,remainingStudentCap,status,roundId:round?.roundId||null};
}
async function classRewardStatus(studentId){
  const info=await rewardStudentClassInfo(studentId), [catalogSnap,roundsSnap]=await Promise.all([rtdb.ref(`${SR_ROOT}/classRewardCatalog`).get(),rtdb.ref(`${SR_ROOT}/classRewardRounds/${info.classId}`).get()]);
  const catalog=catalogSnap.val()||{}, rounds=roundsSnap.val()||{}, goals=[];
  for(const item of Object.values(catalog))if(item&&item.active!==false)goals.push(classGoalView(item,rounds[item.id]||null,info,studentId));
  goals.sort((a,b)=>a.perStudentCost-b.perStudentCost||String(a.name).localeCompare(String(b.name)));
  return {info,goals};
}
async function contributeClassReward(studentId,classRewardId,rawAmount){
  const amount=Math.floor(Number(rawAmount||0));
  if(!Number.isFinite(amount)||amount<1)return {ok:false,error:"Enter at least 1 point."};
  const openSnap=await rtdb.ref(`${SR_ROOT}/settings/rewardStoreEnabled`).get();
  if(!(openSnap.val()===true||String(openSnap.val())==="true"))return {ok:false,error:"The Prize Store is closed right now."};
  const info=await rewardStudentClassInfo(studentId), rewardSnap=await rtdb.ref(`${SR_ROOT}/classRewardCatalog/${classRewardId}`).get(), reward=rewardSnap.val();
  if(!reward||reward.active===false)return {ok:false,error:"That class reward is unavailable."};
  const perStudent=Math.max(1,Math.round(Number(reward.costPerStudent||100))), goalPoints=perStudent*info.classSize, maxPerStudent=Math.min(goalPoints,Math.ceil((goalPoints/info.classSize)*2));
  let insufficient=false;
  const balanceRef=rtdb.ref(`${SR_ROOT}/students/${studentId}/rewardBalance`);
  const balanceTx=await balanceRef.transaction(cur=>{const balance=Number(cur||0);if(balance<amount){insufficient=true;return}return balance-amount});
  if(!balanceTx.committed)return {ok:false,error:insufficient?"You do not have enough points.":"Could not update your balance."};
  const balanceAfter=Number(balanceTx.snapshot.val()||0), roundRef=rtdb.ref(`${SR_ROOT}/classRewardRounds/${info.classId}/${classRewardId}`), candidateRoundId=`round-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  let failure="";
  const roundTx=await roundRef.transaction(cur=>{
    const current=cur&&typeof cur==="object"?cur:{roundId:candidateRoundId,status:"active",startedAt:Date.now(),classSize:info.classSize,perStudentCost:perStudent,goalPoints,maxPerStudent,totalContributed:0,byStudent:{}};
    if(current.status==="completed"){failure="This class goal has already been reached.";return}
    const goal=Math.max(1,Number(current.goalPoints)||goalPoints), cap=Math.max(1,Number(current.maxPerStudent)||maxPerStudent), total=Math.max(0,Number(current.totalContributed)||0), mine=Math.max(0,Number(current.byStudent?.[studentId])||0);
    if(amount>goal-total){failure=`Only ${Math.max(0,goal-total)} more points are needed for this goal.`;return}
    if(amount>cap-mine){failure=`You may contribute up to ${Math.max(0,cap-mine)} more points to this goal.`;return}
    const nextTotal=total+amount, next={...current,roundId:current.roundId||candidateRoundId,status:nextTotal>=goal?"completed":"active",classSize:Number(current.classSize)||info.classSize,perStudentCost:Number(current.perStudentCost)||perStudent,goalPoints:goal,maxPerStudent:cap,totalContributed:nextTotal,byStudent:{...(current.byStudent||{}),[studentId]:mine+amount},updatedAt:Date.now()};
    if(next.status==="completed"&&!next.completedAt)next.completedAt=Date.now();
    return next;
  });
  if(!roundTx.committed){await balanceRef.transaction(cur=>Number(cur||0)+amount);return {ok:false,error:failure||"Could not add those points to the class goal."};}
  const round=roundTx.snapshot.val()||{}, contributionRef=rtdb.ref(`${SR_ROOT}/classRewardContributions/${info.classId}/${classRewardId}/${round.roundId}`).push(), id=contributionRef.key, record={id,studentId,studentName:info.student.name||studentId,classId:info.classId,className:info.className,rewardId:classRewardId,rewardName:reward.name||"Class Reward",roundId:round.roundId,amount,createdAt:Date.now(),balanceAfter};
  await rtdb.ref().update({[`${SR_ROOT}/classRewardContributions/${info.classId}/${classRewardId}/${round.roundId}/${id}`]:record,[`${SR_ROOT}/classRewardContributionsByStudent/${studentId}/${id}`]:record});
  return {ok:true,balance:balanceAfter,goal:classGoalView(reward,round,info,studentId)};
}

exports.studentRewardsAutoAward = onRequest(
  { cors:true, region:"us-central1", memory:"256MiB" },
  async (req,res)=>{
    if(cors(req,res)) return;
    if(req.method!=="POST") return res.status(405).json({error:"Use POST"});
    try{
      const body=req.body||{};
      const action=String(body.action||"").trim();
      if(action){
        if(action==="student-point-history"||action==="class-reward-status"||action==="contribute-class-reward"){
          const student=await requireStudent(req);
          if(!student.ok) return res.status(401).json({error:student.error});
          if(action==="student-point-history"){
            const history=await studentPointHistory(student.studentId);
            return res.status(200).json({ok:true,history});
          }
          if(action==="class-reward-status"){
            const result=await classRewardStatus(student.studentId);
            return res.status(200).json({ok:true,goals:result.goals,classId:result.info.classId,className:result.info.className});
          }
          const result=await contributeClassReward(student.studentId,String(body.classRewardId||""),body.amount);
          if(!result.ok)return res.status(409).json({error:result.error});
          return res.status(200).json(result);
        }
        const teacher=await requireTeacher(req);
        if(!teacher.ok) return res.status(401).json({error:teacher.error});
        if(action==="list-chazara-pending"){
          const requests=await listPendingChazaraRequests();
          return res.status(200).json({ok:true,requests});
        }
        if(action==="approve-point-request"){
          const result=await approvePendingRequest(String(body.requestId||""),teacher.email);
          if(!result.ok) return res.status(409).json({error:result.error});
          return res.status(200).json(result);
        }
        if(action==="reject-point-request"){
          const result=await rejectPendingRequest(String(body.requestId||""),teacher.email);
          if(!result.ok) return res.status(409).json({error:result.error});
          return res.status(200).json(result);
        }
        return res.status(400).json({error:"Unknown teacher action."});
      }

      const studentId=String(body.studentId||"").trim();
      const source=String(body.source||"").trim();
      if(!studentId) return res.status(400).json({error:"Missing student."});

      const approved=await rtdb.ref(`posukPractice/allowedStudents/${studentId}`).get();
      if(!approved.exists()) return res.status(403).json({error:"Student is not approved for Posuk Practice."});

      if(source==="chazara-remove"){
        const result=await handleRemoval(studentId,String(body.eventId||""));
        if(!result.ok) return res.status(409).json({error:result.error});
        return res.status(200).json(result);
      }
      if(!POINTS[source]) return res.status(400).json({error:"Missing or invalid point-request information."});

      const rewardStudentId=await resolveRewardStudentId(studentId);
      if(!rewardStudentId) return res.status(404).json({error:"Could not match this student to Student Rewards."});
      const amount=POINTS[source];

      let requestId,record={},reason="",chazaraVerification=null;
      if(source === "reading100" || source === "translation100" || source === "understand100"){
        const awardPosukKey=String(body.awardPosukKey||"");
        const evidencePosukKey=String(body.evidencePosukKey||"");
        const verified=await verifyMilestone(studentId,source,awardPosukKey,evidencePosukKey);
        if(!verified.ok) return res.status(409).json({error:verified.error});
        const parsed=parsePracticeKey(awardPosukKey);
        requestId=safeKey(`milestone_${source}_${studentId}_${awardPosukKey}`);
        reason=reasonFor(source,parsed?.perek,parsed?.start);
        record={awardPosukKey,evidencePosukKey,verifiedScore:verified.score,perek:parsed?.perek||null,posuk:parsed?.start||null};
      }else{
        const eventId=String(body.eventId||"");
        chazaraVerification=await verifyChazara(studentId,source,eventId);
        if(!chazaraVerification.ok) return res.status(409).json({error:chazaraVerification.error});
        const e=chazaraVerification.event;
        requestId=safeKey(`chazara_${studentId}_${eventId}`);
        reason=reasonFor(source,e.perek,e.posuk);
        record={eventId,perek:e.perek||null,posuk:e.posuk||null,recorded:e.recorded===true};
      }

      if(source === "reading100" || source === "translation100" || source === "understand100"){
        const result=await awardMilestoneImmediately({requestId,rewardStudentId,studentId,source,amount,reason,record});
        if(!result.ok) return res.status(409).json({error:result.error});
        return res.status(200).json({ok:true,awarded:result.newlyAwarded,status:result.status,requestId,amount:result.amount,balanceAfter:result.balanceAfter});
      }

      const result=await createPendingRequest({requestId,rewardStudentId,studentId,source,amount,reason,record});
      if(chazaraVerification?.eventRef){
        await chazaraVerification.eventRef.update({pointRequestId:requestId,pointRequestStatus:result.status,pointRequestCreatedAt:Date.now()});
      }
      return res.status(200).json({ok:true,requested:result.created,status:result.status,requestId,amount});
    }catch(err){
      console.error("studentRewardsAutoAward",err);
      return res.status(500).json({error:"Could not create the point request."});
    }
  }
);
