'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function teacherFixture({deferPopup=false}={}){
 const source=fs.readFileSync('site-settings.js','utf8');let releaseRead,releasePopup,reads=0,updates=0;
 const user={uid:'synthetic_teacher'};
 const auth={currentUser:null,setPersistence:async()=>{},updateCurrentUser:async u=>{updates++;auth.currentUser=u;},signOut:async()=>{auth.currentUser=null;}};
 const saved={currentUser:null,setPersistence:async()=>{},signOut:async()=>{saved.currentUser=null;},signInWithPopup:()=>deferPopup?new Promise(r=>releasePopup=()=>{saved.currentUser=user;r({user});}):Promise.resolve({user})};
 const authApi={GoogleAuthProvider:class{setCustomParameters(){}},Auth:{Persistence:{LOCAL:'local',SESSION:'session'}}};
 const c=vm.createContext({ensureFirebase:()=>({auth}),window:{firebase:{auth:authApi}},teacherSignInVersion:0,teacherSignOutVersion:0,sessionStorage:{removeItem(){}},NO_RESTORE_KEY:'blocked',getRememberedTeacherAuth:()=>saved,
  readUserAccess:()=>{reads++;return new Promise(r=>releaseRead=()=>r({authorized:true,role:'teacher',classIds:['et']}));},currentAccess:{authorized:false},document:{readyState:'complete'},showToolVersions(){}});
 vm.runInContext(source.slice(source.indexOf('  function signInWithGoogle() {'),source.indexOf('\n  function signOut()')),c);
 return {c,auth,saved,user,get reads(){return reads;},get updates(){return updates;},finishRead:()=>releaseRead(),finishPopup:()=>releasePopup()};
}
async function turns(){for(let i=0;i<20;i++)await Promise.resolve();}
test('sign-out during Google authorization cannot restore teacher access',async()=>{
 const s=teacherFixture(),pending=s.c.signInWithGoogle();await turns();assert.equal(s.reads,1);
 s.c.teacherSignOutVersion++;s.auth.currentUser=null;s.finishRead();await assert.rejects(pending,{code:'b3/sign-in-cancelled'});
 assert.equal(s.c.currentAccess.authorized,false);assert.equal(s.auth.currentUser,null);assert.equal(s.saved.currentUser,null);
});
test('a popup completing after sign-out is cancelled before default auth is replaced',async()=>{
 const s=teacherFixture({deferPopup:true}),pending=s.c.signInWithGoogle();await turns();s.c.teacherSignOutVersion++;s.finishPopup();await assert.rejects(pending,{code:'b3/sign-in-cancelled'});assert.equal(s.updates,0);assert.equal(s.saved.currentUser,null);
});
test('cancelled older Google result cannot sign out a newer login',async()=>{
 const s=teacherFixture(),pending=s.c.signInWithGoogle();await turns();s.c.teacherSignInVersion++;s.auth.currentUser={uid:'newer_teacher'};s.finishRead();await assert.rejects(pending,{code:'b3/sign-in-cancelled'});assert.equal(s.auth.currentUser.uid,'newer_teacher');
});
test('Halacha exchanges a fresh class-scoped token when the student changes class',async()=>{
 const html=fs.readFileSync('halacha/index.html','utf8');const source=html.slice(html.indexOf('async function halachaAuthReady(){'),html.indexOf('\nhalachaAuthReady().then'));
 let requests=0,persistence;
 const auth={currentUser:{getIdTokenResult:async()=>({claims:{b3StudentId:'synthetic',b3ClassId:'et'}})},setPersistence:async value=>{persistence=value;},signOut:async()=>{auth.currentUser=null;},signInWithCustomToken:async()=>{auth.currentUser={getIdTokenResult:async()=>({claims:{b3StudentId:'synthetic',b3ClassId:'wt'}})};}};
 const c=vm.createContext({HALACHA_TEACHER_PREVIEW:false,HALACHA_STUDENT_ID:'synthetic',halachaAuth:auth,sessionStorage:{getItem:key=>({'b3Games_studentName':'Synthetic','b3Games_classPin':'1234','b3Games_studentClass':'wt'})[key]},firebase:{auth:{Auth:{Persistence:{SESSION:'session'}}}},AbortSignal,fetch:async()=>{requests++;return{ok:true,json:async()=>({customToken:'synthetic_token',b3StudentId:'synthetic'})};}});
 vm.runInContext(source,c);await c.halachaAuthReady();assert.equal(requests,1);assert.equal(persistence,'session');assert.equal((await auth.currentUser.getIdTokenResult()).claims.b3ClassId,'wt');
});
for(const matches of [true,false])test('Rewards '+(matches?'reuses matching claims':'exchanges mismatched class claims'),async()=>{
 const source=fs.readFileSync('student-rewards/student.js','utf8');let exchanges=0;const notes={};
 const c=vm.createContext({openTeacherPreview:async()=>false,sessionStorage:{getItem:key=>({'b3Games_studentId':'synthetic','b3Games_studentName':'Synthetic','b3Games_classPin':'1234','b3Games_studentClass':'wt'})[key]||''},$:()=>notes,auth:{setPersistence:async()=>{},currentUser:{getIdTokenResult:async()=>({claims:{b3StudentId:'synthetic',b3ClassId:matches?'wt':'et',studentRewardsRole:'student',studentRewardsStudentId:'synthetic_reward'}})}},firebase:{auth:{Auth:{Persistence:{SESSION:'session'}}}},signInB3:async()=>{exchanges++;}});
 vm.runInContext(source.slice(source.indexOf('async function trySharedB3Login(){'),source.indexOf('\nasync function load(){')),c);await c.trySharedB3Login();assert.equal(exchanges,matches?0:1);
});
