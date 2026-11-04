'use strict';
// Fictional students and classes only. Protect student homework after unpublish.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, students, teachers, makeStore } = require('./fixtures/synthetic-class.cjs');
const { homeworkApi } = require('../backend/functions/homework-staging/homework-core.cjs');

const base = 'assignmentCenter/workspaces/b3-2026/classes/synth-a';
const teacher = (store, body, now = 1000) =>
  homeworkApi(store, teachers.a, { classId: 'synth-a', ...body }, now, () => 'homework-test-id');
const student = (store, body, now = 1000) =>
  homeworkApi(store, {}, { ...students.a1, ...body }, now, () => 'student-test-id');

async function makeDraft() {
  const store = makeStore(seed());
  const { id } = await teacher(store, {
    action: 'create', type: 'shorashim', title: 'Practice roots',
    details: 'Practice then hand in.', studentIds: ['synthA1'],
    assignedAt: 1000, dueAt: 9000
  });
  return { store, id };
}

test('unpublish followed by delete cannot erase submitted work', async () => {
  const { store, id } = await makeDraft();
  await teacher(store, { action: 'publish', assignmentId: id }, 2000);
  await student(store, { action: 'submit', assignmentId: id, answer: 'I practiced.' }, 3000);
  const path = base + '/students/synthA1/assignments/' + id;
  const before = await store.get(path);
  assert.equal(before.status, 'submitted');
  await teacher(store, { action: 'unpublish', assignmentId: id }, 4000);
  await assert.rejects(
    teacher(store, { action: 'delete', assignmentId: id }, 5000),
    { code: 409 }
  );
  assert.deepEqual(await store.get(path), before);
  const def = await store.get(base + '/definitions/' + id);
  assert.equal(def.publicationState, 'draft');
  assert.equal(def.publishedAt, 2000);
});

test('unpublished assignment with no student submissions still preserves assigned records', async () => {
  const { store, id } = await makeDraft();
  await teacher(store, { action: 'publish', assignmentId: id }, 2000);
  await teacher(store, { action: 'unpublish', assignmentId: id }, 3000);
  await assert.rejects(teacher(store, { action: 'delete', assignmentId: id }, 4000), { code: 409 });
  assert.ok(await store.get(base + '/students/synthA1/assignments/' + id));
});

test('legacy draft with orphaned former-student work cannot be deleted', async () => {
  const { store, id } = await makeDraft();
  const path = base + '/students/synthAgone/assignments/' + id;
  const oldWork = { assignmentId: id, status: 'submitted', answer: 'Old work must stay.' };
  await store.set(path, oldWork);
  await assert.rejects(teacher(store, { action: 'delete', assignmentId: id }, 2000), { code: 409 });
  assert.deepEqual(await store.get(path), oldWork);
  assert.ok(await store.get(base + '/definitions/' + id));
});

test('never-published draft with no student records remains deletable', async () => {
  const { store, id } = await makeDraft();
  assert.equal(await store.get(base + '/students'), null);
  await teacher(store, { action: 'delete', assignmentId: id }, 2000);
  assert.equal(await store.get(base + '/definitions/' + id), null);
});
