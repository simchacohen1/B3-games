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
