'use strict';
// A teacher looks at their own students' saved Class Pointer whiteboards (read only).
//   • Storage rules are NOT used for this: students keep sole direct access to studentFiles/{class}/{student}/.
//   • The server (admin SDK) checks the teacher against the database, then lists that one student's files or hands
//     back a 5 minute link to one picture. Nothing is written, and file contents (the board data) are never returned.
// The same file is kept, byte for byte, in backend/functions and backend/functions-staging (a test checks that).
const WS='b3-2026';
const ID=/^[A-Za-z0-9_-]{1,100}$/;
const FILE_ID=/^[-A-Za-z0-9_]{1,64}$/;
const MAX_FILES=200;
const fail=(message,code=403)=>Object.assign(new Error(message),{code});
const validId=value=>typeof value==='string'&&ID.test(value);
const base=`b3Games/workspaces/${WS}/`;
const clean=(value,max)=>String(value==null?'':value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

// Who may look at this class: the site owner, an admin, or an active teacher who is assigned to the class. Never a
// student, even one in the same class. Throws a plain error with an HTTP code when not allowed.
async function authorize({get,identity,classId,studentId,ownerEmail,stagingPassword}){
  if(!identity||identity.b3StudentRole||!identity.uid)throw fail('Teacher sign-in required.');
  if(!validId(classId))throw fail('Choose a valid class.',400);
  if(studentId!==undefined&&!validId(studentId))throw fail('Choose a valid student.',400);
  const owner=!!ownerEmail&&String(identity.email||'').toLowerCase()===ownerEmail&&identity.email_verified===true;
  const admin=!owner&&await get(`b3Games/admins/${identity.uid}/active`)===true;
  if(!owner&&!admin){
    const provider=identity.firebase?.sign_in_provider;
    if(provider!=='google.com'&&!(stagingPassword&&identity.b3StagingAccount===true&&provider==='password'))throw fail('Teacher sign-in required.');
    const teacher=await get(`${base}teachers/${identity.uid}`);
    if(!teacher||teacher.active!==true||teacher.classIds?.[classId]!==true)throw fail('This class is not assigned to your teacher account.');
  }
  const active=await get(`${base}classes/${classId}/active`);
  if(active===false)throw fail('This class is not active.');
  if(studentId!==undefined){
    const member=await get(`${base}classes/${classId}/members/${studentId}`);
    if(!member||member.active===false)throw fail('That student is not in this class.');
  }
  return{owner,admin};
}

// The students of one class, by name (the pick list).
async function roster({get,classId}){
  const members=await get(`${base}classes/${classId}/members`)||{};
  const ids=Object.keys(members).filter(id=>validId(id)&&members[id]&&members[id].active!==false).slice(0,500);
  const rows=await Promise.all(ids.map(async id=>{
    const profile=await get(`b3Games/students/${id}/profile`);
    if(profile&&profile.active===false)return null;
    return{id,name:clean(profile?.name||members[id].name||id,60)};
  }));
  return rows.filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
}

const prefix=(classId,studentId)=>`studentFiles/${classId}/${studentId}/`;

// One student's saved whiteboards: name, when saved, whether it came from the teacher, whether it has a picture.
async function listFiles({bucket,classId,studentId}){
  const [files]=await bucket.getFiles({prefix:prefix(classId,studentId),maxResults:1000});
  const pictures=new Set();
  const boards=[];
  for(const file of files){
    const name=String(file.name||'').slice(prefix(classId,studentId).length);
    const match=/^([-A-Za-z0-9_]{1,64})\.(json|png)$/.exec(name);
    if(!match)continue;
    if(match[2]==='png'){pictures.add(match[1]);continue}
    const custom=file.metadata?.metadata||{};
    if(custom.kind&&custom.kind!=='whiteboard')continue;
    const label=clean(custom.displayName,60)||'Whiteboard';
    boards.push({id:match[1],name:label,savedAt:Math.floor(Number(custom.savedAt))||Date.parse(file.metadata?.updated||'')||0,fromTeacher:/^From your teacher/.test(label)});
  }
  boards.sort((a,b)=>b.savedAt-a.savedAt);
  return boards.slice(0,MAX_FILES).map(board=>({...board,hasPicture:pictures.has(board.id)}));
}

// A short link to one picture, or null when the picture is not there.
async function pictureUrl({bucket,classId,studentId,fileId,now=Date.now}){
  if(typeof fileId!=='string'||!FILE_ID.test(fileId))throw fail('Choose a valid file.',400);
  const file=bucket.file(`${prefix(classId,studentId)}${fileId}.png`),[exists]=await file.exists();
  if(!exists)return null;
  const [url]=await file.getSignedUrl({action:'read',expires:now()+5*60*1000});
  return url;
}

// The whole request. body = {action:'students'|'files'|'picture', classId, studentId?, fileId?}
async function handle({body,identity,get,bucket,ownerEmail,stagingPassword,log}){
  const action=String(body?.action||''),classId=body?.classId,studentId=body?.studentId;
  if(!['students','files','picture'].includes(action))throw fail('Unknown request.',400);
  await authorize({get,identity,classId,studentId:action==='students'?undefined:studentId,ownerEmail,stagingPassword});
  // Who looked at what is logged by id only (never names, emails or file contents).
  if(log)log({action,uid:identity.uid,classId,studentId:action==='students'?'':studentId});
  if(action==='students')return{students:await roster({get,classId})};
  if(action==='files')return{files:await listFiles({bucket,classId,studentId})};
  const url=await pictureUrl({bucket,classId,studentId,fileId:body.fileId});
  if(!url)throw fail('There is no picture for this file.',404);
  return{url,expiresInSeconds:300};
}

module.exports={authorize,roster,listFiles,pictureUrl,handle,validId};
