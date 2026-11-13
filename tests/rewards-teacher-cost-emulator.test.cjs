'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {TextEncoder}=require('node:util');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const firebase=require('firebase/compat/app');
require('firebase/compat/database');
const {rewardsTeacher}=require('../backend/functions/rewards-teacher-core.cjs');

const RUN=process.env.B3_RUN_RTDB_EMULATOR_TESTS==='1';
const encoder=new TextEncoder();
const bytes=value=>encoder.encode(JSON.stringify(value??null)).byteLength;

test('Rewards teacher refresh reads enrolled student records instead of the whole student root',async t=>{
 if(!RUN){t.skip('Run with FIREBASE_DATABASE_EMULATOR_HOST and B3_RUN_RTDB_EMULATOR_TESTS=1 against the local RTDB emulator.');return;}
 const endpoint=String(process.env.FIREBASE_DATABASE_EMULATOR_HOST||'');
 const [host,portText]=endpoint.split(':');
 if(!host||!portText)throw new Error('FIREBASE_DATABASE_EMULATOR_HOST must be host:port');
 const env=await initializeTestEnvironment({projectId:'demo-shorashim-cost-audit',database:{host,port:Number(portText),rules:JSON.stringify({rules:{'.read':true,'.write':true}})}});
 t.after(()=>env.cleanup());
 const database=env.unauthenticatedContext().database();
 const students={
  'existing-student-a':{id:'existing-student-a',name:'Synthetic A',b3StudentId:'student-a',active:true,rewardBalance:10},
  'existing-student-b':{id:'existing-student-b',name:'Synthetic B',b3StudentId:'student-b',active:true,rewardBalance:20}
 };
 for(let i=0;i<600;i++)students[`unrelated-${i}`]={id:`unrelated-${i}`,name:`Synthetic unrelated student ${i}`,b3StudentId:`outside-${i}`,active:true,rewardBalance:i};
 const rewardClasses={b3_sc:{id:'b3_sc',name:'Synthetic class',active:true,b3ClassId:'sc'}},roundHistory={b3_sc:{activeRound:{status:'active',totalContributed:12}}};
 for(let i=0;i<40;i++){
  rewardClasses[`b3_unrelated_${i}`]={id:`b3_unrelated_${i}`,name:`Unrelated class ${i}`,b3ClassId:`unrelated_${i}`};
  roundHistory[`b3_unrelated_${i}`]={activeRound:{status:'active',totalContributed:i}};
 }
 await database.ref().set({
  b3Games:{workspaces:{'b3-2026':{
   teachers:{teacher:{active:true,classIds:{sc:true}}},
   classes:{sc:{name:'Synthetic class',active:true,toolGrants:{'student-rewards':true},members:{'student-a':{name:'Synthetic A',active:true},'student-b':{name:'Synthetic B',active:true}}}}
  }}},
   studentRewards:{classes:rewardClasses,enrollments:{b3_sc:{'existing-student-a':true,'existing-student-b':true}},students,classRewardRounds:roundHistory}
 });
 const fullStudentRoot=await database.ref('studentRewards/students').once('value');
 const fullRootBytes=bytes(fullStudentRoot.val());
 const fullClassRootBytes=bytes((await database.ref('studentRewards/classes').once('value')).val());
 const fullRoundRootBytes=bytes((await database.ref('studentRewards/classRewardRounds').once('value')).val());
 const reads=[];
 const store={
  async get(path){const value=(await database.ref(path).once('value')).val();reads.push({path,bytes:bytes(value)});return value;},
  async update(values){return database.ref().update(values);},
  async tx(path,fn){return database.ref(path).transaction(fn);}
 };
 const identity={uid:'teacher',email:'teacher@school.test',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const {root}=await rewardsTeacher(store,identity,{action:'load'},Date.parse('2026-10-02T15:00:00Z'));
 const broadRootReads=reads.filter(row=>row.path==='studentRewards/students');
 const scopedStudentReads=reads.filter(row=>/^studentRewards\/students\/[^/]+$/.test(row.path));
 const scopedBytes=scopedStudentReads.reduce((sum,row)=>sum+row.bytes,0);
 const broadClassReads=reads.filter(row=>row.path==='studentRewards/classes');
 const scopedClassReads=reads.filter(row=>row.path==='studentRewards/classes/b3_sc');
 const broadRoundReads=reads.filter(row=>row.path==='studentRewards/classRewardRounds');
 const scopedRoundReads=reads.filter(row=>row.path==='studentRewards/classRewardRounds/b3_sc');
 const scopedRoundBytes=scopedRoundReads.reduce((sum,row)=>sum+row.bytes,0);
 assert.equal(broadRootReads.length,0,'mapped class members should not trigger a full-root student scan');
 assert.equal(scopedStudentReads.length,2,'read only each enrolled student record');
 assert.equal(Object.keys(root.students).length,2,'teacher response only contains enrolled students');
 assert.ok(scopedBytes<fullRootBytes,'scoped student snapshots are smaller than the whole root');
 assert.deepEqual(Object.keys(root.classes),['b3_sc'],'teacher response contains only its class');
 assert.deepEqual(Object.keys(root.classRewardRounds),['b3_sc'],'teacher response contains only its class round');
 assert.equal(broadClassReads.length,0,'class metadata is not downloaded from its root');
 assert.equal(scopedClassReads.length,1,'reuse exactly the authorized class metadata snapshot');
 assert.ok(scopedClassReads[0].bytes<fullClassRootBytes);
 assert.equal(broadRoundReads.length,0,'round history is not downloaded from its root');
 assert.equal(scopedRoundReads.length,1,'read exactly the authorized class round node');
 assert.ok(scopedRoundBytes<fullRoundRootBytes);
  console.log(JSON.stringify({measurement:'local RTDB emulator decoded JSON snapshots; excludes wire framing/compression and billing',unrelatedStudents:600,fullStudentRootBytes:fullRootBytes,scopedStudentReadBytes:scopedBytes,studentRootReads:broadRootReads.length,scopedStudentRecordReads:scopedStudentReads.length,unrelatedClasses:40,fullClassMetadataBytes:fullClassRootBytes,authorizedClassMetadataBytes:scopedClassReads[0].bytes,classRootReads:broadClassReads.length,fullRoundHistoryBytes:fullRoundRootBytes,authorizedRoundBytes:scopedRoundBytes,roundRootReads:broadRoundReads.length,teacherResponseStudentCount:Object.keys(root.students).length}));
});
