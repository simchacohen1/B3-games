/**
 * Class Gallery Tag powers.
 *
 * Add this file to the Firebase Functions project and export it from functions/index.js:
 *   exports.classGalleryPowerPurchase = require('./class-gallery-powers').classGalleryPowerPurchase;
 *
 * Then deploy:
 *   firebase deploy --only functions:classGalleryPowerPurchase
 */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const rtdb = admin.database();

const SR_ROOT = 'studentRewards';
const PRESENCE_ROOT = 'b3Games/classGalleryPresence';
const TAG_ENABLED_PATH = 'b3Games/classGalleryPresenceSettings/tagEnabled';
const SPEND_CAP = 12;
const GLOBAL_COOLDOWN_MS = 4000;

const POWERS = Object.freeze({
  speed:     { label:'Speed Burst', cost:2, durationMs:7000 },
  dash:      { label:'Dash',        cost:2, durationMs:0 },
  teleport:  { label:'Teleport',    cost:4, durationMs:0 },
  invisible: { label:'Invisible',   cost:4, durationMs:6000 },
  shield:    { label:'Shield',      cost:4, durationMs:5000 },
  freeze:    { label:'Freeze',      cost:5, durationMs:3000 }
});

function cors(req,res){
  res.set('Access-Control-Allow-Origin','*');
  res.set('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods','POST, OPTIONS');
  if(req.method==='OPTIONS'){res.status(204).send('');return true;}
  return false;
}
function normalizeName(v){
  return String(v||'').trim().toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g,' ').replace(/\s+/g,' ');
}
function safeKey(v){return String(v||'').replace(/[^A-Za-z0-9_-]/g,'-').slice(0,220);}
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}

async function requireStudent(req){
  const header=String(req.headers.authorization||'');
  if(!header.startsWith('Bearer ')) return {ok:false,error:'Student sign-in required.'};
  try{
    const decoded=await admin.auth().verifyIdToken(header.slice(7));
    const studentId=String(decoded.studentRewardsStudentId||'').trim();
    if(!studentId||decoded.studentRewardsRole!=='student') return {ok:false,error:'Student sign-in required.'};
    return {ok:true,studentId,decoded};
  }catch(err){
    console.warn('Tag power student token verification failed',err);
    return {ok:false,error:'Your points sign-in expired. Open the power shop again.'};
  }
}

async function resolveRewardStudentId(b3StudentId){
  const direct=await rtdb.ref(`${SR_ROOT}/students/${b3StudentId}`).get();
  if(direct.exists()) return b3StudentId;

  const allowed=await rtdb.ref(`posukPractice/allowedStudents/${b3StudentId}`).get();
  if(!allowed.exists()) return null;
  const practice=await rtdb.ref(`posukPractice/students/${b3StudentId}`).get().catch(()=>null);
  const wanted=normalizeName(allowed.val()?.name || practice?.val()?.name || b3StudentId);
  if(!wanted) return null;

  const all=await rtdb.ref(`${SR_ROOT}/students`).get();
  let match=null;
  all.forEach(child=>{
    if(match) return;
    const row=child.val()||{};
    if(normalizeName(row.name)===wanted || normalizeName(row.displayName)===wanted) match=child.key;
  });
  return match;
}

async function verifyIdentity(authStudentId,b3StudentId,decoded){
  if(decoded.b3StudentId){
    if(decoded.b3StudentId!==b3StudentId)return {ok:false,error:'The B3 login does not match this points account.'};
    const profile=(await rtdb.ref(`b3Games/students/${b3StudentId}/profile`).get()).val();
    if(profile?.active===false)return {ok:false,error:'This student account is inactive.'};
    return {ok:true,rewardStudentId:authStudentId,studentName:profile?.name||b3StudentId};
  }
  if(!b3StudentId) return {ok:false,error:'Could not identify your B3 account.'};
  const allowed=await rtdb.ref(`posukPractice/allowedStudents/${b3StudentId}`).get();
  if(!allowed.exists()) return {ok:false,error:'This B3 student is not approved.'};
  const rewardStudentId=await resolveRewardStudentId(b3StudentId);
  if(!rewardStudentId) return {ok:false,error:'Could not match this B3 student to Student Rewards.'};
  if(String(rewardStudentId)!==String(authStudentId)) return {ok:false,error:'The B3 login does not match this points account.'};
  return {ok:true,rewardStudentId,studentName:allowed.val()?.name||b3StudentId};
}

async function latestPresence(studentId,context={presenceRoot:PRESENCE_ROOT,classes:['et','wt','all']}){
  const root=await rtdb.ref(context.presenceRoot).get();
  let best=null;
  context.classes.forEach(classId=>{
    const sessions=root.child(`${classId}/${studentId}`).val()||{};
    Object.values(sessions).forEach(row=>{
      if(!row||typeof row!=='object') return;
      const updatedAt=num(row.updatedAt,0);
      if(!best||updatedAt>num(best.updatedAt,0)) best={...row,classId};
    });
  });
  if(!best) return null;
  if(best.updatedAt && Date.now()-num(best.updatedAt)>50000) return null;
  return best;
}

async function verifyPlayingTag(b3StudentId,context){
  const p=await latestPresence(b3StudentId,context);
  if(!p || p.playingTag!==true || p.space!=='hallway'||(p.tagMode==='manhunt'?'manhunt':'regular')!==context.mode) return {ok:false,error:'Join Tag in the main hallway before buying a power.'};
  return {ok:true,presence:p};
}

async function rollbackSpend(spendRef,purchaseId,cost){
  await spendRef.transaction(cur=>{
    cur=cur||{};
    if(String(cur.lastPurchaseId||'')!==purchaseId) return cur;
    return {...cur,spent:Math.max(0,num(cur.spent)-cost),lastPurchaseAt:0,lastPurchaseId:null,lastPower:null};
  }).catch(err=>console.warn('Could not roll back Tag power spend reservation',err));
}

async function applyEffect({powerId,b3StudentId,targetStudentId,purchaseId,now,context}){
  const effectsRef=rtdb.ref(`${context.tagRoot}/effects`);
  if(powerId==='speed'){
    await effectsRef.child(b3StudentId).update({speedUntil:now+POWERS.speed.durationMs,lastPower:'speed',lastPowerAt:now});
    return {effectUntil:now+POWERS.speed.durationMs};
  }
  if(powerId==='invisible'){
    await effectsRef.child(b3StudentId).update({invisibleUntil:now+POWERS.invisible.durationMs,lastPower:'invisible',lastPowerAt:now});
    return {effectUntil:now+POWERS.invisible.durationMs};
  }
  if(powerId==='shield'){
    await effectsRef.child(b3StudentId).update({shieldUntil:now+POWERS.shield.durationMs,lastPower:'shield',lastPowerAt:now});
    return {effectUntil:now+POWERS.shield.durationMs};
  }
  if(powerId==='dash'){
    await effectsRef.child(b3StudentId).update({dashToken:purchaseId,dashAt:now,lastPower:'dash',lastPowerAt:now});
    return {effectUntil:now};
  }
  if(powerId==='teleport'){
    await effectsRef.child(b3StudentId).update({teleportToken:purchaseId,teleportAt:now,lastPower:'teleport',lastPowerAt:now});
    return {effectUntil:now};
  }
  if(powerId==='freeze'){
    if(!targetStudentId || targetStudentId===b3StudentId) throw new Error('Choose a nearby classmate to freeze.');
    const [buyer,target,allowedTarget]=await Promise.all([
      latestPresence(b3StudentId,context),
      latestPresence(targetStudentId,context),
      rtdb.ref(context.legacy?`posukPractice/allowedStudents/${targetStudentId}`:`b3Games/students/${targetStudentId}/profile`).get()
    ]);
    if(!allowedTarget.exists() || !buyer || !target || buyer.playingTag!==true || target.playingTag!==true || buyer.space!=='hallway' || target.space!=='hallway'){
      throw new Error('That classmate is not available to freeze right now.');
    }
    const distance=Math.hypot(num(target.x)-num(buyer.x),num(target.z)-num(buyer.z));
    if(distance>5.8) throw new Error('Get closer to that classmate before using Freeze.');
    const targetRef=effectsRef.child(targetStudentId);
    await targetRef.transaction(cur=>{
      cur=cur||{};
      return {...cur,frozenUntil:Math.max(num(cur.frozenUntil),now+POWERS.freeze.durationMs),frozenBy:b3StudentId,freezePurchaseId:purchaseId,lastPowerAt:now};
    });
    return {effectUntil:now+POWERS.freeze.durationMs,targetStudentId};
  }
  throw new Error('Unknown power.');
}

async function writePurchaseHistory({purchaseId,powerId,power,rewardStudentId,b3StudentId,studentName,balanceAfter,spent,now,targetStudentId}){
  const infoSnap=await rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}`).get();
  const info=infoSnap.val()||{};
  const requestId=safeKey(`tagpower_${b3StudentId}_${purchaseId}`);
  const reason=`Tag Power — ${power.label}`;
  const row={
    id:requestId,status:'approved',automatic:true,approvedAutomatically:true,
    amount:-power.cost,actualAmount:-power.cost,source:'tag-power',reason,
    practiceStudentId:b3StudentId,rewardStudentId,studentName:info.name||info.displayName||studentName||b3StudentId,
    classId:info.classId||null,powerId,powerLabel:power.label,cost:power.cost,targetStudentId:targetStudentId||null,
    balanceAfter,tagGameSpendAfter:spent,createdAt:now,reviewedAt:now,reviewedBy:'Tag Power Shop'
  };
  await Promise.all([
    rtdb.ref(`${SR_ROOT}/pointRequests/${requestId}`).set(row),
    rtdb.ref(`${SR_ROOT}/tagPowerPurchases/${rewardStudentId}/${purchaseId}`).set({...row,id:purchaseId,requestId})
  ]);
}

exports.classGalleryPowerPurchase=onRequest(
  {cors:true,region:'us-central1',memory:'256MiB'},
  async(req,res)=>{
    if(cors(req,res)) return;
    if(req.method!=='POST') return res.status(405).json({error:'Use POST'});
    try{
      const student=await requireStudent(req);
      if(!student.ok) return res.status(401).json({error:student.error});

      const body=req.body||{};
      const action=String(body.action||'balance').trim();
      const b3StudentId=String(body.b3StudentId||'').trim();
      const identity=await verifyIdentity(student.studentId,b3StudentId,student.decoded);
      if(!identity.ok) return res.status(403).json({error:identity.error});
      const rewardStudentId=identity.rewardStudentId;
      const mode=body.mode==='manhunt'?'manhunt':'regular';
      const classId=String(body.classId||student.decoded.b3ClassId||'et');
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(classId))return res.status(400).json({error:'Invalid class.'});
      const legacy=['et','wt'].includes(classId);
      const resourceRoot='b3Games/workspaces/b3-2026/classes/'+classId+'/resources/gallery';
      if(!legacy){
        const cls=(await rtdb.ref('b3Games/workspaces/b3-2026/classes/'+classId).get()).val();
        if(!cls||cls.active===false||!cls.members?.[b3StudentId]||cls.members[b3StudentId].active===false)return res.status(403).json({error:'This class is not available to your account.'});
      }
      const context={mode,legacy,presenceRoot:legacy?PRESENCE_ROOT:resourceRoot+'/presence',classes:legacy?['et','wt','all']:[classId],tagRoot:legacy?'b3Games/classGalleryTag/'+(mode==='manhunt'?'manhunt':'all'):resourceRoot+'/tag/'+(mode==='manhunt'?'manhunt_':'class_')+classId,enabledPath:legacy?TAG_ENABLED_PATH:resourceRoot+'/settings/tagEnabled'};


      const [balanceSnap,spendSnap]=await Promise.all([
        rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}/rewardBalance`).get(),
        rtdb.ref(`${context.tagRoot}/powerSpend/${b3StudentId}`).get()
      ]);
      const currentBalance=num(balanceSnap.val());
      const currentSpend=spendSnap.val()||{};
      const currentCooldownUntil=num(currentSpend.lastPurchaseAt)+GLOBAL_COOLDOWN_MS;

      if(action==='balance'){
        return res.status(200).json({ok:true,balance:currentBalance,spent:num(currentSpend.spent),cap:SPEND_CAP,cooldownUntil:currentCooldownUntil});
      }
      if(action!=='purchase') return res.status(400).json({error:'Unknown Tag power action.'});

      const powerId=String(body.powerId||'').trim();
      const power=POWERS[powerId];
      if(!power) return res.status(400).json({error:'That power is not available.'});
      const tagEnabled=await rtdb.ref(context.enabledPath).get();
      if(tagEnabled.val()!==true) return res.status(409).json({error:'Tag is not turned on right now.'});
      const playing=await verifyPlayingTag(b3StudentId,context);
      if(!playing.ok) return res.status(409).json({error:playing.error});

      if(mode==='manhunt'){
        const hunter=(await rtdb.ref(context.tagRoot+'/hunters/'+b3StudentId).get()).val();
        if(!(hunter?['speed','dash','freeze']:['speed','dash','invisible']).includes(powerId))return res.status(409).json({error:'That power is not available for your Manhunt role.'});
      }
      const now=Date.now();
      const selfEffects=(await rtdb.ref(`${context.tagRoot}/effects/${b3StudentId}`).get()).val()||{};
      const selfTimedActive=['speedUntil','invisibleUntil','shieldUntil'].some(k=>num(selfEffects[k])>now);
      if(selfTimedActive && ['speed','invisible','shield'].includes(powerId)){
        return res.status(409).json({error:'Wait until your current power ends before starting another timed power.'});
      }

      let targetStudentId=String(body.targetStudentId||'').trim();
      if(powerId==='freeze'){
        if(!targetStudentId) return res.status(409).json({error:'Get closer to another player before using Freeze.'});
        // Validate distance before charging points.
        const [buyer,target]=await Promise.all([latestPresence(b3StudentId,context),latestPresence(targetStudentId,context)]);
        if(!buyer||!target||buyer.playingTag!==true||target.playingTag!==true||buyer.space!=='hallway'||target.space!=='hallway') return res.status(409).json({error:'That classmate is not available to freeze right now.'});
        if((target.tagMode==='manhunt'?'manhunt':'regular')!==mode)return res.status(409).json({error:'That classmate is playing a different game.'});
        if(mode==='manhunt'&&(await rtdb.ref(context.tagRoot+'/hunters/'+targetStudentId).get()).val())return res.status(409).json({error:'Choose a runner to freeze.'});
        if(Math.hypot(num(target.x)-num(buyer.x),num(target.z)-num(buyer.z))>5.8) return res.status(409).json({error:'Get closer to that classmate before using Freeze.'});
      }else targetStudentId='';

      const purchaseId=safeKey(`${now}_${Math.random().toString(36).slice(2,10)}`);
      const spendRef=rtdb.ref(`${context.tagRoot}/powerSpend/${b3StudentId}`);
      let reserveError='';
      const reserve=await spendRef.transaction(cur=>{
        cur=cur||{};
        const spent=num(cur.spent),last=num(cur.lastPurchaseAt);
        if(now-last<GLOBAL_COOLDOWN_MS){reserveError='Wait a few seconds before buying another power.';return;}
        if(spent+power.cost>SPEND_CAP){reserveError=`You can spend up to ${SPEND_CAP} points per Tag game.`;return;}
        return {...cur,spent:spent+power.cost,lastPurchaseAt:now,lastPurchaseId:purchaseId,lastPower:powerId};
      });
      if(!reserve.committed) return res.status(409).json({error:reserveError||'Could not reserve that power right now.'});
      const spent=num(reserve.snapshot.val()?.spent);

      const balanceRef=rtdb.ref(`${SR_ROOT}/students/${rewardStudentId}/rewardBalance`);
      let insufficient=false;
      const balanceTx=await balanceRef.transaction(cur=>{
        const balance=num(cur);
        if(balance<power.cost){insufficient=true;return;}
        return balance-power.cost;
      });
      if(!balanceTx.committed){
        await rollbackSpend(spendRef,purchaseId,power.cost);
        return res.status(409).json({error:insufficient?'You do not have enough points for that power.':'Could not update your point balance.'});
      }
      const balanceAfter=num(balanceTx.snapshot.val());

      let effectResult;
      try{
        effectResult=await applyEffect({powerId,b3StudentId,targetStudentId,purchaseId,now,context});
        await writePurchaseHistory({purchaseId,powerId,power,rewardStudentId,b3StudentId,studentName:identity.studentName,balanceAfter,spent,now,targetStudentId:effectResult.targetStudentId||targetStudentId});
      }catch(err){
        console.error('Could not apply Tag power after charge',err);
        await balanceRef.transaction(cur=>num(cur)+power.cost).catch(()=>{});
        await rollbackSpend(spendRef,purchaseId,power.cost);
        return res.status(409).json({error:err?.message||'Could not activate that power. Your points were returned.'});
      }

      return res.status(200).json({
        ok:true,powerId,powerLabel:power.label,cost:power.cost,
        balance:balanceAfter,spent,cap:SPEND_CAP,cooldownUntil:now+GLOBAL_COOLDOWN_MS,
        effectUntil:effectResult.effectUntil||now,targetStudentId:effectResult.targetStudentId||null
      });
    }catch(err){
      console.error('classGalleryPowerPurchase',err);
      return res.status(500).json({error:'Could not use the Tag power shop right now.'});
    }
  }
);
