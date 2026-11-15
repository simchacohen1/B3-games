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
  assert.match(s, /classUrl\('follow-teacher\/teacher\.html', id, \{embed:'1'\}\)/);
  // Since 212bbd98 the embedded Follow panel keeps its own class selector enabled.
  assert.match(read('follow-teacher/teacher.js'), /q\('classSelect'\)\.disabled = false;/);
});

test('loader reaches normal Firebase pages and standalone teacher pages', () => {
  assert.match(read('firebase-config.js'), /gallery-share\.js/);
  assert.match(read('gallery-share.js'), /teacher-global-controls\.js/);
  for (const p of ['admin.html','sync-to-nigri/index.html','all-pages.html']) {
    assert.match(read(p), /teacher-global-bootstrap\.js/, p);
  }
});

test('a button press is never silent: with no class chosen it asks which class (issue 769)', () => {
  const s = read('teacher-global-controls.js');
  // All three buttons, on tool pages and on the owner home bar, go through act().
  assert.match(s, /lock\.addEventListener\('click', function\(\)\{ act\('access'\); \}\)/);
  assert.match(s, /follow\.addEventListener\('click', function\(\)\{ act\('follow'\); \}\)/);
  assert.match(s, /pointer\.addEventListener\('click', function\(\)\{ act\('pointer'\); \}\)/);
  assert.match(s, /homeFollow\.addEventListener\('click',function\(\)\{act\('follow'\);\}\)/);
  assert.match(s, /homePointer\.addEventListener\('click',function\(\)\{act\('pointer'\);\}\)/);
  assert.match(s, /if \(!resolveClass\(\)\) \{ askClass\(which\); return; \}/);
  assert.match(s, /Which class\?/);
  // The Class Pointer button is shown to every signed-in teacher, not only once a class is chosen.
  assert.match(s, /var ok = authorized && classes\.length > 0;/);
  // The Yiddish app defines its own global open(), which replaces window.open there.
  assert.doesNotMatch(s, /window\.open\(/);
  assert.match(s, /link\.target = name;/);
  // Still never picks between several classes by itself.
  assert.match(s, /classes\.length === 1/);
  assert.match(s, /selected = ids\.includes\(requested\) \? requested : '';/);
});

test('pages fetch the fixed toolbar, not a cached older copy', () => {
  const version = /teacher-global-controls\.js\?v=20261110-buttons1/;
  assert.match(read('gallery-share.js'), version);
  assert.match(read('teacher-global-bootstrap.js'), version);
  assert.match(read('firebase-config.js'), /gallery-share\.js\?v=20261110-buttons1/);
});
