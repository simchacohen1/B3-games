'use strict';
// Run the checked-in HTTP handlers against ONLY the synthetic Auth/RTDB emulators.
module.exports=function({root,project,namespace,authPort,dbPort,config}){
 const path=require('node:path'),Module=require('node:module');
 if(!project.startsWith('demo-'))throw Error('A demo project is required');
 process.env.NODE_PATH=process.env.SIGNIN_LAB_BACKEND_DEPS||'/tmp/pr283-backend-deps/node_modules';Module._initPaths();
 process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:'+authPort;
 process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:'+dbPort;
 process.env.GCLOUD_PROJECT=project;process.env.GOOGLE_CLOUD_PROJECT=project;
 delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
 const admin=require('firebase-admin'),express=require('express');
 admin.initializeApp({projectId:project,databaseURL:config.databaseURL,credential:{getAccessToken:async()=>({access_token:'owner',expires_in:3600})}});
 const app=express(),calls=[];app.use(express.json({limit:'16kb'}));
 const handlers={
  funTorahStudentAuth:require(path.join(root,'backend/functions/student-auth.js')).funTorahStudentAuth,
  funTorahTeacherClaim:require(path.join(root,'backend/functions/teacher-claim.js')).funTorahTeacherClaim,
  studentRewardsLogin:require(path.join(root,'backend/functions/student-rewards-functions.js')).studentRewardsLogin,
  studentRewardsAutoAward:require(path.join(root,'backend/functions/student-rewards-auto-award.js')).studentRewardsAutoAward,
  weeklyQuizStudent:require(path.join(root,'backend/functions/weekly-quiz-student.js')).weeklyQuizStudent
 };
 for(const [name,handler]of Object.entries(handlers))app.all('/api/'+name,(req,res)=>{
  // Only action/status are recorded, never PINs, tokens, or response bodies.
  res.on('finish',()=>calls.push({name,action:String(req.body?.action||''),status:res.statusCode}));
  return handler(req,res);
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'Handler not enabled in this isolated lab'}));
 return {router:app,calls,setDisabled:async(uid,disabled)=>{if(!/^student_[a-f0-9]+$/.test(uid))throw Error('Only synthetic student tokens are accepted');return admin.auth().updateUser(uid,{disabled});},close:async()=>{await Promise.all(admin.apps.map(app=>app.delete()));}};
};
