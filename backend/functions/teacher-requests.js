'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp();
const ROOT='b3Games/workspaces/b3-2026';
const OWNER='simcha5770@gmail.com';
const clean=s=>String(s||'').trim();
const emailOf=identity=>clean(identity.email).toLowerCase();
exports.funTorahTeacherRequests=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io','https://funtorahtools.com','https://www.funtorahtools.com'],maxInstances:5},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'POST required'});
 try{
  const token=clean(req.headers.authorization).replace(/^Bearer\s+/i,'');
  if(!token)return res.status(401).json({error:'Google sign-in required'});
  const user=await admin.auth().verifyIdToken(token,true);
  if(!user.uid||!user.email_verified||user.firebase?.sign_in_provider!=='google.com')return res.status(403).json({error:'Verified Google sign-in required'});
  const action=clean(req.body?.action),email=emailOf(user),db=admin.database();
  if(action==='request'){
   if(email===OWNER)return res.status(400).json({error:'Owner account is already authorized'});
   const name=clean(req.body?.name).slice(0,120);
   const school=clean(req.body?.school).slice(0,160);
   const purpose=clean(req.body?.purpose).slice(0,350);
   if(!name||!school||req.body?.adultConfirmed!==true)return res.status(400).json({error:'Name, school, and adult confirmation are required'});
   const ref=db.ref(ROOT+'/teacherRequests/'+user.uid);
   const current=(await ref.once('value')).val();
   if(current?.status==='approved')return res.json({status:'approved'});
   if(current?.status==='rejected')return res.status(403).json({error:'Your request cannot be resubmitted'});
   await ref.update({uid:user.uid,email,name,school,purpose,adultConfirmed:true,status:'pending',submittedAt:current?.submittedAt||admin.database.ServerValue.TIMESTAMP,updatedAt:admin.database.ServerValue.TIMESTAMP});
   return res.json({status:'pending'});
  }
  if(email!==OWNER||user.email_verified!==true)return res.status(403).json({error:'Owner access required'});
  if(action==='list'){
   const snap=await db.ref(ROOT+'/teacherRequests').orderByChild('status').equalTo('pending').once('value');
   return res.json({requests:Object.values(snap.val()||{})});
  }
  if(action==='review'){
   const uid=clean(req.body?.uid),decision=clean(req.body?.decision);
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||!['approve','reject'].includes(decision))return res.status(400).json({error:'Invalid request'});
   const ref=db.ref(ROOT+'/teacherRequests/'+uid),snap=await ref.once('value'),request=snap.val();
   if(!request||request.status!=='pending')return res.status(409).json({error:'Request is not pending'});
   const newStatus=decision==='approve'?'approved':'rejected';
   // Write both decisions and invitations atomically. An approved request
   // must not be stranded without an invitation if one write fails.
   const updates={
    [ROOT+'/teacherRequests/'+uid+'/status']:newStatus,
    [ROOT+'/teacherRequests/'+uid+'/reviewedAt']:admin.database.ServerValue.TIMESTAMP,
    [ROOT+'/teacherRequests/'+uid+'/reviewedBy']:user.uid
   };
   if(decision==='approve'){
    const inviteId=request.email.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    const inviteRef=db.ref(ROOT+'/teacherInvites/'+inviteId);
    const old=(await inviteRef.once('value')).val();
    if(!old){
     const prefix=ROOT+'/teacherInvites/'+inviteId+'/';
     Object.assign(updates,{
      [prefix+'email']:request.email,[prefix+'name']:request.name,
      [prefix+'role']:'teacher',[prefix+'active']:false,
      [prefix+'updatedAt']:admin.database.ServerValue.TIMESTAMP
     });
    }
   }
   await db.ref().update(updates);
   return res.json({status:newStatus});
  }
  return res.status(400).json({error:'Unknown action'});
 }catch(e){console.error('Teacher request error',e);return res.status(500).json({error:'Unable to complete teacher request'});}
});
