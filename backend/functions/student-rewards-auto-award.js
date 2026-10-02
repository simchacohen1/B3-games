const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

const teacherClassScope=require("./teacher-class-scope");
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
    const actions=['list-chazara-pending','approve-point-request','reject-point-request','teacher-add-chazara','teacher-delete-chazara','teacher-reject-chazara-recording','teacher-set-recording-full-review'];
    if(!actions.includes(req.body?.action))return {ok:false,error:'This action is available only to the owner.'};
    const classIds=Object.keys(row.classIds||{}).filter(id=>id!=='*'&&row.classIds[id]===true);
    const scope=await teacherClassScope.roster(get,{authorized:true,role:'teacher',classIds},classId);
    return {ok:true,email,decoded,owner:false,scope};
  }catch(err){
    console.warn("Teacher token verification failed",err);
    return {ok:false,error:"Teacher sign-in expired. Please sign in again."};
  }
}

async function authorizeChazaraAction(teacher,body){
 if(!teacher.scope)return;
 const scope=teacher.scope,action=body.action;
 if(action==='list-chazara-pending')return;
 if(action==='approve-point-request'||action==='reject-point-request'){
  if(!/^[A-Za-z0-9_-]{1,220}$/.test(String(body.requestId||'')))throw Object.assign(new Error('Invalid point request.'),{code:403});
  const item=(await rtdb.ref(`${SR_ROOT}/pointRequests/${body.requestId}`).get()).val();
  if(!isChazaraRequest(item)||!teacherClassScope.recordAllowed(scope,item?.practiceStudentId,item))throw Object.assign(new Error('This request does not belong to your selected class.'),{code:403});
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

async function classRewardStatusForStudent(studentId,preferredClassId=''){
  const root=(await rtdb.ref(SR_ROOT).get()).val()||{};
  const classId=chooseStudentClass(root,studentId,preferredClassId);
  if(!classId) return {goals:[],storeOpen:root?.settings?.rewardStoreEnabled===true||String(root?.settings?.rewardStoreEnabled)==='true',classId:''};
  const goals=[];
  for(const rewardId of Object.keys(root.classRewardCatalog||{})){
    const goal=classRewardGoalFromRoot(root,studentId,classId,rewardId);
    if(goal) goals.push(goal);
  }
  goals.sort((a,b)=>a.perStudentCost-b.perStudentCost||String(a.name).localeCompare(String(b.name)));
  return {
    goals,
    classId,
    className:root?.classes?.[classId]?.name||classId,
    storeOpen:root?.settings?.rewardStoreEnabled===true||String(root?.settings?.rewardStoreEnabled)==='true',
  };
}

async function contributeToClassReward(studentId,rewardId,amount,preferredClassId='',requestedModeIds=[]){
  amount=Math.floor(Number(amount||0));
  if(!Number.isFinite(amount)||amount<1) return {ok:false,error:'Enter how many points you want to contribute.'};

  const root=(await rtdb.ref(SR_ROOT).get()).val()||{};
  const classId=chooseStudentClass(root,studentId,preferredClassId);
  if(!classId) return {ok:false,error:'Could not find your class.'};
  const storeOpen=root?.settings?.rewardStoreEnabled===true||String(root?.settings?.rewardStoreEnabled)==='true';
  if(!storeOpen) return {ok:false,error:'The Prize Store is closed right now.'};
  const goal=classRewardGoalFromRoot(root,studentId,classId,rewardId);
  if(!goal) return {ok:false,error:'That class reward is no longer available.'};
  if(!goal.available) return {ok:false,error:'That class reward is closed right now.'};
  if(goal.status==='cooldown') return {ok:false,error:`Gimkit is on cooldown right now.`};

  let selectedModes=[];
  if(goal.modeVoting){
    const allowedIds=new Set((goal.modes||[]).map(m=>m.id));
    selectedModes=[...new Set((Array.isArray(requestedModeIds)?requestedModeIds:[]).map(String).filter(id=>allowedIds.has(id)))];
    if(!selectedModes.length) return {ok:false,error:'Choose at least one Gimkit mode.'};
  }

  const balance=Math.max(0,Number(root?.students?.[studentId]?.rewardBalance)||0);
  const allowed=Math.max(0,Math.min(balance,goal.remainingStudentCap,goal.modeVoting?Number.MAX_SAFE_INTEGER:goal.remainingGoal));
  if(amount>allowed) return {ok:false,error:`You can contribute up to ${allowed} points to this goal right now.`};

  const balRef=rtdb.ref(`${SR_ROOT}/students/${studentId}/rewardBalance`);
  let balanceAfter=null;
  const balTx=await balRef.transaction(cur=>{
    const current=Math.max(0,Number(cur)||0);
    if(current<amount) return;
    return current-amount;
  });
  if(!balTx.committed) return {ok:false,error:'You do not have enough points for that contribution.'};
  balanceAfter=Math.max(0,Number(balTx.snapshot.val())||0);

  const item=root?.classRewardCatalog?.[rewardId]||{};
  const roundRef=rtdb.ref(`${SR_ROOT}/classRewardRounds/${classId}/${rewardId}`);
  let roundError='', winner=null, allocations={};
  const roundTx=await roundRef.transaction(cur=>{
    let live=cur&&typeof cur==='object'?{...cur}:{};
    const perStudentCost=Math.max(1,Number(live.perStudentCost)||goal.perStudentCost);
    const goalPoints=Math.max(1,Number(live.goalPoints)||goal.goalPoints);
    const maxPerStudent=Math.max(1,Number(live.maxPerStudent)||goal.studentCap);
    const cooldownDays=Math.max(0,Number(item.cooldownDays)||0);
    const now=Date.now();

    if(goal.modeVoting){
      const liveUntil=Math.max(0,Number(live.cooldownUntil)||0);
      if(liveUntil>now){roundError='Gimkit is on cooldown right now.';return;}
      if(liveUntil&&liveUntil<=now){
        live={...live,status:'active',cooldownUntil:null,byStudent:{},updatedAt:now};
      }
      const mine=Math.max(0,Number(live.byStudent?.[studentId])||0);
      const mineLeft=Math.max(0,maxPerStudent-mine);
      if(amount>mineLeft){roundError=`You can contribute up to ${mineLeft} more points to Gimkit right now.`;return;}

      const configured=classRewardModes(item,rewardId);
      const modeMap=new Map(configured.map(m=>[m.id,m]));
      const selected=selectedModes.filter(id=>modeMap.has(id));
      if(!selected.length){roundError='Choose at least one Gimkit mode.';return;}
      const share=amount/selected.length;
      const modeTotals={...(live.modeTotals||{})};
      const modeVoters={...(live.modeVoters||{})};
      allocations={};
      for(const id of selected){
        modeTotals[id]=Math.max(0,Number(modeTotals[id])||0)+share;
        modeVoters[id]={...(modeVoters[id]||{}),[studentId]:true};
        allocations[id]=share;
      }

      const crossed=selected.map(id=>({
        id,
        name:modeMap.get(id)?.name||id,
        total:Number(modeTotals[id])||0,
        voters:modeVoterCount(modeVoters[id]),
      })).filter(x=>x.total>=goalPoints).sort((a,b)=>b.total-a.total||b.voters-a.voters||a.name.localeCompare(b.name));

      winner=crossed[0]||null;
      let nextByStudent={...(live.byStudent||{}),[studentId]:mine+amount};
      let status='active',completedAt=live.completedAt||null,cooldownUntil=null;
      if(winner){
        winner={...winner,wonAt:now};
        modeTotals[winner.id]=0;
        modeVoters[winner.id]={};
        nextByStudent={};
        completedAt=now;
        cooldownUntil=cooldownDays>0?now+cooldownDays*DAY_MS:null;
        status=cooldownDays>0?'cooldown':'active';
      }
      const leader=Math.max(0,...configured.map(m=>Number(modeTotals[m.id])||0));
      return {
        ...live,
        rewardId,
        rewardName:goal.name,
        classId,
        className:goal.className,
        perStudentCost,
        goalPoints,
        maxPerStudent,
        totalContributed:leader,
        byStudent:nextByStudent,
        modeVoting:true,
        modeTotals,
        modeVoters,
        status,
        startedAt:live.startedAt||now,
        updatedAt:now,
        completedAt,
        cooldownUntil,
        lastWinner:winner||live.lastWinner||null,
      };
    }

    const rawTotal=Math.max(0,Number(live.totalContributed)||0);
    const completedAt=Math.max(0,Number(live.completedAt)||0);
    const computedUntil=Math.max(0,Number(live.cooldownUntil)||0)||(cooldownDays>0&&completedAt?completedAt+cooldownDays*DAY_MS:0);
    if(rawTotal>=goalPoints){
      if(cooldownDays>0&&computedUntil>now){roundError='That class reward is on cooldown right now.';return;}
      if(cooldownDays===0){roundError='That class reward has already reached its goal.';return;}
      live={};
    }
    const total=Math.max(0,Number(live.totalContributed)||0);
    const mine=Math.max(0,Number(live.byStudent?.[studentId])||0);
    const remaining=Math.max(0,goalPoints-total);
    const mineLeft=Math.max(0,maxPerStudent-mine);
    if(amount>remaining){roundError=`Only ${remaining} points are still needed for this goal.`;return;}
    if(amount>mineLeft){roundError=`You can contribute up to ${mineLeft} more points to this goal.`;return;}
    const nextTotal=total+amount;
    const justCompleted=nextTotal>=goalPoints;
    const completeTime=justCompleted?now:null;
    return {
      ...live,
      rewardId,
      rewardName:goal.name,
      classId,
      className:goal.className,
      perStudentCost,
      goalPoints,
      maxPerStudent,
      totalContributed:nextTotal,
      byStudent:{...(live.byStudent||{}),[studentId]:mine+amount},
      status:justCompleted?(cooldownDays>0?'cooldown':'completed'):'active',
      startedAt:live.startedAt||now,
      updatedAt:now,
      completedAt:completeTime,
      cooldownUntil:justCompleted&&cooldownDays>0?now+cooldownDays*DAY_MS:null,
    };
  });

  if(!roundTx.committed){
    await balRef.transaction(cur=>Math.max(0,Number(cur)||0)+amount).catch(()=>{});
    return {ok:false,error:roundError||'Could not add those points to the class goal. Please try again.'};
  }

  const modeNames=goal.modeVoting?selectedModes.map(id=>goal.modes.find(m=>m.id===id)?.name||id):[];
  const contributionRef=rtdb.ref(`${SR_ROOT}/classRewardContributionsByStudent/${studentId}`).push();
  const contribution={
    id:contributionRef.key,
    studentId,
    classId,
    className:goal.className,
    rewardId,
    rewardName:goal.name,
    amount,
    reason:goal.modeVoting?`Gimkit contribution — ${modeNames.join(', ')}`:`Class contribution — ${goal.name}`,
    source:'class-reward-contribution',
    modeIds:goal.modeVoting?selectedModes:null,
    modeNames:goal.modeVoting?modeNames:null,
    modeAllocations:goal.modeVoting?allocations:null,
    winner:winner||null,
    createdAt:Date.now(),
    balanceAfter,
  };
  await contributionRef.set(contribution).catch(err=>console.warn('Could not save class reward contribution history',err));

  const latestRoot=(await rtdb.ref(SR_ROOT).get()).val()||{};
  const latestGoal=classRewardGoalFromRoot(latestRoot,studentId,classId,rewardId);
  return {ok:true,balance:balanceAfter,goal:latestGoal,winner};
}

async function mirrorChazaraPointStatus(item,status){
  if(!item?.practiceStudentId || !item?.eventId) return;
  const field=Number(item.amount || 0) < 0 ? "removalPointRequestStatus" : "pointRequestStatus";
  await rtdb.ref(`posukPractice/chazara/events/${item.practiceStudentId}/${item.eventId}/${field}`).set(status).catch(err=>console.warn("Could not mirror Chazara point status",err));
}

async function repairMissingChazaraPointRequests(scope){
  const studentIds=scope?Object.keys(scope.students||{}):[];
  if(!studentIds.length)return;
  for(const studentId of studentIds){
    const eventsSnap=await rtdb.ref(`posukPractice/chazara/events/${studentId}`).get();
    const events=eventsSnap.val()||{};
    for(const [eventId,e0] of Object.entries(events)){
      const e=e0||{};
      if(e.reviewApplied!==true||e.removed===true||e.teacherRejected===true)continue;
      if(e.pointRequestStatus==="approved"||e.pointRequestStatus==="rejected"||e.pointRequestStatus==="cancelled")continue;
      if(!teacherClassScope.recordAllowed(scope,studentId,e))continue;

      const source=e.recorded===true?"chazara-recording":"chazara";
      const requestId=safeKey(`chazara_${studentId}_${eventId}`);
      const existing=await rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`).get();
      if(existing.exists()){
        const value=existing.val()||{};
        await rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`).update({
          pointRequestId:requestId,
          pointRequestStatus:value.status||"pending"
        }).catch(()=>{});
        continue;
      }

      const rewardStudentId=await resolveRewardStudentId(studentId);
      if(!rewardStudentId){
        await rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`).update({
          pointRequestRepairError:"Could not match this student to Student Rewards.",
          pointRequestRepairAt:Date.now()
        }).catch(()=>{});
        continue;
      }

      // Verify the event using the same rules as a student-created request.
      const verified=await verifyChazara(studentId,source,eventId);
      if(!verified.ok){
        await rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`).update({
          pointRequestRepairError:verified.error||"Could not verify Chazara.",
          pointRequestRepairAt:Date.now()
        }).catch(()=>{});
        continue;
      }

      const amount=POINTS[source];
      const record={
        eventId,
        perek:e.perek||null,
        posuk:e.posuk||null,
        workspaceClassId:e.workspaceClassId||scope.selected||null,
        recorded:e.recorded===true
      };
      const result=await createPendingRequest({
        requestId,
        rewardStudentId,
        studentId,
        source,
        amount,
        reason:reasonFor(source,e.perek,e.posuk),
        record
      });
      await rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`).update({
        pointRequestId:requestId,
        pointRequestStatus:result.status||"pending",
        pointRequestCreatedAt:Date.now(),
        pointRequestSyncedAt:Date.now(),
        pointRequestRepairError:null
      }).catch(()=>{});
    }
  }
}

async function listPendingChazaraRequests(scope){
  if(scope){
    // Self-heal saved Chazaras whose client-side point request never reached
    // the server. Loading the teacher approval panel now recreates any missing
    // pending requests before returning the list.
    await repairMissingChazaraPointRequests(scope);
    const rows=[];
    // Read once and filter in code (no ".indexOn": "practiceStudentId" rule).
    const allRequests=(await rtdb.ref(`${SR_ROOT}/pointRequests`).get()).val()||{};
    for(const studentId of Object.keys(scope.students)){
      for(const [id,item] of Object.entries(allRequests))if(item?.practiceStudentId===studentId&&item.status==='pending'&&isChazaraRequest(item)&&teacherClassScope.recordAllowed(scope,studentId,item))rows.push({id,...item});
    }
    return rows.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
  }
  // Owner viewing all classes has no class scope. Self-heal every student's
  // saved Chazaras too, so the owner's "All classes" view also recovers
  // missing point requests.
  try{
    const studentIds=Object.keys((await rtdb.ref('posukPractice/chazara/events').get()).val()||{}).filter(id=>/^[A-Za-z0-9_-]{1,100}$/.test(id));
    await repairMissingChazaraPointRequests({owner:true,selected:'',students:Object.fromEntries(studentIds.map(id=>[id,{}]))});
  }catch(err){console.error('Owner Chazara self-heal failed',err)}
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

async function awardMilestoneImmediately({requestId,rewardStudentId,studentId,source,amount,reason,record,reviewedBy}){
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
  await ref.update({status:"approved",actualAmount:applied,balanceAfter,approvedAutomatically:true,reviewedBy:reviewedBy||"Verified Posuk Practice",reviewedAt:Date.now()});
  return {ok:true,newlyAwarded:true,requestId,status:"approved",amount:applied,balanceAfter};
}

async function resolveRewardStudentId(posukStudentId){
  // Filter in code: the database has no ".indexOn": "b3StudentId" rule, and
  // the Admin SDK refuses unindexed orderByChild queries.
  const rewardStudents=(await rtdb.ref(`${SR_ROOT}/students`).get()).val()||{};
  const links=Object.keys(rewardStudents).filter(id=>rewardStudents[id]?.b3StudentId===posukStudentId);
  if(links.length===1)return links[0];
  if(links.length>1)return null;

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
  if(e.recorded !== true || Number(e.durationMs||0) < 5000 || e.soundDetected !== true){
    return {ok:false,error:"The recording did not pass the recorded-Chazara checks."};
  }

  // New reliable Chazara save path: some student browsers cannot finish a
  // Firebase Storage upload, so the frontend can preserve the audio directly
  // in RTDB as a data:audio URL. Accept either a verified Storage object OR a
  // validated database audio payload. This keeps teacher approval working for
  // both old and new recordings.
  if(e.audioURL && e.storagePath){
    try{
      const [meta] = await admin.storage().bucket().file(String(e.storagePath)).getMetadata();
      if(Number(meta.size || 0) < 1000) return {ok:false,error:"The recording file is empty."};
    }catch(err){
      console.error("Could not verify Chazara storage object", err);
      return {ok:false,error:"The recording file could not be verified."};
    }
  }else{
    const dataUrl=String(e.audioDataURL||"");
    const declaredSize=Number(e.sizeBytes||0);
    if(!/^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[a-z0-9.+-]+)*;base64,/i.test(dataUrl) || declaredSize < 1000){
      return {ok:false,error:"The recording audio could not be verified."};
    }
    // Sanity-check that the encoded payload is consistent with a real audio
    // recording and not just an empty/placeholder data URL.
    const comma=dataUrl.indexOf(",");
    const encoded=comma>=0?dataUrl.slice(comma+1):"";
    if(encoded.length < 1200){
      return {ok:false,error:"The recording audio is empty."};
    }
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


function dateKeyInNewYork(t=Date.now()){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(t));
  const get=type=>parts.find(p=>p.type===type)?.value||"";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function validDateKey(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""));}
function timestampForDateKey(v){
  if(!validDateKey(v)) return NaN;
  const [y,m,d]=String(v).split("-").map(Number);
  const t=Date.UTC(y,m-1,d,17,0,0,0); // noon-ish in New York year-round; the calendar date is what matters.
  const x=new Date(t);
  return x.getUTCFullYear()===y && x.getUTCMonth()===m-1 && x.getUTCDate()===d ? t : NaN;
}
function chazaraEventDate(e){return String(e?.chazaraDate||"").trim() || dateKeyInNewYork(Number(e?.createdAt)||Date.now());}
function chazaraKey(perek,posuk){return `${Number(perek)}_${Number(posuk)}`;}

async function incrementChazaraSummary(studentId,perek,posuk,when,dateKey,name){
  const key=chazaraKey(perek,posuk),reviewRef=rtdb.ref(`posukPractice/chazara/students/${studentId}/reviews/${key}`);
  await reviewRef.transaction(cur=>{
    const count=Math.max(0,Number(cur?.count)||0)+1;
    const lastAt=Math.max(Number(cur?.lastAt)||0,Number(when)||0);
    return lastAt?{count,lastAt}:{count};
  });
  await rtdb.ref(`posukPractice/chazara/students/${studentId}`).update({
    name:name||studentId,goal:10,updatedAt:Date.now(),[`reviewDays/${dateKey}`]:true
  });
}

async function decrementChazaraSummary(studentId,event){
  const perek=Number(event?.perek),posuk=Number(event?.posuk),key=chazaraKey(perek,posuk),deletedAt=Number(event?.createdAt)||0;
  const eventsSnap=await rtdb.ref(`posukPractice/chazara/events/${studentId}`).get();
  let latestRemaining=0,otherOnDay=false;
  eventsSnap.forEach(child=>{
    if(child.key===String(event?.id||"")) return;
    const e=child.val()||{};
    if(e.reviewApplied!==true||e.removed===true||e.teacherRejected===true||e.pointRequestStatus==="rejected") return;
    if(Number(e.perek)===perek&&Number(e.posuk)===posuk) latestRemaining=Math.max(latestRemaining,Number(e.createdAt)||0);
    if(chazaraEventDate(e)===chazaraEventDate(event)) otherOnDay=true;
  });
  const reviewRef=rtdb.ref(`posukPractice/chazara/students/${studentId}/reviews/${key}`);
  await reviewRef.transaction(cur=>{
    const count=Math.max(0,(Number(cur?.count)||0)-1);
    if(!count) return null;
    const currentLast=Number(cur?.lastAt)||0;
    const lastAt=currentLast===deletedAt ? latestRemaining : currentLast;
    return lastAt?{count,lastAt}:{count};
  });
  if(!otherOnDay){
    await rtdb.ref(`posukPractice/chazara/students/${studentId}/reviewDays/${chazaraEventDate(event)}`).remove().catch(()=>{});
  }
  await rtdb.ref(`posukPractice/chazara/students/${studentId}/updatedAt`).set(Date.now());
}

async function teacherAddChazara(body,reviewedBy){
  const studentId=String(body.studentId||"").trim(),perek=Number(body.perek),posuk=Number(body.posuk),date=String(body.date||"").trim();
  const quantity=Math.max(1,Math.min(20,Math.floor(Number(body.quantity)||1)));
  if(!studentId) return {ok:false,error:"Choose a student."};
  if(!Number.isInteger(perek)||perek<1||perek>200) return {ok:false,error:"Enter a valid perek."};
  if(!Number.isInteger(posuk)||posuk<1||posuk>250) return {ok:false,error:"Enter a valid pasuk."};
  if(!validDateKey(date)) return {ok:false,error:"Choose a valid date."};
  let approved=await rtdb.ref(`b3Games/students/${studentId}/profile`).get();
  if(!approved.exists())approved=await rtdb.ref(`posukPractice/allowedStudents/${studentId}`).get();
  if(approved.val()?.active===false)return {ok:false,error:'Student access is turned off.'};
  if(!approved.exists()) return {ok:false,error:"That student is not approved for Posuk Practice."};
  const rewardStudentId=await resolveRewardStudentId(studentId);
  if(!rewardStudentId) return {ok:false,error:"Could not match this student to Student Rewards."};
  const studentName=approved.val()?.name||studentId,baseWhen=date===dateKeyInNewYork()?Date.now():timestampForDateKey(date);
  if(!Number.isFinite(baseWhen)) return {ok:false,error:"Choose a valid date."};
  const reviewSnap=await rtdb.ref(`posukPractice/chazara/students/${studentId}/reviews/${chazaraKey(perek,posuk)}`).get();
  let nextNumber=(Number(reviewSnap.val()?.count)||0)+1,totalPoints=0;
  const added=[];
  for(let i=0;i<quantity;i++){
    const eventRef=rtdb.ref(`posukPractice/chazara/events/${studentId}`).push(),eventId=eventRef.key,when=baseWhen+i;
    const event={
      id:eventId,studentId,studentName,perek,posuk,recorded:false,points:1,reviewApplied:false,removed:false,
      workspaceClassId:body.classId||null,teacherEntered:true,teacherEnteredBy:reviewedBy,teacherEnteredAt:Date.now(),chazaraDate:date,createdAt:when,reviewNumber:nextNumber+i
    };
    await eventRef.set(event);
    const requestId=safeKey(`chazara_${studentId}_${eventId}`);
    const award=await awardMilestoneImmediately({
      requestId,rewardStudentId,studentId,source:"chazara",amount:1,
      reason:`Teacher-entered Chazara — Perek ${perek} · Posuk ${posuk}`,
      record:{eventId,perek,posuk,workspaceClassId:body.classId||null,recorded:false,teacherEntered:true,chazaraDate:date},
      reviewedBy:`Teacher Chazara entry (${reviewedBy})`
    });
    if(!award.ok){
      await eventRef.remove().catch(()=>{});
      return {ok:false,error:award.error||"Could not add the Chazara points.",added,totalPoints};
    }
    await eventRef.update({reviewApplied:true,pointRequestId:requestId,pointRequestStatus:"approved",pointRequestCreatedAt:Date.now(),pointRequestSyncedAt:Date.now()});
    await incrementChazaraSummary(studentId,perek,posuk,when,date,studentName);
    totalPoints+=Number(award.amount)||0;
    added.push({eventId,reviewNumber:nextNumber+i});
  }
  return {ok:true,studentId,studentName,perek,posuk,date,quantity:added.length,pointsAdded:totalPoints,events:added};
}


async function reverseRecordingPointsForTeacherRejection(studentId,eventId,event,reviewedBy){
  const eventRef=rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`);
  const rewardStudentId=await resolveRewardStudentId(studentId);
  if(!rewardStudentId) return {ok:false,error:"Could not match this student to Student Rewards."};
  const originalId=String(event?.pointRequestId||safeKey(`chazara_${studentId}_${eventId}`));
  const originalRef=rtdb.ref(`${SR_ROOT}/pointRequests/${originalId}`);
  const originalSnap=await originalRef.get();
  if(!originalSnap.exists()){
    await eventRef.update({pointRequestStatus:"rejected"});
    return {ok:true,action:"none",status:"rejected",requestId:null,amount:0};
  }
  const original=originalSnap.val()||{},status=String(original.status||"pending");
  if(status==="pending"){
    await originalRef.update({
      status:"rejected",
      reviewedBy,
      reviewedAt:Date.now(),
      rejectReason:"Recorded Chazara rejected by teacher",
      lastError:null
    });
    await eventRef.update({pointRequestStatus:"rejected"});
    return {ok:true,action:"cancelled",status:"rejected",requestId:originalId,amount:0};
  }
  if(status==="processing") return {ok:false,error:"The point approval is still processing. Please try again in a moment."};
  if(status==="rejected"||status==="cancelled"){
    await eventRef.update({pointRequestStatus:"rejected"});
    return {ok:true,action:"none",status:"rejected",requestId:originalId,amount:0};
  }
  if(status!=="approved"){
    await eventRef.update({pointRequestStatus:"rejected"});
    return {ok:true,action:"none",status,requestId:originalId,amount:0};
  }

  const requested=-Math.abs(Number(original.actualAmount ?? original.amount ?? 2) || 2);
  const requestId=safeKey(`chazara-reject_${studentId}_${eventId}`);
  const reversalRef=rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`);
  const info=await studentInfo(rewardStudentId);
  const seed={
    id:requestId,status:"processing",automatic:true,approvedAutomatically:true,
    amount:requested,source:"chazara-reject",
    reason:`Chazara recording approval reversed — Perek ${event.perek||"?"} · Posuk ${event.posuk||"?"}`,
    practiceStudentId:studentId,rewardStudentId,studentName:info.name,classId:info.classId,
    eventId,perek:event.perek||null,posuk:event.posuk||null,originalRequestId:originalId,recorded:true,
    createdAt:Date.now(),reviewedBy:`Teacher rejection (${reviewedBy})`
  };
  const claim=await reversalRef.transaction(cur=>cur?undefined:seed);
  if(!claim.committed){
    const existing=(await reversalRef.get()).val()||{};
    await eventRef.update({
      pointRequestStatus:"rejected",
      rejectionPointRequestId:requestId,
      rejectionPointRequestStatus:existing.status||"approved"
    });
    return {ok:true,action:"reversed",status:existing.status||"approved",requestId,amount:Number(existing.actualAmount??existing.amount??0),balanceAfter:existing.balanceAfter};
  }

  let applied=0;
  const balRef=rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}/rewardBalance`);
  const bal=await balRef.transaction(cur=>{
    const old=Number(cur||0),next=Math.max(0,old+requested);applied=next-old;return next;
  });
  if(!bal.committed){
    await reversalRef.update({status:"error",lastError:"Balance reversal did not commit"});
    return {ok:false,error:"Could not remove the linked reward points."};
  }
  const balanceAfter=Number(bal.snapshot.val()||0);
  await reversalRef.update({status:"approved",actualAmount:applied,balanceAfter,reviewedAt:Date.now(),lastError:null});
  await eventRef.update({
    pointRequestStatus:"rejected",
    rejectionPointRequestId:requestId,
    rejectionPointRequestStatus:"approved",
    pointReversedAt:Date.now(),
    pointReversalAmount:applied
  });
  return {ok:true,action:"reversed",status:"approved",requestId,amount:applied,balanceAfter};
}

async function teacherRejectChazaraRecording(body,reviewedBy){
  const studentId=String(body.studentId||"").trim(),eventId=String(body.eventId||"").trim();
  if(!studentId||!eventId) return {ok:false,error:"Missing Chazara recording."};
  const eventRef=rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`),snap=await eventRef.get();
  if(!snap.exists()) return {ok:false,error:"Chazara recording not found."};
  const event={id:eventId,...(snap.val()||{})};
  if(event.recorded!==true) return {ok:false,error:"That Chazara is not a recording."};
  if(event.removed===true) return {ok:false,error:"That recording has already been deleted."};
  if(event.reviewApplied!==true) return {ok:false,error:"That recording was not fully saved."};
  if(event.teacherRejected===true){
    return {ok:true,alreadyRejected:true,eventId,studentId,pointsAction:event.rejectionPointAction||"none",pointsAmount:Number(event.pointReversalAmount||0)};
  }

  const points=await reverseRecordingPointsForTeacherRejection(studentId,eventId,event,reviewedBy);
  if(!points.ok) return points;

  await eventRef.update({
    teacherRejected:true,
    teacherRejectedAt:Date.now(),
    teacherRejectedBy:reviewedBy,
    pointRequestStatus:"rejected",
    rejectionPointAction:points.action||"none",
    rejectionPointRequestId:points.requestId||null,
    rejectionPointRequestStatus:points.status||"rejected"
  });
  await decrementChazaraSummary(studentId,event);
  return {
    ok:true,eventId,studentId,status:"rejected",
    pointsAction:points.action||"none",
    pointsAmount:Number(points.amount||0),
    posukReopened:true
  };
}

async function teacherSetRecordingFullReview(body,reviewedBy){
  const studentId=String(body.studentId||"").trim(),eventId=String(body.eventId||"").trim(),checked=body.checked===true;
  if(!studentId||!eventId) return {ok:false,error:"Missing Chazara recording."};
  const eventRef=rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`),snap=await eventRef.get();
  if(!snap.exists()) return {ok:false,error:"Chazara recording not found."};
  const event=snap.val()||{};
  if(event.recorded!==true) return {ok:false,error:"That Chazara is not a recording."};
  if(event.removed===true) return {ok:false,error:"That recording has already been deleted."};
  const update=checked
    ? {teacherFullyChecked:true,teacherFullyCheckedAt:Date.now(),teacherFullyCheckedBy:reviewedBy}
    : {teacherFullyChecked:false,teacherFullyCheckedAt:null,teacherFullyCheckedBy:null};
  await eventRef.update(update);
  return {ok:true,studentId,eventId,teacherFullyChecked:checked};
}

async function teacherDeleteChazara(body,reviewedBy){
  const studentId=String(body.studentId||"").trim(),eventId=String(body.eventId||"").trim();
  if(!studentId||!eventId) return {ok:false,error:"Missing Chazara event."};
  const eventRef=rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`),snap=await eventRef.get();
  if(!snap.exists()) return {ok:false,error:"Chazara event not found."};
  const event={id:eventId,...(snap.val()||{})};
  if(event.removed===true) return {ok:true,alreadyRemoved:true,eventId};
  if(event.reviewApplied!==true) return {ok:false,error:"That Chazara was not fully saved."};
  const summaryAlreadyExcluded=event.teacherRejected===true;
  await eventRef.update({removed:true,removedAt:Date.now(),removedByTeacher:true,removedByTeacherEmail:reviewedBy});
  const points=await handleRemoval(studentId,eventId);
  if(!points.ok){
    await eventRef.update({removed:false,removedAt:null,removedByTeacher:null,removedByTeacherEmail:null}).catch(()=>{});
    return points;
  }
  if(!summaryAlreadyExcluded) await decrementChazaraSummary(studentId,event);
  if(event.recorded===true && event.storagePath){
    await admin.storage().bucket().file(String(event.storagePath)).delete({ignoreNotFound:true}).catch(err=>console.warn("Could not delete removed Chazara audio",err));
  }
  return {ok:true,eventId,studentId,pointsAction:points.action,pointsAmount:Number(points.amount||0),status:points.status};
}

async function handleRemoval(studentId,eventId){
  if(!eventId) return {ok:false,error:"Missing Chazara event."};
  const eventRef=rtdb.ref(`posukPractice/chazara/events/${studentId}/${eventId}`);
  const eventSnap=await eventRef.get();
  if(!eventSnap.exists()) return {ok:false,error:"Chazara event not found."};
  const e=eventSnap.val()||{};
  if(e.reviewApplied!==true || e.removed!==true) return {ok:false,error:"That Chazara has not been removed."};
  if(e.teacherRejected===true){
    await eventRef.update({removalPointRequestStatus:"already-rejected"});
    return {ok:true,action:"none",status:"already-rejected",requestId:e.rejectionPointRequestId||null,amount:0};
  }

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
  if(status==="processing") return {ok:false,error:"The point approval is still processing. Please try the deletion again in a moment."};
  if(status==="approved"){
    const requested=-Math.abs(Number(original.actualAmount ?? original.amount ?? (e.recorded?2:1)) || (e.recorded?2:1));
    const requestId=safeKey(`chazara-remove_${studentId}_${eventId}`);
    const reversalRef=rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`);
    const info=await studentInfo(rewardStudentId);
    const seed={
      id:requestId,status:"processing",automatic:true,approvedAutomatically:true,
      amount:requested,source:"chazara-remove",
      reason:`Removed ${e.recorded?"recorded ":""}Chazara — Perek ${e.perek||"?"} · Posuk ${e.posuk||"?"}`,
      practiceStudentId:studentId,rewardStudentId,studentName:info.name,classId:info.classId,
      eventId,perek:e.perek||null,posuk:e.posuk||null,originalRequestId:originalId,recorded:e.recorded===true,
      createdAt:Date.now(),reviewedBy:"Automatic Chazara reversal"
    };
    const claim=await reversalRef.transaction(cur=>cur?undefined:seed);
    if(!claim.committed){
      const existing=(await reversalRef.get()).val()||{};
      await eventRef.update({removalPointRequestId:requestId,removalPointRequestStatus:existing.status||"approved"});
      return {ok:true,action:"reversed",status:existing.status||"approved",requestId,amount:Number(existing.actualAmount??existing.amount??0),balanceAfter:existing.balanceAfter};
    }
    let applied=0;
    const balRef=rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}/rewardBalance`);
    const bal=await balRef.transaction(cur=>{
      const old=Number(cur||0),next=Math.max(0,old+requested);applied=next-old;return next;
    });
    if(!bal.committed){
      await reversalRef.update({status:"error",lastError:"Balance reversal did not commit"});
      return {ok:false,error:"Could not remove the linked reward points."};
    }
    const balanceAfter=Number(bal.snapshot.val()||0);
    await reversalRef.update({status:"approved",actualAmount:applied,balanceAfter,reviewedAt:Date.now(),lastError:null});
    await eventRef.update({removalPointRequestId:requestId,removalPointRequestStatus:"approved",pointReversedAt:Date.now(),pointReversalAmount:applied});
    return {ok:true,action:"reversed",status:"approved",requestId,amount:applied,balanceAfter};
  }
  await eventRef.update({removalPointRequestStatus:status});
  return {ok:true,action:"none",status,requestId:originalId,amount:0};
}


async function readStudentRewardsData(classId="all"){
  const wanted=String(classId||"all").trim().toLowerCase();
  const rootSnap=await rtdb.ref(SR_ROOT).get();
  const root=rootSnap.val()||{};
  const students=root.students||{};
  const classes=root.classes||{};
  const rewards=root.rewards||{};

  function studentClassIds(studentId){
    const out=[];
    for(const [cid,c] of Object.entries(classes)){
      const members=c?.studentIds||c?.students||{};
      if((Array.isArray(members)&&members.includes(studentId)) || (members&&typeof members==='object'&&members[studentId])) out.push(cid);
    }
    return out;
  }
  function classMatches(studentId){
    if(!wanted||wanted==='all') return true;
    const ids=studentClassIds(studentId).map(x=>String(x).toLowerCase());
    return ids.includes(wanted) || ids.some(x=>x===`b3 ${wanted}`||x===`b3-${wanted}`||x.endsWith(wanted));
  }

  const result=[];
  for(const [studentId,s0] of Object.entries(students)){
    const s=s0||{};
    if(s.active===false || !classMatches(studentId)) continue;
    const events=[];

    for(const [cid,dates] of Object.entries(root.dailyAwards?.[studentId]||{})){
      for(const [date,a0] of Object.entries(dates||{})){
        const a=a0||{}, amount=Number(a.points||0); if(!amount) continue;
        events.push({id:`daily:${studentId}:${cid}:${date}`,source:'daily',amount,reason:'Daily Points',classId:cid,date,createdAt:a.savedAt||null,status:'posted'});
      }
    }
    for(const [id,i0] of Object.entries(root.pointRequests||{})){
      const i=i0||{}; if(String(i.rewardStudentId||'')!==studentId) continue;
      const approved=String(i.status||'')==='approved';
      const amount=Number(approved?(i.actualAmount??i.amount??0):(i.amount??0));
      events.push({id:`request:${id}`,source:i.source||'activity',amount,reason:i.reason||i.source||'Activity points',classId:i.classId||null,perek:i.perek??null,posuk:i.posuk??null,eventId:i.eventId||null,createdAt:i.reviewedAt||i.createdAt||null,status:i.status||'pending',countsTowardBalance:approved,balanceAfter:approved?(i.balanceAfter??null):null});
    }
    for(const [id,i0] of Object.entries(root.pointAdjustments||{})){
      const i=i0||{}; if(String(i.studentId||'')!==studentId) continue;
      const amount=Number(i.amount||0); if(!amount) continue;
      events.push({id:`adjust:${id}`,source:'teacher-adjustment',amount,reason:i.reason||'Teacher adjustment',classId:i.classId||null,createdAt:i.createdAt||null,status:'posted',countsTowardBalance:true});
    }
    for(const [id,i0] of Object.entries(root.redemptionsByStudent?.[studentId]||{})){
      const i=i0||{}, cost=Number(i.cost||0); if(!cost) continue;
      const rewardName=rewards?.[i.rewardId]?.name||'Reward';
      events.push({id:`redeem:${id}`,source:'reward-store',amount:-cost,reason:`Reward requested — ${rewardName}`,rewardId:i.rewardId||null,createdAt:i.requestedAt||null,status:i.status||'requested',countsTowardBalance:String(i.status||'').toLowerCase()!=='declined'});
      if(String(i.status||'').toLowerCase()==='declined') events.push({id:`redeem-return:${id}`,source:'reward-return',amount:cost,reason:`Points returned — ${rewardName}`,rewardId:i.rewardId||null,createdAt:i.reviewedAt||null,status:'posted',countsTowardBalance:true});
    }
    for(const [id,i0] of Object.entries(root.classRewardContributionsByStudent?.[studentId]||{})){
      const i=i0||{}, amount=Math.abs(Number(i.amount||0)); if(!amount) continue;
      events.push({id:`class-reward:${id}`,source:'class-reward',amount:-amount,reason:i.reason||'Class reward contribution',classId:i.classId||null,createdAt:i.createdAt||null,status:'posted',countsTowardBalance:true,balanceAfter:i.balanceAfter??null});
    }
    events.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    result.push({studentId,name:s.name||s.displayName||studentId,displayName:s.displayName||s.name||studentId,active:s.active!==false,classIds:studentClassIds(studentId),currentBalance:Number(s.rewardBalance||0),events});
  }
  result.sort((a,b)=>a.name.localeCompare(b.name));
  return {readOnly:true,classId:wanted,count:result.length,students:result};
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
        if(action==="student-point-history" || action==="class-reward-status" || action==="contribute-class-reward"){
          const student=await requireStudent(req);
          if(!student.ok) return res.status(401).json({error:student.error});
          const preferredClassId=String(student.decoded?.studentRewardsClassId || student.decoded?.classId || "").trim();
          if(action==="student-point-history"){
            const history=await studentPointHistory(student.studentId);
            return res.status(200).json({ok:true,history});
          }
          if(action==="class-reward-status"){
            const status=await classRewardStatusForStudent(student.studentId,preferredClassId);
            return res.status(200).json({ok:true,...status});
          }
          const result=await contributeToClassReward(student.studentId,String(body.classRewardId||""),body.amount,preferredClassId,body.modeIds);
          if(!result.ok) return res.status(409).json({error:result.error});
          return res.status(200).json(result);
        }
        const teacher=await requireTeacher(req);
        if(!teacher.ok) return res.status(401).json({error:teacher.error});
        await authorizeChazaraAction(teacher,body);
        if(action==="read-rewards-data"){
          const data=await readStudentRewardsData(body.classId||"all");
          return res.status(200).json({ok:true,...data});
        }
        if(action==="list-chazara-pending"){
          const requests=await listPendingChazaraRequests(teacher.scope);
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
        if(action==="teacher-add-chazara"){
          const result=await teacherAddChazara(body,teacher.email);
          if(!result.ok) return res.status(409).json({error:result.error,added:result.added||[],pointsAdded:result.totalPoints||0});
          return res.status(200).json(result);
        }
        if(action==="teacher-delete-chazara"){
          const result=await teacherDeleteChazara(body,teacher.email);
          if(!result.ok) return res.status(409).json({error:result.error});
          return res.status(200).json(result);
        }
        if(action==="teacher-reject-chazara-recording"){
          const result=await teacherRejectChazaraRecording(body,teacher.email);
          if(!result.ok) return res.status(409).json({error:result.error});
          return res.status(200).json(result);
        }
        if(action==="teacher-set-recording-full-review"){
          const result=await teacherSetRecordingFullReview(body,teacher.email);
          if(!result.ok) return res.status(409).json({error:result.error});
          return res.status(200).json(result);
        }
        return res.status(400).json({error:"Unknown teacher action."});
      }

      const studentId=String(body.studentId||"").trim();
      const source=String(body.source||"").trim();
      if(!studentId) return res.status(400).json({error:"Missing student."});

      let approved=await rtdb.ref(`b3Games/students/${studentId}/profile`).get();
      if(!approved.exists())approved=await rtdb.ref(`posukPractice/allowedStudents/${studentId}`).get();
      if(approved.val()?.active===false)return res.status(403).json({error:"Student access is turned off."});
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
        record={eventId,perek:e.perek||null,posuk:e.posuk||null,workspaceClassId:e.workspaceClassId||null,recorded:e.recorded===true};
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
      return res.status(err.code||500).json({error:err.code?err.message:"Could not create the point request."});
    }
  }
);