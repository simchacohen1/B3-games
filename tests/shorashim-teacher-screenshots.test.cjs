'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ui=fs.readFileSync('shorashim/teacher-screenshot.js','utf8');
const teacher=fs.readFileSync('shorashim/teacher.html','utf8');
const student=fs.readFileSync('shorashim/app.js','utf8');
const studentHtml=fs.readFileSync('shorashim/index.html','utf8');
const rules=fs.readFileSync('storage-rules.hardened.rules','utf8');

test('teacher screenshot uploader JavaScript parses and is loaded only on teacher page',()=>{
  assert.doesNotThrow(()=>new vm.Script(ui));
  assert.match(teacher,/firebase-storage-compat\.js/);
  assert.ok(teacher.indexOf('teacher.js?v=') < teacher.indexOf('teacher-screenshot.js?v='));
  assert.ok(teacher.indexOf('firebase-storage-compat.js') < teacher.indexOf('teacher-screenshot.js?v='));
  assert.doesNotMatch(studentHtml,/teacher-screenshot\.js/);
});

test('uploads require existing teacher authorization and current verified owner identity',()=>{
  assert.match(ui,/activeTeacherAccess\?\.authorized/);
  assert.match(ui,/user\?\.emailVerified/);
  assert.match(ui,/user\.email === 'simcha5770@gmail\.com'/);
  assert.match(ui,/if \(!item \|\| !allowedTeacher\(\)\) return/);
  assert.match(ui,/First unselect one of the four pictures/);
  assert.match(ui,/\.find\(x => x\.type\.startsWith\('image\/'\)\)/);
  assert.match(ui,/fileInput\.accept = INPUT_TYPES\.join/);
  assert.match(ui,/canvas\.toBlob/);
  assert.match(ui,/URL\.revokeObjectURL/);
  assert.match(ui,/await saveCatalog\(\)/);
  assert.match(ui,/item\.art = previousArt/);
});

test('Storage change permits only approved teacher uploads and never student write',()=>{
  const section=rules.slice(rules.indexOf('match /shorashim-teacher-pictures'),rules.indexOf('match /shorashim-recordings'));
  assert.match(section,/request\.auth\.uid == ownerUid/);
  assert.match(section,/request\.auth\.token\.email_verified == true/);
  assert.match(section,/request\.resource\.size < 2 \* 1024 \* 1024/);
  assert.match(section,/image\/\(png\|webp\)/);
  assert.match(section,/allow update, delete: if false/);
  assert.doesNotMatch(section,/b3StudentRole/);
});

test('student only treats same-bucket screenshot links as safe illustration options',()=>{
  const source=student.split(/\r?\n/).find(x=>x.startsWith('function isTeacherScreenshotArt('));
  assert.ok(source);
  const ctx=vm.createContext({URL});
  vm.runInContext(source,ctx);
  assert.equal(ctx.isTeacherScreenshotArt('https://firebasestorage.googleapis.com/v0/b/b3-games.firebasestorage.app/o/shorashim-teacher-pictures%2Fabc%2F1.webp?alt=media&token=123'),true);
  assert.equal(ctx.isTeacherScreenshotArt('javascript:alert(1)'),false);
  assert.equal(ctx.isTeacherScreenshotArt('https://example.com/image.png'),false);
  assert.equal(ctx.isTeacherScreenshotArt('https://firebasestorage.googleapis.com/v0/b/b3-games.firebasestorage.app/o/shorashim-recordings%2F1.webm'),false);
  assert.match(student,/addArtToEditor\(\{kind:'illustration',value,label:'Teacher screenshot'\}\)/);
  assert.match(studentHtml,/app\.js\?v=20261019-teacher-screenshots/);
});
