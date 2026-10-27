'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {weeklyQuizStudentAction}=require('./weekly-quiz-student-core.cjs');

if(!admin.apps.length)admin.initializeApp();

exports.weeklyQuizStudent=onRequest({
  region:'us-central1',
  cors:['https://simchacohen1.github.io','https://funtorahtools.com','https://www.funtorahtools.com'],
  maxInstances:10
},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  if(Buffer.byteLength(JSON.stringify(req.body||{}))>4000)return res.status(413).json({error:'Request too large.'});
  const bearer=String(req.headers.authorization||'');
  if(!bearer.startsWith('Bearer '))return res.status(401).json({error:'Student sign-in required.'});
  // An expired, revoked, disabled or malformed token is a sign-in problem (401),
  // not a server failure (500) that the quiz page would keep retrying.
  let decoded;
  try{decoded=await admin.auth().verifyIdToken(bearer.slice(7),true);}
  catch(error){return res.status(401).json({error:'Student sign-in required.'});}
  try{
    const db=admin.database();
    const result=await weeklyQuizStudentAction({
      decoded,
      body:req.body||{},
      get:async path=>(await db.ref(path).get()).val(),
      set:async(path,value)=>db.ref(path).set(value),
      tx:async(path,update)=>db.ref(path).transaction(update)
    });
    return res.status(200).json(result);
  }catch(error){
    const status=Number.isInteger(error.status)?error.status:500;
    if(status>=500)console.error('weeklyQuizStudent',error);
    return res.status(status).json({error:status>=500?'Could not load this quiz. Try again.':error.message});
  }
});
