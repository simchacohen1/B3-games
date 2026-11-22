const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..','class-pointer-prototype',f),'utf8');
// The teacher's presentation always comes first: no student Share My Screen button while it is on, and a running share pauses.
test('student page: presentation hides the share button, blocks opening a share, pauses and resumes a running one',()=>{
  const s=read('activity-share.js');
  // set from the teacher's lesson-presentation announcements and from losing the lesson
  assert.match(s,/lessonActive=true;setPresenting\(true\)/);
  assert.match(s,/lessonActive=false;setPresenting\(false\)/);
  assert.equal((s.match(/setPresenting\(false\)/g)||[]).length,2);
  // the button is hidden (both the idle button and a running share's Stop button)
  assert.match(s,/\(active&&permissionReady\)\|\|s\?\.open\)&&!lessonOnAir\?'flex':'none'/);
  assert.match(s,/holder\.style\.display=lessonOnAir\?'none':'flex'/);
  // no share window may be opened or started meanwhile (this was the blank window that flashed twice)
  assert.match(s,/function openHolder\(\)\{\s*if\(busy\|\|!active\|\|!sameStudent\(\)\|\|lessonOnAir\)return;/);
  assert.match(s,/if\(sharePaused\|\|lessonOnAir\)return;/);
  // a running share is paused by disabling its video track, not torn down; the sharing tab is told over the channel
  assert.match(s,/t\.enabled=!paused/);
  assert.match(s,/tell\(\{type:'presenting',on\}\)/);
  assert.match(s,/m\.type==='presenting'&&typeof m\.on==='boolean'/);
  // a freshly opened or briefly missed sharing tab learns the current state
  assert.match(s,/if\(m\.open&&lessonOnAir\)tell\(\{type:'presenting',on:true\}\)/);
  assert.match(s,/tell\(\{type:'presenting',on:lessonOnAir\}\)/);
});
test('Pointer page share button follows the same rule',()=>{
  const b=read('student-boards.js');
  assert.match(b,/classpointer:teacher-presenting/);
  assert.match(b,/shareBtn\.hidden=teacherPresenting/);
  assert.match(b,/function openShareWindow\(\)\{\s*if\(teacherPresenting\)return;/);
  assert.match(b,/t\.enabled=!teacherPresenting/);
});
test('poll: timer select (default 1 minute), countdown, shrink once answered, closes with the teacher',()=>{
  const p=read('poll.js');
  assert.match(p,/\['30','30 seconds'\],\['60','1 minute'\],\['120','2 minutes'\],\['0','No timer'\]/);
  assert.match(p,/timerSelect\.value='60'/);
  assert.match(p,/place\(mode\)/);
  assert.match(p,/cp-poll-mini/);
  assert.match(p,/addEventListener\('pagehide'/);
  assert.match(p,/if\(n<=0\)\{clearInterval\(stuTick\)/);
});
