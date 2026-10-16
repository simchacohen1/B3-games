'use strict';
// Homework security/privacy tests on SYNTHETIC data only (made-up class, students, passcodes).
const test = require('node:test');
const assert = require('node:assert/strict');
const { students: S, teachers: T, makeStore } = require('./fixtures/synthetic-class.cjs');
const { homeworkApi } = require('../backend/functions/homework-core.cjs');
let now = 1_800_000_000_000, n = 0;
const hw = (store, auth, body) => homeworkApi(store, auth, body, (now += 3000), () => 'hw' + (++n));
const SECRET = 'SECRET-HOMEWORK-TEXT-5c1d';
const attempt = async fn => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, code: e.code, msg: e.message }; } };
const leaked = r => JSON.stringify(r).includes(SECRET);

async function seeded() {
  const store = makeStore();
  await hw(store, T.a, { action: 'create', classId: 'synth-a', type: 'other', title: SECRET, studentIds: ['synthA1'] });
  return store;
}
test('homework: only the assigned student and teachers of synth-a see it', async () => {
  const store = await seeded();
  assert.equal(leaked(await hw(store, {}, { action: 'studentList', ...S.a1 })), true);
  assert.equal(leaked(await hw(store, T.a, { action: 'teacherList', classId: 'synth-a' })), true);
  for (const login of [S.a2, S.a3, S.b1, S.b2]) {
    const a = await attempt(() => hw(store, {}, { action: 'studentList', ...login }));
    if (a.ok) assert.equal(leaked(a.r), false);
  }
  for (const body of [{ action: 'teacherList', classId: 'synth-a' }, { action: 'delete', classId: 'synth-a', assignmentId: 'hw1' }, { action: 'approve', classId: 'synth-a', assignmentId: 'hw1', studentId: 'synthA1' }]) {
    assert.equal((await attempt(() => hw(store, T.b, body))).code, 403);
    assert.equal((await attempt(() => hw(store, {}, body))).code, 401);
  }
  assert.equal((await attempt(() => hw(store, T.both, { action: 'teacherList', classId: 'synth-off' }))).code, 403);
  assert.equal((await attempt(() => hw(store, {}, { action: 'studentList', ...S.o1 }))).code, 403);
});
test('homework: wrong passcode or someone else\'s id never works; no passcodes in responses', async () => {
  const store = await seeded();
  assert.equal((await attempt(() => hw(store, {}, { action: 'studentList', ...S.a1, pin: S.a2.pin }))).code, 401);
  assert.equal((await attempt(() => hw(store, {}, { action: 'studentList', ...S.a1, studentName: S.a2.studentName }))).code, 401);
  const text = JSON.stringify(await hw(store, {}, { action: 'studentList', ...S.a1 }));
  for (const bad of ['1001', '1002', 'passcode', 'b3Private']) assert.equal(text.includes(bad), false);
});
test('homework: hostile ids and field types end in a clean 4xx and change nothing', async () => {
  const store = await seeded();
  const before = JSON.stringify(store.data.b3Games);
  const nasty = ['__proto__', 'constructor', '../synthB1', 'a/b', '', null, undefined, 0, true, [], {}, ['synthA1'], { $ne: 1 }, 'x'.repeat(5000), '\u0000'];
  let bad = 0;
  for (const v of nasty) for (const f of [
    () => hw(store, {}, { action: 'save', ...S.a1, assignmentId: v, draft: 'x' }),
    () => hw(store, {}, { action: 'submit', ...S.a1, assignmentId: v, answer: 'x' }),
    () => hw(store, T.a, { action: 'create', classId: 'synth-a', type: 'other', title: 't', studentIds: v }),
    () => hw(store, T.a, { action: 'create', classId: 'synth-a', type: v, title: v, details: v, dueAt: v }),
    () => hw(store, T.a, { action: 'approve', classId: 'synth-a', assignmentId: v, studentId: v, stars: v }),
    () => hw(store, T.a, { action: 'teacherList', classId: v }),
    () => hw(store, {}, { action: 'studentList', studentId: v, studentName: v, pin: v, classId: v })]) {
    const a = await attempt(f);
    if (!a.ok && !(Number.isInteger(a.code) && a.code >= 400 && a.code < 500)) { bad++; console.log('CRASH', a.msg); }
  }
  assert.equal(bad, 0);
  assert.equal(JSON.stringify(store.data.b3Games), before);
  assert.deepEqual(Object.keys(store.data.assignmentCenter.workspaces['b3-2026'].classes), ['synth-a']);
});
