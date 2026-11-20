'use strict';
// STAGING COPY of backend/functions/student-locks.js (fun-torah-tools-staging only): only the staging site and its
// preview addresses may call it. The rules are in the shared student-locks-core.cjs.
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {manageLocks}=require('./student-locks-core.cjs');
if(!admin.apps.length)admin.initializeApp();
require('./firebase-resource-targets.cjs').assertNoProductionFirebaseTarget(admin.apps[0]);
const STAGING_ORIGINS=['https://fun-torah-tools-staging.web.app',/^https:\/\/fun-torah-tools-staging--[a-z0-9-]+\.web\.app$/];
exports.studentLocks=onRequest({region:'us-central1',cors:STAGING_ORIGINS,maxInstances:10},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>65536)return res.status(413).json({error:'Request too large.'});
 try{
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token)return res.status(401).json({error:'Sign-in required.'});
  let identity;
  try{identity=await admin.auth().verifyIdToken(token,true)}catch(_){return res.status(401).json({error:'Sign in again, then try again.'})}
  const db=admin.database();
  const store={get:async path=>(await db.ref(path).once('value')).val(),update:updates=>db.ref().update(updates)};
  res.json(await manageLocks(store,identity,req.body||{}));
 }catch(error){
  const known=Number.isInteger(error.code)&&error.code>=400&&error.code<600;
  if(!known)console.warn('studentLocks',error);
  res.status(known?error.code:500).json({error:known?error.message:'The lock change could not be saved.'});
 }
});
