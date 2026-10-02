'use strict';
const crypto=require('node:crypto');
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
async function resolveStudent(get,body){
 const name=String(body.name||'').trim(),pin=String(body.pin||'').trim();
 if(!name||!pin)fail(400,'Enter your name and individual passcode.');
 let id=body.b3StudentId,profile;
 if(id){if(!key(id))fail(400,'Invalid student account.');profile=await get('b3Games/students/'+id+'/profile');}
 else{
  const all=await get('b3Games/students')||{};
  const matches=Object.entries(all).filter(([,r])=>r?.profile?.active!==false&&normalize(r?.profile?.name)===normalize(name)&&equal(r?.profile?.passcode||'',pin));
  if(matches.length>1)fail(409,'More than one account matches. Sign in from the main site.');
  if(matches.length){id=matches[0][0];profile=matches[0][1].profile;}
 }
 if(!profile){
  id=id||name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  if(!key(id))fail(401,'Check your name and passcode.');
  const old=await get('posukPractice/allowedStudents/'+id);
  if(old)profile={...old,passcode:String(old.passcode||'5770')};
 }
 if(!profile||profile.active===false||normalize(profile.name)!==normalize(name)||!equal(profile.passcode||'',pin))fail(401,'Check your name and individual passcode.');
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
