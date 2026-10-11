'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {verifiedTeacherIdentity}=require('../backend/functions/teacher-auth-identity.cjs');
function memoryStore(data={}){
 const m={...data};
 return {getItem:k=>Object.hasOwn(m,k)?m[k]:null,
   setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];},
   clear:()=>{for(const k of Object.keys(m))delete m[k];},has:k=>Object.hasOwn(m,k)};
}
function createSwitch(){
 const actions=[];
 const sessionStorage=memoryStore({b3Games_studentId:'student123',b3TeacherBypass:'1',b3ActingAsStudent:'{}'});
 const localStorage=memoryStore({b3TeacherWasSignedIn:'1',b3TeacherEmailLinkPending:'{}',otherSetting:'keep'});
 const window={};
 const sandbox={window,document:{currentScript:{src:'https://funtorahtools.com/shared-device-session.js'}},
  location:{href:'https://funtorahtools.com/teacher-home.html',assign:url=>actions.push(url)},
  URL,sessionStorage,localStorage};
 const code=fs.readFileSync(path.resolve(__dirname,'../shared-device-session.js'),'utf8');
 vm.runInNewContext(code,sandbox);
 return {window,sessionStorage,localStorage,actions};
}
test('Switch to student signs out Firebase before a student sees the device',async()=>{
 const x=createSwitch();const order=[];
 const auth={signOut:async()=>{order.push('signOut');}};
 x.window.B3SharedDevice.switchToStudent(auth).then(()=>order.push('done'));
 await Promise.resolve();
 assert.equal(order[0],'signOut');
 await new Promise(setImmediate);
 assert.deepEqual(x.actions,['https://funtorahtools.com/index.html?sharedDevice=student']);
 assert.equal(x.sessionStorage.has('b3Games_studentId'),false);
 assert.equal(x.sessionStorage.has('b3TeacherBypass'),false);
 assert.equal(x.localStorage.has('b3TeacherWasSignedIn'),false);
 assert.equal(x.localStorage.has('b3TeacherEmailLinkPending'),false);
 assert.equal(x.localStorage.has('otherSetting'),true);
});
test('Teacher sign-out failures NEVER hand the computer to student',async()=>{
 const x=createSwitch();
 await assert.rejects(x.window.B3SharedDevice.switchToStudent({
  signOut:async()=>{throw new Error('network error')}
 }),/network error/);
 assert.deepEqual(x.actions,[]);
 assert.equal(x.sessionStorage.has('b3TeacherBypass'),true);
});
test('Switch to teacher clears child login and requires a new Firebase teacher sign-in',async()=>{
 const x=createSwitch();let n=0;
 await x.window.B3SharedDevice.switchToTeacher({signOut:async()=>{n++;}});
 assert.equal(n,1);
 assert.deepEqual(x.actions,['https://funtorahtools.com/teacher-home.html?sharedDevice=teacher']);
 assert.equal(x.sessionStorage.has('b3Games_studentId'),false);
});
test('Verified Google OR verified email-link teacher ID tokens allowed',()=>{
 const sample={uid:'teacherABC',email:'teacher@school.org',email_verified:true,
  firebase:{sign_in_provider:'google.com'}};
 assert.equal(verifiedTeacherIdentity(sample),true);
 assert.equal(verifiedTeacherIdentity({...sample,firebase:{sign_in_provider:'password'}}),true);
 for(const v of [{...sample,email_verified:false},{...sample,firebase:{sign_in_provider:'anonymous'}},
  {...sample,uid:''},{...sample,email:'notemail'}])
  assert.equal(verifiedTeacherIdentity(v),false);
});
test('Teacher, student UI and email link work are present without PIN-only bypass',()=>{
 const home=fs.readFileSync(path.resolve(__dirname,'../teacher-home.html'),'utf8');
 const index=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
 const settings=fs.readFileSync(path.resolve(__dirname,'../site-settings.js'),'utf8');
 assert.match(home,/id="switchToStudent"/);
 assert.match(home,/B3SharedDevice\.switchToStudent\(firebase\.auth\(\)\)/);
 assert.match(index,/id="switchToTeacherBtn"/);
 assert.match(index,/id="switchToTeacherLogin"/);
 assert.match(index,/B3SharedDevice\.switchToTeacher\(firebase\.auth\(\)\)/);
 assert.match(home,/Complete email sign-in/);
 assert.match(settings,/sendSignInLinkToEmail/);
 assert.match(settings,/signInWithEmailLink/);
 assert.doesNotMatch(home,/signInWithCustomToken|teacherPIN===/);
});
