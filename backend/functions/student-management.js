'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {manageStudents}=require('./student-management-core.cjs');
if(!admin.apps.length)admin.initializeApp();
exports.funTorahManageStudents=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io'],maxInstances:5},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>3000)return res.status(413).json({error:'Request too large.'});
 try{
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const identity=await admin.auth().verifyIdToken(token,true),db=admin.database();
  res.json(await manageStudents({get:async path=>(await db.ref(path).once('value')).val(),update:updates=>db.ref().update(updates)},identity,req.body||{}));
 }catch(error){res.status(Number.isInteger(error.code)?error.code:403).json({error:Number.isInteger(error.code)?error.message:'Teacher student management could not be authorized.'});}
});
