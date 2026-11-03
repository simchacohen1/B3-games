'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'class-pointer-prototype',name),'utf8');

test('whiteboards open over the student learning activity',()=>{
  const activity=read('activity-share.js'),boards=read('student-boards.js');
  assert.ok(activity.includes('embeddedStage:boardStage'));
  assert.ok(activity.includes('ClassPointerBoards?.fromTeacher(message)'));
  assert.ok(boards.includes("show(on&&!(B.embedded&&mode==='screens'))"));
  assert.ok(!activity.includes('location.assign('),'whiteboards must not redirect to another tab');
});

test('screen requests do not add a dialog over whiteboard or activity',()=>{
  const activity=read('activity-share.js');
  for(const old of ['fttShareRequestOverlay','routeTeacherRequest','Open Sharing Window'])assert.ok(!activity.includes(old));
  assert.ok(activity.includes("holder.style.display=active?'flex':'none'"));
  assert.ok(activity.includes("btn.addEventListener('click',beginShare)"));
});

test('whiteboard denial remains enforced by authenticated teacher mode',()=>{
  const boards=read('student-boards.js');
  assert.ok(boards.includes('excluded(m,mode)'));
  assert.ok(boards.includes('denied={screens:new Set(),boards:new Set()}'));
});
