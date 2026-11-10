'use strict';
// Shared Kami-style drawing toolbar (class-pointer-prototype/annotation-toolbar.js) and its hooks (#707).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const repo=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(repo,name),'utf8');
const toolbar=read('class-pointer-prototype/annotation-toolbar.js');

test('toolbar offers the eight Kami-style tools',()=>{
  for(const tool of ['pointer','hand','select','highlight','text','shape','eraser','pen'])
    assert.match(toolbar,new RegExp("\\['"+tool+"',"),tool);
  for(const shape of ['rect','ellipse','line','arrow'])assert.match(toolbar,new RegExp("\\['"+shape+"',"),shape);
});

test('students see nothing unless sharing or a whiteboard is open; teachers always have the pencil',()=>{
  assert.match(toolbar,/function visible\(\)\{return role==='teacher'\|\|reasons\.size>0\}/);
  // open() refuses when not visible, so a student has no other way in.
  assert.match(toolbar,/function openBar\(auto\)\{\s*if\(!visible\(\)\)return;/);
  // When the last reason ends the toolbar is removed and a student's marks go with it.
  assert.match(toolbar,/if\(!visible\(\)\)return hideAll\(\);/);
  assert.match(toolbar,/if\(role!=='teacher'\)\{viewport\.items=\[\];/);
  // A reason starting opens the toolbar by itself.
  assert.match(toolbar,/reasons\.add\(name\);[^\n]*openBar\(true\)/);
});

test('minimized or Hand/Pointer: the overlay catches no clicks',()=>{
  assert.match(toolbar,/#fttAnnotate\{position:fixed;inset:0;z-index:\$\{Z\};pointer-events:none;/);
  assert.match(toolbar,/const CAPTURES=new Set\(\['select','highlight','text','shape','eraser','pen'\]\);/);
  assert.match(toolbar,/const on=mode==='open'&&!isDelegate\(s\)&&CAPTURES\.has\(st\.tool\)&&!!r;/);
  // The pointer dot follows the mouse with a passive listener, never a click-catching layer.
  assert.match(toolbar,/document\.addEventListener\('pointermove',e=>\{\s*if\(mode!=='open'\|\|st\.tool!=='pointer'\)return;/);
});

test('teacher marks on a student screen use the shared toolbar and the existing verified channel',()=>{
  const s=read('class-pointer-prototype/screen-annotate.js');
  assert.match(s,/const surface=FA&&\{id:'screen',idPrefix:'t',autoOpen:true/);
  assert.match(s,/setItems\(list\)\{const t=current\(\);if\(!t\)return;record\(t\.id\)\.strokes=list\.slice\(-MAX_STROKES\);sendMarks\(t\)/);
  assert.match(s,/live\(d,p\)\{if\(!current\(\)\)return;draft=d;livePoint=p;/);
  assert.match(s,/if\(!FA\)host\.prepend\(bar\)/);
});

test('student side accepts shapes and text from the teacher, checked, with teacher ids only',()=>{
  const s=read('class-pointer-prototype/student-boards.js');
  assert.match(s,/return window\.FTTAnnotate\.cleanItem\(s,\{idPrefix:'t',maxPoints:400\}\)/);
  assert.match(toolbar,/if\(opts\.idPrefix&&raw\.id\[0\]!==opts\.idPrefix\)return null;/);
  assert.match(toolbar,/if\(typeof raw\.text!=='string'\|\|!raw\.text\.trim\(\)\|\|raw\.text\.length>MAX_TEXT/);
});

test('student whiteboard is a toolbar surface whose marks are ordinary board lines',()=>{
  const s=read('class-pointer-prototype/student-boards.js');
  assert.match(s,/const boardSurface=\{id:'board',idPrefix:'s',defaultTool:'pen'/);
  assert.match(s,/FA\.setReason\('whiteboard',boardOpen\(\)\)/);
  assert.match(s,/const ITEM_TOOLS=\['highlight','rect','ellipse','line','arrow','text'\]/);
  assert.match(s,/act\(\{type:'board-add',stroke\}\)/);
});

test('screen sharing turns the student toolbar on and off',()=>{
  const share=read('class-pointer-prototype/activity-share.js');
  assert.match(share,/window\.FTTAnnotate\?\.setReason\('sharing',true\)/);
  assert.match(share,/window\.FTTAnnotate\?\.setReason\('sharing',false\)/);
  assert.match(share,/if\(window\.FTTAnnotate\?\.owns\?\.\(target\)\)return true;/);
  assert.match(share,/annotation-toolbar\.js\?v=20261110-cp770/);
  const boards=read('class-pointer-prototype/student-boards.js');
  assert.match(boards,/window\.FTTAnnotate\?\.setReason\('sharing',true\)/);
  assert.match(boards,/window\.FTTAnnotate\?\.setReason\('sharing',false\)/);
});

test('teacher pages: pencil for signed-in teachers, classroom toolbar drives the lesson tools',()=>{
  const g=read('teacher-global-controls.js');
  assert.match(g,/authorized=true;\s*teacherAnnotate\(true\);/);
  assert.match(g,/function reset\(\) \{\s*teacherAnnotate\(false\);/);
  const c=read('class-pointer-prototype/classroom-annotate.js');
  assert.match(c,/FA\.setReason\('sharing',kind==='screen'\)/);
  assert.match(c,/FA\.setReason\('whiteboard',kind==='whiteboard'\)/);
  const html=read('class-pointer-prototype/classroom.html');
  assert.ok(html.indexOf('annotation-toolbar.js')<html.indexOf('screen-annotate.js'),'toolbar loads before screen-annotate');
  assert.ok(html.indexOf('classroom-annotate.js')>html.indexOf('classroom.js'),'adapter loads after classroom');
  assert.match(read('class-pointer-prototype/classroom.js'),/lessonKind:\(\)=>state\.sharing\?'screen':/);
});
