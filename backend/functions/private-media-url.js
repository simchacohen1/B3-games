'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp();
const SAFE_PATH=/^[A-Za-z0-9_./-]{1,600}$/;

async function canReadMedia(db,identity,path){
  const parts=path.split('/');
  const studentId=String(identity.b3StudentId||'');
  const isStudent=identity.b3StudentRole==='student'&&studentId;
  let ownerId='',classId='',galleryPostId='';
  if(parts[0]==='posukPractice'&&parts[1]==='shorashimLearning'&&parts[2]==='students'&&parts[3])ownerId=parts[3];
  else if(parts[0]==='posukPractice'&&parts.length>=3)ownerId=parts[1];
  else if(parts[0]==='shorashimLearning'&&parts[1]==='students'&&parts[2])ownerId=parts[2];
  else if(parts[0]==='shorashim-recordings'&&parts[1])ownerId=parts[1];
  else if(parts[0]==='classGallery'&&parts.length>=5){classId=parts[1];ownerId=parts[2];galleryPostId=parts[3];}
  else return false;
  if(isStudent){
    const studentClassId=String(identity.b3ClassId||'');
    if(!studentClassId||classId&&classId!==studentClassId)return false;
    classId=classId||studentClassId;
    const [studentClass,membership]=await Promise.all([
      db.ref(`b3Games/workspaces/b3-2026/classes/${classId}`).get(),
      db.ref(`b3Games/workspaces/b3-2026/classes/${classId}/members/${studentId}`).get()
    ]);
    if(!studentClass.exists()||!membership.exists()||studentClass.child('active').val()===false||membership.child('active').val()===false)return false;
    if(studentId===ownerId)return true;
    if(!galleryPostId)return false;
    let post=await db.ref(`b3Games/workspaces/b3-2026/classes/${classId}/resources/gallery/posts/${galleryPostId}`).get();
    if(!post.exists())post=await db.ref(`classGallery/posts/${galleryPostId}`).get();
    return post.exists()&&post.child('classId').val()===classId&&post.child('studentId').val()===ownerId&&post.child('status').val()==='approved';
  }
  const ownerEmail=String(identity.email||'').toLowerCase()==='simcha5770@gmail.com'&&identity.email_verified===true;
  const adminRow=await db.ref('b3Games/admins/'+identity.uid+'/active').get();
  if(ownerEmail||adminRow.val()===true)return true;
  if(identity.firebase?.sign_in_provider!=='google.com')return false;
  if(!classId){const profile=await db.ref(`b3Games/students/${ownerId}/profile`).get();classId=String(profile.child('classId').val()||'');}
  if(!classId)return false;
  const [teacher,cls]=await Promise.all([
    db.ref(`b3Games/workspaces/b3-2026/teachers/${identity.uid}`).get(),
    db.ref(`b3Games/workspaces/b3-2026/classes/${classId}`).get()
  ]);
  return teacher.child('active').val()===true&&teacher.child('classIds/'+classId).val()===true&&cls.exists()&&cls.child('active').val()!==false&&cls.child('members/'+ownerId).exists()&&cls.child('members/'+ownerId+'/active').val()!==false;
}
exports.canReadMedia=canReadMedia;

exports.privateMediaUrl=onRequest({region:'us-central1',cors:['https://funtorahtools.com','https://www.funtorahtools.com','https://simchacohen1.github.io'],maxInstances:20,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!token)return res.status(401).json({error:'Sign-in required.'});
    const identity=await admin.auth().verifyIdToken(token,true),path=String(req.body?.path||'');
    if(!SAFE_PATH.test(path)||path.includes('..')||path.startsWith('/'))return res.status(400).json({error:'Invalid media path.'});
    const db=admin.database();
    if(!await canReadMedia(db,identity,path))return res.status(403).json({error:'You do not have access to this recording.'});
    const bucket=admin.storage().bucket(),file=bucket.file(path),[exists]=await file.exists();
    if(!exists)return res.status(404).json({error:'Recording not found.'});
    const [url]=await file.getSignedUrl({action:'read',expires:Date.now()+5*60*1000});
    return res.status(200).json({url,expiresInSeconds:300});
  }catch(error){
    const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
    if(code===500)console.error('privateMediaUrl',error);
    return res.status(code).json({error:code===500?'Recording could not be opened.':error.message});
  }
});
