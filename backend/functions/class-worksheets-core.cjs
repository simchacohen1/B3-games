'use strict';
// PDF worksheets for a class (HIGH RISK: student data and a server copy of a teacher's file).
//   • A teacher sends one PDF from their own private PDF library to their class: the server copies that one file to
//     classWorksheets/{classId}/{id}.pdf. Nothing else of the teacher's library is reachable.
//   • Students of that class list the class's worksheets and get a 5 minute link to read one. Each student then saves
//     their own copy in their own My files (existing studentFiles rules), so no one's marks are shared.
//   • Storage rules are NOT changed: classWorksheets/ is covered by the existing deny-all rule, so browsers can never
//     read or write it directly. Only this server code can.
// The same file is kept, byte for byte, in backend/functions and backend/functions-staging (a test checks that).
const crypto=require('node:crypto');
const {authorize,validId}=require('./teacher-student-files-core.cjs');
const WS='b3-2026';
const base=`b3Games/workspaces/${WS}/`;
const ID=/^[-A-Za-z0-9_]{1,64}$/;
const LIBRARY_ID=/^[-A-Za-z0-9_.]{1,80}\.pdf$/;
const MAX_BYTES=25*1024*1024; // the biggest PDF a student can keep in My files
const MAX_WORKSHEETS=30;       // per class
const fail=(message,code=403)=>Object.assign(new Error(message),{code});
const clean=(value,max)=>String(value==null?'':value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const prefix=classId=>`classWorksheets/${classId}/`;

// A student of the class (active member of an active class). Returns {classId}. Never reads another class.
async function authorizeStudent({get,identity}){
  const classId=String(identity.b3ClassId||''),studentId=String(identity.b3StudentId||'');
  if(identity.b3StudentRole!=='student'||!validId(classId)||!validId(studentId))throw fail('Sign in as a student of this class.');
  if(await get(`${base}classes/${classId}/active`)===false)throw fail('This class is not active.');
  const member=await get(`${base}classes/${classId}/members/${studentId}`);
  if(!member||member.active===false)throw fail('You are not in this class.');
  return{classId};
}

async function listWorksheets({bucket,classId}){
  const [files]=await bucket.getFiles({prefix:prefix(classId),maxResults:200});
  const rows=[];
  for(const file of files){
    const match=/^([-A-Za-z0-9_]{1,64})\.pdf$/.exec(String(file.name||'').slice(prefix(classId).length));
    if(!match)continue;
    const custom=file.metadata?.metadata||{};
    rows.push({id:match[1],name:clean(custom.displayName,100)||'Worksheet',sentAt:Math.floor(Number(custom.sentAt))||Date.parse(file.metadata?.updated||'')||0,size:Number(file.metadata?.size)||0});
  }
  return rows.sort((a,b)=>b.sentAt-a.sentAt).slice(0,MAX_WORKSHEETS);
}

async function handle({body,identity,get,bucket,ownerEmail,stagingPassword,log,now=Date.now}){
  const action=String(body?.action||'');
  if(!['list','url','send','remove'].includes(action))throw fail('Unknown request.',400);
  const isStudent=!!identity&&identity.b3StudentRole==='student';
  let classId;
  if(isStudent){
    if(!['list','url'].includes(action))throw fail('Only a teacher can do that.');
    classId=(await authorizeStudent({get,identity})).classId; // the class comes from the sign-in, never from the request
  }else{
    classId=body?.classId;
    await authorize({get,identity,classId,ownerEmail,stagingPassword});
  }
  if(log)log({action,uid:identity.uid,classId});
  if(action==='list')return{worksheets:await listWorksheets({bucket,classId})};
  if(action==='url'||action==='remove'){
    const id=body?.id;
    if(typeof id!=='string'||!ID.test(id))throw fail('Choose a valid worksheet.',400);
    const file=bucket.file(`${prefix(classId)}${id}.pdf`),[exists]=await file.exists();
    if(!exists)throw fail('That worksheet is not there.',404);
    if(action==='remove'){await file.delete();return{removed:true}}
    const [url]=await file.getSignedUrl({action:'read',expires:now()+5*60*1000});
    return{url,expiresInSeconds:300};
  }
  // send: from this teacher's own private library only (the folder is built from the signed-in uid, not the request)
  const pdfId=body?.pdfId;
  if(typeof pdfId!=='string'||!LIBRARY_ID.test(pdfId)||pdfId.includes('..'))throw fail('Choose a PDF from your library.',400);
  const source=bucket.file(`pointerPdfLibrary/${identity.uid}/${pdfId}`),[exists]=await source.exists();
  if(!exists)throw fail('That PDF is not in your library.',404);
  const [meta]=await source.getMetadata();
  if(meta.contentType!=='application/pdf')throw fail('Only a PDF can be sent.',400);
  if(!(Number(meta.size)>0)||Number(meta.size)>MAX_BYTES)throw fail('This PDF is too big to send to students. The limit is 25 MB.',400);
  if((await listWorksheets({bucket,classId})).length>=MAX_WORKSHEETS)throw fail('This class already has '+MAX_WORKSHEETS+' worksheets. Remove one first.',400);
  const id=crypto.randomBytes(12).toString('hex'),dest=bucket.file(`${prefix(classId)}${id}.pdf`);
  await source.copy(dest);
  const name=clean(body?.name,100)||clean(meta.metadata?.displayName,100)||'Worksheet';
  await dest.setMetadata({contentType:'application/pdf',metadata:{displayName:name,sentAt:String(now()),sentBy:identity.uid}});
  return{id,name};
}

module.exports={authorizeStudent,listWorksheets,handle,MAX_BYTES,MAX_WORKSHEETS};
