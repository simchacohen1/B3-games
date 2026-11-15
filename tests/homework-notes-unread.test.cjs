'use strict';
// Homework notes: "new message" (unread) tracking for both sides, on the live and staging server copies.
const test = require('node:test');
const assert = require('node:assert/strict');
const { unreadCount } = require('../assignment-center/homework-common.js');

const cores = {
  live: require('../backend/functions/homework-core.cjs').homeworkApi,
  staging: require('../backend/functions/homework-staging/homework-core.cjs').homeworkApi
};

function makeStore() {
  const data = { b3Games: { admins: {}, workspaces: { 'b3-2026': {
    classes: { et: { name: 'Test Class Alef', toolGrants: { homework: true }, members: { s1: { active: true }, s2: { active: true } } } },
    teachers: { t1: { active: true, classIds: { et: true } } }
  } }, students: { s1: { profile: { name: 'Sam One' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
    s2: { profile: { name: 'Dan Two' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } } } },
    b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' } } } };
  const get = async path => path.split('/').reduce((node, key) => node == null ? null : node[key], data) ?? null;
  const set = async (path, value) => { const keys = path.split('/'); let node = data; for (const key of keys.slice(0, -1)) node = node[key] ||= {}; if (value === null) delete node[keys.at(-1)]; else node[keys.at(-1)] = structuredClone(value); };
  const tx = async (path, fn) => { const current = await get(path), next = fn(current == null ? null : structuredClone(current)); if (next === undefined) return { committed: false }; await set(path, next); return { committed: true }; };
  return { data, get, set, tx };
}
const teacher = { identity: { uid: 't1', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
const student = (id = 's1', name = 'Sam One', pin = '1111') => ({ studentId: id, studentName: name, pin, classId: 'et' });
let serial = 0;
const ids = () => 'n' + (++serial);

for (const [name, homeworkApi] of Object.entries(cores)) {
  async function setup() {
    const store = makeStore();
    const { id } = await homeworkApi(store, teacher, { action: 'create', classId: 'et', type: 'other', title: 'Practice' }, 1, ids);
    await homeworkApi(store, teacher, { action: 'publish', classId: 'et', assignmentId: id }, 2);
    const studentMessages = async now => (await homeworkApi(store, {}, { action: 'studentList', ...student() }, now)).assignments[0].messages;
    const teacherMessages = async now => (await homeworkApi(store, teacher, { action: 'teacherList', classId: 'et' }, now)).assignments[0].students.s1.messages;
    const teacherSays = (text, now) => homeworkApi(store, teacher, { action: 'comment', classId: 'et', assignmentId: id, studentId: 's1', text }, now, ids);
    const studentSays = (text, now) => homeworkApi(store, {}, { action: 'comment', ...student(), assignmentId: id, text }, now, ids);
    return { store, id, studentMessages, teacherMessages, teacherSays, studentSays };
  }

  test(`${name}: a teacher note is new for the student until the student opens the thread`, async () => {
    const t = await setup();
    await t.teacherSays('Nice start!', 10);
    assert.deepEqual((await t.studentMessages(11)).map(m => m.unread), [true]);
    assert.deepEqual((await t.teacherMessages(11)).map(m => m.unread), [false], 'your own note is never new to you');
    assert.equal(unreadCount(await t.studentMessages(11), 'student'), 1);

    assert.deepEqual(await cores[name](t.store, {}, { action: 'markRead', ...student(), assignmentId: t.id }, 12), { ok: true });
    assert.deepEqual((await t.studentMessages(13)).map(m => m.unread), [false]);

    await t.teacherSays('One more thing.', 20);
    assert.deepEqual((await t.studentMessages(21)).map(m => m.unread), [false, true], 'only the newer note counts');
  });

  test(`${name}: a student note is new for the teacher until the teacher opens it`, async () => {
    const t = await setup();
    await t.studentSays('What page is it?', 10);
    assert.deepEqual((await t.teacherMessages(11)).map(m => m.unread), [true]);
    await homeworkApi(t.store, teacher, { action: 'markRead', classId: 'et', assignmentId: t.id, studentId: 's1' }, 12);
    assert.deepEqual((await t.teacherMessages(13)).map(m => m.unread), [false]);
  });

  test(`${name}: replying counts as reading, and labels keep each side's role`, async () => {
    const t = await setup();
    await t.teacherSays('Please fix line 2.', 10);
    await t.studentSays('Fixed it!', 11);
    const seenByStudent = await t.studentMessages(12);
    assert.deepEqual(seenByStudent.map(m => [m.role, m.unread]), [['teacher', false], ['student', false]]);
    const seenByTeacher = await t.teacherMessages(12);
    assert.deepEqual(seenByTeacher.map(m => [m.role, m.unread]), [['teacher', false], ['student', true]]);
  });

  test(`${name}: markRead is limited to your own thread`, async () => {
    const t = await setup();
    await t.teacherSays('For Sam only', 10);
    // Dan marking his own thread read does not touch Sam's.
    await homeworkApi(t.store, {}, { action: 'markRead', ...student('s2', 'Dan Two', '2222'), assignmentId: t.id }, 11);
    assert.deepEqual((await t.studentMessages(12)).map(m => m.unread), [true]);
    await assert.rejects(homeworkApi(t.store, {}, { action: 'markRead', ...student('s1', 'Sam One', '9999'), assignmentId: t.id }, 13));
    await assert.rejects(homeworkApi(t.store, teacher, { action: 'markRead', classId: 'et', assignmentId: t.id, studentId: 'nobody' }, 14), { code: 404 });
  });

  test(`${name}: markRead keeps status, work and messages unchanged`, async () => {
    const t = await setup();
    await homeworkApi(t.store, {}, { action: 'save', ...student(), assignmentId: t.id, draft: 'my draft' }, 5);
    await t.teacherSays('Keep going', 10);
    const before = (await homeworkApi(t.store, {}, { action: 'studentList', ...student() }, 11)).assignments[0];
    await homeworkApi(t.store, {}, { action: 'markRead', ...student(), assignmentId: t.id }, 12);
    const after = (await homeworkApi(t.store, {}, { action: 'studentList', ...student() }, 13)).assignments[0];
    assert.equal(after.status, before.status);
    assert.equal(after.draft, 'my draft');
    assert.deepEqual(after.messages.map(m => m.text), before.messages.map(m => m.text));
  });
}

test('unreadCount ignores your own notes and notes already read', () => {
  const messages = [{ role: 'teacher', unread: true }, { role: 'teacher', unread: false }, { role: 'student', unread: true }];
  assert.equal(unreadCount(messages, 'student'), 1);
  assert.equal(unreadCount(messages, 'teacher'), 1);
  assert.equal(unreadCount(undefined, 'teacher'), 0);
});
