'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { homeworkApi } = require('../backend/functions/homework-core.cjs');

function makeStore(seed) {
  const data = JSON.parse(JSON.stringify(seed));
  const parts = p => p.split('/');
  const get = async p => { let n = data; for (const k of parts(p)) { if (n == null) return null; n = n[k]; } return n === undefined ? null : JSON.parse(JSON.stringify(n)); };
  const set = async (p, v) => { const k = parts(p); let n = data; for (const s of k.slice(0, -1)) n = n[s] = n[s] || {}; if (v === null) delete n[k[k.length - 1]]; else n[k[k.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const tx = async (p, fn) => { const cur = await get(p); const out = fn(cur); if (out === undefined) return { committed: false }; await set(p, out); return { committed: true }; };
  return { get, set, tx, data };
}
const seed = () => ({
  b3Games: {
    admins: {},
    workspaces: { 'b3-2026': {
      classes: {
        et: { name: 'ET', toolGrants: { homework: true }, members: { s1: { active: true }, s2: { active: true }, s3: { active: false } } },
        wt: { name: 'WT', members: { s9: { active: true } } }
      },
      teachers: { t1: { active: true, classIds: { et: true } } }
    } },
    students: {
      s1: { profile: { name: 'Sam One' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
      s2: { profile: { name: 'Dan Two' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
      s3: { profile: { name: 'Old Three' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
      s9: { profile: { name: 'Wes Nine' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'wt' } } }
    }
  },
  b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' }, s9: { passcode: '9999' } } }
});
const teacher = uid => ({ uid, email: uid + '@x.org', email_verified: true, firebase: { sign_in_provider: 'google.com' } });
const stu = (id, name, pin) => ({ studentId: id, studentName: name, pin, classId: id === 's9' ? 'wt' : 'et' });
let n = 0; const newId = () => 'a' + (++n);
const T = () => ({ identity: teacher('t1') });
const defId = store => Object.keys(store.data.assignmentCenter.workspaces['b3-2026'].classes.et.definitions)[0];

async function setup() {
  const store = makeStore(seed());
  await homeworkApi(store, T(), { action: 'create', classId: 'et', type: 'shorashim', title: 'Shorashim', details: 'Practice', targetMinutes: 10, dueAt: 1000 }, 500, newId);
  return store;
}
const list = (store, id, name, pin, now) => homeworkApi(store, {}, { action: 'studentList', ...stu(id, name, pin) }, now);

test('teacher creates; only active members get records', async () => {
  const store = await setup();
  const l = await homeworkApi(store, T(), { action: 'teacherList', classId: 'et' }, 600);
  assert.deepEqual(Object.keys(l.assignments[0].students).sort(), ['s1', 's2']);
  assert.equal(l.assignments[0].counts.assigned, 2);
});

test('teacher not assigned to a class is refused; unverified identity refused', async () => {
  const store = await setup();
  await assert.rejects(homeworkApi(store, T(), { action: 'teacherList', classId: 'wt' }, 1), { code: 403 });
  await assert.rejects(homeworkApi(store, { identity: teacher('t2') }, { action: 'teacherList', classId: 'et' }, 1), { code: 403 });
  await assert.rejects(homeworkApi(store, { identity: { ...teacher('t1'), email_verified: false } }, { action: 'teacherList', classId: 'et' }, 1), { code: 403 });
  await assert.rejects(homeworkApi(store, {}, { action: 'create', classId: 'et' }, 1), { code: 401 });
});

test('student sees only own work and needs the correct passcode', async () => {
  const store = await setup();
  const ok = await list(store, 's1', 'Sam One', '1111', 600);
  assert.equal(ok.assignments.length, 1);
  assert.equal(ok.openCount, 1);
  assert.equal(ok.assignments[0].late, false);
  assert.equal((await list(store, 's1', 'Sam One', '1111', 1500)).assignments[0].late, true);
  await assert.rejects(list(store, 's1', 'Sam One', '2222', 600), { code: 401 });
  await assert.rejects(list(store, 's9', 'Wes Nine', '9999', 600), { code: 403 }); // homework not turned on for wt
});

test('selected-students assignment is hidden from others', async () => {
  const store = await setup();
  await homeworkApi(store, T(), { action: 'create', classId: 'et', type: 'audio', title: 'Read', studentIds: ['s2', 's9'] }, 700, newId);
  assert.equal((await list(store, 's1', 'Sam One', '1111', 800)).assignments.length, 1);
  assert.equal((await list(store, 's2', 'Dan Two', '2222', 800)).assignments.length, 2);
});

test('progress saves and never goes backwards; submit, return, resubmit, approve', async () => {
  const store = await setup();
  const id = defId(store);
  const s = (action, extra) => homeworkApi(store, {}, { action, ...stu('s1', 'Sam One', '1111'), assignmentId: id, ...extra }, 900);
  await s('save', { draft: 'half done', progress: 6 });
  await s('save', { draft: 'still', progress: 3 });
  let l = (await list(store, 's1', 'Sam One', '1111', 900)).assignments[0];
  assert.equal(l.status, 'in_progress'); assert.equal(l.progress, 6); assert.equal(l.draft, 'still');
  await s('submit', { answer: 'Done', progress: 10 });
  await s('submit', { answer: 'Done', progress: 10 });
  await assert.rejects(s('save', { draft: 'x' }), { code: 409 });
  const rev = (action, extra) => homeworkApi(store, T(), { action, classId: 'et', assignmentId: id, studentId: 's1', ...extra }, 1000);
  await assert.rejects(rev('return', {}), { code: 400 });
  await rev('return', { feedback: 'Do 2 more minutes' });
  l = (await list(store, 's1', 'Sam One', '1111', 1001)).assignments[0];
  assert.equal(l.status, 'returned'); assert.equal(l.feedback, 'Do 2 more minutes');
  await s('submit', { answer: 'Now done', progress: 12 });
  await rev('approve', { stars: 5, feedback: 'Great' });
  l = (await list(store, 's1', 'Sam One', '1111', 1101)).assignments[0];
  assert.equal(l.status, 'approved'); assert.equal(l.stars, 5);
  await assert.rejects(s('submit', { answer: 'again' }), { code: 409 });
});

test('cannot approve unsubmitted work; bad stars refused', async () => {
  const store = await setup();
  const id = defId(store);
  const base = { action: 'approve', classId: 'et', assignmentId: id, studentId: 's1' };
  await assert.rejects(homeworkApi(store, T(), base, 1), { code: 409 });
  await assert.rejects(homeworkApi(store, T(), { ...base, stars: 9 }, 1), { code: 400 });
});

test('student cannot call teacher actions or use a bad assignment id', async () => {
  const store = await setup();
  await assert.rejects(homeworkApi(store, {}, { action: 'approve', classId: 'et', assignmentId: 'x', studentId: 's1' }, 1), { code: 401 });
  await assert.rejects(homeworkApi(store, {}, { action: 'save', ...stu('s1', 'Sam One', '1111'), assignmentId: '../x' }, 1), { code: 404 });
});

test('edit and delete', async () => {
  const store = await setup();
  const id = defId(store);
  await homeworkApi(store, T(), { action: 'edit', classId: 'et', assignmentId: id, title: 'New title', dueAt: null }, 10);
  let l = await homeworkApi(store, T(), { action: 'teacherList', classId: 'et' }, 10);
  assert.equal(l.assignments[0].title, 'New title'); assert.equal(l.assignments[0].dueAt, null);
  await homeworkApi(store, T(), { action: 'delete', classId: 'et', assignmentId: id }, 10);
  l = await homeworkApi(store, T(), { action: 'teacherList', classId: 'et' }, 10);
  assert.equal(l.assignments.length, 0);
});

test('access: other classes, other students, switched-off class', async () => {
  const store = await setup();
  const id = defId(store);
  // student claims a class they are not in, or someone else's id with own passcode
  // asking for another class just returns their own class (never wt's data)
  assert.equal((await homeworkApi(store, {}, { action: 'studentList', studentId: 's1', studentName: 'Sam One', pin: '1111', classId: 'wt' }, 1)).assignments[0].id, id);
  await assert.rejects(homeworkApi(store, {}, { action: 'studentList', ...stu('s2', 'Dan Two', '1111') }, 1), { code: 401 });
  await assert.rejects(homeworkApi(store, {}, { action: 'studentList', ...stu('s1', 'Dan Two', '1111') }, 1), { code: 401 });
  // removed (inactive) student has no passcode access
  await assert.rejects(list(store, 's3', 'Old Three', '1111', 1), { code: 401 });
  // a student in another (switched-on) class sees none of this class's homework
  store.data.b3Games.workspaces['b3-2026'].classes.wt.toolGrants = { homework: true };
  assert.equal((await list(store, 's9', 'Wes Nine', '9999', 1)).assignments.length, 0);
  // teacher: inactive, class flagged false, or switched-off class
  store.data.b3Games.workspaces['b3-2026'].teachers.t1.classIds.et = false;
  await assert.rejects(homeworkApi(store, T(), { action: 'teacherList', classId: 'et' }, 1), { code: 403 });
  store.data.b3Games.workspaces['b3-2026'].teachers.t1.classIds.et = true;
  store.data.b3Games.workspaces['b3-2026'].teachers.t1.active = false;
  await assert.rejects(homeworkApi(store, T(), { action: 'teacherList', classId: 'et' }, 1), { code: 403 });
  store.data.b3Games.workspaces['b3-2026'].teachers.t1.active = true;
  delete store.data.b3Games.workspaces['b3-2026'].classes.et.toolGrants;
  await assert.rejects(homeworkApi(store, T(), { action: 'teacherList', classId: 'et' }, 1), { code: 403 });
  await assert.rejects(list(store, 's1', 'Sam One', '1111', 1), { code: 403 });
  assert.ok(id);
});

test('teacher cannot review a student from another class; owner needs the class switched on', async () => {
  const store = await setup();
  const id = defId(store);
  await assert.rejects(homeworkApi(store, T(), { action: 'approve', classId: 'et', assignmentId: id, studentId: 's9' }, 1), { code: 404 });
  await assert.rejects(homeworkApi(store, T(), { action: 'delete', classId: 'et', assignmentId: '../../x' }, 1), { code: 404 });
  const owner = { identity: { uid: 'o', email: 'simcha5770@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
  await homeworkApi(store, owner, { action: 'teacherList', classId: 'et' }, 1);
  await assert.rejects(homeworkApi(store, owner, { action: 'teacherList', classId: 'wt' }, 1), { code: 403 });
  const emailLogin = { identity: { ...owner.identity, firebase: { sign_in_provider: 'password' } } };
  await assert.rejects(homeworkApi(store, emailLogin, { action: 'teacherList', classId: 'et' }, 1), { code: 403 });
});

test('functions copy of the policy matches the tested original', () => {
  assert.equal(fs.readFileSync(__dirname + '/../backend/functions/homework-policy.cjs', 'utf8'),
    fs.readFileSync(__dirname + '/../assignment-center/assignment-policy.js', 'utf8'));
});
