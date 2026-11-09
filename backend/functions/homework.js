'use strict';
// Homework Portal endpoint (live site). The staging copy lives in homework-staging/ and is deployed separately.
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {homeworkApi}=require('./homework-core.cjs');
if(!admin.apps.length)admin.initializeApp();
exports.homeworkPortal=onRequest({region:'us-central1',cors:['https://funtorahtools.com','https://www.funtorahtools.com','https://simchacohen1.github.io'],maxInstances:5,timeoutSeconds:30,memory:'256MiB'},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method==='GET')return res.json({ok:true,ready:true,version:1});
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 const voiceComment=req.body?.action==='comment'&&typeof req.body?.voiceDataURL==='string';
 // One-on-one voice messages (#647) can be up to 5 minutes (3 MB of audio, ~4 MB as base64).
 const voiceMessage=req.body?.action==='dmSend'&&typeof req.body?.voiceDataURL==='string';
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>(voiceMessage?4200000:voiceComment?320000:20000))return res.status(413).json({error:'Request too large.'});
 try{
  const db=admin.database();
  const store={
   get:async p=>(await db.ref(p).once('value')).val(),
   set:(p,v)=>db.ref(p).set(v),
   tx:async(p,fn)=>{const ref=db.ref(p);const snap=await ref.once('value');
    // First pass can see an empty cached copy; give it back unchanged so Firebase retries with real data.
    return ref.transaction(cur=>cur===null&&snap.val()!==null?cur:fn(cur));},
   // Voice messages: Cloud Storage via the Admin SDK only (no client rules cover homeworkMessages/).
   putFile:(p,data,contentType)=>admin.storage().bucket().file(p).save(data,{contentType,resumable:false,metadata:{cacheControl:'private, no-store'}}),
   getFile:async p=>{const file=admin.storage().bucket().file(p);const [exists]=await file.exists();if(!exists)return null;
    const [[data],[meta]]=await Promise.all([file.download(),file.getMetadata()]);return {data,contentType:meta.contentType};},
   deleteFile:p=>admin.storage().bucket().file(p).delete({ignoreNotFound:true})
  };
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  let auth={};
  if(token){
   try{auth={identity:await admin.auth().verifyIdToken(token,true)};}
   catch(e){return res.status(401).json({error:'Please sign in again.'});}
  }
  auth.ip=req.ip;
  res.json(await homeworkApi(store,auth,req.body||{}));
 }catch(error){
  const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
  if(code===500)console.error('homeworkPortal',error);
  res.status(code).json({error:code===500?'Homework could not save right now. Please try again.':error.message});
 }
});
