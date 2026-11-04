const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8').replace(/\r\n/g,'\n');
const boards=read('class-pointer-prototype/student-boards.js');
const room=read('class-pointer-prototype/classroom.js');
const share=read('class-pointer-prototype/activity-share.js');

test('only the teacher page can start, change or stop a presented whiteboard',()=>{
  // Student side accepts class-board messages only through the teacher connection handler (fromTeacher).
  assert.match(boards,/if\(message\.type\.startsWith\('board-class'\)\)\{onClassMessage\(message\);return true\}/);
  // Teacher side: a boy may change who writes only if he is the presenter and the teacher has not taken control.
  assert.match(boards,/if\(!isPresenter\(m\)\|\|cb\.locked\)return;/);
  // Another boy may write only while allowed and not paused; nothing a boy sends is forwarded as it came.
  assert.match(boards,/if\(isPresenter\(m\)\|\|!cbCanWrite\(m\)\|\|isBlocked\(m\)\)return;/);
  assert.match(boards,/const op=cleanRelayOp\(message\.op,'guest'\)/);
  // Boys can remove only their own lines on the shared board.
  assert.match(boards,/model\.guest=model\.guest\.filter\(s=>!\(s\.owner===from&&ids\.has\(s\.id\)\)\)/);
});

test('it stops when boards close, a mode changes, the class ends, the teacher signs out or the boy is paused',()=>{
  for(const needle of ["if(!next)stopClassBoard();","if(next!=='boards')stopClassBoard();","stopClassBoard();drawer?.cancel();for(const m of B.members().values())closeScreen(m);",
    "document.addEventListener('class-pointer-teacher-signed-out',()=>stopClassBoard());","if(isBlocked(m)||excluded(m,'boards'))stopClassBoard();"])
    assert.ok(boards.includes(needle),needle);
  assert.match(boards,/stopClassBoard,\n\s+classBoard:/);
});

test('one class-wide presentation at a time (screen share and whiteboard replace each other)',()=>{
  assert.match(boards,/window\.ClassPointerClassShare\?\.stop\(\);\s+stopClassBoard\(\);/);
  assert.match(room,/window\.ClassPointerBoards\?\.stopClassBoard\?\.\(\);\s+stopClassShare\(\);/);
});

test('the Stop button is always on the lesson and a late joiner receives the presentation',()=>{
  assert.match(boards,/stage\.appendChild\(cbBar\)/);
  assert.match(boards,/Stop showing '\+cb\.name\+'’s whiteboard/);
  assert.match(boards,/if\(cb\)B\.send\(m\.connection,cbMessage\(m\)\)/);
  // The student page closes it when the teacher connection ends.
  assert.match(boards,/reset\(\)\{closeClassBoard\(\);/);
  assert.match(share,/window\.ClassPointerBoards\?\.reset\?\.\(\);\s+clearLesson\(\)/);
});

test('changed scripts have a new cache label so students load the new file',()=>{
  assert.match(share,/student-boards\.js\?v=20261102-classboard1/);
  assert.match(read('class-pointer-prototype/classroom.html'),/student-boards\.js\?v=20261102-classboard1/);
});
