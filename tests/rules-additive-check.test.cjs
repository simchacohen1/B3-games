'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { compare, parse, stripComments } = require('../scripts/rules-additive-check.cjs');

// Snapshot of the rules on main (the live baseline) before the Pointer release.
const live = () => parse(fs.readFileSync('tests/fixtures/firebase-rules.main-20261017.json', 'utf8'));
const candidate = () => JSON.parse(fs.readFileSync('firebase-rules.json', 'utf8'));
// b3Quiz was tightened in its own reviewed step (see tests/b3-quiz-rules-emulator.test.cjs); the Pointer additive check ignores it.
const additiveView = () => { const c = candidate(); c.rules.b3Quiz = live().rules.b3Quiz; return c; };

test('firebase-rules.json is the main/live baseline plus only approved additions', () => {
  assert.deepEqual(compare(live(), additiveView()), []);
});
test('the additive-step CLI config deploys firebase-rules.json, never the hardened file', () => {
  const cfg = JSON.parse(fs.readFileSync('firebase.pointer-additive.json', 'utf8'));
  assert.equal(cfg.database.rules, 'firebase-rules.json');
  assert.deepEqual(Object.keys(cfg), ['database']);
});
test('a changed existing rule is caught', () => {
  const c = candidate(); c.rules.b3Games.siteSettings = { '.read': false };
  assert.ok(compare(live(), c).some(p => p.startsWith('CHANGED') || p.startsWith('REMOVED')));
});
test('removing the blanket b3Games read without its $other replacement is caught', () => {
  const c = candidate(); delete c.rules.b3Games.$other;
  assert.ok(compare(live(), c).some(p => p.includes('REMOVED') && p.includes('/b3Games/.read')));
});
test('the student-records step must match exactly: a weaker $other or student read is caught', () => {
  const c = candidate(); c.rules.b3Games.$other['.write'] = true;
  assert.ok(compare(live(), c).some(p => p.startsWith('ADDED') && p.includes('/b3Games/$other')));
  const d = candidate(); d.rules.b3Games.students.$studentId['.read'] = 'auth != null';
  assert.ok(compare(live(), d).some(p => p.startsWith('ADDED') && p.includes('/b3Games/students/$studentId/.read')));
});
test('an unapproved new top-level node is caught', () => {
  const c = candidate(); c.rules.somethingNew = { '.read': true };
  assert.ok(compare(live(), c).some(p => p.startsWith('ADDED') && p.includes('/somethingNew')));
});
test('live rules that predate the Halacha Siman rule accept the approved multiplayer and Pointer additions', () => {
  const l = live();
  delete l.rules.b3Games.workspaces.$workspaceId.classes.$classId.halachaAccess;
  assert.deepEqual(compare(l, additiveView()), []);
});
test('another unapproved addition next to halachaAccess is still caught', () => {
  const l = live();
  delete l.rules.b3Games.workspaces.$workspaceId.classes.$classId.halachaAccess;
  const c = candidate(); c.rules.b3Games.workspaces.$workspaceId.classes.$classId.somethingElse = { '.write': true };
  assert.ok(compare(l, c).some(p => p.startsWith('ADDED') && p.includes('/somethingElse')));
});
test('the approved recording-link tightening must match exactly; any other value is caught', () => {
  const c = candidate(); c.rules.posukPractice.attempts['.read'] = 'auth != null';
  assert.ok(compare(live(), c).some(p => p.startsWith('CHANGED') && p.includes('/posukPractice/attempts/.read')));
  const d = candidate(); d.rules.posukPractice.attempts.$studentId['.read'] = true;
  assert.ok(compare(live(), d).some(p => p.startsWith('ADDED') && p.includes('/posukPractice/attempts/$studentId/.read')));
});
test('console-style comments in a saved live rules file are tolerated', () => {
  const text = '// saved from console\n{"rules": {/* x */ ".read": false, "a": {"b": "has // inside"}}}';
  assert.deepEqual(parse(text), { rules: { '.read': false, a: { b: 'has // inside' } } });
  assert.equal(stripComments('"//keep"'), '"//keep"');
});
