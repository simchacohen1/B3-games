'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const core=require('./teacher-student-files-core.cjs');
if(!admin.apps.length)admin.initializeApp();
// STAGING COPY of backend/functions/teacher-student-files.js (fun-torah-tools-staging only).
// Differences: the staging owner and bucket, approved staging test accounts may sign in with a password, and only
// the staging site and its preview addresses may call it. The checks are in the shared core file.
require('./firebase-resource-targets.cjs').assertNoProductionFirebaseTarget(admin.apps[0]);
const STAGING_BUCKET='fun-torah-tools-staging.firebasestorage.app';
const STAGING_ORIGINS=['https://fun-torah-tools-staging.web.app',/^https:\/\/fun-torah-tools-staging--[a-z0-9-]+\.web\.app$/];
const OWNER_EMAIL='owner@funtorahtools-staging.test';

exports.teacherStudentFiles=onRequest({region:'us-central1',cors:STAGING_ORIGINS,maxInstances:10,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!token)return res.status(401).json({error:'Sign-in required.'});
    const identity=await admin.auth().verifyIdToken(token,true),db=admin.database();
    const result=await core.handle({
      body:req.body,identity,
      get:async path=>(await db.ref(path).get()).val(),
      bucket:admin.storage().bucket(STAGING_BUCKET),
      ownerEmail:OWNER_EMAIL,stagingPassword:true,
      log:entry=>console.info('teacherStudentFiles',JSON.stringify(entry))
    });
    return res.status(200).json(result);
  }catch(error){
    const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
    if(code===500)console.error('teacherStudentFiles',error);
    return res.status(code).json({error:code===500?'Student files could not be opened.':error.message});
  }
});
