const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('site-settings.js','utf8');
function setup({tab={},saved=true,active=null}={}){
 const data=new Map(Object.entries(tab));
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
 const teacher={uid:'teacher',email:'simcha5770@gmail.com',providerData:[{providerId:'google.com'}]};
 const callbacks=[];
 const auth={currentUser:active,setPersistence:async p=>{auth.persistence=p},updateCurrentUser:async u=>{auth.currentUser=u;for(const cb of callbacks)cb(u)},onAuthStateChanged:cb=>{callbacks.push(cb);queueMicrotask(()=>cb(auth.currentUser));return ()=>{}},signOut:async()=>{auth.currentUser=null;for(const cb of callbacks)cb(null)}};
 const savedAuth={currentUser:saved?teacher:null,authStateReady:async()=>{},setPersistence:async p=>{savedAuth.persistence=p},signInWithPopup:async()=>{savedAuth.currentUser=teacher;return {user:teacher}},signOut:async()=>{savedAuth.currentUser=null}};
 const firebase={apps:[{}],app:()=>({auth:()=>savedAuth}),auth:()=>auth,database:()=>({ref:()=>({once:async()=>({val:()=>null}),update:async()=>{}})})};
 firebase.auth.Auth={Persistence:{LOCAL:'LOCAL',SESSION:'SESSION'}};
 firebase.auth.GoogleAuthProvider=class{setCustomParameters(){}};
 const window={firebase,B3_FIREBASE_CONFIG:Object.fromEntries(['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId'].map(k=>[k,'test']))};
 vm.runInNewContext(source,{window,firebase,sessionStorage:storage,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{readyState:'loading',addEventListener(){},getElementsByTagName:()=>[]},location:{href:'https://example.test/'},URL,console,Intl,Date});
 return {api:window.B3SiteSettings,auth,savedAuth,teacher,data};
}
const settle=()=>new Promise(r=>setTimeout(r,5));
const student={uid:'student',providerData:[]};

test('student identity leaked into a teacher tab is replaced by the remembered teacher',async()=>{
 const t=setup({active:student});t.api.onAuthStateChanged(()=>{});await settle();
 assert.equal(t.auth.currentUser,t.teacher);assert.equal(t.auth.persistence,'SESSION');
});
test('a real student tab keeps its student and never gets teacher credentials',async()=>{
 const t=setup({tab:{b3Games_studentId:'s1'},active:student});t.api.onAuthStateChanged(()=>{});await settle();
 assert.equal(t.auth.currentUser,student);
});
test('Switch student signs out the student, clears student storage, leaves remembered teacher',async()=>{
 const t=setup({tab:{b3Games_studentId:'s1',b3Games_classPin:'x',posukPractice_studentId:'s1'},active:student});
 t.api.onAuthStateChanged(()=>{});await settle();
 await t.api.endStudentSession();await settle();
 assert.equal(t.auth.currentUser,null);
 assert.equal(t.data.get('b3Games_studentId'),undefined);assert.equal(t.data.get('b3Games_classPin'),undefined);
 assert.equal(t.savedAuth.currentUser,t.teacher,'teacher login must survive');
});
test('after Switch student the tab does not turn into the teacher tab',async()=>{
 const t=setup({tab:{b3Games_studentId:'s1'},active:student});t.api.onAuthStateChanged(()=>{});await settle();
 await t.api.endStudentSession();await settle();
 assert.equal(t.auth.currentUser,null);
});
test('Teacher Sign-in after Switch student works again in that tab',async()=>{
 const t=setup({tab:{b3Games_studentId:'s1'},active:student});
 await t.api.endStudentSession();await t.api.signInWithGoogle();
 assert.equal(t.auth.currentUser,t.teacher);
});
test('endStudentSession never signs out a Google teacher',async()=>{
 const t=setup({active:null});t.api.onAuthStateChanged(()=>{});await settle();
 assert.equal(t.auth.currentUser,t.teacher);
 await t.api.endStudentSession();assert.equal(t.auth.currentUser,t.teacher);
});
test('student custom-token sign-ins use tab-only SESSION persistence',()=>{
 const html=fs.readFileSync('record_pesukim/student.html','utf8');
 const i=html.indexOf('signInWithCustomToken(data.customToken)');
 assert.ok(i>0);assert.match(html.slice(i-300,i),/Persistence\.SESSION/);
 const idx=fs.readFileSync('index.html','utf8');
 const j=idx.indexOf('signInWithCustomToken(customToken)');
 assert.match(idx.slice(j-300,j),/Persistence\.SESSION/);
 assert.match(idx,/endStudentSession\(\)/);
 assert.doesNotMatch(idx.slice(idx.indexOf('async function switchStudent'),idx.indexOf('function timeParts')),/B3SiteSettings\.signOut|settingsApi\.signOut/);
});
