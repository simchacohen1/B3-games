'use strict';
const submissionOpen=require('./submission-open-core.cjs');
const rashiRecording=require('./rashi-recording-core.cjs');
// A Rashi item may be one section, or a whole Vayeira perek / all of Vayeira (a prefix of the passage ids).
const rashiRuleOk=id=>rashiRecording.isSection(id)||Object.keys(rashiRecording.PASSAGES).some(key=>key.startsWith(id+'-'));
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const CLASS_TOOL_GRANTS=Object.freeze(['sefer-hamitzvos','halacha','yiddish','posuk-practice-scroll','rashi-letters','gematria','shorashim','chazara','game-show','student-rewards','weekly-quiz','multiplayer-center','homework','gallery','tag','davening','chavrusa','name-picker','daily-checklist','class-pointer','sync-to-nigri']);
const CLASS_TOOL_GRANT_SET=new Set(CLASS_TOOL_GRANTS);
// The Chumash Cheder tool shows four tiles; each can be starred on its own (it is one tool grant, four star keys).
const STAR_TILE_KEYS=new Set(['chumash-quiz','record-mishnayos','record-mishnayos-quiz']);
const DAYS=['sun','mon','tue','wed','thu','fri','sat'];
const validWindows=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 return DAYS.every(day=>Array.isArray(value[day])&&value[day].length<=8&&value[day].every(r=>r&&/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end)&&r.start!==r.end));
};
async function manageClassAccess(store,identity,body,now=Date.now()){
 if(!identity?.uid)fail(401,'Google sign-in required.');
 const classId=String(body.classId||'');if(!validId(classId))fail(400,'Choose a valid class.');
 const [admin,teacher,cls]=await Promise.all([
  store.get(`b3Games/admins/${identity.uid}`),
  store.get(`b3Games/workspaces/b3-2026/teachers/${identity.uid}`),
  store.get(`b3Games/workspaces/b3-2026/classes/${classId}`)
 ]);
 const bootstrap=String(identity.email||'').toLowerCase()==='simcha5770@gmail.com'&&identity.email_verified===true;
 const isAdmin=bootstrap||Boolean(admin&&admin.active!==false);
 let invite=null;
 if(isAdmin&&body.actorMode==='teacher'&&identity.email){
  const inviteKey=String(identity.email).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  if(inviteKey)invite=await store.get(`b3Games/workspaces/b3-2026/teacherInvites/${inviteKey}`);
 }
 const assigned=(teacher?.active!==false&&teacher?.classIds?.[classId]===true)
  || Boolean(invite&&invite.active!==false&&String(invite.email||'').trim().toLowerCase()===String(identity.email).toLowerCase()&&invite.classIds?.[classId]===true);
 const ownerIsTeacher=body.actorMode==='teacher';
 if(ownerIsTeacher&&!assigned)fail(403,'You are not assigned to this class.');
 if(!isAdmin&&!assigned)fail(403,'You are not assigned to this class.');
 if(!cls||cls.active===false)fail(404,'This class is unavailable.');
 const action=body.action,root=`b3Games/workspaces/b3-2026/classes/${classId}`;
 if(['mode','lockWindows','game','star','timedOpen'].includes(action)){
  if(!store.updateSettings)fail(503,'Class access settings are unavailable.');
  if(action==='mode'&&!['auto','open','locked'].includes(body.mode))fail(400,'Choose Automatic, Open, or Locked.');
  if(action==='timedOpen'&&!(Number.isInteger(body.minutes)&&body.minutes>=0&&body.minutes<=180))fail(400,'Choose 15, 30 or 45 minutes.');
  if(action==='lockWindows'&&!validWindows(body.lockWindows))fail(400,'Invalid class schedule.');
  if(action==='game'&&(!validId(body.gameId)||typeof body.enabled!=='boolean'||!['et','wt'].includes(classId)))fail(400,'Invalid activity setting.');
  if(action==='star'&&(!validId(body.gameId)||typeof body.keepOpen!=='boolean'))fail(400,'Invalid starred exception.');
  const result=await store.updateSettings(current=>{
   const updated=structuredClone(current||{});
   if(action==='mode'){
    const row=updated.classAccess?.[classId];if(!row)return null;row.mode=body.mode;delete row.openUntil;
   }else if(action==='timedOpen'){
    const row=updated.classAccess?.[classId];if(!row)return null;
    if(body.minutes)row.openUntil=now+body.minutes*60000;else delete row.openUntil;
   }else if(action==='lockWindows'){
    if(!updated.classAccess?.[classId])return null;
    updated.classAccess[classId].lockWindows=body.lockWindows;
   }else if(action==='game'){
    updated.classGames??={};updated.classGames[classId]??={};updated.classGames[classId][body.gameId]=body.enabled;
   }else{
    const games=String(updated.classLockedGameOverride?.[classId]||'').split(',').map(x=>x.trim()).filter(Boolean).filter(x=>x!==body.gameId);
    if(body.keepOpen)games.push(body.gameId);
    updated.classLockedGameOverride??={};updated.classLockedGameOverride[classId]=games.join(',');
    updated.classLockedGameOverrideUntil??={};updated.classLockedGameOverrideUntil[classId]??={};
    if(!body.keepOpen)delete updated.classLockedGameOverrideUntil[classId][body.gameId];
    else updated.classLockedGameOverrideUntil[classId][body.gameId]=Number(body.expiresAt)||now+86400000;
   }
   return updated;
  });
  if(!result.committed)fail(400,'Schedule is missing for this class.');
  return {ok:true};
 }
 if(action==='platform'){
  if(!['open','locked'].includes(body.mode))fail(400,'Choose Open or Locked.');
  await store.update({[`${root}/access/mode`]:body.mode,[`${root}/siteEnabled`]:body.mode==='open',[`${root}/access/openUntil`]:null,...(body.mode==='open'?{[`${root}/access/stars`]:null}:{})});
  return {ok:true};
 }
 if(action==='platformStar'){
  // A starred tool stays open while the class is locked; it switches itself off at expiresAt (at most 24 hours ahead).
  if(!(CLASS_TOOL_GRANT_SET.has(body.toolId)||STAR_TILE_KEYS.has(body.toolId))||typeof body.keepOpen!=='boolean')fail(400,'Invalid star setting.');
  const until=Math.min(Number(body.expiresAt)||now+86400000,now+86400000+60000);
  await store.update({[`${root}/access/stars/${body.toolId}`]:body.keepOpen&&until>now?until:null});
  return {ok:true};
 }
 if(action==='platformTimedOpen'){
  if(!(Number.isInteger(body.minutes)&&body.minutes>=0&&body.minutes<=180))fail(400,'Choose 15, 30 or 45 minutes.');
  await store.update({[`${root}/access/openUntil`]:body.minutes?now+body.minutes*60000:null});
  return {ok:true};
 }
 if(action==='grant'){
  if(!CLASS_TOOL_GRANT_SET.has(body.toolId)||typeof body.enabled!=='boolean')fail(400,'Invalid tool setting.');
  await store.update({[`${root}/toolGrants/${body.toolId}`]:body.enabled});return {ok:true};
 }
 if(action==='submissionOpenRead'){
  // What is open for sending in this class: the whole class, and each boy who has his own items.
  const node=(await store.get(`${root}/submissionOpen`))||{};
  const out={ok:true,...submissionOpen.publicStatus(node,'',rashiRecording.sectionLabel),students:{}};
  for(const [id,own] of Object.entries(node.students||{})){
   if(!submissionOpen.validKey(id)||!own||typeof own!=='object')continue;
   const status=submissionOpen.publicStatus({items:own.items,all:own.all},'',rashiRecording.sectionLabel);
   if(status.all||status.rules.length)out.students[id]=status;
  }
  return out;
 }
 if(action==='submissionOpenChange'){
  // Open or close items for sending, for the whole class or for one boy. Everything else stays practice-only.
  let changes;
  try{changes=submissionOpen.changesFor(body,rashiRuleOk,id=>cls.members?.[id]&&cls.members[id].active!==false);}
  catch(message){fail(400,String(message));}
  await store.update(Object.fromEntries(Object.entries(changes).map(([path,value])=>[`${root}/${path}`,value])));
  return {ok:true};
 }
 fail(400,'Unknown class access action.');
}
module.exports={manageClassAccess,CLASS_TOOL_GRANTS};
