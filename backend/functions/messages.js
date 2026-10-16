'use strict';
// Teacher <-> student messaging endpoint. NOT DEPLOYED until the owner approves it.
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {messagesApi}=require('./messages-core.cjs');
if(!admin.apps.length)admin.initializeApp();
const BUCKET='b3-games.firebasestorage.app';
exports.messagesPortal=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io','https://funtorahtools.com','https://www.funtorahtools.com'],maxInstances:5,timeoutSeconds:30,memory:'256MiB'},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method==='GET')return res.json({ok:true,ready:true,version:1});
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>760000)return res.status(413).json({error:'Request too large.'});
 try{
  const db=admin.database();
  const store={
   get:async p=>(await db.ref(p).once('value')).val(),
   set:(p,v)=>db.ref(p).set(v),
   tx:async(p,fn)=>{const ref=db.ref(p);const snap=await ref.once('value');
    // First pass can see an empty cached copy; hand it back unchanged so Firebase retries with real data.
    return ref.transaction(cur=>cur===null&&snap.val()!==null?cur:fn(cur));},
   page:async(p,{limit,before})=>{
    let q=db.ref(p).orderByKey();
    if(before)q=q.endBefore(before);
    const snap=await q.limitToLast(limit).once('value');
    const rows=[];snap.forEach(c=>{rows.push(c.val());});
    return rows;
   },
   putFile:(path,buf,type)=>admin.storage().bucket(BUCKET).file(path).save(buf,{resumable:false,contentType:type,metadata:{cacheControl:'private, max-age=0'}}),
   getFile:async path=>(await admin.storage().bucket(BUCKET).file(path).download())[0],
   delFile:path=>admin.storage().bucket(BUCKET).file(path).delete({ignoreNotFound:true})
  };
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  let auth={};
  if(token){
   try{auth={identity:await admin.auth().verifyIdToken(token,true)};}
   catch(e){return res.status(401).json({error:'Please sign in again.'});}
  }
  auth.ip=req.ip;
  res.json(await messagesApi(store,auth,req.body||{}));
 }catch(error){
  const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
  if(code===500)console.error('messagesPortal',error);
  res.status(code).json({error:code===500?'Messages could not be sent right now. Please try again.':error.message});
 }
});
