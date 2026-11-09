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
  assert.deepEqual(await S.getStudentClassIds(db, 'b3-2026', 's1', 'et'), ['c1']);
  assert.deepEqual(await S.getStudentClassIds(null, 'b3-2026', 's1', 'et'), ['et']);
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
