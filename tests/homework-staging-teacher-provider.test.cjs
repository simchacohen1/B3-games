'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, teachers, makeStore } = require('./fixtures/synthetic-class.cjs');
const { homeworkApi: stagingApi } = require('../backend/functions/homework-staging/homework-core.cjs');
const { homeworkApi: productionApi } = require('../backend/functions/homework-core.cjs');

const passwordTeacher = {
  identity: { ...teachers.a.identity, firebase: { sign_in_provider: 'password' } }
};

test('staging accepts an email-verified fictional teacher assigned to the class', async () => {
  const store = makeStore(seed());
  const classes = await stagingApi(store, passwordTeacher, { action: 'authorizedClasses' }, 1000);
  assert.deepEqual(classes.classes.map(c => c.id), ['synth-a']);
  const list = await stagingApi(store, passwordTeacher,
    { action: 'teacherList', classId: 'synth-a' }, 1000);
  assert.equal(list.ok, true);
});

test('staging password sign-in never bypasses class membership or verification', async () => {
  const store = makeStore(seed());
  await assert.rejects(stagingApi(store, passwordTeacher,
    { action: 'teacherList', classId: 'synth-b' }, 1000), { code: 403 });
  await assert.rejects(stagingApi(store,
    { identity: { ...passwordTeacher.identity, email_verified: false } },
    { action: 'teacherList', classId: 'synth-a' }, 1000), { code: 403 });
  store.data.b3Games.workspaces['b3-2026'].teachers.synthTeacherA.active = false;
  await assert.rejects(stagingApi(store, passwordTeacher,
    { action: 'teacherList', classId: 'synth-a' }, 1000), { code: 403 });
});

test('production helper continues to reject password-only teacher sign-in', async () => {
  const store = makeStore(seed());
  await assert.rejects(productionApi(store, passwordTeacher,
    { action: 'teacherList', classId: 'synth-a' }, 1000), { code: 403 });
});
