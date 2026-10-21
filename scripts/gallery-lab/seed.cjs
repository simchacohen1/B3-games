'use strict';
const {PROJECT,ports,run}=require('./isolation.cjs');
const admin=require('firebase-admin'),fs=require('node:fs'),path=require('node:path');
admin.initializeApp({projectId:PROJECT,databaseURL:`https://${PROJECT}-default-rtdb.firebaseio.com`,storageBucket:PROJECT+'.appspot.com'});
async function google(cls){
 const email=`teacher-${cls}@gallery.test`,idp=JSON.stringify({sub:'gallery-'+cls,email,email_verified:true,provider_id:'google.com'});
 const r=await fetch(`http://127.0.0.1:${ports.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=lab-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postBody:'id_token='+encodeURIComponent(idp)+'&providerId=google.com',requestUri:'http://localhost',returnIdpCredential:true,returnSecureToken:true})});
 const j=await r.json();if(!j.localId)throw Error(JSON.stringify(j));return{uid:j.localId,email};
}
(async()=>{
 const updates={},people={};
 for(const cls of ['et','wt']){
 const id='gallery_synthetic_'+cls,name='Gallery Synthetic '+cls.toUpperCase(),pin=cls==='et'?'7181':'7182',teacher=await google(cls);
 people[cls]={id,name,pin,teacher};
 updates[`b3Games/students/${id}`]={profile:{id,name,active:true,classId:cls},memberships:{['b3-2026_'+cls]:{workspaceId:'b3-2026',classId:cls,active:true}}};
 updates[`b3Private/passcodes/${id}`]={passcode:pin,updatedAt:Date.now(),chosenPinVersion:1};
 updates[`b3Games/workspaces/b3-2026/classes/${cls}`]={id:cls,name:'B3 '+cls.toUpperCase(),active:true,members:{[id]:{active:true,name}},teacherIds:{[teacher.uid]:true},toolGrants:{'class-gallery':true}};
 updates[`b3Games/workspaces/b3-2026/teachers/${teacher.uid}`]={active:true,email:teacher.email,name:'Synthetic '+cls.toUpperCase()+' Teacher',classIds:{[cls]:true}};
 }
 updates['b3Games/siteSettings']={studentWebsiteEnabled:true,games:{'class-gallery':true},siteEnabled:true,classAccess:{et:{mode:'open'},wt:{mode:'open'}}};
 await admin.database().ref().update(updates);
 fs.writeFileSync(path.join(run,'people.json'),JSON.stringify(people,null,2));console.log('Seeded synthetic ET/WT only');await admin.app().delete();
})().catch(e=>{console.error(e);process.exit(1)});
