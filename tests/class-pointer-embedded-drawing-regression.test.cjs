'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','class-pointer-prototype');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('embedded student teacher lesson offers drawing controls in the existing overlay',()=>{
 const s=read('activity-share.js');
 assert.match(s,/fttTeacherLessonOverlay/);
 assert.match(s,/fttLessonDrawTools/);
 assert.match(s,/lessonModes=\[\['point'/);
 assert.match(s,/\['highlight'/);
 assert.match(s,/\['pen'/);
 assert.match(s,/lessonStage\.append\(lessonVideo,markLayer,pointerLayer,hitLayer\)/);
 assert.doesNotMatch(s,/location\.assign\([^)]*classroom/);
});
test('student buttons are permission gated and permission revocation clears in-flight draft',()=>{
 const s=read('activity-share.js');
 assert.match(s,/function redrawToolbar\(/);
 assert.match(s,/button\.hidden=!allowedMode\(mode\)/);
 assert.match(s,/lessonDraft=null;redrawToolbar\(\)/);
 assert.match(s,/hitLayer\.style\.pointerEvents=lessonLevel==='none'\?'none':'auto'/);
});
test('student sends normalized drawing coordinates via verified presence connection',()=>{
 const s=read('activity-share.js');
 assert.match(s,/const normalized=e=>/);
 assert.match(s,/presenceConn\.send\(\{type:'highlight',stroke\}\)/);
 assert.match(s,/type:'point',point:/);
 assert.match(s,/type:'pointer-hide'/);
 assert.match(s,/type:'edit-highlights',action:'undo'/);
});
test('presence ticket precedes permission and mark delivery',()=>{
 const s=read('classroom.js');
 assert.match(s,/gate\.verify\(message\.ticket,connection\.peer\)/);
 assert.match(s,/applyLevel\(entry,savedLevel\(name\)\)/);
 assert.match(s,/send\(connection,\{type:'lesson-tools',level:levelOf\(entry\)\}\)/);
 assert.match(s,/send\(connection,\{type:'lesson-marks'/);
});
test('teacher enforces permission for embedded drawing events',()=>{
 const s=read('classroom.js');
 assert.match(s,/member\.presence\?presence\.get\(member\.id\):members\.get\(member\.id\)/);
 assert.match(s,/message\.type==='highlight'&&live\(\)&&selected\(member\)/);
 assert.match(s,/message\.type==='point'&&live\(\)&&selected\(member\)/);
 assert.match(s,/message\.type==='edit-highlights'&&member\.admitted&&/);
});
test('Everyone and individual permission changes publish to all embedded student views',()=>{
 const s=read('classroom.js');
 assert.match(s,/\[\.\.\.members\.values\(\),\.\.\.presence\.values\(\)\]/);
 assert.match(s,/for\(const member of presence\.values\(\)\)if\(member\.admitted\)/);
 assert.match(s,/nameLevels\.set\(key,level\)/);
 assert.match(s,/nameLevels\.clear\(\)/);
});
test('working individual student whiteboard stays independent',()=>{
 const activity=read('activity-share.js');
 assert.match(activity,/ClassPointerBoards\?\.fromTeacher\(message\)/);
 assert.match(activity,/ClassPointerBoards\?\.reset\?\.\(\)/);
 assert.match(activity,/class-pointer-prototype\/student-boards\.js/);
});
