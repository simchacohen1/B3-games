'use strict';
// Three Class Pointer fixes: (1) Select no longer blocks page buttons, (2) no "Share my screen" while the student's whiteboard is
// shown, (3) one Pointer tool replaces Pointer + Hand. Source checks; the behaviour was also checked in a real browser.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.resolve(__dirname,'..','class-pointer-prototype',file),'utf8');
const toolbar=read('annotation-toolbar.js'),boards=read('student-boards.js'),share=read('activity-share.js'),
  classroom=read('classroom.js'),annotate=read('classroom-annotate.js');

test('Select: the drawing layer lets clicks through, and only a mark, a handle or a word tile takes the press',()=>{
  assert.match(toolbar,/capture\.style\.pointerEvents=st\.tool==='select'\?'none':''/,'no pointer events on the layer while Select is chosen');
  assert.match(toolbar,/function markUnder\(e\)/);
  assert.match(toolbar,/document\.addEventListener\('pointerdown',e=>\{\s*if\(mode!=='open'\|\|st\.tool!=='select'/,'presses are looked at on the document');
  assert.match(toolbar,/if\(!found\)\{if\(selected\)\{selected=null;sync\(\)\}return\}/,'a press on nothing goes to the page and lets go of the pick');
  assert.match(toolbar,/if\(root\.contains\(e\.target\)\)return;/,'the toolbar itself is never intercepted');
  assert.match(toolbar,/capture\.style\.pointerEvents='auto';\s*e\.stopImmediatePropagation\(\);\s*onCaptureDown\(e\);/,'a press on a mark is taken over');
  assert.match(toolbar,/document\.addEventListener\('dblclick'/,'double-clicking words to edit them still works');
  assert.match(toolbar,/Buttons and links on the page still work\./,'the Select tip says so');
  // the other drawing tools still cover the page, as drawing needs
  assert.match(toolbar,/const CAPTURES=new Set\(\['select','highlight','text','shape','eraser','pen'\]\)/);
});

test('the whiteboards tell the Select gate where the word tiles are, without moving them',()=>{
  assert.equal((boards.match(/grab:\{hit:/g)||[]).length,2,'student board and teacher large board');
  assert.match(read('board-tiles-core.js'),/hit\(p\)\{/);
});

test('Share My Screen is not offered while the student\'s whiteboard is shown (a share already open keeps its Stop button)',()=>{
  assert.match(boards,/function announceBoard\(\)/);
  assert.match(boards,/classpointer:student-board/);
  // told when the board opens or closes, goes back to the activity, comes back, and when the teacher pauses it
  assert.ok((boards.match(/announceBoard\(\)/g)||[]).length>=5,'called from show, back, return, ui');
  assert.match(share,/document\.addEventListener\?\.\('classpointer:student-board'/);
  assert.match(share,/!lessonOnAir&&!\(boardShown&&!s\?\.open\)\?'flex':'none'/);
  // a running share's Stop button is untouched by the whiteboard
  assert.match(share,/holder\.style\.display=lessonOnAir\?'none':'flex'/);
});

test('one Pointer replaces Pointer + Hand on every toolbar',()=>{
  assert.doesNotMatch(toolbar,/\['hand',/,'no Hand button');
  assert.match(toolbar,/\['pointer','🔴','Pointer','Use the page normally: click, type and scroll\. Others see a dot where you point\.'\]/);
  assert.match(toolbar,/const st=\{tool:'pointer',/);
  assert.match(toolbar,/get defaultTool\(\)\{return 'pointer'\}/);
  assert.match(toolbar,/if\(tool==='hand'\)tool='pointer';/,'an old page asking for the Hand gets the Pointer');
  assert.doesNotMatch(toolbar,/:'hand';changed=true/);
});

test('on the lesson the Pointer is also the mouse: the page works normally and the class still sees the dot',()=>{
  assert.match(annotate,/const out=\['pointer'\];\s*if\(canSelect\(\)\)out\.push\('select'\);/);
  assert.doesNotMatch(annotate,/toolLabels:\{hand:/);
  assert.match(annotate,/B\.setNavigation\?\.\(arrow\(tool\)&&open,tool==='pointer'\);/);
  // classroom.js: mouse mode from the Pointer tool keeps the dot; holding Shift is still the plain mouse
  assert.match(classroom,/function setNavigation\(on,pointer=false\)\{toolNav=!!on;toolPointer=!!pointer;applyNavigation\(\)\}/);
  assert.match(classroom,/withPointer=!shiftNav&&toolNav&&toolPointer/);
  assert.match(classroom,/\(navigating&&!navPointer\)\|\|!point\|\|!live\(\)\|\|!allowed\(\)/,'the hover dot is sent in Pointer mouse mode');
  assert.match(classroom,/\(navigating&&!navPointer\)\|\|!live\(\)/,'and shown when pointing');
  assert.match(classroom,/shiftNav=true;applyNavigation\(\)/);
  // Select still never shows the teacher's pointer
  assert.match(classroom,/\['eraser','select'\]\.includes\(\$\('teacherTool'\)\.value\)\)\{hideOwnPointer\(\);return\}/);
});
