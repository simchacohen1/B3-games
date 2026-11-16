'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const core=require('./class-worksheets-core.cjs');
if(!admin.apps.length)admin.initializeApp();
// HIGH RISK (student data; copies one teacher file). A teacher sends a PDF worksheet from their own library to
// their class; students of that class list it and get a short link to read it. Storage rules are unchanged:
// classWorksheets/ stays closed to browsers. See class-worksheets-core.cjs for every check.
// Allowed to send: an active teacher assigned to the class, or a site admin (b3Games/admins/{uid}/active).
const BUCKET='b3-games.firebasestorage.app';

exports.classWorksheets=onRequest({region:'us-central1',cors:['https://funtorahtools.com','https://sols.tools','https://www.sols.tools','https://www.funtorahtools.com','https://simchacohen1.github.io'],maxInstances:10,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!token)return res.status(401).json({error:'Sign-in required.'});
    let identity;
    try{identity=await admin.auth().verifyIdToken(token,true)}catch(_){return res.status(401).json({error:'Sign in again, then try again.'})}
    const db=admin.database();
    const result=await core.handle({
      body:req.body,identity,
      get:async path=>(await db.ref(path).get()).val(),
      bucket:admin.storage().bucket(BUCKET),
      ownerEmail:'',stagingPassword:false,
      log:entry=>console.info('classWorksheets',JSON.stringify(entry))
    });
    return res.status(200).json(result);
  }catch(error){
    const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
    if(code===500)console.error('classWorksheets',error);
    return res.status(code).json({error:code===500?'Worksheets could not be opened.':error.message});
  }
});
