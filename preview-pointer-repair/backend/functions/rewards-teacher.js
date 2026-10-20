'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {rewardsTeacher}=require('./rewards-teacher-core.cjs');
if(!admin.apps.length)admin.initializeApp();
exports.studentRewardsTeacher=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io'],maxInstances:10,timeoutSeconds:60,memory:'512MiB'},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>200000)return res.status(413).json({error:'Request too large.'});
 try{
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token)return res.status(401).json({error:'Teacher sign-in required.'});
  const identity=await admin.auth().verifyIdToken(token,true),db=admin.database();
  const store={
   get:async path=>(await db.ref(path).once('value')).val(),
   update:updates=>db.ref().update(updates),
   tx:(path,fn)=>db.ref(path).transaction(fn)
  };
  res.json(await rewardsTeacher(store,identity,req.body||{}));
 }catch(error){
  const code=Number.isInteger(error.code)?error.code:500;
  if(code===500)console.error('studentRewardsTeacher',error);
  res.status(code).json({error:code===500?'Student Rewards could not complete that. Try again.':error.message});
 }
});
