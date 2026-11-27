const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const SC = require('../teacher-site-class.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const memory = () => { const m = new Map(); return { localStorage: { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) } }; };

test('the class is remembered per teacher account and the last chooser is known before sign-in', () => {
  const w = memory();
  assert.equal(SC.get('', w), '');
  assert.equal(SC.set('uidA', 'et', w), true);
  assert.equal(SC.set('uidB', 'wt', w), true);
  assert.equal(SC.get('uidA', w), 'et');
  assert.equal(SC.get('uidB', w), 'wt');
  assert.equal(SC.get('', w), 'wt', 'the page opens on whoever chose last until sign-in finishes');
  assert.equal(SC.set('uidA', '../x', w), false);
  assert.equal(SC.set('', 'et', w), false);
});

test('"all" is remembered, and never overwrites the page confirm class', () => {
  const w = memory();
  SC.set('u', 'et', w); SC.set('u', 'all', w);
  assert.equal(SC.get('u', w), 'all');
  assert.equal(w.localStorage.getItem('b3LastConfirmedClass'), 'et');
});

test('teacher pages get the remembered class; a ?class= link always wins; other pages are never touched', () => {
  assert.equal(SC.plan('/rashi-letters/teacher.html', '', 'et'), '?class=et');
  assert.equal(SC.plan('/shorashim/teacher.html', '?x=1', 'wt'), '?x=1&class=wt');
  assert.equal(SC.plan('/rashi-letters/teacher.html', '?class=wt', 'et'), null);
  assert.equal(SC.plan('/rashi-letters/student.html', '', 'et'), null, 'student pages never get a class');
  assert.equal(SC.plan('/index.html', '', 'et'), null);
  assert.equal(SC.plan('/class-pointer-prototype/classroom.html', '', 'et'), null, 'students join the pointer room');
  assert.equal(SC.plan('/class-pointer-prototype/classroom.html', '?dashboard=teacher', 'et'), '?dashboard=teacher&class=et');
  assert.equal(SC.plan('/preview/x/chazara/teacher.html', '', 'et'), '?class=et', 'also under a preview folder');
  assert.equal(SC.plan('/rashi-letters/teacher.html', '', '../bad'), null);
});

test('"All my classes" is added only where the page understands it (Chazara)', () => {
  assert.equal(SC.plan('/chazara/teacher.html', '', 'all'), '?class=all');
  assert.equal(SC.plan('/rashi-letters/teacher.html', '', 'all'), null);
  assert.equal(SC.relink('https://s.test/rashi-letters/teacher.html?class=et', 'all'), 'https://s.test/rashi-letters/teacher.html');
  assert.equal(SC.relink('https://s.test/chazara/teacher.html?class=et', 'all'), 'https://s.test/chazara/teacher.html?class=all');
  assert.equal(SC.relink('https://s.test/rashi-letters/teacher.html?tab=x', 'wt'), 'https://s.test/rashi-letters/teacher.html?tab=x&class=wt');
});

test('the same class names everywhere: B3 ET and B3 WT', () => {
  assert.equal(SC.label('et', 'ET'), 'B3 ET');
  assert.equal(SC.label('wt', 'Class WT'), 'B3 WT');
  assert.equal(SC.label('kita_a', 'Class B3 Alef'), 'B3 Alef');
  assert.equal(SC.label('kita_b', ''), 'kita_b');
});

test('every teacher page in the list exists, and the wiring is in place', () => {
  for (const page of SC.PAGES) assert.ok(fs.existsSync(path.join(__dirname, '..', page)), page + ' must exist');
  assert.match(read('firebase-config.js'), /b3SiteClassLast[\s\S]*teacher-site-class\.js/);
  assert.match(read('teacher-home.html'), /teacher-site-class\.js/);
  assert.match(read('teacher-global-controls.js'), /All my classes/);
  assert.match(read('class-confirm-gate.js'), /B3SiteClass/);
});
