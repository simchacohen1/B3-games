// The staging check for the Class Pointer teacher dashboard's fictional data: it must find every gap
// and only ever fill blanks (never overwrite), and it must stay locked to the staging project.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { diagnose, spawnOptions, PROJECT } = require('../staging/class-pointer-test-data.cjs');

const ws = 'b3-2026', uid = 'uidA';
const role = { email: 'teacher.alef@funtorahtools-staging.test', displayName: 'Test Teacher Alef', classId: 'TEST-ALEF', className: 'Test Class Alef',
  students: [{ id: 's1', name: 'Test Student A1' }, { id: 's2', name: 'Test Student A2' }] };
const good = () => ({
  teacher: { uid, active: true, classIds: { 'TEST-ALEF': true } },
  cls: { active: true, toolGrants: { 'class-pointer': true }, teacherIds: { [uid]: true }, members: { s1: { active: true }, s2: { active: true } } },
  students: { s1: { profile: {}, membership: {} }, s2: { profile: {}, membership: {} } }, passcodes: { s1: true, s2: true }
});
const run = have => diagnose({ workspaceId: ws, role, uid, have });

test('complete data: no problems, nothing to write', () => {
  const r = run(good()); assert.deepEqual(r.problems, []); assert.deepEqual(r.patch, {});
});
test('nothing seeded: finds every gap and writes one non-overlapping update', () => {
  const r = run({ teacher: null, cls: null, students: {}, passcodes: {} });
  const paths = Object.keys(r.patch);
  assert.ok(r.problems.length >= 6);
  assert.equal(r.patch['b3Games/workspaces/b3-2026/classes/TEST-ALEF'].toolGrants['class-pointer'], true);
  assert.deepEqual(Object.keys(r.patch['b3Games/workspaces/b3-2026/classes/TEST-ALEF'].members), ['s1', 's2']);
  for (const a of paths) for (const b of paths) if (a !== b) assert.ok(!b.startsWith(a + '/'), a + ' overlaps ' + b);
  assert.ok(r.problems.some(p => /no passcode/.test(p)) && !paths.some(p => /passcode/i.test(p)), 'passcodes are reported, never written');
});
test('teacher inactive, class tool off, student missing: fills only those blanks', () => {
  const h = good(); h.teacher.active = false; delete h.cls.toolGrants['class-pointer']; delete h.cls.members.s2;
  const r = run(h);
  assert.deepEqual(Object.keys(r.patch).sort(), [
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF/members/s2',
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF/toolGrants/class-pointer',
    'b3Games/workspaces/b3-2026/teachers/uidA/active'].sort());
});
test('never overwrites: existing values and other classes are left alone', () => {
  const h = good(); h.teacher.classIds = { 'OTHER': true };
  const r = run(h);
  assert.deepEqual(Object.keys(r.patch), ['b3Games/workspaces/b3-2026/teachers/uidA/classIds/TEST-ALEF']);
});
test('locked to the staging project and never prints credentials', () => {
  assert.equal(PROJECT, 'fun-torah-tools-staging');
  const src = fs.readFileSync('staging/class-pointer-test-data.cjs', 'utf8');
  assert.doesNotMatch(src, /b3-games\.firebaseio|b3-games-default-rtdb|b3-games\.firebaseapp/);
  assert.doesNotMatch(src, /console\.log\([^)]*(password|passcode\b)/i);
});

test('gcloud is started through a shell on Windows only (gcloud.cmd), never on Mac/Linux', () => {
  assert.equal(spawnOptions('win32').shell, true);
  assert.equal(spawnOptions('linux').shell, false);
  assert.equal(spawnOptions('darwin').shell, false);
});
