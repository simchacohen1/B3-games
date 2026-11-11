'use strict';
// Issue #667: `b3Games/students` is several MB because every student record also
// holds Halacha work and progress. Sign-in only needs each student's small
// `profile`, so read the id list (keys only, via a REST `shallow=true` read) and
// then each profile, instead of downloading every full student record.
// If the shallow read is unavailable (tests, local tools, or any error) this falls
// back to the old full read, so behaviour never depends on it.
const ROOT='b3Games/students';
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);

// Keys of an RTDB path without downloading the children. Uses the same service
// account token the Admin SDK already uses for its own database connection.
async function adminShallowKeys(path){
 let admin;
 try{admin=require('firebase-admin');}catch(_){return null;}
 if(!admin.apps.length)return null;
 const app=admin.app();
 const url=app.options.databaseURL||(process.env.GCLOUD_PROJECT?`https://${process.env.GCLOUD_PROJECT}-default-rtdb.firebaseio.com`:'');
 if(!url||typeof fetch!=='function')return null;
 const credential=app.options.credential||admin.credential.applicationDefault();
 const {access_token:token}=await credential.getAccessToken();
 const res=await fetch(`${url.replace(/\/$/,'')}/${path}.json?shallow=true`,{headers:{Authorization:'Bearer '+token}});
 if(!res.ok)throw new Error('shallow read '+res.status);
 const data=await res.json();
 return data&&typeof data==='object'?Object.keys(data):[];
}

// Returns { ids, profiles } where profiles[id] is that student's profile (or null).
// `keys` may be supplied by a caller/test; otherwise the Admin SDK shallow read is used.
async function loadStudentProfiles(get,keys){
 let ids=null;
 try{ids=await (keys||get.keys||adminShallowKeys)(ROOT);}
 catch(error){console.warn('Student directory shallow read failed; using full read.',error?.message||error);ids=null;}
 if(!Array.isArray(ids)){
  const all=await get(ROOT)||{};
  const profiles={};
  for(const [id,row] of Object.entries(all))profiles[id]=row?.profile||null;
  return {ids:Object.keys(all),profiles};
 }
 ids=ids.filter(validId);
 const rows=await Promise.all(ids.map(id=>get(ROOT+'/'+id+'/profile')));
 const profiles={};
 ids.forEach((id,i)=>{profiles[id]=rows[i]||null;});
 return {ids,profiles};
}

module.exports={loadStudentProfiles,adminShallowKeys};
