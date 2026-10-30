'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('./assignment-policy');
const scope={workspaceId:'school',classId:'ET',studentId:'s1'};
const teacher={id:'t1',role:'teacher',authenticated:true};
const student={id:'s1',role:'student',authenticated:true};
const ctx={workspaceId:'school',classId:'ET',classActive:true,studentActive:true,
 membershipActive:true,studentVerifiedId:'s1',teacherVerifiedId:'t1',
 teacherAuthorized:true,teacherAssignedToClass:true};
test('student can only read/submit own assignments',()=>{
 assert.equal(p.authorized(student,scope,ctx,'read'),true);
 assert.equal(p.authorized(student,scope,ctx,'submit'),true);
 assert.equal(p.authorized(student,scope,ctx,'write'),false);
 assert.equal(p.authorized({...student,id:'s2'},scope,ctx,'submit'),false);
});
test('teacher access requires verified active assignment',()=>{
 assert.equal(p.authorized(teacher,scope,ctx,'write'),true);
 for(const field of ['teacherAuthorized','teacherAssignedToClass','membershipActive','classActive','studentActive']){
  assert.equal(p.authorized(teacher,scope,{...ctx,[field]:false},'write'),false);
 }
 assert.equal(p.authorized(teacher,{...scope,classId:'WT'},ctx,'write'),false);
 assert.equal(p.authorized({...teacher,authenticated:false},scope,ctx,'write'),false);
});
test('assignment validation and safe path',()=>{
 assert.deepEqual(p.cleanDefinition({type:'audio',title:' Read ',details:'test',dueAt:0}),
 {type:'audio',title:'Read',details:'test',dueAt:0});
 assert.throws(()=>p.cleanDefinition({type:'audio',title:'',details:''}));
 assert.throws(()=>p.cleanDefinition({type:'invalid',title:'Read',details:''}));
 assert.throws(()=>p.assignmentPath(scope,'../outside'));
 assert.match(p.assignmentPath(scope,'a1'),/classes\/ET\/students\/s1\/assignments\/a1$/);
});
test('student submission and teacher review',()=>{
 const assigned={status:'assigned'};
 const submitted=p.transition(assigned,'submit',student,scope,ctx,100);
 assert.equal(submitted.status,'submitted');
 const approved=p.transition(submitted,'approve',teacher,scope,ctx,101);
 assert.equal(approved.status,'approved');
 assert.throws(()=>p.transition(submitted,'approve',student,scope,ctx,102));
 assert.throws(()=>p.transition(approved,'submit',student,scope,ctx,103));
 const returned=p.transition(submitted,'return',teacher,scope,ctx,104);
 assert.equal(p.transition(returned,'submit',student,scope,ctx,105).status,'submitted');
});
