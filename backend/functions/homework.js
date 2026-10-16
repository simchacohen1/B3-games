'use strict';
// Homework Portal endpoint. NOT DEPLOYED until the owner approves it.
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {homeworkApi}=require('./homework-core.cjs');
if(!admin.apps.length)admin.initializeApp();
exports.homeworkPortal=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io','https://funtorahtools.com','https://www.funtorahtools.com'],maxInstances:5,timeoutSeconds:30,memory:'256MiB'},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method==='GET')return res.json({ok:true,ready:true,version:1});
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>20000)return res.status(413).json({error:'Request too large.'});
 try{
  const db=admin.database();
  const store={
   get:async p=>(await db.ref(p).once('value')).val(),
   set:(p,v)=>db.ref(p).set(v),
   tx:async(p,fn)=>{const ref=db.ref(p);const snap=await ref.once('value');
    // First pass can see an empty cached copy; give it back unchanged so Firebase retries with real data.
    return ref.transaction(cur=>cur===null&&snap.val()!==null?cur:fn(cur));}
  };
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  const auth=token?{identity:await admin.auth().verifyIdToken(token,true)}:{};
  res.json(await homeworkApi(store,auth,req.body||{}));
 }catch(error){
  const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
  if(code===500)console.error('homeworkPortal',error);
  res.status(code).json({error:code===500?'Homework could not save right now. Please try again.':error.message});
 }
});
