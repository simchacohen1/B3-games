'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {safeQuestion,isActiveStudentAccess,canAcceptStudentBuzz}=require('../backend/functions/game-show-student-questions-core.cjs');

function snap(value){return{exists:()=>value!==null,child:path=>({val:()=>path.split('/').reduce((v,k)=>v?.[k],value)})};}

test('Game Show student payload removes answer-key fields and preserves display fields',()=>{
  const safe=safeQuestion({q:'Synthetic question',choices:['A','B'],ans:'B',answer:'B',correctIndex:1,explanation:'private',id:'q1',image:'img.png'});
  assert.deepEqual(safe,{q:'Synthetic question',choices:['A','B'],image:'img.png'});
  assert.equal(safeQuestion('Synthetic text question'),'Synthetic text question');
});

test('Game Show requires an active student, active class and active tool grant',()=>{
  const identity={b3StudentRole:'student',b3StudentId:'synthetic_student',b3ClassId:'et'};
  assert.equal(isActiveStudentAccess(identity,snap({active:true,toolGrants:{'game-show':true}}),snap({active:true})),true);
  assert.equal(isActiveStudentAccess(identity,snap({active:false,toolGrants:{'game-show':true}}),snap({active:true})),false);
  assert.equal(isActiveStudentAccess(identity,snap({active:true,toolGrants:{'game-show':true}}),snap({active:false})),false);
  assert.equal(isActiveStudentAccess(identity,snap({active:true,toolGrants:{'game-show':false}}),snap({active:true})),false);
  assert.equal(isActiveStudentAccess({...identity,b3StudentRole:'teacher'},snap({active:true,toolGrants:{'game-show':true}}),snap({active:true})),false);
});

test('Game Show server buzz action honors narration and timed reveal locks',()=>{
  assert.equal(canAcceptStudentBuzz({roundActive:true},100),true);
  assert.equal(canAcceptStudentBuzz({roundActive:true,narrationLocked:true},100),false);
  assert.equal(canAcceptStudentBuzz({roundActive:true,buzzUnlockAt:101},100),false);
  assert.equal(canAcceptStudentBuzz({roundActive:true,buzzUnlockAt:100},100),true);
  assert.equal(canAcceptStudentBuzz({roundActive:false},100),false);
  assert.equal(canAcceptStudentBuzz({roundActive:true,buzzedBy:'Synthetic Student'},100),false);
});
