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

test('Game Show lets valid legacy WT and ET students in when no grant is set, and nobody else',()=>{
  const wt={b3StudentRole:'student',b3StudentId:'synthetic_wt_student',b3ClassId:'wt'};
  const et={...wt,b3StudentId:'synthetic_et_student',b3ClassId:'et'};
  // Reproduces issue #420: active WT class, active member, no game-show grant row.
  assert.equal(isActiveStudentAccess(wt,snap({active:true}),snap({active:true})),true);
  assert.equal(isActiveStudentAccess(et,snap({active:true}),snap({active:true})),true);
  // Still refused: inactive class, inactive or missing member, explicit off, teacher role.
  assert.equal(isActiveStudentAccess(wt,snap({active:false}),snap({active:true})),false);
  assert.equal(isActiveStudentAccess(wt,snap({active:true}),snap({active:false})),false);
  assert.equal(isActiveStudentAccess(wt,snap({active:true}),{exists:()=>false}),false);
  assert.equal(isActiveStudentAccess(wt,snap({active:true,toolGrants:{'game-show':false}}),snap({active:true})),false);
  assert.equal(isActiveStudentAccess({...wt,b3StudentRole:'teacher'},snap({active:true}),snap({active:true})),false);
  // A non-legacy class still needs the explicit grant.
  const other={...wt,b3ClassId:'class_other'};
  assert.equal(isActiveStudentAccess(other,snap({active:true}),snap({active:true})),false);
  assert.equal(isActiveStudentAccess(other,snap({active:true,toolGrants:{'game-show':true}}),snap({active:true})),true);
});

test('Game Show server buzz action honors narration and timed reveal locks',()=>{
  assert.equal(canAcceptStudentBuzz({roundActive:true},100),true);
  assert.equal(canAcceptStudentBuzz({roundActive:true,narrationLocked:true},100),false);
  assert.equal(canAcceptStudentBuzz({roundActive:true,buzzUnlockAt:101},100),false);
  assert.equal(canAcceptStudentBuzz({roundActive:true,buzzUnlockAt:100},100),true);
  assert.equal(canAcceptStudentBuzz({roundActive:false},100),false);
  assert.equal(canAcceptStudentBuzz({roundActive:true,buzzedBy:'Synthetic Student'},100),false);
});

test('Game Show treats a missing active flag on legacy WT/ET records as active (issue #420)',()=>{
  const wt={b3StudentRole:'student',b3StudentId:'synthetic_wt_student',b3ClassId:'wt'};
  // Live WT records have no class-level "active" and a membership with no "active" or toolAccess.
  assert.equal(isActiveStudentAccess(wt,snap({name:'WT'}),snap({name:'Synthetic Student'})),true);
  // Explicit per-student switch-off is still honoured.
  assert.equal(isActiveStudentAccess(wt,snap({name:'WT'}),snap({toolAccess:{'game-show':false}})),false);
  // ET cannot use a WT room: the class is taken from the signed identity, never from the request.
  assert.equal(isActiveStudentAccess({...wt,b3ClassId:'et'},snap(null),snap({active:true})),false);
});
