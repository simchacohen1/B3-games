'use strict';
// Fictional-data regression: the real Chazara quiet-scope checker must notice
// permission-relevant student/class membership changes without Firebase access.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('chazara/teacher.html','utf8');
const start=html.indexOf('async function quietScopeCheck(){');
const end=html.indexOf('\nsetInterval(quietScopeCheck,60000);',start);
assert.ok(start>=0&&end>start,'extract the actual Chazara quiet-scope checker');
const source=html.slice(start,end);

function scope(students){
 return {classes:{alpha:{name:'Alef'},beta:{name:'Beis'}},students};
}
function fixture(current,next,{throwRoster=false,rosterGate=null}={}){
 const reloads=[];
 const access={authorized:true,role:'admin',classIds:['*']};
 const user={uid:'fictional_owner'};
 const context={
  teacherAccess:access,teacherScope:current,scopeGeneration:1,document:{hidden:false},
  auth:{currentUser:user},location:{search:''},URLSearchParams,console,
  needsTeacherAssignmentRefresh:()=>false,
  window:{FunTorahTeacherScope:{roster:async()=>{
   if(rosterGate)await rosterGate;
   if(throwRoster)throw Error('Fictional revoked Chazara grant');
   return next;
  }}},
  loadClassScope:(u,a)=>reloads.push({u,a})
 };
 vm.runInNewContext(source+'\nthis.runQuietCheck=quietScopeCheck;',context,{filename:'chazara-quiet-scope-check.js'});
 return {run:()=>context.runQuietCheck(),reloads,context};
}

test('quiet scope refresh detects two students swapping class assignments',async()=>{
 const before=scope({
  studentA:{classId:'alpha',membershipClassIds:['alpha']},
  studentB:{classId:'beta',membershipClassIds:['beta']}
 });
 const after=scope({
  studentA:{classId:'beta',membershipClassIds:['beta']},
  studentB:{classId:'alpha',membershipClassIds:['alpha']}
 });
 const x=fixture(before,after);
 await x.run();
 assert.equal(x.reloads.length,1,'unchanged student and class ID sets must not conceal a class swap');
});

test('quiet scope refresh detects a newly added second-class membership',async()=>{
 const before=scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}});
 const after=scope({studentA:{classId:'alpha',membershipClassIds:['alpha','beta']}});
 const x=fixture(before,after);
 await x.run();
 assert.equal(x.reloads.length,1,'new multi-class provenance must invalidate cached classless-record eligibility');
});

test('membership order alone does not cause unnecessary dashboard reloads',async()=>{
 const before=scope({studentA:{classId:'alpha',membershipClassIds:['alpha','beta']}});
 const after=scope({studentA:{classId:'alpha',membershipClassIds:['beta','alpha']}});
 const x=fixture(before,after);
 await x.run();
 assert.equal(x.reloads.length,0,'equivalent memberships must have the same normalized signature');
});

test('unchanged class scope does not trigger a full dashboard reload',async()=>{
 const current=scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}});
 const x=fixture(current,scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}}));
 await x.run();
 assert.equal(x.reloads.length,0);
});

test('revoked Chazara roster/tool access still forces a fail-closed reload',async()=>{
 const current=scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}});
 const x=fixture(current,current,{throwRoster:true});
 await x.run();
 assert.equal(x.reloads.length,1,'roster authorization failures must not leave the old dashboard active');
});

function deferred(){
 let release;
 const promise=new Promise(resolve=>{release=resolve});
 return {promise,release};
}

test('old roster response cannot reload a different signed-in teacher with stale owner access',async()=>{
 const before=scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}});
 const after=scope({studentA:{classId:'beta',membershipClassIds:['beta']}});
 const gate=deferred();
 const x=fixture(before,after,{rosterGate:gate.promise});
 const pending=x.run();
 // Simulate the normal auth callback rebuilding the dashboard while the old
 // owner's asynchronous roster request is still unresolved.
 x.context.scopeGeneration++;
 x.context.auth.currentUser={uid:'fictional_new_teacher'};
 x.context.teacherAccess={authorized:true,role:'teacher',classIds:['beta']};
 gate.release();
 await pending;
 assert.equal(x.reloads.length,0,'discard the former user’s scope response rather than reloading with stale privileges');
});

test('roster error from an earlier session cannot revive a signed-out dashboard',async()=>{
 const before=scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}});
 const gate=deferred();
 const x=fixture(before,before,{throwRoster:true,rosterGate:gate.promise});
 const pending=x.run();
 x.context.scopeGeneration++;
 x.context.auth.currentUser=null;
 x.context.teacherAccess={authorized:false};
 gate.release();
 await pending;
 assert.equal(x.reloads.length,0,'old authorization failures must not launch a new load for the signed-out user');
});

test('newer scope generation suppresses stale roster even for the same signed-in user',async()=>{
 const before=scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}});
 const after=scope({studentA:{classId:'beta',membershipClassIds:['beta']}});
 const gate=deferred();
 const x=fixture(before,after,{rosterGate:gate.promise});
 const pending=x.run();
 x.context.scopeGeneration++;
 gate.release();
 await pending;
 assert.equal(x.reloads.length,0,'a newer authorized dashboard must not be replaced by an old roster response');
});

test('identity switch alone invalidates a pending owner roster read',async()=>{
 const before=scope({studentA:{classId:'alpha',membershipClassIds:['alpha']}});
 const after=scope({studentA:{classId:'beta',membershipClassIds:['beta']}});
 const gate=deferred();
 const x=fixture(before,after,{rosterGate:gate.promise});
 const pending=x.run();
 x.context.auth.currentUser={uid:'fictional_other_user'};
 gate.release();
 await pending;
 assert.equal(x.reloads.length,0,'never apply a previous identity’s access even before the auth callback updates generation');
});
