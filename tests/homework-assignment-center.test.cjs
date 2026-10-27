'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { seed, students, teachers, makeStore } = require('./fixtures/synthetic-class.cjs');
const { homeworkApi } = require('../backend/functions/homework-core.cjs');

let next = 0;
const call = (store, auth, body, now = 1000) =>
  homeworkApi(store, auth, body, now, () => 'assignment' + (++next));
const teacher = (store, body, now) => call(store, teachers.a, { classId: 'synth-a', ...body }, now);
const student = (store, body, now) => call(store, {}, { ...students.a1, ...body }, now);
const recordPath = id => 'assignmentCenter/workspaces/b3-2026/classes/synth-a/students/synthA1/assignments/' + id;

async function makeDraft(extra = {}) {
  const store = makeStore(seed());
  const result = await teacher(store, {
    action: 'create', type: 'shorashim', title: 'Practice roots', details: 'Use the assigned list.',
    assignedAt: 2000, dueAt: 8000, targetAmount: 12, targetUnit: 'minutes', studentIds: ['synthA1'], ...extra
  }, 1000);
  return { store, id: result.id };
}

test('draft review keeps work hidden and creates no student record until publish', async () => {
  const { store, id } = await makeDraft();
  const dashboard = await teacher(store, { action: 'teacherList' }, 1200);
  assert.equal(dashboard.assignments[0].id, id);
  assert.equal(dashboard.assignments[0].publicationState, 'draft');
  assert.equal(dashboard.assignments[0].targetAmount, 12);
  assert.equal(await store.get(recordPath(id)), null);
  assert.deepEqual((await student(store, { action: 'studentList' }, 1200)).assignments, []);
  await assert.rejects(student(store, { action: 'save', assignmentId: id, draft: 'early' }, 1200), { code: 404 });
});

test('publish respects audience and assigned date; unpublish revokes access without erasing progress', async () => {
  const { store, id } = await makeDraft({ type: 'weeklyQuiz', targetAmount: 8, targetUnit: 'questions' });
  await teacher(store, { action: 'publish', assignmentId: id }, 1300);
  assert.deepEqual((await student(store, { action: 'studentList' }, 1999)).assignments, []);
  assert.deepEqual((await call(store, {}, { ...students.a2, action: 'studentList' }, 2000)).assignments, []);
  let list = await student(store, { action: 'studentList' }, 2000);
  assert.equal(list.assignments.length, 1);
  assert.equal(list.assignments[0].status, 'assigned');
  assert.equal(list.assignments[0].targetUnit, 'questions');
  await student(store, { action: 'save', assignmentId: id, draft: 'halfway' }, 2100);
  await teacher(store, { action: 'unpublish', assignmentId: id }, 2200);
  assert.deepEqual((await student(store, { action: 'studentList' }, 2300)).assignments, []);
  await assert.rejects(student(store, { action: 'submit', assignmentId: id, answer: 'finished' }, 2300), { code: 404 });
  const saved = await store.get(recordPath(id));
  assert.equal(saved.status, 'in_progress');
  assert.equal(saved.draft, 'halfway');
  await teacher(store, { action: 'publish', assignmentId: id }, 2400);
  list = await student(store, { action: 'studentList' }, 2500);
  assert.equal(list.assignments[0].status, 'in_progress');
  assert.equal(list.assignments[0].draft, 'halfway');
});

test('archive hides assignments while preserving submitted work and scores', async () => {
  const { store, id } = await makeDraft();
  await teacher(store, { action: 'publish', assignmentId: id }, 1100);
  await student(store, { action: 'submit', assignmentId: id, answer: 'I practiced twelve minutes.', progress: 12 }, 3000);
  const before = await store.get(recordPath(id));
  await teacher(store, { action: 'archive', assignmentId: id }, 4000);
  assert.deepEqual((await student(store, { action: 'studentList' }, 5000)).assignments, []);
  assert.deepEqual(await store.get(recordPath(id)), before);
  const row = (await teacher(store, { action: 'teacherList' }, 5000)).assignments[0];
  assert.equal(row.publicationState, 'archived');
  assert.equal(row.students.synthA1.status, 'submitted');
});

test('due date before assigned date is rejected and edits preserve the selected class audience', async () => {
  const store = makeStore(seed());
  await assert.rejects(teacher(store, {
    action: 'create', type: 'weeklyQuiz', title: 'Quiz', assignedAt: 9000, dueAt: 8000
  }, 1000), { code: 400 });
  const { store: draftStore, id } = await makeDraft();
  await teacher(draftStore, { action: 'edit', assignmentId: id, title: 'Revised', assignedAt: 3000, dueAt: 9000 }, 1500);
  const row = (await teacher(draftStore, { action: 'teacherList' }, 1600)).assignments[0];
  assert.equal(row.title, 'Revised');
  assert.equal(row.assignedAt, 3000);
  assert.deepEqual(Object.keys(row.students), ['synthA1']);
});

test('preview runtime refuses production Firebase and activity links never submit on open', async () => {
  const context = { window: { location: { hostname: 'simchacohen1.github.io', search: '' }, B3_FIREBASE_CONFIG: { projectId: 'b3-games' } }, URL };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../assignment-center/homework-common.js', 'utf8'), context);
  assert.equal(context.window.HomeworkCommon.API, '');
  assert.equal(context.window.HomeworkCommon.isStagingRuntime(), false);
  await assert.rejects(context.window.HomeworkCommon.call({ action: 'studentList' }), /locked to the isolated staging site/);

  const html = fs.readFileSync(__dirname + '/../assignment-center/student.html', 'utf8');
  assert.match(html, /data-assignment-launch/);
  assert.match(html, /Opening the activity does not mark this assignment complete/);
  const cardCode = html.slice(html.indexOf('function card(a)'), html.indexOf('async function refresh()'));
  const launchCode = cardCode.slice(cardCode.indexOf('var activityUrl'), cardCode.indexOf("if(a.status==='returned'"));
  assert.match(launchCode, /target='_blank'/);
  assert.doesNotMatch(launchCode, /call\(/);
});

test('staging guard accepts only the staging host/project and provides local activity targets', () => {
  const guard = fs.readFileSync(__dirname + '/../assignment-center/staging-guard.js', 'utf8');
  const common = fs.readFileSync(__dirname + '/../assignment-center/homework-common.js', 'utf8');
  const stage = { window: {
    location: { hostname: 'fun-torah-tools-staging.web.app', search: '', href: 'https://fun-torah-tools-staging.web.app/assignment-center/student.html' },
    B3_FIREBASE_CONFIG: { projectId: 'fun-torah-tools-staging' }
  }, URL };
  vm.runInNewContext(guard, stage);
  vm.runInNewContext(common, stage);
  assert.equal(stage.window.__B3_STAGING_BLOCKED__, false);
  assert.equal(stage.window.HomeworkCommon.API, 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/homeworkPortal');
  assert.equal(stage.window.HomeworkCommon.activityUrl('shorashim'), 'https://fun-torah-tools-staging.web.app/shorashim/index.html');

  const production = { window: {
    location: { hostname: 'simchacohen1.github.io', search: '', href: 'https://simchacohen1.github.io/B3-games/assignment-center/student.html' },
    B3_FIREBASE_CONFIG: { projectId: 'b3-games' }
  } };
  vm.runInNewContext(guard, production);
  vm.runInNewContext(common, production);
  assert.equal(production.window.__B3_STAGING_BLOCKED__, true);
  assert.equal(production.window.HomeworkCommon.API, '');
});
