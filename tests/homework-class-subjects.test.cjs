'use strict';
// Multiple classes (#662): per-class subject lists, teacher subject links, who sees which
// homework, and the student class switcher. Runs against the live and staging copies.
const test = require('node:test');
const assert = require('node:assert/strict');

const copies = {
  live: require('../backend/functions/homework-core.cjs').homeworkApi,
  staging: require('../backend/functions/homework-staging/homework-core.cjs').homeworkApi
};

function makeStore(seed) {
  const data = JSON.parse(JSON.stringify(seed));
  const parts = p => p.split('/');
  const get = async p => { let n = data; for (const k of parts(p)) { if (n == null) return null; n = n[k]; } return n === undefined ? null : JSON.parse(JSON.stringify(n)); };
  const set = async (p, v) => { const k = parts(p); let n = data; for (const s of k.slice(0, -1)) n = n[s] = n[s] || {}; if (v === null) delete n[k[k.length - 1]]; else n[k[k.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const tx = async (p, fn) => { const cur = await get(p); const out = fn(cur); if (out === undefined) return { committed: false }; await set(p, out); return { committed: true }; };
  return { get, set, tx, data };
}
const member = { active: true };
const seed = () => ({
  b3Games: {
    admins: { boss: { active: true } },
    workspaces: { 'b3-2026': {
      classes: {
        et: { name: 'ET', toolGrants: { homework: true }, teacherIds: { t1: true, t2: true }, members: { s1: member, s2: member } },
        wt: { name: 'WT', toolGrants: { homework: true }, teacherIds: { t3: true }, members: { s1: member } },
        art: { name: 'Art', toolGrants: {}, teacherIds: { t3: true }, members: { s1: member } }
      },
      teachers: {
        t1: { active: true, displayName: 'Rabbi Levi', classIds: { et: true } },
        t2: { active: true, displayName: 'mr.cohen@example.org', classIds: { et: true } },
        t3: { active: true, displayName: 'Rabbi Katz', classIds: { wt: true, art: true } }
      }
    } },
    students: {
      s1: { profile: { name: 'Sam One' }, memberships: {
        a: { workspaceId: 'b3-2026', classId: 'et' }, b: { workspaceId: 'b3-2026', classId: 'wt' }, c: { workspaceId: 'b3-2026', classId: 'art' } } },
      s2: { profile: { name: 'Sue Two' }, memberships: { a: { workspaceId: 'b3-2026', classId: 'et' } } }
    }
  },
  b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' } } }
});
const who = uid => ({ identity: { uid, email: uid + '@x.org', email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const [T1, T2, T3, OWNER] = ['t1', 't2', 't3', 'boss'].map(who);
const S1 = { studentId: 's1', studentName: 'Sam One', pin: '1111' };
const S2 = { studentId: 's2', studentName: 'Sue Two', pin: '2222', classId: 'et' };
const settings = store => store.data.assignmentCenter.workspaces['b3-2026'].classes.et.settings;
const defs = (store, c = 'et') => store.data.assignmentCenter.workspaces['b3-2026'].classes[c].definitions;

for (const [name, api] of Object.entries(copies)) {
  const ids = () => { let n = 0; return () => 'id' + (++n); };
  const setup = async () => {
    const store = makeStore(seed()), newId = ids();
    const call = (who, body, now = 100) => api(store, who, { classId: 'et', ...body }, now, newId);
    const chumash = (await call(T1, { action: 'addSubject', name: 'Chumash' })).id;
    const mishnayos = (await call(T2, { action: 'addSubject', name: 'Mishnayos' })).id;
    return { store, call, chumash, mishnayos };
  };
  const post = (call, who, title, extra = {}) => call(who, { action: 'create', type: 'other', title, assignedAt: 0, ...extra })
    .then(async r => { await call(who, { action: 'publish', assignmentId: r.id }); return r.id; });

  test(name + ': every teacher of a class can manage its subjects and links equally', async () => {
    const { store, call, chumash, mishnayos } = await setup();
    await call(T2, { action: 'renameSubject', subjectId: chumash, name: 'Chumash (Bereishis)' });
    await assert.rejects(call(T1, { action: 'addSubject', name: 'mishnayos' }), { code: 409 });
    await call(T1, { action: 'setTeacherSubjects', teacherId: 't2', subjectIds: [mishnayos] });
    await call(T2, { action: 'setTeacherSubjects', teacherId: 't1', subjectIds: [chumash, mishnayos] });
    const list = await call(T1, { action: 'teacherList' });
    assert.deepEqual(list.subjects.map(s => s.name), ['Chumash (Bereishis)', 'Mishnayos']);
    assert.deepEqual(list.teachers.t2, { name: 'mr.cohen', subjectIds: [mishnayos] }); // no e-mail address shown
    assert.deepEqual(list.teachers.t1.subjectIds.sort(), [chumash, mishnayos].sort());
    assert.deepEqual(list.me.subjectIds.sort(), [chumash, mishnayos].sort());
    // A teacher of another class cannot touch this class.
    await assert.rejects(call(T3, { action: 'addSubject', name: 'Navi' }), { code: 403 });
    await assert.rejects(call(T1, { action: 'setTeacherSubjects', teacherId: 't3', subjectIds: [chumash] }), { code: 404 });
    await assert.rejects(call(T1, { action: 'setTeacherSubjects', teacherId: 't2', subjectIds: ['nope'] }), { code: 400 });
    assert.equal(Object.keys(settings(store).subjects).length, 2);
  });

  test(name + ': teachers see their own homework and homework with no subject; owner sees all', async () => {
    const { call, chumash, mishnayos } = await setup();
    await call(T1, { action: 'setTeacherSubjects', teacherId: 't1', subjectIds: [chumash] });
    const t1Chumash = await post(call, T1, 'T1 Chumash', { subjectId: chumash });
    const t1Plain = await post(call, T1, 'T1 plain');
    const t2Mish = await post(call, T2, 'T2 Mishnayos', { subjectId: mishnayos });
    const titles = async who => (await call(who, { action: 'teacherList' })).assignments.map(a => a.title).sort();
    assert.deepEqual(await titles(T1), ['T1 Chumash', 'T1 plain']);
    assert.deepEqual(await titles(T2), ['T1 plain', 'T2 Mishnayos']);
    assert.deepEqual(await titles(OWNER), ['T1 Chumash', 'T1 plain', 'T2 Mishnayos']);
    const row = (await call(T2, { action: 'teacherList' })).assignments.find(a => a.id === t1Plain);
    assert.equal(row.postedBy, 'Rabbi Levi');
    assert.equal(row.mine, false);
    // Hidden homework cannot be changed through any action either.
    for (const action of ['edit', 'publish', 'unpublish', 'archive', 'delete'])
      await assert.rejects(call(T2, { action, assignmentId: t1Chumash, title: 'x' }), { code: 404 }, action);
    await assert.rejects(call(T2, { action: 'approve', assignmentId: t1Chumash, studentId: 's1' }), { code: 404 });
    await assert.rejects(call(T2, { action: 'comment', assignmentId: t1Chumash, studentId: 's1', text: 'hi' }), { code: 404 });
    assert.ok(t2Mish);
  });

  test(name + ': subject must come from the class list and from the teacher\'s own subjects', async () => {
    const { store, call, chumash, mishnayos } = await setup();
    await call(T1, { action: 'setTeacherSubjects', teacherId: 't1', subjectIds: [chumash] });
    await assert.rejects(post(call, T1, 'Wrong', { subjectId: mishnayos }), { code: 403 });
    await assert.rejects(post(call, T1, 'Unknown', { subjectId: 'zzz' }), { code: 400 });
    await assert.rejects(post(call, T1, 'Free text', { subject: 'Navi' }), { code: 400 });
    // t2 has no links yet, so any class subject is allowed; the owner may use any subject.
    await post(call, T2, 'Any', { subjectId: chumash });
    const own = await post(call, OWNER, 'Owner', { subjectId: mishnayos });
    assert.equal(defs(store)[own].subject, 'Mishnayos');
    // Edit: change subject, keep it when not sent, clear it with ''.
    const id = await post(call, T1, 'Edit me', { subjectId: chumash });
    await call(T1, { action: 'edit', assignmentId: id, title: 'Edited' });
    assert.equal(defs(store)[id].subjectId, chumash);
    await call(T1, { action: 'edit', assignmentId: id, subjectId: '' });
    assert.equal(defs(store)[id].subjectId, '');
    assert.equal(defs(store)[id].subject, '');
  });

  test(name + ': a class with no subject list keeps working exactly as before', async () => {
    const store = makeStore(seed()), call = (who, body) => api(store, who, { classId: 'et', ...body }, 100, ids());
    const r = await call(T1, { action: 'create', type: 'other', title: 'Old style', subject: 'Chumash', assignedAt: 0 });
    assert.equal(defs(store)[r.id].subject, 'Chumash');
    const plain = await call(T1, { action: 'create', type: 'other', title: 'Plain', assignedAt: 0 });
    const t2 = await call(T2, { action: 'teacherList' });
    assert.deepEqual(t2.assignments.map(a => a.id), [plain.id]); // free-text subject still counts as a subject
    assert.deepEqual(t2.subjects, []);
    assert.equal(t2.me.linked, false);
  });

  test(name + ': removing a subject keeps the homework label and clears links', async () => {
    const { store, call, chumash } = await setup();
    await call(T1, { action: 'setTeacherSubjects', teacherId: 't1', subjectIds: [chumash] });
    const id = await post(call, T1, 'Tagged', { subjectId: chumash });
    await call(T2, { action: 'removeSubject', subjectId: chumash });
    assert.equal(settings(store).subjects[chumash], undefined);
    assert.equal(settings(store).teacherSubjects?.t1, undefined);
    const row = (await call(T1, { action: 'teacherList' })).assignments.find(a => a.id === id);
    assert.equal(row.subject, 'Chumash');
  });

  test(name + ': students switch between their classes and see subject and teacher', async () => {
    const { store, call, chumash } = await setup();
    await post(call, T1, 'ET Chumash', { subjectId: chumash });
    await post(call, T2, 'ET plain');
    await api(store, T3, { classId: 'wt', action: 'create', type: 'other', title: 'WT work', assignedAt: 0 }, 100, () => 'w1');
    await api(store, T3, { classId: 'wt', action: 'publish', assignmentId: 'w1' }, 100);
    const et = await api(store, {}, { action: 'studentList', ...S1, classId: 'et' }, 200);
    assert.deepEqual(et.classes, [{ id: 'et', name: 'ET' }, { id: 'wt', name: 'WT' }]); // Art has no Homework
    assert.equal(et.classId, 'et');
    const byTitle = Object.fromEntries(et.assignments.map(a => [a.title, a]));
    assert.equal(byTitle['ET Chumash'].subject, 'Chumash');
    assert.equal(byTitle['ET Chumash'].teacher, 'Rabbi Levi');
    assert.equal(byTitle['ET plain'].teacher, 'mr.cohen');
    const wt = await api(store, {}, { action: 'studentList', ...S1, classId: 'wt' }, 200);
    assert.deepEqual(wt.assignments.map(a => a.title), ['WT work']);
    // A class the student is not in is refused; a one-class student sees just that class.
    await assert.rejects(api(store, {}, { action: 'studentList', ...S2, classId: 'wt' }, 200), { code: 403 });
    assert.deepEqual((await api(store, {}, { action: 'studentList', ...S2 }, 200)).classes, [{ id: 'et', name: 'ET' }]);
  });
}
