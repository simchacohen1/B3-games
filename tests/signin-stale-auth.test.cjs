'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('site-settings.js','utf8');
const start=source.indexOf('  function onAuthStateChanged(callback) {');
const end=source.indexOf('\n  // ---------------------------------------------------------------------',start);
function setup(){
 let observe,resolve;
 const auth={currentUser:null,onAuthStateChanged(fn){observe=fn;return()=>{};}};
 const c=vm.createContext({ensureFirebase:()=>({auth}),endAuthChecking(){},isGoogleUser:()=>true,isStudentTab:()=>false,teacherRestoreBlocked:()=>false,
  restoreTeacher:async()=>false,currentAccess:{authorized:false},setSignedInHint(){},getActingStudent:()=>null,
  readUserAccess:()=>new Promise(r=>resolve=r),document:{readyState:'complete'},showToolVersions(){},console});
 vm.runInContext(source.slice(start,end),c);
 const calls=[];const off=c.onAuthStateChanged((user,authorized)=>calls.push({uid:user?.uid,authorized}));
 return {auth,calls,off,emit:async user=>{auth.currentUser=user;await observe(user);},finish:()=>resolve({authorized:true,role:'teacher',classIds:['et']})};
}
test('late teacher authorization cannot override sign-out',async()=>{
 const s=setup();await s.emit({uid:'teacher'});await s.emit(null);s.finish();await Promise.resolve();
 assert.deepEqual(s.calls,[{uid:undefined,authorized:false}]);
});
test('unsubscribed observer cannot deliver pending authorization',async()=>{
 const s=setup();await s.emit({uid:'teacher'});s.off();s.finish();await Promise.resolve();assert.equal(s.calls.length,0);
});
test('unchanged signed-in teacher still receives verified authorization',async()=>{
 const s=setup();await s.emit({uid:'teacher'});s.finish();await Promise.resolve();assert.deepEqual(s.calls,[{uid:'teacher',authorized:true}]);
});
