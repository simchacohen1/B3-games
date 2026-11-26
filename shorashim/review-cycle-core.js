/* Shorashim review cycles: pure logic, no page access.
   A cycle goes through all of a student's learned words in one track once.
   The student record keeps, per track: { cycle: <number>, done: { <itemKey>: <time> } }
   and each card keeps reviewCount / lastReviewedAt. Nothing here touches points or recordings. */
(function(root){
  'use strict';
  const TRACKS=['shorashim','prefix','suffix'];

  function ensureCycle(student,track){
    if(!student.reviewCycles||typeof student.reviewCycles!=='object')student.reviewCycles={};
    let c=student.reviewCycles[track];
    if(!c||typeof c!=='object')c=student.reviewCycles[track]={cycle:1,done:{}};
    if(!(Number(c.cycle)>=1))c.cycle=1;
    if(!c.done||typeof c.done!=='object')c.done={};
    return c;
  }

  // keys = item keys of every learned (eligible) word in the track.
  function summary(student,track,keys){
    const c=ensureCycle(student,track),total=keys.length,left=keys.filter(k=>!c.done[k]).length;
    return {cycle:c.cycle,total,left,reviewed:total-left};
  }

  // Same numbers without changing the record (used by the teacher page).
  function peek(student,track,keys){
    const c=student&&student.reviewCycles&&student.reviewCycles[track],done=(c&&c.done)||{},cycle=Number(c&&c.cycle)>=1?Number(c.cycle):1;
    const left=keys.filter(k=>!done[k]).length;
    return {cycle,total:keys.length,left,reviewed:keys.length-left};
  }

  // orderedKeys = learned words in the order the student wants; count = number or 'all'.
  function pickBatch(student,track,orderedKeys,count){
    const c=ensureCycle(student,track),rest=orderedKeys.filter(k=>!c.done[k]);
    if(count==='all'||count===Infinity)return rest;
    const n=Math.floor(Number(count));
    return Number.isFinite(n)&&n>0?rest.slice(0,n):rest;
  }

  // Record one reviewed word. Returns {completed, cycle, left, total}. When the last word of
  // the cycle is reviewed the cycle number goes up and the new cycle starts empty.
  function markReviewed(student,track,key,keys,now){
    const card=student.cards&&student.cards[key];
    if(card){card.reviewCount=(Number(card.reviewCount)||0)+1;card.lastReviewedAt=now;}
    const c=ensureCycle(student,track);
    c.done[key]=now;
    let completed=false;
    if(keys.length&&keys.every(k=>c.done[k])){
      completed=true;c.completedCycle=c.cycle;c.cycle+=1;c.done={};
    }
    const s=summary(student,track,keys);
    return {completed,cycle:s.cycle,left:s.left,total:s.total};
  }

  function leftText(left){return `${left} left in this cycle`;}
  function countLabel(n){return n===1?'1 time':`${n} times`;}
  function reviewCountOf(card){return Math.max(0,Math.floor(Number(card&&card.reviewCount)||0));}

  const api={TRACKS,ensureCycle,summary,peek,pickBatch,markReviewed,leftText,countLabel,reviewCountOf};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.B3ReviewCycles=api;
})(typeof window==='object'?window:globalThis);
