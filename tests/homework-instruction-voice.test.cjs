'use strict';
// Homework (#629): a teacher can attach a recorded voice message ("Record instructions") to an
// assignment. Only the teacher who created the assignment can add, replace or remove it; students can
// only play it, and only for published assignments they are assigned. Runs on the live and staging copies.
const test = require('node:test');
const assert = require('node:assert/strict');

const cores = {
  live: require('../backend/functions/homework-core.cjs').homeworkApi,
  staging: require('../backend/functions/homework-staging/homework-core.cjs').homeworkApi
};

function makeStore() {
  const data = { b3Games: { admins: {}, workspaces: { 'b3-2026': {
    classes: {
      et: { name: 'Test Class Alef', toolGrants: { homework: true }, members: { s1: { active: true }, s2: { active: true } } },
      wt: { name: 'Test Class Bet', toolGrants: { homework: true }, members: { s3: { active: true } } }
    },
    // t1 and t2 co-teach Alef; t3 teaches Bet only.
    teachers: { t1: { active: true, classIds: { et: true } }, t2: { active: true, classIds: { et: true } },
      t3: { active: true, classIds: { wt: true } } }
  } }, students: {
    s1: { profile: { name: 'Sam One' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
    s2: { profile: { name: 'Dan Two' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
    s3: { profile: { name: 'Eli Three' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'wt' } } } } },
    b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' }, s3: { passcode: '3333' } } } };
  const get = async path => path.split('/').reduce((node, key) => node == null ? null : node[key], data) ?? null;
  const set = async (path, value) => { const keys = path.split('/'); let node = data; for (const key of keys.slice(0, -1)) node = node[key] ||= {}; if (value === null) delete node[keys.at(-1)]; else node[keys.at(-1)] = structuredClone(value); };
  const tx = async (path, fn) => { const current = await get(path), next = fn(current == null ? null : structuredClone(current)); if (next === undefined) return { committed: false }; await set(path, next); return { committed: true }; };
  return { data, get, set, tx };
}
const teacherAuth = uid => ({ identity: { uid, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const t1 = teacherAuth('t1'), t2 = teacherAuth('t2'), t3 = teacherAuth('t3');
const s1 = { studentId: 's1', studentName: 'Sam One', pin: '1111', classId: 'et' };
const s2 = { studentId: 's2', studentName: 'Dan Two', pin: '2222', classId: 'et' };
const s3 = { studentId: 's3', studentName: 'Eli Three', pin: '3333', classId: 'wt' };
const voice = (fill = 7, size = 64) => 'data:audio/webm;base64,' + Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(size, fill)]).toString('base64');
let serial = 0;
const ids = () => 'a' + (++serial);
const audioAt = (store, classId, id) => store.data.assignmentCenter?.workspaces?.['b3-2026']?.classes?.[classId]?.instructionVoice?.[id] ?? null;
const defAt = (store, id) => store.data.assignmentCenter.workspaces['b3-2026'].classes.et.definitions[id];

for (const [name, api] of Object.entries(cores)) {
  async function published(store, body = {}) {
    const { id } = await api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Listen and practice', details: 'Say each word.', ...body }, 1, ids);
    await api(store, t1, { action: 'publish', classId: 'et', assignmentId: id }, 2);
    return id;
  }

  test(`${name}: a teacher creates an assignment with recorded instructions; the audio stays out of every list`, async () => {
    const store = makeStore();
    const id = await published(store, { voiceDataURL: voice() });
    assert.equal(audioAt(store, 'et', id), voice(), 'audio is stored apart from the definition');
    assert.deepEqual(defAt(store, id).instructionVoice, { at: 1, by: 't1' });
    assert.equal(JSON.stringify(defAt(store, id)).includes('base64'), false);
    const teacherView = await api(store, t1, { action: 'teacherList', classId: 'et' }, 3);
    assert.equal(teacherView.assignments[0].instructionVoice, true);
    assert.equal(teacherView.assignments[0].ownedByMe, true);
    assert.equal(JSON.stringify(teacherView).includes('base64'), false);
    const coTeacherView = await api(store, t2, { action: 'teacherList', classId: 'et' }, 3);
    assert.equal(coTeacherView.assignments[0].ownedByMe, false);
    const view = await api(store, {}, { action: 'studentList', ...s1 }, 4);
    assert.equal(view.assignments[0].instructionVoice, true);
    assert.equal(JSON.stringify(view).includes('base64'), false);
    // The class's teachers can play it to check it.
    assert.equal((await api(store, t2, { action: 'instructionVoiceRead', classId: 'et', assignmentId: id }, 5)).voiceDataURL, voice());
  });

  test(`${name}: text-only assignments work exactly as before`, async () => {
    const store = makeStore();
    const id = await published(store);
    assert.equal('instructionVoice' in defAt(store, id), false);
    assert.equal(audioAt(store, 'et', id), null);
    const view = await api(store, {}, { action: 'studentList', ...s1 }, 3);
    assert.equal(view.assignments[0].instructionVoice, false);
    assert.equal(view.assignments[0].details, 'Say each word.');
    await assert.rejects(api(store, {}, { action: 'instructionVoiceRead', ...s1, assignmentId: id }, 4), { code: 404 });
    // An ordinary edit (no voice fields) by a co-teacher is unchanged.
    await api(store, t2, { action: 'edit', classId: 'et', assignmentId: id, title: 'New name' }, 5);
    assert.equal(defAt(store, id).title, 'New name');
  });

  test(`${name}: a student replays the recorded instructions as many times as they like`, async () => {
    const store = makeStore();
    const id = await published(store, { voiceDataURL: voice() });
    for (let i = 0; i < 5; i++) {
      const played = await api(store, {}, { action: 'instructionVoiceRead', ...s1, assignmentId: id }, 10 + i);
      assert.equal(played.voiceDataURL, voice());
    }
    const view = await api(store, {}, { action: 'studentList', ...s1 }, 20);
    assert.equal(view.assignments[0].status, 'assigned', 'listening does not change or hand in the work');
  });

  test(`${name}: students can only play it when they are assigned, signed in, and it is published`, async () => {
    const store = makeStore();
    // Draft: not visible yet.
    const { id: draft } = await api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Draft', voiceDataURL: voice() }, 1, ids);
    await assert.rejects(api(store, {}, { action: 'instructionVoiceRead', ...s1, assignmentId: draft }, 2), { code: 404 });
    // Assigned to s1 only.
    const { id } = await api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Only Sam', studentIds: ['s1'], voiceDataURL: voice() }, 1, ids);
    await api(store, t1, { action: 'publish', classId: 'et', assignmentId: id }, 2);
    assert.equal((await api(store, {}, { action: 'instructionVoiceRead', ...s1, assignmentId: id }, 3)).voiceDataURL, voice());
    await assert.rejects(api(store, {}, { action: 'instructionVoiceRead', ...s2, assignmentId: id }, 3), { code: 404 });
    // Another class's student, even naming this assignment.
    await assert.rejects(api(store, {}, { action: 'instructionVoiceRead', ...s3, assignmentId: id }, 3), { code: 404 });
    // Wrong passcode.
    await assert.rejects(api(store, {}, { action: 'instructionVoiceRead', ...s1, pin: '9999', assignmentId: id }, 3));
    // Another class's teacher.
    await assert.rejects(api(store, t3, { action: 'instructionVoiceRead', classId: 'et', assignmentId: id }, 3), { code: 403 });
    // Students cannot change it.
    await assert.rejects(api(store, {}, { action: 'edit', ...s1, assignmentId: id, voiceDataURL: voice(9) }, 4), { code: 401 });
    assert.equal(audioAt(store, 'et', id), voice());
  });

  test(`${name}: a teacher cannot add, replace or remove the recording on another teacher's assignment`, async () => {
    const store = makeStore();
    const withVoice = await published(store, { voiceDataURL: voice() });
    const textOnly = await published(store);
    const before = structuredClone(defAt(store, withVoice));
    await assert.rejects(api(store, t2, { action: 'edit', classId: 'et', assignmentId: withVoice, voiceDataURL: voice(9) }, 5),
      { code: 403, message: /Only the teacher who created this assignment/ });
    await assert.rejects(api(store, t2, { action: 'edit', classId: 'et', assignmentId: withVoice, removeVoice: true, title: 'Hijack' }, 5), { code: 403 });
    await assert.rejects(api(store, t2, { action: 'edit', classId: 'et', assignmentId: textOnly, voiceDataURL: voice(9) }, 5), { code: 403 });
    // Even a bad file is refused for ownership first, and nothing changed (not even the title).
    await assert.rejects(api(store, t2, { action: 'edit', classId: 'et', assignmentId: withVoice, voiceDataURL: 'nope' }, 5), { code: 403 });
    assert.deepEqual(defAt(store, withVoice), before);
    assert.equal(audioAt(store, 'et', withVoice), voice());
    assert.equal(audioAt(store, 'et', textOnly), null);
    // A teacher of another class cannot reach it at all.
    await assert.rejects(api(store, t3, { action: 'edit', classId: 'et', assignmentId: withVoice, removeVoice: true }, 5), { code: 403 });
  });

  test(`${name}: the owner adds, replaces and removes the recording while editing`, async () => {
    const store = makeStore();
    const id = await published(store);
    await api(store, t1, { action: 'edit', classId: 'et', assignmentId: id, voiceDataURL: voice(1) }, 5);
    assert.equal((await api(store, {}, { action: 'instructionVoiceRead', ...s1, assignmentId: id }, 6)).voiceDataURL, voice(1));
    await api(store, t1, { action: 'edit', classId: 'et', assignmentId: id, voiceDataURL: voice(2) }, 7);
    assert.equal((await api(store, {}, { action: 'instructionVoiceRead', ...s1, assignmentId: id }, 8)).voiceDataURL, voice(2));
    // A plain edit keeps the recording.
    await api(store, t1, { action: 'edit', classId: 'et', assignmentId: id, title: 'Renamed' }, 9);
    assert.equal(defAt(store, id).instructionVoice.at, 7);
    await api(store, t1, { action: 'edit', classId: 'et', assignmentId: id, removeVoice: true }, 10);
    assert.equal(defAt(store, id).instructionVoice, null);
    assert.equal(audioAt(store, 'et', id), null);
    assert.equal((await api(store, {}, { action: 'studentList', ...s1 }, 11)).assignments[0].instructionVoice, false);
    await assert.rejects(api(store, {}, { action: 'instructionVoiceRead', ...s1, assignmentId: id }, 12), { code: 404 });
  });

  test(`${name}: recorded instructions use the same size and format checks as voice notes`, async () => {
    const store = makeStore();
    const create = extra => api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Checks', ...extra }, 1, ids);
    await assert.rejects(create({ voiceDataURL: voice(7, 100001) }), { code: 413 });
    await assert.rejects(create({ voiceDataURL: 'data:audio/webm;base64,' + Buffer.alloc(64, 7).toString('base64') }), { code: 400 });
    await assert.rejects(create({ voiceDataURL: 'data:text/html;base64,PGI+' }), { code: 400 });
    await assert.rejects(create({ voiceDataURL: 123 }), { code: 400 });
    assert.equal(store.data.assignmentCenter, undefined, 'a refused recording creates nothing');
    // Archived assignments stay read only, owner included.
    const { id } = await create({ voiceDataURL: voice() });
    await api(store, t1, { action: 'archive', classId: 'et', assignmentId: id }, 2);
    await assert.rejects(api(store, t1, { action: 'edit', classId: 'et', assignmentId: id, removeVoice: true }, 3), { code: 409 });
  });

  test(`${name}: deleting a draft also deletes its recording`, async () => {
    const store = makeStore();
    const { id } = await api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Draft', voiceDataURL: voice() }, 1, ids);
    await api(store, t1, { action: 'delete', classId: 'et', assignmentId: id }, 2);
    assert.equal(audioAt(store, 'et', id), null);
  });
}
