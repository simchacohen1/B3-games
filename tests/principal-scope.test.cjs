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

test('principal invitation form validates real email addresses without accepting spaces',()=>{
 const html=require('node:fs').readFileSync('owner-admin.html','utf8');
 const line=html.split(/\r?\n/).find(x=>x.includes('Enter a valid principal Google email.'));
 assert.ok(line,'principal invitation email validation must exist');
 const start=line.indexOf('if(!')+4,end=line.indexOf('.test(email))');
 assert.ok(start>=4&&end>start,'principal email validation must use a regular expression');
 const emailPattern=Function('return ('+line.slice(start,end)+')')();
 for(const email of ['principal@example.com','teacher+principal@school.org'])
  assert.equal(emailPattern.test(email),true,'valid principal email rejected: '+email);
 for(const email of ['bad name@example.com','principal@example','bad@@example.com'])
  assert.equal(emailPattern.test(email),false,'invalid principal email accepted: '+email);
});


test('principal re-claim clears class membership removed by supervision changes',async()=>{
 const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
 const root='b3Games/workspaces/b3-2026',writes={};
 const existing={active:true,accountType:'principal',classIds:{et:true,wt:true}};
 const invite={email:'principal@example.com',active:true,role:'principal',accountType:'principal',classIds:{wt:true}};
 const store={
  get:async key=>key===root+'/teacherInvites'?{principal_example_com:invite}:
    key===root+'/teachers/principal-uid'?existing:null,
  update:async updates=>Object.assign(writes,updates)
 };
 const identity={uid:'principal-uid',email:'principal@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const result=await claimTeacher(store,identity);
 assert.deepEqual(result.classIds,['wt']);
 assert.deepEqual(writes[root+'/teachers/principal-uid'].classIds,{wt:true});
 assert.equal(writes[root+'/classes/et/teacherIds/principal-uid'],null,'stale ET class grant must be removed');
 assert.equal(writes[root+'/classes/wt/teacherIds/principal-uid'],true);
});
test('principal claim refuses invalid class keys before constructing database paths',async()=>{
 const {claimTeacher}=require('../backend/functions/teacher-claim-core.cjs');
 const root='b3Games/workspaces/b3-2026',writes={};
 const invite={email:'principal@example.com',active:true,accountType:'principal',classIds:{wt:true,'../outside':true}};
 const store={get:async key=>key===root+'/teacherInvites'?{principal_example_com:invite}:null,
  update:async updates=>Object.assign(writes,updates)};
 const identity={uid:'principal-uid',email:'principal@example.com',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const result=await claimTeacher(store,identity);
 assert.deepEqual(result.classIds,['wt']);
 assert.deepEqual(Object.keys(writes).filter(key=>key.includes('/teacherIds/')), [root+'/classes/wt/teacherIds/principal-uid']);
});
