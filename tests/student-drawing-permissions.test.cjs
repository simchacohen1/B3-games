'use strict';
// Student drawing tools in Class Pointer:
//   1. Sharing a screen gives a student NO drawing toolbar by default (sharing is for showing a program).
//   2. Their own whiteboard (the teacher starts student whiteboards or sends a board) always has the tools.
//   3. Everywhere else, drawing is off unless the teacher allows it with the per-student control (Nothing / Pointer /
//      Highlight / Pen). The default is Nothing.
//   4. A student only sees the tools they may use.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const toolbar=read('class-pointer-prototype/annotation-toolbar.js');

test('the toolbar is hidden while a student shares unless the teacher allowed drawing; the whiteboard is always on',()=>{
  assert.match(toolbar,/let studentLevel='none';/,'the default is Nothing');
  assert.match(toolbar,/function ownDrawing\(\)\{for\(const name of reasons\)if\(name!=='sharing'\)return true;return false\}/);
  assert.match(toolbar,/function visible\(\)\{\s*if\(role==='teacher'\)return true;\s*if\(ownDrawing\(\)\)return true;\s*return reasons\.has\('sharing'\)&&studentLevel!=='none';\s*\}/);
  // setReason('sharing',true) alone no longer opens anything: openBar refuses when not visible.
  assert.match(toolbar,/function openBar\(auto\)\{\s*if\(!visible\(\)\)return;/);
  assert.match(toolbar,/if\(!visible\(\)\)return hideAll\(\);/);
});

test('each level gives a student only its tools, with no greyed-out buttons (Nothing: none, Pointer, Highlight, Pen)',()=>{
  const levels=toolbar.match(/const LEVEL_TOOLS=(\{[^;]*\});/);
  assert.ok(levels,'a tool list per level');
  const table=JSON.parse(JSON.stringify(vm.runInNewContext('('+levels[1]+')')));
  assert.deepEqual(table.none,[]);
  assert.deepEqual(table.point,['pointer']);
  assert.deepEqual(table.highlight,['pointer','highlight']);
  assert.deepEqual(table.pen,['select','pointer','highlight','text','shape','eraser','pen']);
  assert.equal(table.point.includes('pen')||table.highlight.includes('pen'),false,'pointing or highlighting never gives the pen');
  assert.equal(JSON.stringify(Object.values(table).flat()).includes('hand'),false,'no Hand tool');
  // The student's own screen only gets those tools; a teacher's page keeps all of them.
  assert.match(toolbar,/get tools\(\)\{return role==='teacher'\|\|ownDrawing\(\)\?undefined:LEVEL_TOOLS\[studentLevel\]\}/);
  assert.match(toolbar,/get hideUnused\(\)\{return role!=='teacher'&&!ownDrawing\(\)\}/);
  assert.match(toolbar,/get defaultTool\(\)\{return 'pointer'\}/);
  // Unknown levels fall back to Nothing.
  assert.match(toolbar,/Object\.prototype\.hasOwnProperty\.call\(LEVEL_TOOLS,next\)\?next:'none'/);
});

test('a student\'s own whiteboard and worksheet surfaces are not limited by the level',()=>{
  const boards=read('class-pointer-prototype/student-boards.js'),mine=read('class-pointer-prototype/my-files.js');
  // The student's board surface lists no tools, so it has all of them, whatever the level.
  const surface=boards.slice(boards.indexOf('const boardSurface='),boards.indexOf('const boardSurface=')+400);
  assert.doesNotMatch(surface,/tools:\[/);
  assert.match(boards,/FA\.setReason\('whiteboard',boardOpen\(\)\)/);
  assert.match(mine,/FA\.setReason\('whiteboard',true\)/);
});

test('the per-student permission already used for the lesson also drives the toolbar, and hides tools that are not allowed',()=>{
  const cls=read('class-pointer-prototype/classroom.js'),share=read('class-pointer-prototype/activity-share.js');
  // Classroom page (student): the level comes from the teacher's per-student tools; not selected means none.
  assert.match(cls,/const own=ownMember\(\),level=!selected\(own\)\?'none':memberTools\(own\)\?\.pen\?'pen':memberTools\(own\)\?\.highlight\?'highlight':memberTools\(own\)\?\.pointer\?'point':'none';\s*window\.FTTAnnotate\?\.setStudentLevel\?\.\(level\);/);
  assert.match(cls,/option\.hidden=option\.disabled/,'tools the student may not use are not shown');
  // Activity pages: the level the teacher sends (lesson-tools) is the same one.
  assert.match(share,/function redrawToolbar\(\)\{\s*\/\/[^\n]*\n\s*window\.FTTAnnotate\?\.setStudentLevel\?\.\(lessonLevel\);/);
  assert.match(share,/let lessonLevel='none'/);
  assert.match(share,/lessonLevel='none';lessonDraft=null;lessonMarks=/,'leaving the class goes back to Nothing');
  // The lesson tools on an activity page already hide what is not allowed.
  assert.match(share,/button\.hidden=!allowedMode\(mode\)/);
});

test('starting to share still sets the sharing reason, but that alone shows nothing',()=>{
  assert.match(read('class-pointer-prototype/activity-share.js'),/FTTAnnotate\?\.setReason\('sharing',true\)/);
  assert.match(read('class-pointer-prototype/student-boards.js'),/FTTAnnotate\?\.setReason\('sharing',true\)/);
  assert.match(toolbar,/setStudentLevel\(next\)\{/);
  // Allowing drawing while the student is already sharing opens the toolbar; taking it away closes it and clears the marks.
  assert.match(toolbar,/if\(before==='none'&&reasons\.has\('sharing'\)\)\{mount\(\);st\.tool=viewport\.defaultTool;lastSurface=null;openBar\(true\);return\}/);
  assert.match(toolbar,/function hideAll\(\)\{[\s\S]*?if\(role!=='teacher'\)\{viewport\.items=\[\];history\.delete\('viewport'\)\}/);
});
