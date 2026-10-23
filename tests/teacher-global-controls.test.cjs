const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('shared teacher toolbar and loaders have valid JS syntax', () => {
  ['teacher-global-controls.js','teacher-global-bootstrap.js','gallery-share.js','follow-teacher/teacher.js'].forEach(p => {
    assert.doesNotThrow(() => new vm.Script(read(p), { filename:p }));
  });
});

test('toolbar only initializes for verified teachers and never in embedded student demo pages', () => {
  const s = read('teacher-global-controls.js');
  assert.match(s, /window\.self !== window\.top/);
  assert.match(s, /API\.onAuthStateChanged\(onAuth\)/);
  assert.match(s, /access\.authorized/);
  assert.match(s, /access\.role !== 'admin' && access\.role !== 'teacher'/);
  assert.match(s, /API\.getActingStudent && API\.getActingStudent\(\)/);
  assert.match(s, /access\.classIds\|\|\[\]/);
  assert.match(s, /all\[id\]\.active !== false/);
});

test('class selection and lock reuse existing controls, no new lock database writes', () => {
  const s = read('teacher-global-controls.js');
  assert.match(s, /b3ControlClass/);
  assert.match(s, /homeClassBar/);
  assert.match(s, /admin\.html/);
  assert.match(s, /tab:'access',embed:'1'/);
  assert.doesNotMatch(s, /updateClassMode|\.ref\(\)\.update\(/);
});

test('Follow can be opened and closed without removing its iframe, and standalone window is available', () => {
  const s = read('teacher-global-controls.js');
  assert.match(s, /activePanel === which/);
  assert.match(s, /modal\.hidden = true/);
  assert.match(s, /lastFollowClass !== id/);
  assert.match(s, /Follow the Teacher controls/);
  assert.match(s, /Separate window/);
});

test('loader reaches normal Firebase pages and standalone teacher pages', () => {
  assert.match(read('firebase-config.js'), /gallery-share\.js/);
  assert.match(read('gallery-share.js'), /teacher-global-controls\.js/);
  for (const p of ['admin.html','sync-to-nigri/index.html','all-pages.html']) {
    assert.match(read(p), /teacher-global-bootstrap\.js/, p);
  }
});
