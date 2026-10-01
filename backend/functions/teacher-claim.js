'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {claimTeacher}=require('./teacher-claim-core.cjs');
if(!admin.apps.length)admin.initializeApp();
exports.funTorahTeacherClaim=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io'],maxInstances:5},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 try{
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token)return res.status(401).json({error:'Google sign-in required.'});
  const identity=await admin.auth().verifyIdToken(token,true);
  const db=admin.database();
  const result=await claimTeacher({get:async path=>(await db.ref(path).once('value')).val(),update:updates=>db.ref().update(updates)},identity);
  res.json(result);
 }catch(error){res.status(error.code&&Number.isInteger(error.code)?error.code:403).json({error:error.code&&Number.isInteger(error.code)?error.message:'Your teacher account could not be verified.'});}
});
