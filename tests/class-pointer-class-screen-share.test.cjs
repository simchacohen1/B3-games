const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const room=read('class-pointer-prototype/classroom.js');
const teacher=read('class-pointer-prototype/activity-screen-teacher.js');
const student=read('class-pointer-prototype/activity-share.js');
const boards=read('class-pointer-prototype/student-boards.js');

test('only the teacher page can start a class-wide share, for one student at a time',()=>{
  assert.match(room,/if\(isTeacher\)window\.ClassPointerClassShare=/);
  assert.match(room,/function startClassShare\(studentId,name,stream\)\{\s*if\(!isTeacher\|\|!started\|\|!stream/);
  // Starting a new one first stops the previous one.
  assert.match(room,/stopClassShare\(\);\s*classShare=\{id:crypto\.randomUUID\(\)/);
  // No student message type can trigger it on the teacher side.
  const handler=room.slice(room.indexOf("if(message.type==='lesson-retry'"),room.indexOf("if(message.type==='lesson-retry'")+400);
  assert.doesNotMatch(handler,/class-share/);
  assert.doesNotMatch(room.replace(/send\(entry\.connection,\{type:'class-share'[^}]*\}\)/g,''),/message\.type==='class-share'/);
});

test('it goes only to this lesson\'s admitted connections, never back to the sharing boy',()=>{
  assert.match(room,/presence\.get\(entry\.id\)!==entry\|\|entry\.studentId===classShare\.studentId/);
  assert.match(room,/sendActivityLesson\(entry\);sendClassShare\(entry\);/); // late joiners get it too
  assert.match(room,/closeShareCall\(entry\),presence\.delete\(entry\.id\)/);
  assert.match(room,/window\.ClassPointerClassShare\?\.stop\(\);\s*window\.ClassPointerActivityShares\?\.closeAll\(\)/); // end of class
  assert.match(room,/stopClassShare\(\);activityTeacherAuthorized=false/); // teacher signs out
});

test('students accept it only from their teacher\'s room, announced first, view-only',()=>{
  assert.match(student,/incoming\.metadata\?\.kind==='class-share'\)\{if\(!sameStudent\(\)\|\|incoming\.peer!==presenceTarget\)/);
  assert.match(student,/if\(message\.type==='class-share'\)\{if\(admitted\)onClassShareMessage\(message\)/);
  assert.match(student,/shareExpect&&shareExpect\.id===id/);
  assert.match(student,/function clearLesson\(\)\{\s*closeClassShare\(\);/);
  assert.doesNotMatch(student.slice(student.indexOf('function closeClassShare'),student.indexOf('function onClassShareMessage')),/send\(/);
});

test('everyone sees whose screen; teacher has a Stop bar that stays visible and stops when the boy stops',()=>{
  assert.match(student,/’s screen — your teacher is showing it to the class/);
  assert.match(teacher,/id='classShareBar'/);
  assert.match(teacher,/classBarStop\.onclick=\(\)=>window\.ClassPointerClassShare\?\.stop\(\)/);
  assert.match(teacher,/Show to whole class/);
  assert.match(teacher,/calls\.some\(item=>item\.stream\)\)window\.ClassPointerClassShare\.stop\(\)/);
  assert.match(boards,/board-class-share/);
});
