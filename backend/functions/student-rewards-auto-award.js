const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

const teacherClassScope=require("./teacher-class-scope");
const rewardsStore=require('./rewards-store.cjs');
const studentTools=require('./student-tool-policy.js');
const {authorizePracticeStudent}=require('./student-practice-auth.cjs');
const rashiCore=require('./rashi-recording-core.cjs');
const SR_ROOT = "studentRewards";
const ADMIN_EMAIL = "simcha5770@gmail.com";
const POINTS = Object.freeze({
  reading100: 3,
  translation100: 5,
  understand100: 3,
  chazara: 1,
  "chazara-recording": 2,
  "shorashim-recording": 2,
  "shorashim-no-hints": 3,
  [rashiCore.RASHI_SOURCE]: rashiCore.RASHI_POINTS,
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


function isShorashimRequest(item){return ["shorashim-recording","shorashim-no-hints"].includes(String(item?.source||""));}
function isMilestoneRequest(item){return ['reading100','translation100','understand100'].includes(String(item?.source||''));}
function isRashiRequest(item){return String(item?.source||"")===rashiCore.RASHI_SOURCE;}
function isReviewableRequest(item){return isChazaraRequest(item)||isShorashimRequest(item)||isMilestoneRequest(item);}
function isChazaraRequest(item){
  return ["chazara","chazara-recording"].includes(String(item?.source || ""));
}

async function requireTeacher(req){
  const header=String(req.headers.authorization || "");
  if(!header.startsWith("Bearer ")) return {ok:false,error:"Teacher sign-in required."};
  try{
    const decoded=await admin.auth().verifyIdToken(header.slice(7));
    const email=String(decoded.email || "").trim().toLowerCase();
    if(decoded.email_verified!==true)return {ok:false,error:"Verified Google sign-in required."};
    const get=async p=>(await rtdb.ref(p).get()).val(),classId=String(req.body?.classId||'');
    if(email===ADMIN_EMAIL){
      const scope=classId?await teacherClassScope.roster(get,{authorized:true,role:'admin'},classId):null;
      return {ok:true,email,decoded,owner:true,scope};
    }
    const row=await get('b3Games/workspaces/b3-2026/teachers/'+decoded.uid);
    if(!row||row.active===false)return {ok:false,error:'This teacher account is not active.'};
    const actions=['rashi-list-pending','rashi-approve','rashi-reject','list-chazara-pending','list-chazara-recordings','get-chazara-recording-audio','approve-point-request','reject-point-request','teacher-add-chazara','teacher-delete-chazara','teacher-reject-chazara-recording','teacher-set-recording-full-review'];
    if(!actions.includes(req.body?.action))return {ok:false,error:'This action is available only to the owner.'};
    const classIds=Object.keys(row.classIds||{}).filter(id=>id!=='*'&&row.classIds[id]===true);
    const scope=await teacherClassScope.roster(get,{authorized:true,role:'teacher',classIds},classId,String(req.body?.action||'').startsWith('rashi-')?'rashi-letters':'chazara');
    return {ok:true,email,decoded,owner:false,scope};
  }catch(err){
    console.warn("Teacher token verification failed",err);
    return {ok:false,error:"Teacher sign-in expired. Please sign in again."};
  }
}

async function authorizeChazaraAction(teacher,body){
 if(!teacher.scope){
  if(body.action==='get-chazara-recording-audio'&&!teacher.owner)throw Object.assign(new Error('Teacher class scope is required.'),{code:403});
  return;
 }
 const scope=teacher.scope,action=body.action;
 if(action==='list-chazara-pending'||action==='list-chazara-recordings')return;
 if(action==='get-chazara-recording-audio'){
  if(!teacherClassScope.validKey(String(body.studentId||''))||!/^[A-Za-z0-9_-]{1,220}$/.test(String(body.eventId||''))||!scope.students?.[body.studentId])throw Object.assign(new Error('Invalid or out-of-scope Chazara recording.'),{code:403});
  const event=(await rtdb.ref(`posukPractice/chazara/events/${body.studentId}/${body.eventId}`).get()).val();
  if(!teacherClassScope.recordAllowed(scope,body.studentId,event))throw Object.assign(new Error('This Chazara does not belong to your selected class.'),{code:403});
  return;
 }
 if(String(action).startsWith('rashi-'))return; // the Rashi handlers check class scope themselves
 if(action==='repair-shorashim-recording'){
   if(!scope.students?.[body.studentId])throw Object.assign(new Error('Student is outside your class.'),{code:403});
   return;
 }
 if(action==='approve-point-request'||action==='reject-point-request'){
  if(!/^[A-Za-z0-9_-]{1,220}$/.test(String(body.requestId||'')))throw Object.assign(new Error('Invalid point request.'),{code:403});
  const item=(await rtdb.ref(`${SR_ROOT}/pointRequests/${body.requestId}`).get()).val();
  if(!isReviewableRequest(item)||!teacherClassScope.recordAllowed(scope,item?.practiceStudentId,item))throw Object.assign(new Error('This request does not belong to your selected class.'),{code:403});
  return;
 }
 if(!scope.students[body.studentId])throw Object.assign(new Error('This student does not belong to your selected class.'),{code:403});
 if(action!=='teacher-add-chazara'){
  if(!/^[A-Za-z0-9_-]{1,220}$/.test(String(body.eventId||'')))throw Object.assign(new Error('Invalid Chazara event.'),{code:403});
  const event=(await rtdb.ref(`posukPractice/chazara/events/${body.studentId}/${body.eventId}`).get()).val();
  if(!teacherClassScope.recordAllowed(scope,body.studentId,event))throw Object.assign(new Error('This Chazara does not belong to your selected class.'),{code:403});
 }
 body.classId=scope.selected;
}


// ---------- Rashi Letters reading recordings (2026-10-23) ----------
const RASHI_BUCKET='b3-games.firebasestorage.app';
const rashiRecordRef=(studentId,sectionId)=>rtdb.ref(`rashiLetters/recordings/${studentId}/${sectionId}`);
async function rashiRequestStatus(requestId){
  const v=(await rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`).get()).val();
  return v?String(v.status||'pending'):null;
}
// Student sends one recording (raw audio in the body). Only the student's own
// verified sign-in works; the points request is created here, by the server,
// and is worth exactly 2 points once a teacher approves it.
async function rashiStudentSubmit(req,res){
  const student=await requirePracticeStudent(req,rashiCore.RASHI_SOURCE);
  if(!student.ok)return res.status(student.status||401).json({error:student.error});
  const {studentId,classId}=student;
  const sectionId=String(req.query.section||'');
  if(!rashiCore.isSection(sectionId))return res.status(400).json({error:'Unknown Rashi section.'});
  const rewardStudentId=await resolveRewardStudentId(studentId);
  if(!rewardStudentId)return res.status(404).json({error:'Could not match this student to Student Rewards.'});
  const words=rashiCore.cleanWords(req.query.words);
  const durationMs=Math.max(0,Math.min(Number(req.query.durationMs)||0,60*60*1000));
  const label=rashiCore.sectionLabel(sectionId);
  const makeRequest=record=>createPendingRequest({requestId:record.requestId,rewardStudentId,studentId,source:rashiCore.RASHI_SOURCE,
    amount:rashiCore.RASHI_POINTS,reason:`Rashi Letters reading — ${label}`,
    record:{sectionId,attemptId:record.attemptId,recordingPath:record.storagePath,workspaceClassId:classId,words:record.words||[]}});
  // 1. Already waiting or approved: never upload or create anything new.
  const existing=(await rashiRecordRef(studentId,sectionId).get()).val();
  if(existing&&existing.status!=='rejected'){
    let status=String(existing.status||'pending');
    if(status==='pending'){
      const made=await makeRequest(existing); // repairs a request that never got saved
      if(['approved','rejected'].includes(made.status)){
        await mirrorRashiRecording({id:existing.requestId,practiceStudentId:studentId,sectionId,attemptId:existing.attemptId,workspaceClassId:classId,amount:rashiCore.RASHI_POINTS},made.status);
        status=made.status;
      }
    }
    if(status!=='rejected')return res.status(200).json({ok:true,alreadySubmitted:true,status,sectionId});
  }
  const audio=Buffer.isBuffer(req.rawBody)?req.rawBody:(Buffer.isBuffer(req.body)?req.body:null);
  if(!audio||audio.length<rashiCore.MIN_BYTES)return res.status(400).json({error:'The recording was too short. Please record again.'});
  if(audio.length>rashiCore.MAX_BYTES)return res.status(413).json({error:'The recording is too long. Please record a shorter one.'});
  if(durationMs<rashiCore.MIN_DURATION_MS)return res.status(400).json({error:'The recording was too short. Please record again.'});
  const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(!/^audio\/(webm|mp4|ogg|mpeg|wav|x-m4a|aac)$/.test(type))return res.status(415).json({error:'Unsupported audio type.'});
  // 2. Save the audio privately (path is tied to class, student and section).
  const attemptId=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const ext=type==='audio/mp4'||type==='audio/x-m4a'||type==='audio/aac'?'m4a':type==='audio/ogg'?'ogg':type==='audio/mpeg'?'mp3':type==='audio/wav'?'wav':'webm';
  const storagePath=`rashi-recordings/${classId}/${studentId}/${sectionId}/${attemptId}.${ext}`;
  const file=admin.storage().bucket(RASHI_BUCKET).file(storagePath);
  await file.save(audio,{resumable:false,contentType:type,metadata:{cacheControl:'private, max-age=0'}});
  const requestId=rashiCore.requestIdFor(studentId,sectionId,attemptId);
  const seed={sectionId,attemptId,requestId,storagePath,studentId,classId,words,durationMs,sizeBytes:audio.length,contentType:type,status:'pending',attempt:1,createdAt:Date.now()};
  // 3. Claim the one slot for this student+section (only if nothing is
  //    pending/approved). A double-click loses here and its upload is removed.
  let claimed=null,blockedBy=null;
  const tx=await rashiRecordRef(studentId,sectionId).transaction(cur=>{
    const r=rashiCore.claim(cur,seed);
    if(r.block){blockedBy=r.block;return;}
    claimed=r.write;return r.write;
  });
  if(!tx.committed||!claimed||tx.snapshot.val()?.attemptId!==attemptId){
    await file.delete().catch(()=>{});
    const live=(await rashiRecordRef(studentId,sectionId).get()).val();
    return res.status(200).json({ok:true,alreadySubmitted:true,status:String(live?.status||blockedBy||'pending'),sectionId});
  }
  if(claimed.previousAttemptId&&existing)await rtdb.ref(`rashiLetters/recordingHistory/${studentId}/${sectionId}/${existing.attemptId}`).set(existing).catch(()=>{});
  // 4. The points request (deterministic id, so a retry never doubles it).
  await makeRequest(claimed);
  return res.status(200).json({ok:true,status:'pending',sectionId,attempt:claimed.attempt});
}
// Student asks for the status of every section (one call, no polling).
async function rashiStudentStatus(req,res){
  const student=await requirePracticeStudent(req,rashiCore.RASHI_SOURCE);
  if(!student.ok)return res.status(student.status||401).json({error:student.error});
  const rows=(await rtdb.ref(`rashiLetters/recordings/${student.studentId}`).get()).val()||{};
  const sections={};
  for(const [sectionId,record] of Object.entries(rows)){
    if(!rashiCore.isSection(sectionId)||!record)continue;
    let reqStatus=null;
    if(record.status==='pending'&&record.requestId){
      reqStatus=await rashiRequestStatus(record.requestId);
      if(reqStatus==='approved'||reqStatus==='rejected')await mirrorRashiRecording({id:record.requestId,practiceStudentId:student.studentId,sectionId,attemptId:record.attemptId,workspaceClassId:record.classId,amount:rashiCore.RASHI_POINTS},reqStatus);
    }
    sections[sectionId]=rashiCore.publicStatus(record,reqStatus);
  }
  return res.status(200).json({ok:true,sections});
}
async function rashiTeacherList(teacher){
  const scope=teacher.scope;
  const all=(await rtdb.ref(`${SR_ROOT}/pointRequests`).get()).val()||{};
  const bucket=admin.storage().bucket(RASHI_BUCKET),rows=[];
  for(const [id,item] of Object.entries(all)){
    if(!isRashiRequest(item)||item.status!=='pending')continue;
    if(scope&&!teacherClassScope.recordAllowed(scope,item.practiceStudentId,item))continue;
    const record=(await rashiRecordRef(item.practiceStudentId,item.sectionId).get()).val();
    if(!record||record.attemptId!==item.attemptId||!record.storagePath)continue;
    let audioUrl=null;
    try{[audioUrl]=await bucket.file(record.storagePath).getSignedUrl({action:'read',expires:Date.now()+60*60*1000});}catch(err){console.warn('Rashi recording URL failed',err);}
    const info=scope?.students?.[item.practiceStudentId];
    rows.push({id,studentId:item.practiceStudentId,studentName:item.studentName||info?.name||item.practiceStudentId,
      classId:item.workspaceClassId||info?.classId||'',className:info?.className||item.workspaceClassId||'',sectionId:item.sectionId,
      sectionLabel:rashiCore.sectionLabel(item.sectionId),words:record.words||[],attempt:record.attempt||1,createdAt:item.createdAt||record.createdAt||0,
      durationMs:record.durationMs||0,amount:item.amount,audioUrl});
  }
  return rows.sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
}
// Teachers may only act on a Rashi recording from a class they manage.
async function rashiAuthorizeRequest(teacher,requestId){
  if(!/^[A-Za-z0-9_-]{1,220}$/.test(String(requestId||'')))throw Object.assign(new Error('Invalid recording request.'),{code:403});
  const item=(await rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`).get()).val();
  if(!isRashiRequest(item))throw Object.assign(new Error('This is not a Rashi recording.'),{code:403});
  if(teacher.scope&&!teacherClassScope.recordAllowed(teacher.scope,item.practiceStudentId,item))throw Object.assign(new Error('This recording does not belong to your selected class.'),{code:403});
  return item;
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

async function requirePracticeStudent(req,source){
  const result=await authorizePracticeStudent({
    authorization:req.headers.authorization,
    verifyToken:token=>admin.auth().verifyIdToken(token),
    get:async path=>(await rtdb.ref(path).get()).val(),source,studentTools
  });
  if(!result.ok&&result.status===401)console.warn('Practice student token was missing or invalid.');
  return result;
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
      const item=child.val() || {};
      const amount=Math.abs(Number(item.amount || 0));
      if(!amount) return;
      rows.push({
        id:child.key,
        source:"class-reward-contribution",
        reason:item.reason || `Class contribution — ${item.rewardName || "Class Reward"}`,
        actualAmount:-amount,
        amount:-amount,
        createdAt:item.createdAt || null,
        reviewedAt:item.createdAt || null,
        classId:item.classId || null,
        rewardId:item.rewardId || null,
        rewardName:item.rewardName || null,
        balanceAfter:item.balanceAfter ?? null,
      });
    });
  }
  rows.sort((a,b)=>(Number(b.reviewedAt || b.createdAt)||0)-(Number(a.reviewedAt || a.createdAt)||0));
  return rows;
}

function studentClassIdsFromRoot(root,studentId){
  const out=[];
  const enrollments=root?.enrollments||{};
  for(const [classId,members] of Object.entries(enrollments)){
    if(members?.[studentId]===true && root?.classes?.[classId]?.active!==false) out.push(classId);
  }
  // Older data sometimes stored membership inside the class itself. Keep this
  // as a fallback so existing students do not lose access during migration.
  if(!out.length){
    for(const [classId,c] of Object.entries(root?.classes||{})){
      if(c?.active===false) continue;
      const members=c?.studentIds||c?.students||{};
      if((Array.isArray(members)&&members.includes(studentId)) || (members&&typeof members==='object'&&members[studentId])) out.push(classId);
    }
  }
  const direct=String(root?.students?.[studentId]?.classId||'').trim();
  if(direct && root?.classes?.[direct]?.active!==false && !out.includes(direct)) out.unshift(direct);
  return [...new Set(out)];
}

function chooseStudentClass(root,studentId,preferred=''){
  const ids=studentClassIdsFromRoot(root,studentId);
  const wanted=String(preferred||'').trim();
  if(wanted && ids.includes(wanted)) return wanted;
  return ids[0]||'';
}

function classRosterCountFromRoot(root,classId){
  const enrolled=root?.enrollments?.[classId]||{};
  let count=Object.keys(enrolled).filter(studentId=>enrolled[studentId]===true && root?.students?.[studentId]?.active!==false).length;
  if(count) return count;
  const c=root?.classes?.[classId]||{};
  const members=c.studentIds||c.students||{};
  if(Array.isArray(members)) count=members.filter(studentId=>root?.students?.[studentId]?.active!==false).length;
  else if(members&&typeof members==='object') count=Object.keys(members).filter(studentId=>members[studentId] && root?.students?.[studentId]?.active!==false).length;
  return Math.max(1,count||0);
}

const DAY_MS = 24*60*60*1000;
const GIMKIT_DEFAULT_MODES = Object.freeze([
  {id:'fishtopia',name:'Fishtopia'},
  {id:'tag-domination',name:'Tag: Domination'},
  {id:'capture-the-flag',name:'Capture the Flag'},
  {id:'farmchain',name:'Farmchain'},
  {id:'snowbrawl',name:'Snowbrawl'},
  {id:'snowy-survival',name:'Snowy Survival'},
  {id:'one-way-out',name:'One Way Out'},
  {id:'dont-look-down',name:"Don't Look Down"},
  {id:'blastball',name:'Blastball'},
]);

function classRewardModeId(name){
  return String(name||'mode').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'mode';
}
function isGimkitReward(item,rewardId=''){
  const id=String(rewardId||item?.id||'').toLowerCase();
  const name=String(item?.name||'').trim().toLowerCase();
  return item?.modeVotingEnabled===true || id.includes('gimkit') || name==='gimkit';
}
function classRewardModes(item,rewardId=''){
  if(!isGimkitReward(item,rewardId)) return [];
  const raw=item?.modes;
  let modes=[];
  if(Array.isArray(raw)){
    modes=raw.map((m,i)=>({id:String(m?.id||classRewardModeId(m?.name||`mode-${i+1}`)),name:String(m?.name||'').trim(),active:m?.active!==false}));
  }else if(raw&&typeof raw==='object'){
    modes=Object.entries(raw).map(([key,m])=>({id:String(m?.id||key),name:String(m?.name||key).trim(),active:m?.active!==false}));
  }
  modes=modes.filter(m=>m.active!==false&&m.name);
  if(!modes.length)modes=GIMKIT_DEFAULT_MODES.map(m=>({...m,active:true}));
  const seen=new Set();
  return modes.filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true;});
}
function classRewardCooldown(item,live,completed){
  const cooldownDays=Math.max(0,Number(item?.cooldownDays)||0);
  const completedAt=Math.max(0,Number(live?.completedAt)||Number(live?.lastWinner?.wonAt)||0);
  const storedUntil=Math.max(0,Number(live?.cooldownUntil)||0);
  const cooldownUntil=storedUntil||(cooldownDays>0&&completedAt?completedAt+cooldownDays*DAY_MS:0);
  const cooling=cooldownDays>0&&cooldownUntil>Date.now();
  const expired=!!(cooldownDays>0&&cooldownUntil&&cooldownUntil<=Date.now());
  return {cooldownDays,completedAt,cooldownUntil,cooling,expired,completed:!!completed};
}
function modeVoterCount(voters){return Object.values(voters||{}).filter(Boolean).length;}
function maxModeTotal(modes){return modes.reduce((m,x)=>Math.max(m,Number(x.total)||0),0);}

function classRewardGoalFromRoot(root,studentId,classId,rewardId){
  const item=root?.classRewardCatalog?.[rewardId];
  if(!item || item.active===false) return null;
  const count=classRosterCountFromRoot(root,classId);
  const live=root?.classRewardRounds?.[classId]?.[rewardId]||{};
  const perStudentCost=Math.max(1,Number(live.perStudentCost)||Number(item.costPerStudent)||100);
  const goalPoints=Math.max(1,Number(live.goalPoints)||perStudentCost*count);
  const studentCap=Math.max(1,Number(live.maxPerStudent)||Math.min(goalPoints,Math.ceil((goalPoints/count)*2)));
  const settingsAvailable=root?.settings?.classRewardAvailability?.[rewardId];
  const available=item.available!==false && settingsAvailable!==false;
  const modeVoting=isGimkitReward(item,rewardId);

  if(modeVoting){
    const configured=classRewardModes(item,rewardId);
    const modeTotals=live.modeTotals&&typeof live.modeTotals==='object'?live.modeTotals:{};
    const modeVoters=live.modeVoters&&typeof live.modeVoters==='object'?live.modeVoters:{};
    const modes=configured.map(m=>{
      const total=Math.max(0,Number(modeTotals[m.id])||0);
      const voters=modeVoterCount(modeVoters[m.id]);
      return {...m,total,voters,pct:Math.max(0,Math.min(100,Math.round(total/goalPoints*100)))};
    });
    const cooldown=classRewardCooldown(item,live,!!live.lastWinner);
    const studentContributed=cooldown.cooling?0:Math.max(0,Number(live.byStudent?.[studentId])||0);
    const remainingStudentCap=Math.max(0,studentCap-studentContributed);
    const leaderTotal=maxModeTotal(modes);
    const status=cooldown.cooling?'cooldown':(leaderTotal>0||live.startedAt?'active':'not-started');
    return {
      rewardId,
      name:item.name||'Gimkit',
      icon:item.icon||'🎯',
      active:item.active!==false,
      available,
      classId,
      className:root?.classes?.[classId]?.name||classId,
      classSize:count,
      perStudentCost,
      goalPoints,
      totalContributed:leaderTotal,
      remainingGoal:Math.max(0,goalPoints-leaderTotal),
      studentCap,
      studentContributed,
      remainingStudentCap,
      status,
      cooldownDays:cooldown.cooldownDays,
      cooldownUntil:cooldown.cooldownUntil||null,
      modeVoting:true,
      modes,
      lastWinner:live.lastWinner||null,
    };
  }

  const rawTotal=Math.max(0,Number(live.totalContributed)||0);
  const completed=rawTotal>=goalPoints;
  const cooldown=classRewardCooldown(item,live,completed);
  const resetExpired=completed&&cooldown.expired;
  const totalContributed=resetExpired?0:rawTotal;
  const studentContributed=resetExpired?0:Math.max(0,Number(live.byStudent?.[studentId])||0);
  const remainingGoal=Math.max(0,goalPoints-totalContributed);
  const remainingStudentCap=Math.max(0,studentCap-studentContributed);
  const status=cooldown.cooling?'cooldown':resetExpired?'not-started':(totalContributed>=goalPoints?'completed':String(live.status||'not-started'));
  return {
    rewardId,
    name:item.name||'Class Reward',
    icon:item.icon||'⭐',
    active:item.active!==false,
    available,
    classId,
    className:root?.classes?.[classId]?.name||classId,
    classSize:count,
    perStudentCost,
    goalPoints,
    totalContributed,
    remainingGoal,
    studentCap,
    studentContributed,
    remainingStudentCap,
    status,
    cooldownDays:cooldown.cooldownDays,
    cooldownUntil:cooldown.cooldownUntil||null,
    modeVoting:false,
  };
}

// Only the parts of studentRewards that the status check needs. Reading the
// whole root here (with daily ratings, requests, history) on every 5-60s poll
// was the main source of Realtime Database download charges.
const CLASS_REWARD_STATUS_KEYS=['students','enrollments','classes','settings','classRewardCatalog','classRewardRounds'];
async function readClassRewardStatusRoot(){
  const snaps=await Promise.all(CLASS_REWARD_STATUS_KEYS.map(k=>rtdb.ref(`${SR_ROOT}/${k}`).get()));
  const root={};
  CLASS_REWARD_STATUS_KEYS.forEach((k,i)=>{const v=snaps[i].val();if(v!=null)root[k]=v;});
  return root;
}

async function classRewardStatusForStudent(studentId,preferredClassId=''){
  const root=await readClassRewardStatusRoot();
  const balance=Math.max(0,Number(root?.students?.[studentId]?.rewardBalance)||0);
  const classId=chooseStudentClass(root,studentId,preferredClassId);
  if(!classId) return {goals:[],storeOpen:root?.settings?.rewardStoreEnabled===true||String(root?.settings?.rewardStoreEnabled)==='true',classId:'',balance};
  const goals=[];
  for(const rewardId of Object.keys(root.classRewardCatalog||{})){
    if(!rewardsStore.itemInStore(root,classId,root.classRewardCatalog[rewardId]))continue;
    const goal=classRewardGoalFromRoot(root,studentId,classId,rewardId);
    if(goal) goals.push(goal);
  }
  goals.sort((a,b)=>a.perStudentCost-b.perStudentCost||String(a.name).localeCompare(String(b.name)));
  return {
    goals,
    classId,
    className:root?.classes?.[