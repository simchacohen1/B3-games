'use strict';
const {PROJECT,ports,run}=require('./isolation.cjs'),admin=require('firebase-admin'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const BASE='http://127.0.0.1:'+ports.site,people=JSON.parse(fs.readFileSync(path.join(run,'people.json')));
(async()=>{
 admin.initializeApp({projectId:PROJECT,databaseURL:`https://${PROJECT}-default-rtdb.firebaseio.com`,storageBucket:PROJECT+'.appspot.com'});
 const student=people.et;
 const login=await fetch(BASE+'/_fn/funTorahStudentAuth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',name:student.name,pin:student.pin,classId:'et'})});const l=await login.json();assert(l.customToken);
 const auth=await fetch(`http://127.0.0.1:${ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=lab-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:l.customToken,returnSecureToken:true})});const identity=await auth.json();assert(identity.idToken);
 const mediaPath='classGallery/et/'+student.id+'/synthetic_media/audio.webm',bytes=Buffer.from('Gallery lab synthetic media fixture');
 await admin.storage().bucket().file(mediaPath).save(bytes,{contentType:'audio/webm'});
 const request=async target=>fetch(BASE+'/_fn/privateMediaUrl',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+identity.idToken},body:JSON.stringify({path:target})});
 const r=await request(mediaPath);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));const data=await r.json();assert.equal(new URL(data.url).hostname,'127.0.0.1');const download=await fetch(data.url);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 const cross=await request(mediaPath.replace('/et/','/wt/'));assert.equal(cross.status,403);
 const evidence={result:'PASS',ownMediaStatus:200,localDownloadBytes:bytes.length,crossClassStatus:403};fs.writeFileSync(path.join(run,'media-smoke.json'),JSON.stringify(evidence,null,2));console.log(evidence);await admin.app().delete();
})().catch(e=>{console.error(e);process.exitCode=1});
