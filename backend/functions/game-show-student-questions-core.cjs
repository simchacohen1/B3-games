'use strict';

function safeQuestion(q){
  if(typeof q==='string')return q;
  if(!q||typeof q!=='object')return null;
  const out={};
  for(const key of ['q','question','choices','options','image','audio'])if(q[key]!==undefined)out[key]=q[key];
  // Students may see the prompt and choices, but never the answer or answer key.
  return out;
}

// The two original classes (et, wt) predate per-class tool grants, so every
// other student tool (Weekly Quiz, Rewards, Class Pointer) already treats them
// as allowed when no grant is set. Game Show must match, or valid WT students are
// refused. The class must still be active and the student an active member.
const LEGACY_CLASS_IDS=['et','wt'];

function isActiveStudentAccess(identity,classSnap,memberSnap){
  const grant=classSnap?.child?.('toolGrants/game-show')?.val?.();
  // Legacy classes: allowed when the grant is simply missing, but a teacher
  // who explicitly turned Game Show off (false) is still respected.
  const grantOk=grant===true||(LEGACY_CLASS_IDS.includes(String(identity?.b3ClassId||''))&&grant!==false);
  return identity?.b3StudentRole==='student'
    && Boolean(identity.b3StudentId)
    && Boolean(identity.b3ClassId)
    && classSnap?.exists?.()
    && classSnap.child('active').val()===true
    && grantOk
    && memberSnap?.exists?.()
    && memberSnap.child('active').val()===true;
}

function canAcceptStudentBuzz(current,now){
  return Boolean(current)
    && current.roundActive===true
    && !current.buzzedBy
    && current.narrationLocked!==true
    && Number(now)>=(Number(current.buzzUnlockAt)||0);
}

module.exports={safeQuestion,isActiveStudentAccess,canAcceptStudentBuzz};
