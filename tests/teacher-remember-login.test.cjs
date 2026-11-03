const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('site-settings.js','utf8');
function setup({student=false,saved=true,active=null}={}){
 const data=new Map(student?[['b3Games_studentId','test-student']]:[]);
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const teacher={uid:'teacher',email:'simcha5770@gmail.com'};
 const callbacks=[];
 const auth={currentUser:active,setPersistence:async p=>{auth.persistence=p},updateCurrentUser:async u=>{auth.currentUser=u;for(const cb of callbacks)cb(u)},onAuthStateChanged:cb=>{callbacks.push(cb);queueMicrotask(()=>cb(auth.currentUser));return ()=>{}},signOut:async()=>{auth.currentUser=null;for(const cb of callbacks)cb(null)}};
 const savedAuth={currentUser:saved?teacher:null,authStateReady:async()=>{},setPersistence:async p=>{savedAuth.persistence=p},signInWithPopup:async()=>{savedAuth.currentUser=teacher;return {user:teacher}},signOut:async()=>{savedAuth.currentUser=null}};
 const firebase={apps:[{}],app:()=>({auth:()=>savedAuth}),auth:()=>auth,database:()=>({ref:()=>({once:async()=>({val:()=>null}),update:async()=>{}})})};
 firebase.auth.Auth={Persistence:{LOCAL:'LOCAL',SESSION:'SESSION'}};
 firebase.auth.GoogleAuthProvider=class{setCustomParameters(){}};
 const window={firebase,B3_FIREBASE_CONFIG:Object.fromEntries(['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'].map(k=>[k,'test']))};
 vm.runInNewContext(source,{window,firebase,sessionStorage:storage,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{readyState:'loading',addEventListener(){},getElementsByTagName:()=>[]},location:{href:'https://example.test/'},URL,console,Intl,Date});
 return {api:window.B3SiteSettings,auth,savedAuth,teacher};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('new teacher tab restores remembered Google login into a tab-only session',async()=>{
 const t=setup();t.api.onAuthStateChanged(()=>{});await settle();
 assert.equal(t.auth.currentUser,t.teacher);assert.equal(t.auth.persistence,'SESSION');
});
test('student tab never restores teacher credentials',async()=>{
 const t=setup({student:true});t.api.onAuthStateChanged(()=>{});await settle();assert.equal(t.auth.currentUser,null);
});
test('existing student Firebase identity is never replaced',async()=>{
 const student={uid:'student'};const t=setup({active:student,student:true});t.api.onAuthStateChanged(()=>{});await settle();assert.equal(t.auth.currentUser,student);
});
test('Google login is remembered separately while active session stays tab-only',async()=>{
 const t=setup({saved:false});await t.api.signInWithGoogle();
 assert.equal(t.savedAuth.persistence,'LOCAL');assert.equal(t.auth.persistence,'SESSION');assert.equal(t.auth.currentUser,t.teacher);
});
test('explicit sign out clears active and remembered login without restoring it',async()=>{
 const t=setup();t.api.onAuthStateChanged(()=>{});await settle();await t.api.signOut();await settle();
 assert.equal(t.auth.currentUser,null);assert.equal(t.savedAuth.currentUser,null);
});
test('sign out during pending restoration cannot revive the login',async()=>{
 const t=setup();let release;t.savedAuth.authStateReady=()=>new Promise(r=>release=r);
 t.api.onAuthStateChanged(()=>{});await settle();await t.api.signOut();release();await settle();assert.equal(t.auth.currentUser,null);
});
