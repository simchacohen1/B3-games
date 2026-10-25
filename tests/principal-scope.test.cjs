'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {derive,principal}=require('../principal-scope.js');
const classroom={et:{active:true},wt:{active:true},archived:{active:false},new_class:{active:true}};
const people={
  a:{role:'teacher',active:true,name:'Rabbi A',classIds:{et:true,wt:true}},
  b:{role:'teacher',active:true,name:'Rabbi B',classIds:{wt:true,new_class:true}},
  gone:{role:'teacher',active:false,classIds:{archived:true}},
  otherPrincipal:{role:'principal',active:true,classIds:{new_class:true}}
};
test('principal access is the union of classes belonging to selected active teachers',()=>{
 const scope=derive(people,{supervisedTeacherIds:{a:true,b:true}},classroom);
 assert.deepEqual(scope.classIds,{et:true,wt:true,new_class:true});
 assert.equal(scope.active,true);
 assert.deepEqual(Object.keys(scope.supervisedTeachers),['a','b']);
 assert.deepEqual(scope.supervisedTeachers.a.classIds,{et:true,wt:true});
});
test('never grant arbitrary classes, wildcard, inactive classes or other principals',()=>{
 const scope=derive({...people,a:{...people.a,classIds:{et:true,'*':true,archived:true}}},{supervisedTeacherIds:{a:true,gone:true,otherPrincipal:true,missing:true}},classroom);
 assert.deepEqual(scope.classIds,{et:true});
 assert.deepEqual(Object.keys(scope.supervisedTeachers),['a']);
});
test('removing a supervision assignment removes principal access immediately on reconciliation',()=>{
 const before=derive(people,{supervisedTeacherIds:{a:true,b:true}},classroom);
 const after=derive(people,{supervisedTeacherIds:{b:true}},classroom);
 assert.ok(before.classIds.et);assert.equal(after.classIds.et,undefined);
 assert.ok(after.classIds.wt);
 assert.equal(derive(people,{supervisedTeacherIds:{}},classroom).active,false);
});
test('principal recognition cannot be inferred from a teacher name',()=>{
 assert.equal(principal({name:'Principal Smith',role:'teacher'}),false);
 assert.equal(principal({role:'principal'}),true);
 assert.equal(principal({role:'teacher',accountType:'principal'}),true);
});

test('principal Google claim stays teacher-privileged, not admin, and retains supervised teachers',async()=>{
 const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
 const root='b3Games/workspaces/b3-2026',writes={};
 const principalInvite={email:'principal@example.com',active:true,role:'principal',accountType:'principal',
   classIds:{et:true,wt:true},supervisedTeachers:{a:{name:'Rabbi A',classIds:{et:true,wt:true}}}};
 const store={get:async key=>key===root+'/teacherInvites'?{principal_example_com:principalInvite}:null,
   update:async updates=>Object.assign(writes,updates)};
 const identity={uid:'principal-uid',email:'principal@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const result=await claimTeacher(store,identity);
 assert.equal(result.role,'teacher');
 assert.equal(result.accountType,'principal');
 assert.deepEqual(result.classIds,['et','wt']);
 assert.equal(writes[root+'/teachers/principal-uid'].role,'teacher');
 assert.equal(writes[root+'/teachers/principal-uid'].accountType,'principal');
 assert.equal(writes[root+'/classes/et/teacherIds/principal-uid'],true);
 assert.equal(writes[root+'/admins/principal-uid'],undefined);
});
test('principal claim refuses inactive invitations',async()=>{
 const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
 const root='b3Games/workspaces/b3-2026';
 const store={get:async key=>key===root+'/teacherInvites'?{principal_example_com:{email:'principal@example.com',role:'principal',active:false,classIds:{et:true}}}:null,
    update:async()=>{throw Error('Must not grant')}};
 const identity={uid:'principal-uid',email:'principal@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 await assert.rejects(claimTeacher(store,identity),/No active teacher invitation/);
});
