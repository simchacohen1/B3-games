'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','class-pointer-prototype');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('teacher maximizing never requests native browser fullscreen',()=>{
 const s=read('lesson-fullscreen.js');
 assert.doesNotMatch(s,/\bstage\.requestFullscreen\s*\(/);
 assert.match(s,/stage\.classList\.add\('lesson-fullscreen'\)/);
});
test('teacher share controls preserve existing share sources',()=>{
 const s=read('teacher-toolbar.js');
 for(const id of ['shareScreen','openBrowserTab','openPdf','openWebpage','openWhiteboard','stopScreen'])
   assert.ok(s.includes("'"+id+"'"),'Missing share source: '+id);
});
test('student screens default to screens but whiteboard choice remains',()=>{
 const s=read('student-boards.js');
 assert.match(s,/mode='screens',focusId/);
 assert.match(s,/setMode\('boards'\)/);
 assert.match(s,/setMode\('screens'\)/);
});
test('teacher screen permission is disabled when closing the viewer',()=>{
 const s=read('student-boards.js');
 assert.match(s,/setStudentScreenSharing\(on&&mode==='screens'\)/);
 assert.match(s,/setStudentScreenSharing\(false\)/);
});
test('class picker preserves authorization checks',()=>{
 const s=read('dashboard-session.js');
 assert.match(s,/C\.permitted\(access,classId,row\)/);
 assert.match(s,/C\.permitted\(access,id,classRow\)/);
});

test('student capture prefers a browser tab but requires the browser permission chooser',()=>{
 const s=read('student-boards.js');
 assert.match(s,/getDisplayMedia\(/);
 assert.match(s,/preferCurrentTab:true/);
 assert.match(s,/surfaceSwitching:'include'/);
 assert.match(s,/getVideoTracks\(\)\[0\]/);
});

test('activity sharing requires a verified student before opening a screen button',()=>{
 const s=read('activity-share.js');
 assert.match(s,/studentAuth/);
 assert.match(s,/action:'verify'/);
 assert.match(s,/studentScreenSharing===true/);
 assert.match(s,/action:'issue'/);
 assert.match(s,/getDisplayMedia\(/);
});
test('teacher checks activity ticket before accepting a media call',()=>{
 const teacher=read('activity-screen-teacher.js');
 const classroom=read('classroom.js');
 assert.match(teacher,/action:'verify'/);
 assert.match(teacher,/Authorization:'Bearer '/);
 assert.match(teacher,/call\.answer\(\)/);
 assert.match(classroom,/ClassPointerActivityShares\.incomingCall/);
});
