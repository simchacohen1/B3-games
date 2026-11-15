'use strict';
// Homework notes (#621): standalone teacher/student messages that are not tied to an assignment,
// and voice notes that send on their own (no typing, no hand-in). Runs on the live and staging copies.
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
    teachers: { t1: { active: true, classIds: { et: true } }, t2: { active: true, classIds: { wt: true } } }
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
const teacher = { identity: { uid: 't1', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
const otherTeacher = { identity: { uid: 't2', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
const student = (id = 's1', name = 'Sam One', pin = '1111') => ({ studentId: id, studentName: name, pin, classId: 'et' });
const voiceDataURL = (size = 64, fill = 7) => 'data:audio/webm;base64,' + Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(size, fill)]).toString('base64');
let serial = 0;
const ids = () => 'm' + (++serial);
const threadPath = sid => ['assignmentCenter', 'workspaces', 'b3-2026', 'classes', 'et', 'messages', sid];
const thread = (store, sid) => threadPath(sid).reduce((node, key) => node == null ? null : node[key], store.data);

for (const [name, homeworkApi] of Object.entries(cores)) {
  test(`${name}: a student sends a voice note on its own, with no text and no hand-in`, async () => {
    const store = makeStore();
    const { id } = await homeworkApi(store, teacher, { action: 'create', classId: 'et', type: 'other', title: 'Practice' }, 1, ids);
    await homeworkApi(store, teacher, { action: 'publish', classId: 'et', assignmentId: id }, 2);
    const voice = voiceDataURL();
    const sent = await homeworkApi(store, {}, { action: 'comment', ...student(), assignmentId: id, voiceDataURL: voice }, 10, ids);
    assert.equal(sent.ok, true);
    assert.equal(sent.message.voice, true);
    assert.equal(sent.message.text, '');
    const view = await homeworkApi(store, {}, { action: 'studentList', ...student() }, 11);
    assert.equal(view.assignments[0].status, 'assigned', 'sending a note does not hand the homework in');
    const teacherView = await homeworkApi(store, teacher, { action: 'teacherList', classId: 'et' }, 12);
    const msgs = teacherView.assignments[0].students.s1.messages;
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].voice, true);
    assert.equal(msgs[0].unread, true);
    const played = await homeworkApi(store, teacher, { action: 'voiceRead', classId: 'et', assignmentId: id, studentId: 's1', messageId: sent.message.id }, 13);
    assert.equal(played.voiceDataURL, voice);
    // Text alone and text + voice still work.
    await homeworkApi(store, {}, { action: 'comment', ...student(), assignmentId: id, text: 'Just text' }, 14, ids);
    await homeworkApi(store, {}, { action: 'comment', ...student(), assignmentId: id, text: 'Both', voiceDataURL: voice }, 15, ids);
    await assert.rejects(homeworkApi(store, {}, { action: 'comment', ...student(), assignmentId: id }, 16, ids), { code: 400 });
  });

  test(`${name}: standalone thread works without an assignment, in both directions`, async () => {
    const store = makeStore(); // no assignment exists at all
    const voice = voiceDataURL();
    const studentVoice = await homeworkApi(store, {}, { action: 'comment', ...student(), voiceDataURL: voice }, 10, ids);
    await homeworkApi(store, {}, { action: 'comment', ...student(), text: 'Can I ask about Rashi?' }, 11, ids);
    const teacherView = await homeworkApi(store, teacher, { action: 'teacherList', classId: 'et' }, 12);
    assert.deepEqual(teacherView.assignments, []);
    assert.deepEqual(teacherView.messages.s2, []);
    const t = teacherView.messages.s1;
    assert.deepEqual(t.map(m => [m.role, m.voice, m.text, m.unread]), [['student', true, '', true], ['student', false, 'Can I ask about Rashi?', true]]);
    assert.equal(JSON.stringify(teacherView).includes('base64'), false, 'audio never rides along in the list');
    assert.equal((await homeworkApi(store, teacher, { action: 'voiceRead', classId: 'et', studentId: 's1', messageId: studentVoice.message.id }, 13)).voiceDataURL, voice);

    const reply = await homeworkApi(store, teacher, { action: 'comment', classId: 'et', studentId: 's1', voiceDataURL: voice }, 14, ids);
    await homeworkApi(store, teacher, { action: 'comment', classId: 'et', studentId: 's1', text: 'Yes, after class.', voiceDataURL: voice }, 15, ids);
    const studentView = await homeworkApi(store, {}, { action: 'studentList', ...student() }, 16);
    const mine = studentView.general.messages;
    assert.deepEqual(mine.map(m => [m.role, m.unread]), [['student', false], ['student', false], ['teacher', true], ['teacher', true]]);
    assert.equal(mine[3].text, 'Yes, after class.');
    assert.equal((await homeworkApi(store, {}, { action: 'voiceRead', ...student(), messageId: reply.message.id }, 17)).voiceDataURL, voice);

    await homeworkApi(store, {}, { action: 'markRead', ...student() }, 18);
    assert.equal((await homeworkApi(store, {}, { action: 'studentList', ...student() }, 19)).general.messages.filter(m => m.unread).length, 0);
    // Replying counted as reading for the teacher.
    assert.equal((await homeworkApi(store, teacher, { action: 'teacherList', classId: 'et' }, 20)).messages.s1.filter(m => m.unread).length, 0);
    // Stored per student per class, away from assignment records.
    assert.equal(thread(store, 's1').messages.length, 4);
    assert.equal(store.data.assignmentCenter.workspaces['b3-2026'].classes.et.students, undefined);
  });

  test(`${name}: standalone threads stay private to the student, their class and its teacher`, async () => {
    const store = makeStore();
    const sent = await homeworkApi(store, {}, { action: 'comment', ...student(), voiceDataURL: voiceDataURL() }, 10, ids);
    // Another student cannot play it or see it.
    await assert.rejects(homeworkApi(store, {}, { action: 'voiceRead', ...student('s2', 'Dan Two', '2222'), messageId: sent.message.id }, 11), { code: 404 });
    assert.deepEqual((await homeworkApi(store, {}, { action: 'studentList', ...student('s2', 'Dan Two', '2222') }, 12)).general.messages, []);
    // Wrong passcode is refused.
    await assert.rejects(homeworkApi(store, {}, { action: 'comment', ...student('s1', 'Sam One', '9999'), text: 'hi' }, 13, ids));
    // A teacher of another class cannot read, reply or mark read.
    await assert.rejects(homeworkApi(store, otherTeacher, { action: 'voiceRead', classId: 'et', studentId: 's1', messageId: sent.message.id }, 14), { code: 403 });
    await assert.rejects(homeworkApi(store, otherTeacher, { action: 'comment', classId: 'wt', studentId: 's1', text: 'hi' }, 15, ids), { code: 404 });
    // The teacher can only reach students in the class.
    await assert.rejects(homeworkApi(store, teacher, { action: 'comment', classId: 'et', studentId: 's3', text: 'hi' }, 16, ids), { code: 404 });
    await assert.rejects(homeworkApi(store, teacher, { action: 'comment', classId: 'et', text: 'hi' }, 17, ids), { code: 404 });
    // An unknown assignment id is still refused, not silently sent to the standalone thread.
    await assert.rejects(homeworkApi(store, {}, { action: 'comment', ...student(), assignmentId: 'nope', text: 'hi' }, 18, ids), { code: 404 });
    // Unauthenticated teacher-shaped requests fall to the student path and fail sign-in.
    await assert.rejects(homeworkApi(store, {}, { action: 'comment', classId: 'et', studentId: 's1', text: 'hi' }, 19, ids));
  });

  test(`${name}: standalone voice notes keep the server size and format checks`, async () => {
    const store = makeStore();
    const send = (voice, now = 20) => homeworkApi(store, {}, { action: 'comment', ...student(), voiceDataURL: voice }, now, ids);
    await assert.rejects(send(voiceDataURL(100001)), { code: 413 });
    await assert.rejects(send('data:text/html;base64,QQ=='), { code: 400 });
    await assert.rejects(send('data:audio/webm;base64,' + Buffer.alloc(8, 5).toString('base64')), { code: 400 });
    await assert.rejects(homeworkApi(store, {}, { action: 'comment', ...student(), text: '   ' }, 21, ids), { code: 400 });
    assert.equal(thread(store, 's1'), null, 'nothing is stored from a refused note');
  });

  test(`${name}: the standalone thread rolls off old notes instead of filling up, and slows down bursts`, async () => {
    const store = makeStore();
    const minute = 60 * 1000;
    let now = 1000, firstVoice = null;
    // 8 voice notes, spread out so the burst limit does not apply: only the newest 6 keep audio.
    for (let i = 0; i < 8; i++) {
      const sent = await homeworkApi(store, {}, { action: 'comment', ...student(), voiceDataURL: voiceDataURL(16, i) }, now += 11 * minute, ids);
      if (!firstVoice) firstVoice = sent.message.id;
    }
    let t = thread(store, 's1');
    assert.equal(t.messages.filter(m => m.voice).length, 6);
    assert.equal(Object.keys(t.voiceNotes).length, 6);
    assert.equal(firstVoice in t.voiceNotes, false, 'the oldest audio is removed, not kept forever');
    await assert.rejects(homeworkApi(store, {}, { action: 'voiceRead', ...student(), messageId: firstVoice }, now + 1), { code: 404 });
    // Text rolls off after 30 messages.
    for (let i = 0; i < 40; i++) await homeworkApi(store, teacher, { action: 'comment', classId: 'et', studentId: 's1', text: 'note ' + i }, now += 11 * minute, ids);
    t = thread(store, 's1');
    assert.equal(t.messages.length, 30);
    assert.equal(t.messages.at(-1).text, 'note 39');
    assert.equal(Object.keys(t.voiceNotes || {}).length, 0, 'audio for rolled-off notes is gone too');
    // Burst limit: 10 messages per side in 10 minutes.
    for (let i = 0; i < 10; i++) await homeworkApi(store, {}, { action: 'comment', ...student(), text: 'hi ' + i }, now += 1000, ids);
    await assert.rejects(homeworkApi(store, {}, { action: 'comment', ...student(), text: 'one more' }, now += 1000, ids), { code: 429 });
    // The other side is not blocked by the student's burst.
    await homeworkApi(store, teacher, { action: 'comment', classId: 'et', studentId: 's1', text: 'reply' }, now += 1000, ids);
  });
}
