'use strict';

function safeQuestion(q){
  if(typeof q==='string')return q;
  if(!q||typeof q!=='object')return null;
  const out={};
  for(const key of ['q','question','choices','options','image','audio'])if(q[key]!==undefined)out[key]=q[key];
  // Students may see the prompt and choices, but never the answer or answer key.
  return out;
}

// The two original classes (et, wt) predate per-class tool grants and "active"
// flags, so Weekly Quiz, Rewards and Class Pointer already treat them as allowed
// when those fields are simply missing. Game Show must match, or valid WT students
// are refused (issue #420). Only an explicit false turns a class, a membership or
// a student's Game Show access off. Any other class still needs the tool grant.
const LEGACY_CLASS_IDS=['et','wt'];

function isActiveStudentAccess(identity,classSnap,memberSnap){
  const classId=String(identity?.b3ClassId||'');
  const grant=classSnap?.child?.('toolGrants/game-show')?.val?.();
  const grantOk=grant===true||(LEGACY_CLASS_IDS.includes(classId)&&grant!==false);
  return identity?.b3StudentRole==='student'
    && Boolean(identity.b3StudentId)
    && Boolean(classId)
    && Boolean(classSnap?.exists?.())
    && classSnap.child('active').val()!==false
    && grantOk
    && Boolean(memberSnap?.exists?.())
    && memberSnap.child('active').val()!==false
    && memberSnap.child('toolAccess/game-show').val()!==false;
}

function canAcceptStudentBuzz(current,now){
  return Boolean(current)
    && current.roundActive===true
    && !current.buzzedBy
    && current.narrationLocked!==true
    && Number(now)>=(Number(current.buzzUnlockAt)||0);
}

module.exports={safeQuestion,isActiveStudentAccess,canAcceptStudentBuzz};
