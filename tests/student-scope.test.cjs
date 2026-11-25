'use strict';
// Students in schools and classes (owner-managed record, no names).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../student-scope.js');

const classes = () => ({
  c1: { name: 'Chumash A', active: true, schoolId: 'negri', members: { s1: { name: 'Sam One', active: true }, s2: { name: 'Dina Two', active: true } } },
  c2: { name: 'Mishnayos', active: true, schoolId: 'negri', members: { s1: { name: 'Sam One', active: true } } },
  c3: { name: 'Other School', active: true, schoolId: 'other', members: { s2: { name: 'Dina Two', active: true }, s3: { name: 'Gone', active: false } } },
  c4: { name: 'No School', active: true, members: { s4: { name: 'Avi Four', active: true }, demo_abc: { name: 'T (demo)', active: true, demo: true } } },
  c5: { name: 'Closed', active: false, schoolId: 'negri', members: { s1: { name: 'Sam One', active: true } } }
});

test('roster lists active students with their classes, skipping inactive members, demos and closed classes', () => {
  const r = S.rosterStudents(classes());
  assert.deepEqual(Object.keys(r).sort(), ['s1', 's2', 's4']);
  assert.deepEqual(r.s1, { name: 'Sam One', classIds: { c1: true, c2: true } });
  assert.deepEqual(r.s2.classIds, { c1: true, c3: true });
});

test('class picker offers only classes from the student\'s own school', () => {
  assert.deepEqual(S.classesForSchool(classes(), 'negri'), ['c1', 'c2']);
  assert.deepEqual(S.classesForSchool(classes(), 'other'), ['c3']);
  assert.deepEqual(S.classesForSchool(classes(), ''), []);
});

test('changing school keeps classes in the new school and removes the rest', () => {
  const plan = S.planSchoolChange({ c1: true, c3: true }, classes(), 'other');
  assert.deepEqual(plan, { keep: { c3: true }, remove: ['c1'] });
});

test('import sets up only students without a record, using one school when their classes agree', () => {
  const plan = S.planImport(S.rosterStudents(classes()), { s4: { schoolId: '', classIds: {} } }, classes(), 123);
  assert.deepEqual(plan.created, ['s1', 's2']);
  assert.deepEqual(plan.updates.s1, { schoolId: 'negri', classIds: { c1: true, c2: true }, updatedAt: 123 });
  assert.equal(plan.updates.s2.schoolId, null, 'classes in two schools: owner chooses');
  assert.deepEqual(plan.noSchool, ['s2']);
});

test('records never carry a name (b3Games/workspaces is publicly readable)', () => {
  const plan = S.planImport(S.rosterStudents(classes()), {}, classes(), 1);
  for (const rec of Object.values(plan.updates)) assert.deepEqual(Object.keys(rec).sort(), ['classIds', 'schoolId', 'updatedAt']);
  assert.deepEqual(S.normalizeRecord({ name: 'Leak', schoolId: 'negri', classIds: { c1: true, c9: false, 'bad/id': true } }), { schoolId: 'negri', classIds: { c1: true } });
  const src = fs.readFileSync(path.join(__dirname, '..', 'student-scope.js'), 'utf8');
  assert.doesNotMatch(src, /\/name'\]\s*=/, 'no writes of a name field');
});

test('a school in use by classes or students cannot be deleted', () => {
  assert.deepEqual(S.countSchoolUse('negri', classes(), { s1: { schoolId: 'negri' }, s2: { schoolId: 'other' } }), { classes: 3, students: 1 });
  assert.deepEqual(S.classesWithoutSchool(classes()), ['c4']);
});

test('database helpers write only schoolId, classIds and updatedAt under the student record', async () => {
  const writes = [];
  const db = { ref: p => ({ update: async u => writes.push(u), once: async () => ({ val: () => ({ classIds: { c1: true } }) }) }) };
  await S.saveSchool(db, 'b3-2026', 's1', 'negri', { c1: true }, 9);
  await S.setStudentClass(db, 'b3-2026', 's1', 'c2', false, 10);
  assert.deepEqual(writes[0], { 'b3Games/workspaces/b3-2026/students/s1/schoolId': 'negri', 'b3Games/workspaces/b3-2026/students/s1/classIds': { c1: true }, 'b3Games/workspaces/b3-2026/students/s1/updatedAt': 9 });
  assert.deepEqual(writes[1], { 'b3Games/workspaces/b3-2026/students/s1/classIds/c2': null, 'b3Games/workspaces/b3-2026/students/s1/updatedAt': 10 });
  await assert.rejects(S.setStudentClass(db, 'b3-2026', 's1', '../x', true, 1));
  assert.deepEqual(await S.getStudentClassIds(null, 'b3-2026', 's1', 'et'), ['et']);
});

test('student classes come from the authoritative memberships, not the owner copy', async () => {
  const data = {
    'b3Games/students/s1/memberships': { a: { workspaceId: 'b3-2026', classId: 'c1', active: true }, b: { workspaceId: 'b3-2026', classId: 'c2', active: true }, c: { workspaceId: 'b3-2026', classId: 'c3', active: false }, d: { workspaceId: 'other', classId: 'c4', active: true } },
    'b3Games/students/s2/memberships': { a: { workspaceId: 'b3-2026', classId: 'et', active: false } },
    'b3Games/workspaces/b3-2026/students/s1': { classIds: { stale: true } }
  };
  const reads = [];
  const db = { ref: p => ({ once: async () => { reads.push(p); return { val: () => data[p] || null }; } }) };
  assert.deepEqual(await S.getStudentClassIds(db, 'b3-2026', 's1', 'et'), ['c1', 'c2']);
  assert.ok(!reads.includes('b3Games/workspaces/b3-2026/students/s1'));
  assert.deepEqual(await S.getStudentClassIds(db, 'b3-2026', 's2', 'et'), [], 'removed on purpose stays removed');
  assert.deepEqual(await S.getStudentClassIds(db, 'b3-2026', 'new', 'et'), ['et']);
});

test('owner panel and sign-in wiring', () => {
  const owner = fs.readFileSync(path.join(__dirname, '..', 'owner-admin.html'), 'utf8');
  assert.match(owner, /<script src="student-scope\.js[^"]*"><\/script>/);
  assert.match(owner, /B3StudentScope\.classesForSchool\(classData,school\)/, 'students see only their school\'s classes');
  assert.match(owner, /manageStudent\(on\?"add":"remove",cid,id\)/, 'class ticks go through the trusted function');
  const home = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(home, /if\(!testLink&&choices\.length>1\)\{\s*const picked=await chooseStudentClass\(choices,r\.name\)/);
  assert.match(home, /choices:studentClassChoices\.slice\(\)\}/);
  assert.match(home, /<div id="classPick"/);
});

// ---- moving a class brings its people ---------------------------------------
const moveClasses = () => ({
  g6: { name: 'G6 CT', schoolId: 'negri', teacherIds: { uT: true }, members: { a: { active: true }, b: { active: true }, gone: { active: false } } },
  g7: { name: 'G7', schoolId: 'negri', teacherIds: { uT: true }, members: { c: { active: true } } },
  stay: { name: 'Stays', schoolId: 'negri', teacherIds: { uS: true }, members: { d: { active: true } } }
});
const moveInvites = () => ({
  t1: { name: 'Chani', claimedUid: 'uT', schoolId: 'negri', classIds: { g6: true } },
  t2: { name: 'Other', claimedUid: 'uS', schoolId: 'negri', classIds: { stay: true } },
  p1: { name: 'Principal', accountType: 'principal', schoolId: 'negri', classIds: { g6: true } }
});
const moveRecords = () => ({ a: { schoolId: 'negri', classIds: { g6: true } }, b: { schoolId: 'negri', classIds: { g6: true } }, c: { schoolId: 'negri', classIds: { g7: true } } });

test('moving a class moves its active students and its teachers, class last, and resets the Nigri login', () => {
  const p = S.planClassMove('g6', moveClasses(), moveInvites(), moveRecords(), {}, 'girls', 99);
  assert.equal(p.ok, true);
  assert.deepEqual(p.students, ['a', 'b']);
  assert.deepEqual(p.teachers, ['t1']);
  assert.equal(p.updates['teacherInvites/t1/schoolId'], 'girls');
  assert.equal(p.updates['teacherInvites/t1/nigriLoginResetAt'], 99);
  assert.equal(p.updates['students/a/schoolId'], 'girls');
  assert.deepEqual(p.updates['students/a/classIds'], { g6: true });
  assert.equal(p.updates['teacherInvites/p1/schoolId'], undefined);
  assert.equal(p.updates['students/gone/schoolId'], undefined);
  const keys = Object.keys(p.updates);
  assert.equal(keys[keys.length - 1], 'classes/g6/schoolId');
});

test('classes that share a teacher move together; moving only one is blocked and names the other', () => {
  const inv = moveInvites(); inv.t1.classIds = { g6: true, g7: true };
  const one = S.planClassMove('g6', moveClasses(), inv, moveRecords(), {}, 'girls', 7);
  assert.equal(one.ok, false);
  assert.deepEqual(one.blockers.teachers[0].classIds, ['g7']);
  const both = S.planClassMove(['g6', 'g7'], moveClasses(), inv, moveRecords(), {}, 'girls', 7);
  assert.equal(both.ok, true);
  assert.deepEqual(both.students, ['a', 'b', 'c']);
  assert.deepEqual(both.teachers, ['t1']);
  assert.equal(both.updates['classes/g7/schoolId'], 'girls');
  assert.equal(Object.keys(both.updates).filter(k => k.startsWith('teacherInvites/t1/')).length, 2);
});

test('a teacher also on a class that stays blocks the move and writes nothing', () => {
  const classes = moveClasses(); classes.stay.teacherIds.uT = true;
  const inv = moveInvites(); inv.t1.classIds.stay = true;
  const p = S.planClassMove('g6', classes, inv, moveRecords(), {}, 'girls', 1);
  assert.equal(p.ok, false);
  assert.deepEqual(p.blockers.teachers.map(t => [t.inviteId, t.classIds]), [['t1', ['stay']]]);
  assert.deepEqual(p.updates, {});
});

test('a student also in a class that stays (by real membership) blocks the move', () => {
  const p = S.planClassMove('g6', moveClasses(), moveInvites(), moveRecords(), { a: ['g6', 'stay'] }, 'girls', 1);
  assert.equal(p.ok, false);
  assert.deepEqual(p.blockers.students, [{ studentId: 'a', classIds: ['stay'] }]);
});

test('a student with no owner record gets one, and a class already in the target school adds no reset', () => {
  const c = moveClasses(); c.g6.schoolId = 'girls';
  const p = S.planClassMove('g6', c, moveInvites(), {}, {}, 'girls', 5);
  assert.equal(p.ok, true);
  assert.deepEqual(p.updates['students/a/classIds'], { g6: true });
  assert.equal(p.updates['students/a/schoolId'], 'girls');
});
