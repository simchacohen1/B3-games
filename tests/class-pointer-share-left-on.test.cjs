const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const read = f => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const dir = 'class-pointer-prototype/';

test('teacher page: the 5-minute reminder also covers a shared screen and tells students at the same moment', () => {
  const src = read(dir + 'teacher-dashboard.js');
  assert.match(src, /You\\u2019re still sharing\. Stop\?/);
  assert.match(src, /reminderStop\.textContent='Stop sharing'/);
  assert.match(src, /reminderKeep\.textContent='Keep sharing'/);
  // The students are told when the reminder is shown, and told again when it is answered, stopped or sharing ends.
  assert.match(src, /if\(screenLive\)\{reminderText[^]*tellStudents\(true\)\}/);
  assert.match(src, /reminderStop\.addEventListener\('click',\(\)=>\{reminder\.hidden=true;if\(screenLive\)tellStudents\(false\)/);
  assert.match(src, /reminderKeep\.addEventListener\('click',\(\)=>\{reminder\.hidden=true;if\(screenLive\)tellStudents\(false\)/);
  assert.match(src, /if\(wasScreen&&!screenLive\)tellStudents\(false\)/);
  // A shared screen counts as live for the check; the whiteboard behaviour (30 s away) is unchanged.
  assert.match(src, /syncReminder\(isLive&&\(\(docOpen\(\)&&lastDoc==='Whiteboard'\)\|\|\(!docOpen\(\)&&sharingScreen\(\)\)\),!docOpen\(\)&&sharingScreen\(\)\)/);
  assert.match(src, /const IDLE_MS=5\*60\*1000,AWAY_MS=30\*1000/);
});

test('teacher session: the flag is written by the teacher and cleared by every new push', () => {
  const src = read(dir + 'dashboard-session.js');
  assert.match(src, /async setShareMayBeLeftOn\(flag\)/);
  assert.match(src, /ref\.update\(\{shareMayBeLeftOn:flag===true\}\)/);
  assert.equal((src.match(/shareMayBeLeftOn:false/g) || []).length, 2, 'share request and destination request clear it');
});

test('student page: buttons appear only with the flag; shrink/close keep him in his class; a new lesson opens again', () => {
  const src = read(dir + 'activity-share.js');
  assert.match(src, /setShareIdleOffer\(next\?\.shareMayBeLeftOn===true\)/);
  assert.match(src, /function syncIdleButtons\(\)\{shrinkBtn\.hidden=!idleOffer;closeShareBtn\.hidden=!idleOffer/);
  // While the teacher is actively sharing the presentation lock still re-opens the picture; once dismissed under the flag it does not.
  assert.match(src, /followingPresentation\(\) && lessonActive && !\(idleOffer&&\(smallMode\|\|idleDismissed\)\)/);
  // Flag cleared (teacher kept sharing / pushed something): the picture is big and in front again.
  assert.match(src, /if\(!on\)\{idleDismissed=false;if\(smallMode\)applySmall\(false\)\}/);
  // A new lesson id re-opens the overlay big, even after the student closed it.
  assert.match(src, /userClosed=false;idleDismissed=false;if\(smallMode\)applySmall\(false\)/);
  // Closing does not leave the class: no sign-out, no class change.
  const close = src.slice(src.indexOf("closeShareBtn.addEventListener('click'"), src.indexOf("let overlayShownAt=0"));
  assert.doesNotMatch(close, /signOut|classId|location\./);
});

test('database rules (staging and hardened) accept the optional boolean flag on a lesson', () => {
  for (const file of ['staging/database.rules.json', 'firebase-rules.hardened.json']) {
    const rules = JSON.parse(read(file)).rules;
    const room = rules.b3Games.workspaces.$workspaceId.classes.$classId.classPointerSessions.$roomId;
    assert.equal(room.shareMayBeLeftOn['.validate'], 'newData.isBoolean()', file);
    assert.equal(room.leadTeacher['.validate'], 'newData.isBoolean()', file);
  }
});
