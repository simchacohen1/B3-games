const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const script=fs.readFileSync('class-pointer-prototype/activity-share.js','utf8');
const page=fs.readFileSync('class-pointer-prototype/share-window.html','utf8');
test('student sharing uses a persistent companion window',()=>{
  assert.match(script,/window\.open\(url\.href,'fttStudentShareWindow'/);
  assert.match(script,/if\(!isCompanion\)/);
  assert.match(page,/activity-share\.js/);
  assert.match(page,/fttShareCompanion=1/);
});
test('display capture permits full screen selection',()=>{
  assert.match(script,/getDisplayMedia/);
  assert.match(script,/preferCurrentTab:false/);
  assert.doesNotMatch(script,/displaySurface:'browser'/);
});
