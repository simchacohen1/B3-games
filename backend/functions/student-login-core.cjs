'use strict';
const crypto=require('node:crypto');
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};

async function resolveStudent(get,body){
 const name=String(body.name||'').trim(),pin=String(body.pin||'').trim();
 if(!name||!pin)fail(400,'Enter your name and individual passcode.');

 const all=await get('b3Games/students')||{};
 const legacyAll=await get('posukPractice/allowedStudents')||{};
 let id=String(body.b3StudentId||'').trim(),profile;

 const sameName=(sid,p)=>normalize(p?.name)===normalize(name)||normalize(sid)===normalize(name);
 const pinOk=p=>p&&equal(p.passcode||'',pin);
 const legacyPinOk=(sid)=>legacyAll[sid]&&legacyAll[sid].active!==false&&equal(legacyAll[sid].passcode||'5770',pin);

 if(id){
  if(!key(id))fail(400,'Invalid student account.');
  profile=await get('b3Games/students/'+id+'/profile');
  if(profile&&profile.active!==false&&sameName(id,profile)){
   // Migration compatibility: if the central profile has a stale PIN, the
   // valid legacy PIN for this exact same student may still authenticate.
   if(!pinOk(profile)&&legacyPinOk(id))profile={...profile,passcode:pin};
  }
 }else{
  const named=Object.entries(all).filter(([sid,r])=>r?.profile?.active!==false&&sameName(sid,r.profile));
  const matches=[];
  for(const [sid,row] of named){
   if(pinOk(row.profile)||legacyPinOk(sid))matches.push([sid,row]);
  }
  if(matches.length>1)fail(409,'More than one account matches. Sign in from the main site.');
  if(matches.length){id=matches[0][0];profile={...matches[0][1].profile,passcode:pin};}
 }

 if(!profile){
  const legacyMatches=Object.entries(legacyAll).filter(([sid,row])=>
   row&&row.active!==false&&sameName(sid,row)&&equal(row.passcode||'5770',pin));
  if(legacyMatches.length>1)fail(409,'More than one account matches. Sign in from the main site.');
  if(legacyMatches.length){
   id=legacyMatches[0][0];
   const old=legacyMatches[0][1]||{};
   profile={...old,name:String(old.name||name),passcode:String(old.passcode||'5770')};
  }
 }

 if(!profile){
  id=id||name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  if(!key(id))fail(401,'Check your name and passcode.');
  const old=await get('posukPractice/allowedStudents/'+id);
  if(old)profile={...old,passcode:String(old.passcode||'5770')};
 }

 if(!profile||profile.active===false||!sameName(id,profile)||!equal(profile.passcode||'',pin))
  fail(401,'Check your name and individual passcode.');

 const memberships=await get('b3Games/students/'+id+'/memberships')||{};
 const ids=Object.values(memberships).filter(m=>m&&m.active!==false&&m.workspaceId==='b3-2026'&&key(m.classId)).map(m=>m.classId);
 const valid=[];
 for(const classId of new Set(ids)){
  const cls=await get('b3Games/workspaces/b3-2026/classes/'+classId);
  if(cls&&cls.active!==false&&cls.members?.[id]&&cls.members[id].active!==false)valid.push({classId,cls});
 }
 // Only older B3 accounts without membership records may use the legacy class.
 if(!Object.keys(memberships).length&&['et','wt'].includes(profile.classId)){
  const cls=await get('b3Games/workspaces/b3-2026/classes/'+profile.classId);
  if(cls&&cls.active!==false&&cls.members?.[id]&&cls.members[id].active!==false)valid.push({classId:profile.classId,cls});
 }
 const selected=valid.find(v=>v.classId===body.classId)||(valid.length===1?valid[0]:null);
 if(!selected)fail(403,'Choose an active class on the main site first.');
 return {id,profile,...selected};
}
module.exports={resolveStudent};
