'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {createHash}=require('node:crypto');
// Per-class change counter, bumped by the triggers in class-gallery-version.js.
// Kept inline so this file loads on its own; a test checks the path matches class-gallery-meta.js.
const versionPath=classId=>`classGalleryMeta/${classId}/version`;
const goodVersion=v=>Number.isSafeInteger(v)&&v>0;
async function readVersion(db,classId){
  try{
    const ref=db.ref(versionPath(classId));
    const current=(await ref.get()).val();
    if(goodVersion(current))return current;
    const result=await ref.transaction(cur=>goodVersion(cur)?undefined:1);
    const value=result&&result.snapshot&&result.snapshot.val();
    return goodVersion(value)?value:null;
  }catch(error){
    console.warn('classGalleryMeta version unavailable',error&&error.message);
    return null;
  }
}
const parseClientVersion=raw=>/^[1-9]\d{0,14}$/.test(String(raw==null?'':raw))?Number(raw):null;
if(!admin.apps.length)admin.initializeApp();

function visibleGalleryPosts(rows,classId,studentId,canReview){
  const out={};
  for(const [id,row] of Object.entries(rows||{})){
    // Pre-login ET/WT records have className but no classId. Never override an explicit classId.
    const rowClass=row?.classId||({'B3 ET':'et','B3 WT':'wt'}[row?.className]);
    if(rowClass===classId&&(canReview||row.status==='approved'||(studentId&&row.studentId===studentId)))out[id]=row;
  }
  return out;
}
exports.visibleGalleryPosts=visibleGalleryPosts;

exports.classGalleryRead=onRequest({region:'us-central1',cors:['https://funtorahtools.com','https://www.funtorahtools.com','https://simchacohen1.github.io'],maxInstances:20,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Use GET.'});
  try{
    const bearer=String(req.headers.authorization||'').replace(/^Bearer /,''),classId=String(req.query?.classId||'');
    if(!bearer)return res.status(401).json({error:'Sign-in required.'});
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(classId))return res.status(400).json({error:'Invalid class.'});
    const identity=await admin.auth().verifyIdToken(bearer,true),db=admin.database();
    const [cls,member,teacher,adminRow]=await Promise.all([
      db.ref(`b3Games/workspaces/b3-2026/classes/${classId}`).get(),
      identity.b3StudentRole==='student'&&identity.b3ClassId===classId?db.ref(`b3Games/workspaces/b3-2026/classes/${classId}/members/${identity.b3StudentId}`).get():Promise.resolve(null),
      db.ref(`b3Games/workspaces/b3-2026/teachers/${identity.uid}`).get(),
      db.ref(`b3Games/admins/${identity.uid}/active`).get()
    ]);
    const owner=String(identity.email||'').toLowerCase()==='simcha5770@gmail.com'&&identity.email_verified===true;
    const isTeacher=identity.firebase?.sign_in_provider==='google.com'&&teacher.child('active').val()===true&&teacher.child('classIds/'+classId).val()===true;
    const isMember=identity.b3StudentRole==='student'&&identity.b3ClassId===classId&&member?.exists()&&member.child('active').val()!==false;
    const allowed=owner||adminRow.val()===true||isMember||isTeacher;
    if(!allowed||!cls.exists()||cls.child('active').val()===false)return res.status(403).json({error:'Active class access required.'});
    const legacy=['et','wt'].includes(classId),path=legacy?'classGallery/posts':`b3Games/workspaces/b3-2026/classes/${classId}/resources/gallery/posts`;
    // Version check: one tiny read tells us whether any post in this class changed
    // since the browser's last full load. Read it BEFORE the posts so a write that
    // lands in between is simply picked up on the next poll, never missed.
    const version=await readVersion(db,classId);
    if(version!==null&&parseClientVersion(req.query?.v)===version)return res.status(200).json({unchanged:true,version});
    const snap=await db.ref(path).get(),rows=snap.val()||{};
    const posts=visibleGalleryPosts(rows,classId,identity.b3StudentId,isTeacher||owner||adminRow.val()===true);
    // Hash only the authorized view: teachers and students can see different posts.
    // Legacy clients receive the complete payload when no hash is supplied.
    const postsJson=JSON.stringify(posts);
    const hash=createHash('sha256').update(postsJson).digest('hex');
    const since=String(req.query?.since||'');
    if(/^[a-f0-9]{64}$/.test(since)&&since===hash){
      return res.status(200).json({unchanged:true,hash,...(version!==null?{version}:{})});
    }
    return res.status(200).json({posts,hash,...(version!==null?{version}:{})});
  }catch(error){
    const code=Number.isInteger(error.code)&&error.code>=400&&error.code<600?error.code:500;
    if(code===500)console.error('classGalleryRead',error);
    return res.status(code).json({error:code===500?'Class Gallery could not load.':error.message});
  }
});
