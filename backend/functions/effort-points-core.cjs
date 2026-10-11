'use strict';

// Small, deterministic rules shared by the Effort Points backend and tests.
// A page being open, mouse movement, or an unsaved answer never calls this.
const POINT_INTERVAL_MS=5*60*1000;
const MAX_DAILY_POINTS=6;
const MAX_GAP_MS=120*1000;
const MAX_RECENT_EVENTS=32;
const TOOLS=Object.freeze({
  yiddish:'Yiddish',
  gematria:'Gematria',
  'rashi-letters':'Rashi Letters'
});
function dayKey(now){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const val=k=>parts.find(p=>p.type===k)?.value||'';
  return val('year')+val('month')+val('day');
}
function validEventId(id){return typeof id==='string'&&/^[A-Za-z0-9_-]{16,90}$/.test(id)}
function recordEvent(prior,now,tool,classId,eventId,breakBefore=false){
  if(!Object.hasOwn(TOOLS,tool)||!validEventId(eventId)||!/^[A-Za-z0-9_-]{1,100}$/.test(classId))return {changed:false,state:prior||null};
  const state=prior&&typeof prior==='object'?prior:{};
  const seen=Array.isArray(state.recentEventIds)?state.recentEventIds:[];
  if(seen.includes(eventId))return {changed:false,state};
  const last=Number(state.lastAt)||0,ms=last>0&&state.lastClass===classId?now-last:0;
  const credited=!breakBefore&&ms>=8000&&ms<=MAX_GAP_MS?ms:0;
  const activeMs=Math.min(MAX_DAILY_POINTS*POINT_INTERVAL_MS,Math.max(0,Number(state.activeMs)||0)+credited);
  const perTool={...(state.perTool||{})};
  perTool[tool]=Math.min(MAX_DAILY_POINTS*POINT_INTERVAL_MS,Math.max(0,Number(perTool[tool])||0)+credited);
  const next={
    activeMs,perTool,lastAt:now,lastClass:classId,lastTool:tool,
    attempted:Math.max(0,Number(state.attempted)||0)+1,
    recentEventIds:[...seen.slice(-(MAX_RECENT_EVENTS-1)),eventId]
  };
  return {changed:true,state:next,creditedMs:credited,milestones:Math.floor(activeMs/POINT_INTERVAL_MS)};
}
module.exports={POINT_INTERVAL_MS,MAX_DAILY_POINTS,MAX_GAP_MS,TOOLS,dayKey,validEventId,recordEvent};
