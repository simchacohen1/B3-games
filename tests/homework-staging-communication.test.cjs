'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { homeworkApi } = require('../backend/functions/homework-staging/homework-core.cjs');

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
const voiceDataURL = (size = 64) => 'data:audio/webm;base64,' + Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(size, 7)]).toString('base64');
let serial = 0;
async function publishedAssignment(store) {
  const { id } = await homeworkApi(store, teacher, { action: 'create', classId: 'et', type: 'other', title: 'Practice' }, 1, () => 'hw' + (++serial));
  await homeworkApi(store, teacher, { action: 'publish', classId: 'et', assignmentId: id }, 2);
  return id;
}

test('teacher and student exchange private text and voice comments on the same assignment', async () => {
  const store = makeStore(), assignmentId = await publishedAssignment(store);
  const voice = voiceDataURL();
  const teacherSent = await homeworkApi(store, teacher, { action: 'comment', classId: 'et', assignmentId, studentId: 's1', text: 'Try reading that line once more.' }, 10, () => 'teacher-note');
  const voiceSent = await homeworkApi(store, teacher, { action: 'comment', classId: 'et', assignmentId, studentId: 's1', voiceDataURL: voice }, 11, () => 'teacher-voice');
  await homeworkApi(store, {}, { action: 'comment', ...student(), assignmentId, text: 'I will practice after lunch.' }, 12, () => 'student-note');
  const studentView = await homeworkApi(store, {}, { action: 'studentList', ...student() }, 13);
  const messages = studentView.assignments[0].messages;
  assert.deepEqual(messages.map(message => message.role), ['teacher', 'teacher', 'student']);
  assert.equal(messages[0].text, 'Try reading that line once more.');
  assert.equal(messages[1].voice, true);
  assert.equal('voiceDataURL' in messages[1], false, 'audio bytes stay out of list responses');
  const listenedByStudent = await homeworkApi(store, {}, { action: 'voiceRead', ...student(), assignmentId, messageId: voiceSent.message.id }, 14);
  const teacherView = await homeworkApi(store, teacher, { action: 'teacherList', classId: 'et' }, 15);
  const listenedByTeacher = await homeworkApi(store, teacher, { action: 'voiceRead', classId: 'et', assignmentId, studentId: 's1', messageId: voiceSent.message.id }, 16);
  assert.equal(listenedByStudent.voiceDataURL, voice);
  assert.equal(listenedByTeacher.voiceDataURL, voice);
  assert.ok(teacherSent.ok);
  assert.equal(teacherView.assignments[0].students.s1.messages.length, 3);
  await assert.rejects(homeworkApi(store, teacher, { action: 'voiceRead', classId: 'et', assignmentId, studentId: 's2', messageId: voiceSent.message.id }, 17), { code: 404 });
  await assert.rejects(homeworkApi(store, {}, { action: 'voiceRead', ...student('s2', 'Dan Two', '2222'), assignmentId, messageId: voiceSent.message.id }, 18), { code: 404 });
});

test('voice notes reject oversized or non-audio data and enforce per-assignment limits', async () => {
  const store = makeStore(), assignmentId = await publishedAssignment(store);
  const send = voiceDataURL => homeworkApi(store, teacher, { action: 'comment', classId: 'et', assignmentId, studentId: 's1', voiceDataURL }, 20, () => 'voice-' + (++serial));
  const oversized = voiceDataURL(100001);
  await assert.rejects(send(oversized), { code: 413 });
  await assert.rejects(send('data:text/html;base64,QQ=='), { code: 400 });
  const shortClip = voiceDataURL(8);
  for (let i = 0; i < 6; i++) await send(shortClip);
  await assert.rejects(send(shortClip), { code: 429 });
  await assert.rejects(send('data:audio/webm;base64,' + Buffer.alloc(8, 5).toString('base64')), { code: 400 });
});
