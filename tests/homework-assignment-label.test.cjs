'use strict';
// Assignment label (Homework / Class Assignment) for the teacher Reports page.
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
const seed = () => ({
  b3Games: {
    admins: {},
    workspaces: { 'b3-2026': {
      classes: { et: { name: 'ET', toolGrants: { homework: true }, members: { s1: { active: true } } } },
      teachers: { t1: { active: true, classIds: { et: true } } }
    } },
    students: { s1: { profile: { name: 'Sam One' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } } }
  }
});
const T = { identity: { uid: 't1', email: 't1@x.org', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
const defs = store => store.data.assignmentCenter.workspaces['b3-2026'].classes.et.definitions;

for (const [name, api] of Object.entries(copies)) {
  test(name + ': new assignments default to Homework; Class Assignment is kept', async () => {
    let n = 0; const newId = () => 'a' + (++n);
    const store = makeStore(seed());
    const plain = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Plain', assignedAt: 0 }, 100, newId);
    const cls = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'In class', label: 'classwork', assignedAt: 0 }, 200, newId);
    assert.equal(defs(store)[plain.id].label, 'homework');
    assert.equal(defs(store)[cls.id].label, 'classwork');
    const list = await api(store, T, { action: 'teacherList', classId: 'et' }, 300);
    const byId = Object.fromEntries(list.assignments.map(a => [a.id, a]));
    assert.equal(byId[plain.id].label, 'homework');
    assert.equal(byId[cls.id].label, 'classwork');
  });

  test(name + ': edit changes the label, and leaves it alone when not sent', async () => {
    let n = 0; const newId = () => 'a' + (++n);
    const store = makeStore(seed());
    const made = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Work', assignedAt: 0 }, 100, newId);
    await api(store, T, { action: 'edit', classId: 'et', assignmentId: made.id, label: 'classwork' }, 200, newId);
    assert.equal(defs(store)[made.id].label, 'classwork');
    await api(store, T, { action: 'edit', classId: 'et', assignmentId: made.id, title: 'Work 2' }, 300, newId);
    assert.equal(defs(store)[made.id].label, 'classwork');
  });

  test(name + ': unknown labels are refused; old assignments without a label read as Homework', async () => {
    let n = 0; const newId = () => 'a' + (++n);
    const store = makeStore(seed());
    await assert.rejects(api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'X', label: 'quiz', assignedAt: 0 }, 100, newId), { code: 400 });
    const made = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Old', assignedAt: 0 }, 100, newId);
    delete defs(store)[made.id].label;
    const list = await api(store, T, { action: 'teacherList', classId: 'et' }, 300);
    assert.equal(list.assignments[0].label, 'homework');
    await assert.rejects(api(store, T, { action: 'edit', classId: 'et', assignmentId: made.id, label: '<b>' }, 400, newId), { code: 400 });
  });
}
