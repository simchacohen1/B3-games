'use strict';
// Rashi Letters reading recordings (2026-10-23). Pure rules shared by the
// studentRewardsAutoAward function and its tests: which sections exist, how
// many points they are worth, and how a submission may replace an earlier one.
const RASHI_SOURCE='rashi-recording';
const VAYEIRA=require('./vayeira-rashi.json');
const PASSAGES=Object.freeze(Object.fromEntries(VAYEIRA.passages.map(p=>[p.id,Object.freeze(p)])));

const RASHI_POINTS=2;
const MIN_BYTES=1000;
const MAX_BYTES=9*1024*1024;
const MIN_DURATION_MS=1500;
const MAX_WORDS=12;
const SECTIONS=Object.freeze({
  zayin:'Mission 1 (ז) words',bet:'Mission 2 (בּ / ב) words',tsadi:'Mission 3 (צ) words',alef:'Mission 4 (א) words',
  tsadisofit:'Mission 5 (ץ) words',memsofit:'Mission 6 (ם) words',shin:'Mission 7 (שׁ / שׂ) words',samech:'Mission 8 (ס) words',
  finalreview:'Final review words',words2:'2-letter words',words3:'3-letter words',words4:'4-letter words'
});
const isSection=id=>typeof id==='string'&&(Object.prototype.hasOwnProperty.call(SECTIONS,id)||Object.prototype.hasOwnProperty.call(PASSAGES,id));
const sectionLabel=id=>SECTIONS[id]||(PASSAGES[id]?`Vayeira ${PASSAGES[id].perek}:${PASSAGES[id].pasuk}`:String(id||''));
const sectionText=id=>PASSAGES[id]?.text||null;
const readingWords=(id,untrusted)=>PASSAGES[id]?[PASSAGES[id].text]:cleanWords(untrusted);
// Words are shown to the teacher only; keep Hebrew letters, points and spaces.
function cleanWords(value){
  const list=Array.isArray(value)?value:String(value||'').split('|');
  return list.map(w=>String(w).normalize('NFC').replace(/[^֐-׿ ]/g,'').trim()).filter(w=>w&&w.length<=30).slice(0,MAX_WORDS);
}
// Decide what a new submission may do given the saved record for that
// student+section. A pending or approved record can never be replaced; only a
// rejected one (the teacher said "Try Again") or nothing at all.
function claim(current,seed){
  if(current===null||current===undefined)return {write:seed};
  const status=String(current.status||'');
  const next=prior=>({write:{...seed,attempt:(Number(current.attempt)||1)+1,previousAttemptId:current.attemptId||null,priorPoints:prior}});
  if(status==='rejected'||status==='deleted')return next(Number(current.priorPoints)||0);
  // A graded reading that earned less than 5 may be recorded again (sending costs 2 again, like Posuk Practice).
  // Points already earned on this section are kept in priorPoints, so the same points are never paid twice.
  if(canRerecord(current))return next(Number(current.bestPoints)||0);
  return {block:status||'pending'};
}
// Graded by letter marks with fewer than 5 points: the student may send it again.
const canRerecord=record=>!!record&&record.status==='approved'&&!!record.letterReview&&Number.isFinite(Number(record.bestPoints))&&Number(record.bestPoints)<MAX_POINTS;
const canSendAgain=record=>!!record&&(record.status==='rejected'||record.status==='deleted'||canRerecord(record));
const requestIdFor=(studentId,sectionId,attemptId)=>`rashi_${studentId}_${sectionId}_${attemptId}`.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,220);
// Sending a recording costs 2 points (taken when it is sent). The teacher then taps the letters that were not recognized;
// the text is split into 5 equal parts and each part with no missed letter earns 1 point (see rashi-letter-marks-core.cjs).
const SUBMIT_COST=2;
const MAX_POINTS=5;
// What the student page shows for one section.
function publicStatus(record,requestStatus){
  if(!record||record.status==='deleted')return {status:'none',attempt:record?(Number(record.attempt)||1):undefined};
  let status=String(record.status||'pending');
  if(status==='pending'&&['approved','rejected'].includes(requestStatus))status=requestStatus;
  const letterMode=!!record.letterReview;
  const points=status==='approved'?(letterMode?(Number(record.bestPoints)||0):RASHI_POINTS):0;
  return {status,attempt:Number(record.attempt)||1,submittedAt:record.createdAt||null,reviewedAt:record.reviewedAt||null,points,letterMode,
    canRerecord:canRerecord(record),grade:record.grade??null,feedback:record.feedback||''};
}
module.exports={SUBMIT_COST,MAX_POINTS,canRerecord,canSendAgain,RASHI_SOURCE,RASHI_POINTS,MIN_BYTES,MAX_BYTES,MIN_DURATION_MS,MAX_WORDS,SECTIONS,PASSAGES,isSection,sectionLabel,sectionText,readingWords,cleanWords,claim,requestIdFor,publicStatus};
