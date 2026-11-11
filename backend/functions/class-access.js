'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {manageClassAccess}=require('./class-access-core.cjs');
if(!admin.apps.length)admin.initializeApp();
exports.funTorahClassAccess=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io','https://funtorahtools.com','https://www.funtorahtools.com'],maxInstances:5},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>65536)return res.status(413).json({error:'Request too large.'});
 try{
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token)return res.status(401).json({error:'Google sign-in required.'});
  const identity=await admin.auth().verifyIdToken(token,true),db=admin.database();
  const store={
   get:async path=>(await db.ref(path).once('value')).val(),
   update:updates=>db.ref().update(updates),
   updateSettings:mutate=>db.ref('b3Games/siteSettings').transaction(current=>mutate(current))
  };
  res.json(await manageClassAccess(store,identity,req.body||{}));
 }catch(error){res.status(Number.isInteger(error.code)?error.code:403).json({error:Number.isInteger(error.code)?error.message:'Class access could not be authorized.'});}
});
