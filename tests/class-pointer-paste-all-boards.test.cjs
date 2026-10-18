'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/student-boards.js'),'utf8');
test('Paste to All Boards offers a preview and an explicit send',()=>{
  assert.match(s,/Paste to All Boards/);
  assert.match(s,/Preview paste to all whiteboards/);
  assert.match(s,/pendingPaste=value/);
  assert.match(s,/if\(item.kind==='image'\)await sendImageFile\(item.file\)/);
  assert.match(s,/sendActivity\(\{kind:'word',text:item.text/);
});
test('Paste action uses browser clipboard and includes Ctrl+V fallback',()=>{
  assert.match(s,/navigator.clipboard\?\.read/);
  assert.match(s,/navigator.clipboard\?\.readText/);
  assert.match(s,/press Ctrl\+V to paste instead/);
});
test('Paste accepts common images but not untrusted HTML',()=>{
  assert.match(s,/image\\\/\(png\|jpeg\|webp\|gif\)/);
  assert.doesNotMatch(s,/clipboard\.readHTML|clipboard\.write/);
});
