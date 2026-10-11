'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function memory(init={}){
 const store=new Map(Object.entries(init));return {
 getItem:key=>store.has(key)?store.get(key):null,
 setItem:(key,val)=>store.set(key,String(val)),
 removeItem:key=>store.delete(key),clear:()=>store.clear()
 };
}
function fixture({users={},pending=false,authenticatedUser=null,loginUser,verified=true}={}){
 const activity=[],localStorage=memory(),sessionStorage=memory();
 const auth={
  currentUser:authenticatedUser,
  isSignInWithEmailLink:url=>pending&&url.includes('oobCode='),
  sendSignInLinkToEmail:async(email,settings)=>{activity.push(['send',email,settings]);},
  signInWithEmailLink:async(email,url)=>{
   activity.push(['consume',email,url]);
   return {user:loginUser||{uid:'teacher-uid',email,emailVerified:verified}};
  },
  signOut:async()=>{activity.push(['signOut']);auth.currentUser=null;},
  onAuthStateChanged:()=>()=>{}
 };
 const db={ref:path=>({once:async()=>({val:()=>users[path]??null})})};
 const firebase={apps:[{}],database:()=>db,auth:()=>auth};
 const window={firebase,B3_FIREBASE_CONFIG:Object.fromEntries(
  ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'].map(k=>[k,'fake']))};
 const location={href:'https://funtorahtools.com/teacher-home.html?oobCode=example&mode=signIn'};
 const history={replaceState:(...args)=>activity.push(['cleanUrl',args[2]])};
 const document={currentScript:{src:'https://funtorahtools.com/site-settings.js'},
  readyState:'loading',addEventListener(){},getElementsByTagName:()=>[]};
 const sandbox={window,document,localStorage,sessionStorage,location,history,
  URL,console,Intl,Date,setTimeout:()=>1,clearTimeout:()=>{},fetch:async()=>({ok:false,status:503})};
 vm.runInNewContext(fs.readFileSync('site-settings.js','utf8'),sandbox);
 return {api:window.B3SiteSettings,activity,localStorage,auth};
}
const teacherRecord={'b3Games/workspaces/b3-2026/teachers/teacher-uid':{active:true,classIds:{classA:true}}};
test('Passwordless email action sends a link without embedding a teacher email in its URL',async()=>{
 const x=fixture();await x.api.sendTeacherEmailLink('Teacher@Example.org');
 assert.equal(x.activity[0][0],'send');
 assert.equal(x.activity[0][1],'teacher@example.org');
 assert.equal(x.activity[0][2].url,'https://funtorahtools.com/teacher-home.html');
 assert.equal(x.activity[0][2].handleCodeInApp,true);
 assert.ok(!x.activity[0][2].url.includes('@'));
 assert.equal(JSON.parse(x.localStorage.getItem('b3TeacherEmailLinkPending')).email,'teacher@example.org');
});
test('Email link requires email verification, matching address and a teacher record',async()=>{
 const x=fixture({pending:true,users:teacherRecord});
 assert.equal(x.api.isEmailSignInLink(),true);
 assert.equal(await x.api.completeTeacherEmailLink('TeACHer@example.org'),true);
 assert.deepEqual([...x.api.getCurrentAccess().classIds],['classA']);
 assert.ok(x.activity.find(a=>a[0]==='cleanUrl'));
 assert.equal(x.localStorage.getItem('b3TeacherEmailLinkPending'),null);
 const bad=fixture({pending:true,users:teacherRecord,verified:false});
 await assert.rejects(bad.api.completeTeacherEmailLink('teacher@example.org'),/did not match/);
 assert.ok(bad.activity.some(a=>a[0]==='signOut'));
 const other=fixture({pending:true,users:teacherRecord,loginUser:{
  uid:'teacher-uid',email:'wrong@example.org',emailVerified:true
 }});
 await assert.rejects(other.api.completeTeacherEmailLink('teacher@example.org'),/did not match/);
 assert.ok(other.activity.some(a=>a[0]==='signOut'));
});
test('Email link to an uninvited address signs out and does not show teacher access',async()=>{
 const x=fixture({pending:true});
 await assert.rejects(x.api.completeTeacherEmailLink('stranger@example.org'),/no active Fun Torah Tools teacher invitation/);
 assert.ok(x.activity.some(a=>a[0]==='signOut'));
 assert.equal(x.api.getCurrentAccess().authorized,false);
});
test('Email completion refuses requests without a genuine Firebase email link',async()=>{
 const x=fixture({pending:false,users:teacherRecord});
 assert.equal(await x.api.completeTeacherEmailLink('teacher@example.org'),false);
 assert.equal(x.activity.length,0);
});
test('Previously granted teacher UID is denied access if Firebase email is unverified',async()=>{
 const x=fixture({users:teacherRecord,authenticatedUser:{uid:'teacher-uid',email:'teacher@example.org',emailVerified:false}});
 let result;
 x.api.onAuthStateChanged(()=>{});
 // A direct email link with an unverified Firebase identity cannot regain
 // permissions just by matching a stored UID.
 const y=fixture({pending:true,users:teacherRecord,loginUser:{
  uid:'teacher-uid',email:'teacher@example.org',emailVerified:false
 }});
 await assert.rejects(y.api.completeTeacherEmailLink('teacher@example.org'));
 assert.equal(y.api.getCurrentAccess().authorized,false);
});
