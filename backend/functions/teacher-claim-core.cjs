'use strict';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
async function claimTeacher(store,identity,workspaceId='b3-2026',now=Date.now()){
 if(!identity?.uid||identity.email_verified!==true||identity.firebase?.sign_in_provider!=='google.com')fail(403,'Sign in with your verified Google account.');
 const email=String(identity.email||'').trim().toLowerCase();
 if(!email)fail(403,'A verified email is required.');
 const root='b3Games/workspaces/'+workspaceId;
 const existing=await store.get(root+'/teachers/'+identity.uid);
 if(existing?.active===false)fail(403,'This teacher account is disabled.');
 const invites=await store.get(root+'/teacherInvites')||{};
 const entry=Object.entries(invites).find(([,v])=>v&&v.active!==false&&String(v.email||'').trim().toLowerCase()===email&&(!v.claimedUid||v.claimedUid===identity.uid));
 if(!entry)fail(403,'No active teacher invitation matches this Google account.');
 const [inviteId,invite]=entry;
 const classIds=Object.fromEntries(Object.entries(invite.classIds||{}).filter(([id,granted])=>id!=='*'&&granted===true));
 const record={uid:identity.uid,email,displayName:invite.name||existing?.displayName||email,role:'teacher',active:true,classIds,inviteId,claimedAt:existing?.claimedAt||now,updatedAt:now};
 await store.update({
  [root+'/teachers/'+identity.uid]:record,
  [root+'/teacherInvites/'+inviteId+'/claimedUid']:identity.uid,
  [root+'/teacherInvites/'+inviteId+'/claimedAt']:invite.claimedAt||now,
  ...Object.fromEntries(Object.keys(classIds).map(id=>[root+'/classes/'+id+'/teacherIds/'+identity.uid,true]))
 });
 return {authorized:true,role:'teacher',classIds:Object.keys(classIds),inviteId};
}
module.exports={claimTeacher};
