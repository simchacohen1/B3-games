'use strict';
// Homework Messages tab (#647): one-on-one conversations between a student and each of their
// teachers or the principal. Runs on the live and staging copies of the homework service.
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
    teachers: {
      t1: { active: true, displayName: 'Rabbi Alef', classIds: { et: true } },
      t2: { active: true, displayName: 'rabbi.bet@example.org', classIds: { wt: true } },
      p1: { active: true, accountType: 'principal', displayName: 'Principal Gimmel', classIds: { et: true, wt: true } },
      gone: { active: false, displayName: 'Old Teacher', classIds: { et: true } }
    }
  } }, students: {
    s1: { profile: { name: 'Sam One' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
    s2: { profile: { name: 'Dan Two' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
    s3: { profile: { name: 'Eli Three' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'wt' } } } } },
    b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' }, s3: { passcode: '3333' } } } };
  const files = {};
  const get = async path => path.split('/').reduce((node, key) => node == null ? null : node[key], data) ?? null;
  const set = async (path, value) => { const keys = path.split('/'); let node = data; for (const key of keys.slice(0, -1)) node = node[key] ||= {}; if (value === null) delete node[keys.at(-1)]; else node[keys.at(-1)] = structuredClone(value); };
  const tx = async (path, fn) => { const current = await get(path), next = fn(current == null ? null : structuredClone(current)); if (next === undefined) return { committed: false }; await set(path, next); return { committed: true }; };
  return { data, files, get, set, tx,
    putFile: async (p, buf, contentType) => { files[p] = { data: Buffer.from(buf), contentType }; },
    getFile: async p => files[p] || null,
    deleteFile: async p => { delete files[p]; } };
}
const who = uid => ({ identity: { uid, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const t1 = who('t1'), t2 = who('t2'), p1 = who('p1');
const student = (id = 's1', name = 'Sam One', pin = '1111', classId = 'et') => ({ studentId: id, studentName: name, pin, classId });
const voice = (size = 64) => 'data:audio/webm;base64,' + Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(size, 7)]).toString('base64');
let serial = 0;
const ids = () => 'm' + (++serial);

for (const [name, api] of Object.entries(cores)) {
  test(`${name}: contacts come from class enrollment — student sees own teachers and the principal only`, async () => {
    const store = makeStore();
    const inbox = await api(store, {}, { action: 'dmInbox', ...student() }, 1);
    const contacts = inbox.groups.flatMap(g => g.contacts);
    assert.deepEqual(contacts.map(c => c.id).sort(), ['p1', 't1'], 'no teacher of another class, no inactive teacher');
    assert.equal(contacts.find(c => c.id === 'p1').kind, 'principal');
    assert.equal(contacts.find(c => c.id === 't1').name, 'Rabbi Alef');
    const other = await api(store, {}, { action: 'dmInbox', ...student('s3', 'Eli Three', '3333', 'wt') }, 1);
    const names = other.groups.flatMap(g => g.contacts).map(c => c.name);
    assert.ok(names.includes('Rabbi Bet'), 'an email-shaped name is shown without the email address');
    assert.ok(!names.some(n => n.includes('@')));
  });

  test(`${name}: teacher sees students grouped by class; principal sees every supervised class`, async () => {
    const store = makeStore();
    const inbox = await api(store, t1, { action: 'dmInbox' }, 1);
    assert.deepEqual(inbox.groups.map(g => g.name), ['Test Class Alef']);
    assert.deepEqual(inbox.groups[0].contacts.map(c => c.name).sort(), ['Dan Two', 'Sam One']);
    const pInbox = await api(store, p1, { action: 'dmInbox' }, 1);
    assert.deepEqual(pInbox.groups.map(g => g.id).sort(), ['et', 'wt']);
  });

  test(`${name}: a long voice message sends on its own, plays back, and counts as unread`, async () => {
    const store = makeStore();
    const big = voice(2_000_000); // ~2 MB: far past the old 15-second / 100 KB limit
    const sent = await api(store, {}, { action: 'dmSend', ...student(), teacherId: 't1', voiceDataURL: big, durationMs: 240000 }, 10, ids);
    assert.equal(sent.message.voice, true);
    assert.equal(sent.message.durationMs, 240000);
    assert.equal(Object.keys(store.files).length, 1, 'audio is stored as a file, not in the database');
    assert.ok(!JSON.stringify(store.data).includes(big.slice(40, 200)), 'no audio in the database');
    assert.equal((await api(store, t1, { action: 'dmUnread' }, 11)).unread, 1);
    const inbox = await api(store, t1, { action: 'dmInbox' }, 11);
    const row = inbox.groups[0].contacts.find(c => c.id === 's1');
    assert.equal(row.unread, 1); assert.equal(row.lastVoice, true);
    const thread = await api(store, t1, { action: 'dmThread', classId: 'et', studentId: 's1' }, 12);
    assert.equal(thread.messages.length, 1); assert.equal(thread.messages[0].unread, true);
    const played = await api(store, t1, { action: 'dmVoice', classId: 'et', studentId: 's1', messageId: sent.message.id }, 13);
    assert.equal(played.voiceDataURL, big);
    await api(store, t1, { action: 'dmRead', classId: 'et', studentId: 's1' }, 14);
    assert.equal((await api(store, t1, { action: 'dmUnread' }, 15)).unread, 0);
    // Reply reaches the student as unread.
    await api(store, t1, { action: 'dmSend', classId: 'et', studentId: 's1', voiceDataURL: voice() }, 16, ids);
    assert.equal((await api(store, {}, { action: 'dmUnread', ...student() }, 17)).unread, 1);
  });

  test(`${name}: voice messages over the 5-minute safety cap are refused`, async () => {
    const store = makeStore();
    await assert.rejects(api(store, {}, { action: 'dmSend', ...student(), teacherId: 't1', voiceDataURL: voice(3_100_000) }, 1, ids), { code: 413 });
    assert.equal(Object.keys(store.files).length, 0);
  });

  test(`${name}: conversations are private — each adult has their own thread`, async () => {
    const store = makeStore();
    await api(store, {}, { action: 'dmSend', ...student(), teacherId: 't1', text: 'For Rabbi Alef only' }, 1, ids);
    const principalView = await api(store, p1, { action: 'dmThread', classId: 'et', studentId: 's1' }, 2);
    assert.equal(principalView.messages.length, 0);
    await assert.rejects(api(store, t2, { action: 'dmThread', classId: 'et', studentId: 's1' }, 2), { code: 403 }, 'teacher of another class');
    await assert.rejects(api(store, {}, { action: 'dmSend', ...student(), teacherId: 't2', text: 'hi' }, 2, ids), { code: 404 }, 'not my teacher');
    await assert.rejects(api(store, {}, { action: 'dmSend', ...student(), teacherId: 'gone', text: 'hi' }, 2, ids), { code: 404 }, 'inactive teacher');
    await assert.rejects(api(store, {}, { action: 'dmThread', ...student('s1', 'Sam One', '9999'), teacherId: 't1' }, 2), err => err.code === 401 || err.code === 403);
    await assert.rejects(api(store, t1, { action: 'dmThread', classId: 'et', studentId: 's3' }, 2), { code: 404 }, 'student not in that class');
  });

  test(`${name}: a message started from a homework post is tagged to it and does not hand it in`, async () => {
    const store = makeStore();
    const { id } = await api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Learn Perek Alef' }, 1, ids);
    await api(store, t1, { action: 'publish', classId: 'et', assignmentId: id }, 2);
    const list = await api(store, {}, { action: 'studentList', ...student() }, 3);
    assert.equal(list.assignments[0].teacherId, 't1', 'the homework says which teacher gave it');
    const sent = await api(store, {}, { action: 'dmSend', ...student(), teacherId: 't1', assignmentId: id, voiceDataURL: voice() }, 4, ids);
    assert.equal(sent.message.assignmentId, id);
    assert.equal(sent.message.assignmentTitle, 'Learn Perek Alef');
    const thread = await api(store, t1, { action: 'dmThread', classId: 'et', studentId: 's1' }, 5);
    assert.equal(thread.messages[0].assignmentId, id);
    const after = await api(store, {}, { action: 'studentList', ...student() }, 6);
    assert.equal(after.assignments[0].status, 'assigned', 'sending a message never hands the homework in');
    // Draft or someone else's homework cannot be linked.
    const draft = await api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Draft' }, 7, ids);
    await assert.rejects(api(store, {}, { action: 'dmSend', ...student(), teacherId: 't1', assignmentId: draft.id, text: 'x' }, 8, ids), { code: 404 });
    const teacherLinked = await api(store, t1, { action: 'dmSend', classId: 'et', studentId: 's1', assignmentId: id, text: 'Good job' }, 9, ids);
    assert.equal(teacherLinked.message.assignmentTitle, 'Learn Perek Alef');
    const teacherDraft = await api(store, t1, { action: 'dmSend', classId: 'et', studentId: 's1', assignmentId: draft.id, text: 'x' }, 10, ids).catch(e => e);
    assert.equal(teacherDraft.code, 404);
  });

  test(`${name}: the existing homework tabs and per-homework notes keep working`, async () => {
    const store = makeStore();
    const { id } = await api(store, t1, { action: 'create', classId: 'et', type: 'other', title: 'Practice' }, 1, ids);
    await api(store, t1, { action: 'publish', classId: 'et', assignmentId: id }, 2);
    await api(store, {}, { action: 'comment', ...student(), assignmentId: id, text: 'Question' }, 3, ids);
    await api(store, {}, { action: 'submit', ...student(), assignmentId: id, answer: 'Done' }, 4);
    const view = await api(store, {}, { action: 'studentList', ...student() }, 5);
    assert.equal(view.assignments[0].status, 'submitted');
    assert.equal(view.assignments[0].messages.length, 1);
  });

  test(`${name}: an owner/admin who is not on the teacher list can start a chat the student can answer`, async () => {
    const store = makeStore();
    store.data.b3Games.admins.a1 = { active: true };
    const admin = { identity: { uid: 'a1', name: 'Office', email: 'office@example.org', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
    await api(store, admin, { action: 'dmSend', classId: 'et', studentId: 's1', text: 'Hello from the office' }, 1, ids);
    const inbox = await api(store, {}, { action: 'dmInbox', ...student() }, 2);
    const row = inbox.groups[0].contacts.find(c => c.id === 'a1');
    assert.ok(row); assert.equal(row.unread, 1); assert.equal(row.name, 'Office');
    await api(store, {}, { action: 'dmSend', ...student(), teacherId: 'a1', text: 'Thanks' }, 3, ids);
    // Another student never sees it.
    const other = await api(store, {}, { action: 'dmInbox', ...student('s2', 'Dan Two', '2222') }, 4);
    assert.ok(!other.groups[0].contacts.some(c => c.id === 'a1'));
  });
}
