'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','class-pointer-prototype');
const navigation=fs.readFileSync(path.join(root,'workspace-layout.js'),'utf8');
const gallery=fs.readFileSync(path.join(root,'student-boards.js'),'utf8');
const sessions=fs.readFileSync(path.join(root,'dashboard-session.js'),'utf8');

test('tabs use repeatable workspace navigation, never click hidden gallery controls',()=>{
  assert.match(navigation,/ClassPointerBoards\?\.navigateWorkspace/);
  assert.match(navigation,/navigate\(id\)!==true/);
  assert.doesNotMatch(navigation,/chooser\.click\(\)|boards\.click\(\)|launch\.click\(\)/);
});
test('Student screens and whiteboards both route through the same explicit gallery transition',()=>{
  assert.match(gallery,/navigateWorkspace\(destination\)/);
  assert.match(gallery,/sendEveryone\(destination==='screens'\?'screens':'boards'\)/);
  assert.match(gallery,/hideWorkspace\(\)/);
});
test('switching to My screen hides boards without ending sharing or clearing board data',()=>{
  assert.match(gallery,/suspended=true;view\.hidden=true/);
  assert.match(gallery,/screenPermissionEnabled/);
  assert.match(gallery,/if\(!on\|\|suspended\|\|excluded\(m,mode\)\)/);
  assert.match(gallery,/if\(revision!==workspaceRevision\)return/);
});
test('whiteboard request preserves an already-approved Entire Screen share',()=>{
  assert.match(sessions,/\.\.\.\(mode==='screens'\?\{studentScreenSharing:true\}:\{\}\)/);
  assert.doesNotMatch(sessions,/studentScreenSharing:mode==='screens'/);
});
test('teacher tabs never bypass capture consent or student permission checks',()=>{
  assert.doesNotMatch(navigation,/getDisplayMedia|classPointerShareAuth|permissionRevision/);
});
