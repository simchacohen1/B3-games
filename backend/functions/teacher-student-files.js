'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const core=require('./teacher-student-files-core.cjs');
if(!admin.apps.length)admin.initializeApp();
// HIGH RISK (student data), read only: a teacher sees the saved whiteboards of students in their own classes.
// Storage rules are unchanged. See teacher-student-files-core.cjs for the checks.
// Allowed: an active teacher assigned to the class, or a site admin (b3Games/admins/{uid}/active). There is no
// special address here: the owner is let in through the same admin row the other teacher tools use.
const BUCKET='b3-games.firebasestorage.app';

exports.teacherStudentFiles=onRequest({region:'us-central1',cors:['https://sols.tools','https://www.sols.tools','https://simchacohen1.github.io'],maxInstances:10,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!token)return res.status(401).json({error:'Sign-in required.'});
    const identity=await admin.auth().verifyIdToken(token,true),db=admin.database();
    const result=await core.handle({
      body:req.body,identity,
      get:async path=>(await db.ref(path).get()).val(),
      bucket:admin.storage().bucket(BUCKET),
      ownerEmail:'',stagingPassword:false,
      log:entry=>console.info('teacherStudentFiles',JSON.stringify(entry))
    });
    return res.status(200).json(result);
  }catch(error){
    const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
    if(code===500)console.error('teacherStudentFiles',error);
    return res.status(code).json({error:code===500?'Student files could not be opened.':error.message});
  }
});
