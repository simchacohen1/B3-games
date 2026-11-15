'use strict';
// Optional Subject (e.g. Chumash, Mishnayos) on homework assignments.
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
  test(name + ': subject is saved, trimmed, capped and shown to the teacher', async () => {
    let n = 0; const newId = () => 'a' + (++n);
    const store = makeStore(seed());
    const plain = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Plain', assignedAt: 0 }, 100, newId);
    const tagged = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Tagged', subject: '  Chumash <b> ', assignedAt: 0 }, 200, newId);
    const long = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Long', subject: 'x'.repeat(100), assignedAt: 0 }, 300, newId);
    assert.equal(defs(store)[plain.id].subject, '');
    assert.equal(defs(store)[tagged.id].subject, 'Chumash b');
    assert.equal(defs(store)[long.id].subject.length, 60);
    const list = await api(store, T, { action: 'teacherList', classId: 'et' }, 400);
    const byId = Object.fromEntries(list.assignments.map(a => [a.id, a]));
    assert.equal(byId[plain.id].subject, '');
    assert.equal(byId[tagged.id].subject, 'Chumash b');
  });

  test(name + ': edit changes or clears the subject, and keeps it when not sent', async () => {
    let n = 0; const newId = () => 'a' + (++n);
    const store = makeStore(seed());
    const made = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Work', subject: 'Chumash', assignedAt: 0 }, 100, newId);
    await api(store, T, { action: 'edit', classId: 'et', assignmentId: made.id, title: 'Work 2' }, 200, newId);
    assert.equal(defs(store)[made.id].subject, 'Chumash');
    await api(store, T, { action: 'edit', classId: 'et', assignmentId: made.id, subject: 'Mishnayos' }, 300, newId);
    assert.equal(defs(store)[made.id].subject, 'Mishnayos');
    await api(store, T, { action: 'edit', classId: 'et', assignmentId: made.id, subject: '' }, 400, newId);
    assert.equal(defs(store)[made.id].subject, '');
  });

  test(name + ': older assignments without a subject read as blank', async () => {
    let n = 0; const newId = () => 'a' + (++n);
    const store = makeStore(seed());
    const made = await api(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Old', assignedAt: 0 }, 100, newId);
    delete defs(store)[made.id].subject;
    const list = await api(store, T, { action: 'teacherList', classId: 'et' }, 200);
    assert.equal(list.assignments[0].subject, '');
  });
}
