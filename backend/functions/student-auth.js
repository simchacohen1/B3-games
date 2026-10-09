'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {studentAuth}=require('./student-auth-core.cjs');
if(!admin.apps.length)admin.initializeApp();
exports.funTorahStudentAuth=onRequest({region:'us-central1',cors:['https://simchacohen1.github.io','https://funtorahtools.com','https://www.funtorahtools.com'],maxInstances:10},async(req,res)=>{
 res.set('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(Buffer.byteLength(JSON.stringify(req.body||{}))>2000)return res.status(413).json({error:'Request too large.'});
 try{
  const db=admin.database();
  const store={
   get:async path=>(await db.ref(path).once('value')).val(),
   update:updates=>db.ref().update(updates),
   tx:(path,fn)=>db.ref(path).transaction(fn)
  };
  res.json(await studentAuth(store,req.body||{},req.ip));
 }catch(error){
  const code=Number.isInteger(error.code)?error.code:500;
  if(code===500)console.error('funTorahStudentAuth',error);
  res.status(code).json({error:code===500?'Could not check your login. Try again.':error.message});
 }
});
