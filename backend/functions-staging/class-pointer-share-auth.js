'use strict';
// Authenticated, class-scoped authorizations for future embedded activity sharing.
// This endpoint does not capture screens or create WebRTC connections.
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const crypto=require('node:crypto');
const {readPasscode,key,equal}=require('./student-passcodes.cjs');
const {STAGING_ORIGIN}=require('./staging-cors.cjs');
if(!admin.apps.length)admin.initializeApp();
const STAGING_PROJECT='fun-torah-tools-staging';
const STAGING_DB='https://fun-torah-tools-staging-default-rtdb.firebaseio.com';
function stagingDatabase(){
 const project=process.env.GCLOUD_PROJECT||process.env.GCP_PROJECT||process.env.GOOGLE_CLOUD_PROJECT;
 if(process.env.B3_STAGING_DEPLOYMENT!=='true'||project!==STAGING_PROJECT)error(503,'Staging authorization is unavailable.');
 const options=admin.app().options||{};
 if((options.projectId&&options.projectId!==STAGING_PROJECT)||(options.databaseURL&&options.databaseURL!==STAGING_DB))error(503,'Staging database target mismatch.');
 return admin.database();
}
const validRoom=s=>typeof s==='string'&&/^class-pointer-[a-f0-9-]{36}$/.test(s);
const validId=s=>key(s);
const error=(code,message)=>{throw Object.assign(new Error(message),{code})};
exports.classPointerShareAuth=onRequest({
 region:'us-central1',
 cors:[STAGING_ORIGIN],
 maxInstances:10
},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>4000)return res.status(413).json({error:'Request too large.'});
 try{
  const db=stagingDatabase(),body=req.body||{},action=body.action;
  const studentId=body.studentId,room=body.room,classId=body.classId,workspaceId='b3-2026';
  if(!validRoom(room)||!validId(classId))error(400,'Invalid class session.');
  const base='b3Games/workspaces/'+workspaceId+'/classes/'+classId;
  const [classSnap,sessionSnap]=await Promise.all([db.ref(base).once('value'),db.ref(base+'/classPointerSessions/'+room).once('value')]);
  const cls=classSnap.val(),session=sessionSnap.val();
  if(!cls||cls.active===false||!session||session.roomId!==room||Date.now()-session.createdAt>14400000||session.createdAt>Date.now()+60000)error(403,'Class Pointer is not active for this class.');
  if(cls.toolGrants?.['class-pointer']!==true)error(403,'Class Pointer is disabled for this class.');
  const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
  const failurePaths=id=>({s:'b3Private/classPointerJoinLimits/s_'+sha(id).slice(0,32),i:'b3Private/classPointerJoinLimits/i_'+sha(req.ip||'unknown').slice(0,32)});
  const assertStudentNotLimited=async g=>{
   const row=(await db.ref(g.s).once('value')).val();
   if(row?.until>Date.now())error(429,'Too many wrong passcodes. Please wait a few minutes.');
  };
  const addressIsLimited=async g=>(await db.ref(g.i).once('value')).val()?.until>Date.now();
  const rejectWrongPasscode=async g=>{
   if(await addressIsLimited(g))error(429,'Too many wrong passcodes. Please wait a few minutes.');
   await recordFailure(g);
   error(401,'Please sign in again.');
  };
  const recordFailure=async g=>{
   const now=Date.now(),bump=(path,max,windowMs)=>db.ref(path).transaction(cur=>{const r=cur&&now-cur.start<windowMs?cur:{start:now,count:0};const count=r.count+1;return {start:r.start,count,until:count>=max?now+windowMs:0}});
   await Promise.all([bump(g.s,8,900000),bump(g.i,40,3600000)]);
  };
  if(action==='permissions'){
   const request=session.destinationRequest;
   if(!(request&&['screens','boards'].includes(request.mode))&&session.studentScreenSharing!==true)error(403,'There is no active student activity request.');
   if(!validId(studentId)||!validId(body.pin)||!cls.members?.[studentId]||cls.members[studentId].active===false)error(403,'Student not in this class.');
   const guard=failurePaths(studentId);
   await assertStudentNotLimited(guard);
   const [profile,code]=await Promise.all([
    db.ref('b3Games/students/'+studentId+'/profile').once('value'),
    readPasscode(p=>db.ref(p).once('value').then(s=>s.val()),studentId,{allowLegacyDefault:false})
   ]);
   if(!profile.val()||profile.val().active===false)error(403,'Inactive student.');
   if(!code.passcode||!equal(code.passcode,body.pin))await rejectWrongPasscode(guard);
   const permission=(await db.ref('b3Private/classPointerSharePermissions/'+workspaceId+'/'+classId+'/'+room+'/'+studentId).once('value')).val()||{};
   return res.json({ok:true,screenSharingDenied:permission.screenSharingDenied===true||session.screenSharingDenied?.[studentId]===true,whiteboardDenied:permission.whiteboardDenied===true||session.whiteboardDenied?.[studentId]===true});
  }
  if(action==='issue'){
   if(session.studentScreenSharing!==true)error(403,'Screen sharing is not enabled for this class.');
   if(!validId(studentId)||!validId(body.pin)||!cls.members?.[studentId]||cls.members[studentId].active===false)error(403,'Student not in this class.');
   const guard=failurePaths(studentId);
   await assertStudentNotLimited(guard);
   const permission=(await db.ref('b3Private/classPointerSharePermissions/'+workspaceId+'/'+classId+'/'+room+'/'+studentId).once('value')).val();
   // The website currently live still records a teacher's denial on the public session record; the new one uses the private record. Honor both.
   if(permission?.screenSharingDenied===true||session.screenSharingDenied?.[studentId]===true)error(403,'Your teacher has turned off your screen sharing.');
   const profile=(await db.ref('b3Games/students/'+studentId+'/profile').once('value')).val();
   if(!profile||profile.active===false)error(403,'Inactive student.');
   const code=await readPasscode(p=>(db.ref(p).once('value')).then(s=>s.val()),studentId,{allowLegacyDefault:false});
   if(!code.passcode||!equal(code.passcode,body.pin))await rejectWrongPasscode(guard);
   // A student's own allowance of successful tickets (25 per 10 minutes), independent of classmates.
   let busy=false;
   await db.ref('b3Private/classPointerShareLimits/ok_'+sha(studentId).slice(0,32)).transaction(previous=>{
    const now=Date.now(),row=previous&&previous.until>now?previous:{count:0,until:now+600000};
    if(row.count>=25){busy=true;return undefined}
    return {count:row.count+1,until:row.until};
   });
   if(busy)error(429,'Too many sharing attempts. Try again in a few minutes.');
   const token=crypto.randomBytes(32).toString('hex');
   const digest=crypto.createHash('sha256').update(token).digest('hex');
   await db.ref('b3Private/classPointerShareTickets/'+digest).set({studentId,classId,room,createdAt:Date.now(),expiresAt:Date.now()+90000});
   return res.json({ok:true,token,studentName:String(profile.name||'Student').slice(0,32)});
  }
  if(action==='verify'){
   if(session.studentScreenSharing!==true)error(403,'Screen sharing is not enabled for this class.');
   const auth=String(req.headers.authorization||'').match(/^Bearer (.+)$/);
   if(!auth)error(401,'Teacher sign-in required.');
   const claims=await admin.auth().verifyIdToken(auth[1],true);
   if(claims.b3StagingAccount!==true||claims.email_verified!==true||!String(claims.email||'').toLowerCase().endsWith('@funtorahtools-staging.test'))error(403,'A fictional staging teacher account is required.');
   // The published session belongs to this exact Firebase-authenticated teacher.
   if(session.teacherUid!==claims.uid)error(403,'This session belongs to another teacher.');
   const [adminSnap,teacherSnap]=await Promise.all([
     db.ref('b3Games/admins/'+claims.uid).once('value'),
     db.ref('b3Games/workspaces/'+workspaceId+'/teachers/'+claims.uid).once('value')
   ]);
   const adminRecord=adminSnap.val(),teacherRecord=teacherSnap.val();
   const bootstrapAdmin=claims.email_verified===true&&String(claims.email||'').toLowerCase()==='owner@funtorahtools-staging.test';
   const activeAdmin=!!adminRecord&&adminRecord.active===true;
   const assignedTeacher=teacherRecord?.active===true&&teacherRecord.classIds?.[classId]===true;
   if(!bootstrapAdmin&&!activeAdmin&&!assignedTeacher)error(403,'Teacher is no longer active or assigned to this class.');
   const token=String(body.token||'');
   if(!/^[a-f0-9]{64}$/.test(token))error(400,'Invalid sharing ticket.');
   const digest=crypto.createHash('sha256').update(token).digest('hex');
   // Verify atomically. A repeated call from the *same session owner* during
   // connection setup is idempotent; a different teacher or class cannot replay it.
   // Retain the short-lived record rather than deleting it before media connects.
   const ticketRef=db.ref('b3Private/classPointerShareTickets/'+digest);
   const now=Date.now();
   const used=await ticketRef.transaction(row=>{
     if(row===null)return row; // let RTDB retry the empty local-cache pass with the stored ticket
     if(!row||row.expiresAt<=now||row.room!==room||row.classId!==classId)return;
     if(row.verifiedBy){
       if(row.verifiedBy!==claims.uid||!Number.isFinite(row.verifiedAt)||now-row.verifiedAt>30000)return;
       return row;
     }
     return {...row,verifiedBy:claims.uid,verifiedAt:now};
   });
   const ticket=used.committed?used.snapshot.val():null;
   if(!ticket)error(403,'Sharing ticket expired, used, or belongs to another class.');
   const permission=(await db.ref('b3Private/classPointerSharePermissions/'+workspaceId+'/'+classId+'/'+room+'/'+ticket.studentId).once('value')).val();
   if(permission?.screenSharingDenied===true||session.screenSharingDenied?.[ticket.studentId]===true)error(403,'Your teacher has turned off your screen sharing.');
   const [profileSnap,memberSnap]=await Promise.all([
     db.ref('b3Games/students/'+ticket.studentId+'/profile').once('value'),
     db.ref(base+'/members/'+ticket.studentId).once('value')
   ]);
   const profile=profileSnap.val(),member=memberSnap.val();
   if(!profile||profile.active===false||!member||member.active===false)error(403,'Student no longer belongs to this class.');
   return res.json({ok:true,studentId:ticket.studentId,studentName:String(profile.name||'Student').slice(0,32)});
  }
  // ---- Join tickets: only a verified class member may connect to the teacher's room. ----
  // The room id is public (the session is published so classmates can find it), so joining
  // must not depend on knowing it. A student proves their own passcode here, and gets a
  // 90-second ticket bound to this class, session, student and the student's own PeerJS id.
  // The teacher page verifies the ticket (signed in as the session owner) before accepting
  // the connection, and takes the student's id and name only from the verified result.
  const peerOk=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(s);
  const teacherSessionOwner=async()=>{
   const auth=String(req.headers.authorization||'').match(/^Bearer (.+)$/);
   if(!auth)error(401,'Teacher sign-in required.');
   const claims=await admin.auth().verifyIdToken(auth[1],true);
   if(claims.b3StagingAccount!==true||claims.email_verified!==true||!String(claims.email||'').toLowerCase().endsWith('@funtorahtools-staging.test'))error(403,'A fictional staging teacher account is required.');
   if(session.teacherUid!==claims.uid)error(403,'This session belongs to another teacher.');
   const [adminSnap,teacherSnap]=await Promise.all([
    db.ref('b3Games/admins/'+claims.uid).once('value'),
    db.ref('b3Games/workspaces/'+workspaceId+'/teachers/'+claims.uid).once('value')
   ]);
   const adminRecord=adminSnap.val(),teacherRecord=teacherSnap.val();
   const bootstrapAdmin=claims.email_verified===true&&String(claims.email||'').toLowerCase()==='owner@funtorahtools-staging.test';
   const activeAdmin=!!adminRecord&&adminRecord.active===true;
   const assignedTeacher=teacherRecord?.active===true&&teacherRecord.classIds?.[classId]===true;
   if(!bootstrapAdmin&&!activeAdmin&&!assignedTeacher)error(403,'Teacher is no longer active or assigned to this class.');
   return claims;
  };
  const stillMember=async id=>{
   if(!validId(id)||!cls.members?.[id]||cls.members[id].active===false)return null;
   const [profileSnap,memberSnap]=await Promise.all([db.ref('b3Games/students/'+id+'/profile').once('value'),db.ref(base+'/members/'+id).once('value')]);
   const profile=profileSnap.val(),member=memberSnap.val();
   if(!profile||profile.active===false||!member||member.active===false)return null;
   return profile;
  };
  if(action==='joinIssue'){
   if(!validId(studentId)||typeof body.pin!=='string'||!body.pin||body.pin.length>100||!peerOk(body.peerId))error(400,'Invalid join request.');
   // Wrong passcodes are counted per student and per address; a correct one clears the student's count.
   const now=Date.now(),sPath='b3Private/classPointerJoinLimits/s_'+sha(studentId).slice(0,32),iPath='b3Private/classPointerJoinLimits/i_'+sha(req.ip||'unknown').slice(0,32);
   const [sRow,iRow]=await Promise.all([db.ref(sPath).once('value').then(s=>s.val()),db.ref(iPath).once('value').then(s=>s.val())]);
   // A student-specific lock blocks every attempt, preventing a passcode oracle. A shared-address
   // lock only rejects incorrect attempts below, so one classroom cannot lock out its classmates.
   if(sRow?.until>now)error(429,'Too many wrong passcodes. Please wait a few minutes.');
   const bump=(path,max,windowMs)=>db.ref(path).transaction(cur=>{const r=cur&&now-cur.start<windowMs?cur:{start:now,count:0};const count=r.count+1;return {start:now,count,until:count>=max?now+windowMs:0}});
   const fail=async(code,message)=>{if(iRow?.until>now)error(429,'Too many wrong passcodes. Please wait a few minutes.');await Promise.all([bump(sPath,8,900000),bump(iPath,40,3600000)]);error(code,message)};
   const profile=await stillMember(studentId);
   if(!profile)error(403,'Student not in this class.');
   // The shared default passcode is never accepted for joining a lesson.
   const code=await readPasscode(p=>(db.ref(p).once('value')).then(s=>s.val()),studentId,{allowLegacyDefault:false});
   if(!code.passcode||!equal(code.passcode,body.pin))await fail(401,'Please sign in again.');
   if(sRow)await db.ref(sPath).set(null);
   const token=crypto.randomBytes(32).toString('hex'),digest=sha(token);
   // One outstanding join ticket per student: a new one replaces the old, so tickets never pile up.
   const indexRef=db.ref('b3Private/classPointerJoinTicketIndex/'+sha(studentId).slice(0,32));
   const previous=(await indexRef.once('value')).val();
   if(typeof previous==='string'&&/^[a-f0-9]{64}$/.test(previous))await db.ref('b3Private/classPointerJoinTickets/'+previous).set(null);
   await db.ref('b3Private/classPointerJoinTickets/'+digest).set({studentId,classId,room,peerId:body.peerId,createdAt:now,expiresAt:now+90000});
   await indexRef.set(digest);
   return res.json({ok:true,token,studentName:String(profile.name||'Student').slice(0,32)});
  }
  if(action==='joinVerify'){
   const claims=await teacherSessionOwner();
   const token=String(body.token||'');
   if(!/^[a-f0-9]{64}$/.test(token)||!peerOk(body.peerId))error(400,'Invalid join ticket.');
   const ticketRef=db.ref('b3Private/classPointerJoinTickets/'+sha(token)),now=Date.now();
   // One student connection per ticket: a stolen ticket does not work from another connection,
   // and a repeat check by the same teacher for the same connection is allowed for 30 seconds.
   const used=await ticketRef.transaction(row=>{
    if(row===null)return row; // let RTDB retry the empty local-cache pass with the stored ticket
    if(!row||row.expiresAt<=now||row.room!==room||row.classId!==classId||row.peerId!==body.peerId)return;
    if(row.verifiedBy){
     if(row.verifiedBy!==claims.uid||!Number.isFinite(row.verifiedAt)||now-row.verifiedAt>30000)return;
     return row;
    }
    return {...row,verifiedBy:claims.uid,verifiedAt:now};
   });
   const ticket=used.committed?used.snapshot.val():null;
   if(!ticket)error(403,'Join ticket expired, already used, or not for this class and connection.');
   const profile=await stillMember(ticket.studentId);
   if(!profile)error(403,'Student no longer belongs to this class.');
   return res.json({ok:true,studentId:ticket.studentId,studentName:String(profile.name||'Student').slice(0,32)});
  }
  if(action==='joinRecheck'){
   // Teacher page asks every minute whether connected students are still allowed (removed, blocked, class switched off).
   await teacherSessionOwner();
   const ids=Array.isArray(body.studentIds)?body.studentIds.filter(validId).slice(0,16):[];
   const allowed=[];
   for(const id of ids)if(await stillMember(id))allowed.push(id);
   return res.json({ok:true,allowed});
  }
  error(400,'Unknown action.');
 }catch(err){
  const code=Number.isInteger(err.code)?err.code:500;
  if(code===500)console.error('classPointerShareAuth',err);
  return res.status(code).json({error:code===500?'Screen sharing authorization unavailable.':err.message});
 }
});

