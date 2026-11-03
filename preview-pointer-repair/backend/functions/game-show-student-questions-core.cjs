'use strict';

function safeQuestion(q){
  if(typeof q==='string')return q;
  if(!q||typeof q!=='object')return null;
  const out={};
  for(const key of ['q','question','choices','options','image','audio'])if(q[key]!==undefined)out[key]=q[key];
  // Students may see the prompt and choices, but never the answer or answer key.
  return out;
}

function isActiveStudentAccess(identity,classSnap,memberSnap){
  return identity?.b3StudentRole==='student'
    && Boolean(identity.b3StudentId)
    && Boolean(identity.b3ClassId)
    && classSnap?.exists?.()
    && classSnap.child('active').val()===true
    && classSnap.child('toolGrants/game-show').val()===true
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
