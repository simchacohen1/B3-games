'use strict';
// Fictional students and classes only. Teacher-confirmed permanent delete of one homework.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { seed, students, teachers, makeStore } = require('./fixtures/synthetic-class.cjs');
const cores = {
  live: require('../backend/functions/homework-core.cjs').homeworkApi,
  staging: require('../backend/functions/homework-staging/homework-core.cjs').homeworkApi
};
const base = c => 'assignmentCenter/workspaces/b3-2026/classes/' + c;

for (const [name, homeworkApi] of Object.entries(cores)) {
  let n = 0;
  const newId = () => 'hw' + (++n);
  const teacher = (store, who, classId, body, now = 1000) => homeworkApi(store, teachers[who], { classId, ...body }, now, newId);
  const student = (store, who, body, now = 1000) => homeworkApi(store, {}, { ...students[who], ...body }, now, () => 'msg' + (++n));

  async function published(store, classId, who, ids) {
    const { id } = await teacher(store, who, classId, { action: 'create', type: 'shorashim', title: 'Roots', details: 'Do it', studentIds: ids, assignedAt: 1000, dueAt: 9000 });
    await teacher(store, who, classId, { action: 'publish', assignmentId: id }, 2000);
    return id;
  }

  test(name + ': delete removes assignment, answers, notes, voice and stars for every student', async () => {
    const store = makeStore(seed());
    const id = await published(store, 'synth-a', 'a', ['synthA1', 'synthA2']);
    const other = await published(store, 'synth-a', 'a', ['synthA1']);
    await student(store, 'a1', { action: 'submit', assignmentId: id, answer: 'done' }, 3000);
    await teacher(store, 'a', 'synth-a', { action: 'comment', assignmentId: id, studentId: 'synthA1', text: 'nice' }, 3500);
    await store.set(base('synth-a') + '/students/synthA1/assignments/' + id + '/stars', 3);
    await store.set(base('synth-a') + '/students/synthA1/assignments/' + id + '/voiceNotes/x', 'data:audio/webm;base64,AAAA');
    await store.set(base('synth-a') + '/students/synthAgone/assignments/' + id, { assignmentId: id, status: 'submitted' });
    await teacher(store, 'a', 'synth-a', { action: 'deletePermanently', assignmentId: id, confirm: true }, 4000);
    assert.equal(await store.get(base('synth-a') + '/definitions/' + id), null);
    for (const s of ['synthA1', 'synthA2', 'synthAgone'])
      assert.equal(await store.get(base('synth-a') + '/students/' + s + '/assignments/' + id), null);
    assert.ok(await store.get(base('synth-a') + '/definitions/' + other), 'other homework untouched');
    assert.ok(await store.get(base('synth-a') + '/students/synthA1/assignments/' + other), 'other homework records untouched');
  });

  test(name + ': delete needs the explicit confirm flag', async () => {
    const store = makeStore(seed());
    const id = await published(store, 'synth-a', 'a', ['synthA1']);
    await assert.rejects(teacher(store, 'a', 'synth-a', { action: 'deletePermanently', assignmentId: id }), { code: 400 });
    assert.ok(await store.get(base('synth-a') + '/definitions/' + id));
  });

  test(name + ': a teacher cannot delete another class\'s homework', async () => {
    const store = makeStore(seed());
    const idB = await published(store, 'synth-b', 'b', ['synthB1']);
    await assert.rejects(teacher(store, 'a', 'synth-b', { action: 'deletePermanently', assignmentId: idB, confirm: true }), { code: 403 });
    await assert.rejects(teacher(store, 'a', 'synth-a', { action: 'deletePermanently', assignmentId: idB, confirm: true }), { code: 404 });
    assert.ok(await store.get(base('synth-b') + '/definitions/' + idB));
    assert.ok(await store.get(base('synth-b') + '/students/synthB1/assignments/' + idB));
  });

  test(name + ': students and signed-out callers cannot delete', async () => {
    const store = makeStore(seed());
    const id = await published(store, 'synth-a', 'a', ['synthA1']);
    await assert.rejects(student(store, 'a1', { action: 'deletePermanently', assignmentId: id, confirm: true }), { code: 401 });
    await assert.rejects(homeworkApi(store, {}, { classId: 'synth-a', action: 'deletePermanently', assignmentId: id, confirm: true }, 1, newId), { code: 401 });
    assert.ok(await store.get(base('synth-a') + '/definitions/' + id));
  });
}

test('browser has no database rule for the homework tree (server only)', () => {
  const rules = JSON.parse(fs.readFileSync(__dirname + '/../firebase-rules.json', 'utf8'));
  assert.equal(rules.rules.assignmentCenter, undefined);
  assert.notEqual(rules.rules['.read'], true);
  assert.notEqual(rules.rules['.write'], true);
});

test('teacher page asks the exact warning before deleting', () => {
  const html = fs.readFileSync(__dirname + '/../assignment-center/teacher.html', 'utf8');
  assert.ok(html.includes('Delete this homework? This also removes all the boys’ work and messages for it, and can’t be undone.'));
  assert.ok(html.includes("action:'deletePermanently'"));
});
