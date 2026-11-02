'use strict';
// Student passcodes live only in b3Private/passcodes/{studentId}, which the
// database rules keep unreadable from browsers. Older copies in public paths
// (central profile, class members, legacy allowedStudents) are read only as a
// migration fallback and are removed by the owner migration.
const crypto=require('node:crypto');
const PRIVATE='b3Private/passcodes/';
const clean=v=>String(v??'').trim();
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const equal=(a,b)=>{const x=Buffer.from(clean(a)),y=Buffer.from(clean(b));return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);};

// Returns the student's current passcode and where it came from.
// allowLegacyDefault keeps the historic "5770 until changed" rule for legacy
// rows with no passcode; callers that must refuse the shared PIN pass false.
async function readPasscode(get,id,{allowLegacyDefault=false}={}){
 if(!key(id))return {passcode:'',source:null};
 const priv=await get(PRIVATE+id);
 if(clean(priv?.passcode))return {passcode:clean(priv.passcode),source:'private'};
 const profile=await get('b3Games/students/'+id+'/profile');
 if(clean(profile?.passcode))return {passcode:clean(profile.passcode),source:'profile'};
 const legacy=await get('posukPractice/allowedStudents/'+id);
 if(legacy&&legacy.active!==false){
  if(clean(legacy.passcode))return {passcode:clean(legacy.passcode),source:'legacy'};
  if(allowLegacyDefault)return {passcode:'5770',source:'legacy-default'};
 }
 return {passcode:'',source:null};
}

// Database updates that store a passcode privately and clear public copies.
// passcodeUpdatedAt stays public (it is not secret) so pages can notice a change.
function passcodeWrites(id,passcode,now=Date.now(),{profileExists=true}={}){
 const updates={[PRIVATE+id]:{passcode:clean(passcode),updatedAt:now}};
 if(profileExists){
  updates['b3Games/students/'+id+'/profile/passcode']=null;
  updates['b3Games/students/'+id+'/profile/passcodeUpdatedAt']=now;
 }
 return updates;
}

module.exports={PRIVATE,clean,key,equal,readPasscode,passcodeWrites};
