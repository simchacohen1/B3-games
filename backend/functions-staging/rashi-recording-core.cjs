'use strict';
// Rashi Letters reading recordings (2026-10-23). Pure rules shared by the
// studentRewardsAutoAward function and its tests: which sections exist, how
// many points they are worth, and how a submission may replace an earlier one.
const RASHI_SOURCE='rashi-recording';
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
const isSection=id=>typeof id==='string'&&Object.prototype.hasOwnProperty.call(SECTIONS,id);
const sectionLabel=id=>SECTIONS[id]||String(id||'');
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
  if(status==='rejected')return {write:{...seed,attempt:(Number(current.attempt)||1)+1,previousAttemptId:current.attemptId||null}};
  return {block:status||'pending'};
}
const requestIdFor=(studentId,sectionId,attemptId)=>`rashi_${studentId}_${sectionId}_${attemptId}`.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,220);
// What the student page shows for one section.
function publicStatus(record,requestStatus){
  if(!record)return {status:'none'};
  let status=String(record.status||'pending');
  if(status==='pending'&&['approved','rejected'].includes(requestStatus))status=requestStatus;
  return {status,attempt:Number(record.attempt)||1,submittedAt:record.createdAt||null,reviewedAt:record.reviewedAt||null,points:status==='approved'?RASHI_POINTS:0};
}
module.exports={RASHI_SOURCE,RASHI_POINTS,MIN_BYTES,MAX_BYTES,MIN_DURATION_MS,MAX_WORDS,SECTIONS,isSection,sectionLabel,cleanWords,claim,requestIdFor,publicStatus};
