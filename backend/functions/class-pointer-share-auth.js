'use strict';
// Authenticated, class-scoped authorizations for future embedded activity sharing.
// This endpoint does not capture screens or create WebRTC connections.
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const crypto=require('node:crypto');
const {readPasscode,key,equal}=require('./student-passcodes.cjs');
if(!admin.apps.length)admin.initializeApp();
const validRoom=s=>typeof s==='string'&&/^class-pointer-[a-f0-9-]{36}$/.test(s);
const validId=s=>key(s);
const error=(code,message)=>{throw Object.assign(new Error(message),{code})};
exports.classPointerShareAuth=onRequest({
 region:'us-central1',
 cors:['https://funtorahtools.com','https://www.funtorahtools.com','https://simchacohen1.github.io'],
 maxInstances:10
},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>4000)return res.status(413).json({error:'Request too large.'});
 try{
  const db=admin.database(),body=req.body||{},action=body.action;
  const studentId=body.studentId,room=body.room,classId=body.classId,workspaceId='b3-2026';
  if(!validRoom(room)||!validId(classId))error(400,'Invalid class session.');
  const base='b3Games/workspaces/'+workspaceId+'/classes/'+classId;
  const [classSnap,sessionSnap]=await Promise.all([db.ref(base).once('value'),db.ref(base+'/classPointerSessions/'+room).once('value')]);
  const cls=classSnap.val(),session=sessionSnap.val();
  if(!cls||cls.active===false||!session||session.roomId!==room||session.studentScreenSharing!==true||Date.now()-session.createdAt>14400000||session.createdAt>Date.now()+60000)error(403,'Screen sharing is not enabled for this class.');
  if(!['et','wt'].includes(classId)&&cls.toolGrants?.['class-pointer']!==true)error(403,'Class Pointer is disabled for this class.');
  if(action==='issue'){
   // Bound passcode attempts at this endpoint, independently of sign-in limits.
   const fingerprint=crypto.createHash('sha256').update(String(req.ip||'unknown')).digest('hex');
   const limit=db.ref('b3Private/classPointerShareLimits/'+fingerprint);
   let denied=false;
   await limit.transaction(previous=>{
    const now=Date.now();
    const row=previous&&previous.until>now?previous:{count:0,until:now+600000};
    if(row.count>=25){denied=true;return undefined}
    return {count:row.count+1,until:row.until};
   });
   if(denied)error(429,'Too many sharing attempts. Try later.');
   if(!validId(studentId)||!validId(body.pin)||!cls.members?.[studentId]||cls.members[studentId].active===false)error(403,'Student not in this class.');
   if(session.screenSharingDenied?.[studentId]===true)error(403,'Your teacher has turned off your screen sharing.');
   const profile=(await db.ref('b3Games/students/'+studentId+'/profile').once('value')).val();
   if(!profile||profile.active===false)error(403,'Inactive student.');
   const code=await readPasscode(p=>(db.ref(p).once('value')).then(s=>s.val()),studentId,{allowLegacyDefault:true});
   if(!equal(code.passcode,body.pin))error(401,'Please sign in again.');
   const token=crypto.randomBytes(32).toString('hex');
   const digest=crypto.createHash('sha256').update(token).digest('hex');
   await db.ref('b3Private/classPointerShareTickets/'+digest).set({studentId,classId,room,createdAt:Date.now(),expiresAt:Date.now()+90000});
   return res.json({ok:true,token,studentName:String(profile.name||'Student').slice(0,32)});
  }
  if(action==='verify'){
   const auth=String(req.headers.authorization||'').match(/^Bearer (.+)$/);
   if(!auth)error(401,'Teacher sign-in required.');
   const claims=await admin.auth().verifyIdToken(auth[1]);
   // The published session belongs to this exact Firebase-authenticated teacher.
   if(session.teacherUid!==claims.uid)error(403,'This session belongs to another teacher.');
   const token=String(body.token||'');
   if(!/^[a-f0-9]{64}$/.test(token))error(400,'Invalid sharing ticket.');
   const digest=crypto.createHash('sha256').update(token).digest('hex');
   // Consume the one-time ticket atomically: two simultaneous attempts cannot reuse it.
   const ticketRef=db.ref('b3Private/classPointerShareTickets/'+digest);
   let ticket=null;
   const used=await ticketRef.transaction(row=>{
     if(!row||row.expiresAt<Date.now()||row.room!==room||row.classId!==classId)return;
     ticket=row;
     return null;
   });
   if(!used.committed||!ticket)error(403,'Sharing ticket expired, used, or belongs to another class.');
   if(session.screenSharingDenied?.[ticket.studentId]===true)error(403,'Your teacher has turned off your screen sharing.');
   const [profileSnap,memberSnap]=await Promise.all([
     db.ref('b3Games/students/'+ticket.studentId+'/profile').once('value'),
     db.ref(base+'/members/'+ticket.studentId).once('value')
   ]);
   const profile=profileSnap.val(),member=memberSnap.val();
   if(!profile||profile.active===false||!member||member.active===false)error(403,'Student no longer belongs to this class.');
   return res.json({ok:true,studentId:ticket.studentId,studentName:String(profile.name||'Student').slice(0,32)});
  }
  error(400,'Unknown action.');
 }catch(err){
  const code=Number.isInteger(err.code)?err.code:500;
  if(code===500)console.error('classPointerShareAuth',err);
  return res.status(code).json({error:code===500?'Screen sharing authorization unavailable.':err.message});
 }
});
