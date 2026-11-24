'use strict';
// Classes & Students page helpers (class-roster-tools.js) and the smarter CSV import (bulk-roster.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../class-roster-tools.js');
const B = require('../bulk-roster.js');

test('pasted list: one name per line, sheet cells, numbering and duplicates are cleaned', () => {
  const out = R.parsePastedNames('Name\r\nMoshe Birk\r\n2. Chaim\tExample\t123456\r\n"Birk, Dovid"\r\n\r\nmoshe  birk\r\n- Levi Cohen\r\nx@y.com\r\n');
  assert.deepEqual(out.names, ['Moshe Birk', 'Chaim Example', 'Dovid Birk', 'Levi Cohen']);
  assert.equal(out.duplicates, 1);
});

test('matching: exact is a match, similar names ask, new names are new', () => {
  const people = [{ id: 'a', name: 'Mendy Steiger' }, { id: 'b', name: 'Lipa Bitton' }, { id: 'c', name: 'Lipa Bitton' }, { id: 'd', name: 'Shneur Zalman Zwiebel' }];
  assert.deepEqual(R.matchPerson('mendy  steiger', people).status, 'match');
  assert.equal(R.matchPerson('mendy steiger', people).id, 'a');
  assert.equal(R.matchPerson('Steiger Mendy', people).status, 'ask');          // same words, other order
  assert.equal(R.matchPerson('Mendi Steiger', people).status, 'ask');          // one letter off
  assert.equal(R.matchPerson('Lipa Bitton', people).status, 'ask');            // two boys with this name
  assert.equal(R.matchPerson('Lipa Bitton', people).candidates.length, 2);
  assert.equal(R.matchPerson('Zalman Zwiebel', people).status, 'ask');         // one contains the other
  assert.equal(R.matchPerson('Dovid Levi', people).status, 'none');
});

test('suggestions find names by any typed words', () => {
  const people = [{ id: 'a', name: 'Mendy Steiger' }, { id: 'b', name: 'Menachem Mendel Simmonds' }, { id: 'c', name: 'Lipa Bitton' }];
  assert.deepEqual(R.suggest('men', people).map(p => p.id).sort(), ['a', 'b']);
  assert.deepEqual(R.suggest('steig mend', people).map(p => p.id), ['a']);
  assert.deepEqual(R.suggest('', people), []);
});

test('random passcode is six digits', () => {
  for (let i = 0; i < 50; i++) assert.match(R.randomPasscode(), /^[1-9][0-9]{5}$/);
});

test('import: a missing Type column means students, with no error', () => {
  const parsed = B.parse('Name,Passcode,Classes\nMoshe Birk,482731,B2 ET\n');
  assert.equal(parsed.errors.length, 0);
  const plan = B.plan(parsed, ['B2 ET']);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.students.length, 1);
  assert.ok(plan.autoFixes.some(f => /No Type column/.test(f)));
});

test('import: class names differing only in spacing or capitals are matched to the site class', () => {
  const plan = B.plan(B.parse('Type,Name,Passcode,Classes\nStudent,Moshe Birk,482731,b2et; B3  wt\n'), ['B2 ET', 'B3 WT']);
  assert.equal(plan.errors.length, 0);
  assert.deepEqual(plan.students[0].classes, ['B2 ET', 'B3 WT']);
  assert.equal(plan.missingClasses.length, 0);
  assert.equal(plan.autoFixes.length, 2);
});

test('import: a missing class is offered, with near matches, and is created only when the owner says so', () => {
  const parsed = B.parse('Type,Name,Passcode,Classes\nStudent,Moshe Birk,482731,B6 WT\nStudent,Dovid Levi,111111,Brand New\n');
  const first = B.plan(parsed, ['B6 WT Boys', 'B5 ET']);
  assert.equal(first.errors.length, 0);
  assert.equal(first.students.length, 0, 'rows wait for the decision');
  const byName = Object.fromEntries(first.missingClasses.map(m => [m.name, m]));
  assert.deepEqual(byName['B6 WT'].suggestions, ['B6 WT Boys']);
  assert.deepEqual(byName['Brand New'].suggestions, []);
  const decided = B.plan(parsed, ['B6 WT Boys', 'B5 ET'], { classDecisions: { b6wt: { type: 'use', name: 'B6 WT Boys' }, brandnew: { type: 'create' } } });
  assert.equal(decided.missingClasses.length, 0);
  assert.deepEqual(decided.classesToCreate, ['Brand New']);
  assert.deepEqual(decided.students.map(s => s.classes), [['B6 WT Boys'], ['Brand New']]);
});

test('import: two site classes with one name no longer fail every row (the server lists the choices)', () => {
  const plan = B.plan(B.parse('Type,Name,Passcode,Classes\nStudent,Moshe Birk,482731,B6 WT\n'), ['B6 WT', 'B6 WT']);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.students.length, 1);
});

test('server: classes sharing a name are listed, and a pick resolves them', async () => {
  const core = require('../backend/functions/student-import-core.cjs');
  const staging = require('../backend/functions-staging/student-import-core.cjs');
  for (const mod of [core, staging]) {
    const classes = { b6_wt: { name: 'B6 WT', members: { s1: {} } }, b6_wt_8324: { name: 'B6 WT', teacherIds: { u1: true } }, other: { name: 'Other' } };
    const store = { get: async () => null, keys: async () => [] };
    const state = { classes, invites: {}, teachers: {}, profiles: {} };
    const input = { batchId: 'imp_0123456789abcdef', label: '', classes: [], staff: [], students: [{ key: 'np:a|111111', name: 'Aaa Bbb', passcode: '111111', rosterId: '', classes: ['B6 WT'], decision: null }], classPicks: {} };
    const open = await mod.buildPlan(store, input, state);
    assert.ok(open.errors.some(e => /more than one class|matches 2 classes/.test(e)));
    assert.equal(open.classChoices.length, 1);
    assert.deepEqual(open.classChoices[0].options.map(o => o.classId).sort(), ['b6_wt', 'b6_wt_8324']);
    const picked = await mod.buildPlan(store, { ...input, classPicks: { [open.classChoices[0].key]: 'b6_wt_8324' } }, state);
    assert.equal(picked.errors.length, 0);
    assert.deepEqual(picked.studentPlan[0].addClassIds, ['b6_wt_8324']);
    // A pick for a class that is not one of the matches is ignored.
    const bad = await mod.buildPlan(store, { ...input, classPicks: { [open.classChoices[0].key]: 'other' } }, state);
    assert.ok(bad.errors.length > 0);
  }
});
