'use strict';
// Security, privacy and hostile-input tests for Homework + Messaging on SYNTHETIC data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { students: S, teachers: T, makeStore } = require('./fixtures/synthetic-class.cjs');
const { messagesApi } = require('../backend/functions/messages-core.cjs');
const { homeworkApi } = require('../backend/functions/homework-core.cjs');

let now = 1_800_000_000_000, n = 0;
const tick = () => (now += 3000);
const cid = () => 'k' + (++n);
const msg = (store, auth, body) => messagesApi(store, auth, body, tick());
const hw = (store, auth, body) => homeworkApi(store, auth, body, tick(), () => 'hw' + (++n));
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300, 9)]).toString('base64');
const SECRET = 'SECRET-PRIVATE-TEXT-9f3a';

async function seeded() {
  const store = makeStore();
  const sent = await msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), text: SECRET + ' from student' });
  await msg(store, T.a, { action: 'send', classId: 'synth-a', studentId: 'synthA1', clientId: cid(), text: SECRET + ' from teacher' });
  const voice = await msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), voice: { mime: 'audio/webm', seconds: 3, data: webm } });
  await hw(store, T.a, { action: 'create', classId: 'synth-a', type: 'other', title: SECRET + ' homework', studentIds: ['synthA1'] });
  return { store, firstId: sent.message.id, voiceId: voice.message.id };
}
const leaked = r => JSON.stringify(r).includes(SECRET);
const attempt = async fn => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, code: e.code, msg: e.message }; } };

test('privacy: only the student and teachers of synth-a can ever see the private thread', async () => {
  const { store, firstId, voiceId } = await seeded();
  const thread = { classId: 'synth-a', studentId: 'synthA1' };
  const allowed = [['student A1', () => msg(store, {}, { action: 'list', ...S.a1 })], ['teacher A', () => msg(store, T.a, { action: 'list', ...thread })], ['teacher Both', () => msg(store, T.both, { action: 'list', ...thread })]];
  for (const [who, f] of allowed) assert.equal(leaked(await f()), true, who + ' should see the thread');
  const others = [
    ['student A2', S.a2], ['student A3', S.a3], ['student B1', S.b1], ['student O1', S.o1]
  ];
  for (const [who, login] of others)
    for (const action of ['list', 'unread', 'read', 'inbox'])
      for (const extra of [{}, { studentId: 'synthA1' }, { studentId: 'synthA1', classId: 'synth-a' }]) {
        const a = await attempt(() => msg(store, {}, { action, ...login, ...extra, limit: 50 }));
        if (a.ok) assert.equal(leaked(a.r), false, who + ' ' + action + ' leaked');
        else assert.ok(a.code >= 400 && a.code < 500, who + ' ' + action + ' got ' + a.code);
      }
  for (const [who, login] of others) {
    for (const action of ['voice', 'report']) {
      const a = await attempt(() => msg(store, {}, { action, ...login, studentId: 'synthA1', messageId: voiceId }));
      assert.equal(a.ok && action === 'voice' && !!a.r.data, false, who + ' got voice');
    }
  }
  const teacherB = ['list', 'voice', 'send', 'read', 'report', 'unread'];
  for (const action of teacherB) {
    const a = await attempt(() => msg(store, T.b, { action, ...thread, messageId: voiceId, clientId: cid(), text: 'x' }));
    assert.equal(a.ok, false, 'teacher B ' + action + ' must be refused'); assert.equal(a.code, 403);
  }
  const ib = await msg(store, T.b, { action: 'inbox', classId: 'synth-b' });
  assert.equal(leaked(ib), false); assert.deepEqual(ib.students.map(s => s.studentId).sort(), ['synthB1', 'synthB2']);
  const ia = await msg(store, T.a, { action: 'inbox', classId: 'synth-a' });
  assert.deepEqual(ia.students.map(s => s.studentId).sort(), ['synthA1', 'synthA2', 'synthA3']); // removed student hidden
  assert.equal((await attempt(() => msg(store, T.both, { action: 'inbox', classId: 'synth-off' }))).code, 403);
  assert.ok(firstId);
});

test('privacy: responses never contain passcodes, other people\'s ids, or storage paths', async () => {
  const { store } = await seeded();
  const l = await msg(store, T.a, { action: 'list', classId: 'synth-a', studentId: 'synthA1' });
  const text = JSON.stringify(l);
  for (const bad of ['1001', '1002', 'senderId', 'synthTeacherA', 'assignmentCenter/voice', 'expiresAt', 'path', 'passcode', 'b3Private'])
    assert.equal(text.includes(bad), false, 'response contains ' + bad);
  const h = await hw(store, {}, { action: 'studentList', ...S.a1 });
  assert.equal(JSON.stringify(h).includes('1001'), false);
});

test('privacy: homework of one student and class is invisible to others', async () => {
  const { store } = await seeded();
  assert.equal(leaked(await hw(store, {}, { action: 'studentList', ...S.a1 })), true);
  assert.equal(leaked(await hw(store, {}, { action: 'studentList', ...S.a2 })), false); // assigned only to A1
  assert.equal((await attempt(() => hw(store, {}, { action: 'studentList', ...S.b1 }))).ok && leaked(await hw(store, {}, { action: 'studentList', ...S.b1 })), false);
  assert.equal((await attempt(() => hw(store, T.b, { action: 'teacherList', classId: 'synth-a' }))).code, 403);
  assert.equal((await attempt(() => hw(store, T.both, { action: 'teacherList', classId: 'synth-off' }))).code, 403); // switched off
  const lb = await hw(store, T.b, { action: 'teacherList', classId: 'synth-b' });
  assert.equal(leaked(lb), false);
});

test('hostile input: odd ids and field types never crash, leak, or write outside the class', async () => {
  const { store } = await seeded();
  const before = JSON.stringify(store.data.b3Games);
  const nasty = ['__proto__', 'constructor', 'prototype', '../synthB1', 'a/b', '', ' ', null, undefined, 0, 1, true, [], {}, ['synthA1'], { $ne: 1 }, 'x'.repeat(5000), '💥', '\u0000', 'synthA1/../synthB1'];
  const calls = [];
  for (const v of nasty) {
    calls.push(['msg student id', () => msg(store, {}, { action: 'list', ...S.a1, studentId: v })]);
    calls.push(['msg classId', () => msg(store, {}, { action: 'list', ...S.a1, classId: v })]);
    calls.push(['msg teacher student', () => msg(store, T.a, { action: 'list', classId: 'synth-a', studentId: v })]);
    calls.push(['msg teacher class', () => msg(store, T.a, { action: 'list', classId: v, studentId: 'synthA1' })]);
    calls.push(['msg messageId', () => msg(store, T.a, { action: 'voice', classId: 'synth-a', studentId: 'synthA1', messageId: v })]);
    calls.push(['msg replyTo', () => msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), text: 'hi', replyTo: v })]);
    calls.push(['msg clientId', () => msg(store, {}, { action: 'send', ...S.a1, clientId: v, text: 'hi' })]);
    calls.push(['msg text', () => msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), text: v })]);
    calls.push(['msg before', () => msg(store, {}, { action: 'list', ...S.a1, before: v })]);
    calls.push(['msg limit', () => msg(store, {}, { action: 'list', ...S.a1, limit: v })]);
    calls.push(['msg voice', () => msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), voice: v })]);
    calls.push(['msg voice data', () => msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), voice: { mime: 'audio/webm', seconds: 3, data: v } })]);
    calls.push(['msg voice mime', () => msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), voice: { mime: v, seconds: 3, data: webm } })]);
    calls.push(['hw assignmentId', () => hw(store, {}, { action: 'save', ...S.a1, assignmentId: v, draft: 'x' })]);
    calls.push(['hw studentIds', () => hw(store, T.a, { action: 'create', classId: 'synth-a', type: 'other', title: 't', studentIds: v })]);
    calls.push(['hw title', () => hw(store, T.a, { action: 'create', classId: 'synth-a', type: 'other', title: v })]);
    calls.push(['hw type', () => hw(store, T.a, { action: 'create', classId: 'synth-a', type: v, title: 't' })]);
    calls.push(['hw progress', () => hw(store, {}, { action: 'save', ...S.a1, assignmentId: 'none', progress: v })]);
    calls.push(['hw login', () => hw(store, {}, { action: 'studentList', studentId: v, studentName: v, pin: v, classId: v })]);
    calls.push(['msg login', () => msg(store, {}, { action: 'list', studentId: v, studentName: v, pin: v, classId: v })]);
  }
  let crashes = 0;
  for (const [label, f] of calls) {
    const a = await attempt(f);
    if (a.ok) assert.equal(/"synthB[12]"|Eli Synthetic|Fivel Synthetic|Synthetic Test Class B/.test(JSON.stringify(a.r)), false, label + ' leaked class B');
    else if (!(Number.isInteger(a.code) && a.code >= 400 && a.code < 500)) { crashes++; console.log('CRASH', label, a.msg); }
  }
  assert.equal(crashes, 0, 'every bad input must end in a clean 4xx');
  // class B and the switched-off class were never modified by any of the above
  assert.deepEqual(Object.keys(store.data.assignmentCenter.workspaces['b3-2026'].classes), ['synth-a']);
  assert.equal(JSON.stringify(store.data.b3Games), before);
  assert.equal(({}).polluted, undefined);
});

test('hostile input: prototype keys cannot be used as ids to reach other data', async () => {
  const { store } = await seeded();
  for (const id of ['__proto__', 'constructor'])
    for (const body of [{ action: 'list', classId: id, studentId: 'synthA1' }, { action: 'list', classId: 'synth-a', studentId: id }]) {
      const a = await attempt(() => msg(store, T.a, body));
      assert.equal(a.ok, false);
    }
});

test('simultaneous sessions: two devices, same student, never duplicate or mix', async () => {
  const store = makeStore();
  const send = text => msg(store, {}, { action: 'send', ...S.a1, clientId: cid(), text });
  await send('one'); await send('two');
  const sameId = 'shared-id';
  const [x, y] = await Promise.all([msg(store, {}, { action: 'send', ...S.a1, clientId: sameId, text: 'dup' }), msg(store, {}, { action: 'send', ...S.a1, clientId: sameId, text: 'dup' })].map(p => p.catch(e => ({ ok: false, code: e.code }))));
  const list = await msg(store, {}, { action: 'list', ...S.a1 });
  assert.equal(list.messages.filter(m => m.text === 'dup').length, 1);
  assert.ok([x, y].some(r => r.ok && !r.duplicate));
});
