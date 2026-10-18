'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {studentAuth}=require('./student-auth-core.cjs');
const crypto=require('node:crypto');
const studentTools=require('./student-tool-policy.js');
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
  const body=req.body||{};
  if(body.action==='halachaToken'){
   // Check the *actual* individual passcode and rate limit before issuing credentials.
   const student=await studentAuth(store,{action:'login',name:body.name,pin:body.pin},req.ip);
   const studentId=String(body.studentId||'');
   const classId=String(body.classId||student.classId||'');
   const validId=/^[A-Za-z0-9_-]{1,100}$/;
   if(!validId.test(studentId)||student.id!==studentId||!validId.test(classId)){
    return res.status(403).json({error:'Please sign in to your class again.'});
   }
   const [memberships,profile,cls]=await Promise.all([
    store.get('b3Games/students/'+studentId+'/memberships'),
    store.get('b3Games/students/'+studentId+'/profile'),
    store.get('b3Games/workspaces/b3-2026/classes/'+classId)
   ]);
   const member=cls?.members?.[studentId];
   const enrolled=Object.values(memberships||{}).some(m=>m&&m.active!==false&&m.workspaceId==='b3-2026'&&m.classId===classId)
    ||(!Object.keys(memberships||{}).length&&profile?.classId===classId);
   if(!enrolled||!cls||cls.active===false||!member||member.active===false
      ||!studentTools.allowed(cls,studentId,'halacha')
      ||(!['et','wt'].includes(classId)&&!studentTools.granted(cls,'halacha'))){
    return res.status(403).json({error:'Halacha is not available for this student and class.'});
   }
   const uid='halacha_'+crypto.createHash('sha256').update(studentId).digest('hex').slice(0,28);
   const customToken=await admin.auth().createCustomToken(uid,{b3StudentId:studentId,b3ClassId:classId,b3StudentRole:'student'});
   return res.json({ok:true,customToken,b3StudentId:studentId,classId});
  }
  const result=await studentAuth(store,body,req.ip);
  if(result?.ok&&['login','choosePin'].includes(String(body.action||''))){
   const studentId=String(result.id||'');
   const requestedClassId=String(body.classId||result.classId||'');
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(studentId)||!/^[A-Za-z0-9_-]{1,100}$/.test(requestedClassId))
    return res.status(403).json({error:'Choose an active class and sign in again.'});
   const [memberships,profile,cls]=await Promise.all([
    store.get('b3Games/students/'+studentId+'/memberships'),
    store.get('b3Games/students/'+studentId+'/profile'),
    store.get('b3Games/workspaces/b3-2026/classes/'+requestedClassId)
   ]);
   const member=cls?.members?.[studentId];
   const enrolled=Object.values(memberships||{}).some(m=>m&&m.active!==false&&m.workspaceId==='b3-2026'&&m.classId===requestedClassId)
    ||(!Object.keys(memberships||{}).length&&profile?.classId===requestedClassId);
   if(!enrolled||!cls||cls.active===false||!member||member.active===false||profile?.active===false)
    return res.status(403).json({error:'This student is not active in the selected class.'});
   const uid='student_'+crypto.createHash('sha256').update(studentId).digest('hex').slice(0,28);
   const classIds=[...new Set(Object.values(memberships||{}).filter(m=>m&&m.active!==false&&m.workspaceId==='b3-2026'&&/^[A-Za-z0-9_-]{1,100}$/.test(String(m.classId||''))).map(m=>String(m.classId)))];
   if(!classIds.length&&/^[A-Za-z0-9_-]{1,100}$/.test(String(profile?.classId||'')))classIds.push(String(profile.classId));
   if(!classIds.length)classIds.push(requestedClassId);
   const classChoices=(await Promise.all(classIds.map(async id=>{
    const row=await store.get('b3Games/workspaces/b3-2026/classes/'+id);
    return row&&row.active!==false&&row.members?.[studentId]&&row.members[studentId].active!==false?{id,name:String(row.name||id)}:null;
   }))).filter(Boolean);
   if(!classChoices.some(c=>c.id===requestedClassId))return res.status(403).json({error:'This student is not active in the selected class.'});
   result.classId=requestedClassId;
   result.classChoices=classChoices;
   result.customToken=await admin.auth().createCustomToken(uid,{b3StudentId:studentId,b3ClassId:requestedClassId,b3StudentRole:'student'});
  }
  res.json(result);
 }catch(error){
  const code=Number.isInteger(error.code)?error.code:500;
  if(code===500)console.error('funTorahStudentAuth',error);
  res.status(code).json({error:code===500?'Could not check your login. Try again.':error.message});
 }
});
