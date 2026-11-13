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
// Reading the clipboard now lives in one shared place (board-clipboard.js) for every whiteboard.
const clip=fs.readFileSync(path.join(__dirname,'../class-pointer-prototype/board-clipboard.js'),'utf8');
test('Paste action uses browser clipboard and includes Ctrl+V fallback',()=>{
  assert.match(s,/Clip\.pasteInto\(classTarget\)/);
  assert.match(clip,/clipboard\.read\(\)/);
  assert.match(clip,/clipboard\.readText\(\)/);
  assert.match(clip,/Click on the whiteboard, then press '\+KEY\+'\+V\./);
});
test('Paste accepts common images but not untrusted HTML',()=>{
  assert.match(clip,/entry\.types\.find/);
  assert.match(clip,/png\|jpeg\|webp\|gif/);
  // Copied web content is only ever read as plain words; it is never put into the page.
  assert.doesNotMatch(clip,/innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(s,/clipboard\.readHTML|clipboard\.write/);
});
test('Ctrl+V and the button share one preview, and long words are never silently cut',()=>{
  assert.doesNotMatch(s,/slice\(0,80\)\}\);return\}/);
  assert.doesNotMatch(s,/addEventListener\('paste'/);
  assert.match(s,/payload\.text\.length<=80&&!payload\.text\.includes\('\\n'\)/);
  assert.match(s,/too long for one class word, so they will be sent as a picture/);
});
