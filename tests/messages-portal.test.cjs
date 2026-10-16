'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { messagesApi, LIMITS } = require('../backend/functions/messages-core.cjs');

function makeStore(seed) {
  const data = JSON.parse(JSON.stringify(seed));
  const files = new Map();
  const parts = p => p.split('/');
  const get = async p => { let n = data; for (const k of parts(p)) { if (n == null) return null; n = n[k]; } return n === undefined ? null : JSON.parse(JSON.stringify(n)); };
  const set = async (p, v) => { const k = parts(p); let n = data; for (const s of k.slice(0, -1)) n = n[s] = n[s] || {}; if (v === null) delete n[k[k.length - 1]]; else n[k[k.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const tx = async (p, fn) => { const cur = await get(p); const out = fn(cur); if (out === undefined) return { committed: false }; await set(p, out); return { committed: true }; };
  const page = async (p, { limit, before }) => {
    const node = (await get(p)) || {};
    return Object.keys(node).sort().filter(k => !before || k < before).slice(-limit).map(k => node[k]);
  };
  const store = { get, set, tx, page, data, files,
    putFile: async (path, buf) => { if (store.failUpload) throw new Error('upload failed'); files.set(path, Buffer.from(buf)); },
    getFile: async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path); },
    delFile: async path => { files.delete(path); } };
  return store;
}
const seed = () => ({
  b3Games: {
    admins: { adm: { active: true } },
    workspaces: { 'b3-2026': {
      classes: {
        et: { name: 'ET', toolGrants: { messages: true }, members: { s1: { active: true }, s2: { active: true }, s3: { active: false } } },
        wt: { name: 'WT', toolGrants: { messages: true }, members: { s9: { active: true } } },
        off: { name: 'Off', members: { s5: { active: true } } }
      },
      teachers: { t1: { active: true, classIds: { et: true } }, t2: { active: true, classIds: { wt: true } }, t3: { active: true, classIds: { et: true, off: true } } }
    } },
    students: {
      s1: { profile: { name: 'Sam One' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
      s2: { profile: { name: 'Dan Two' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
      s3: { profile: { name: 'Old Three' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
      s5: { profile: { name: 'Eli Five' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'off' } } },
      s9: { profile: { name: 'Wes Nine' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'wt' } } }
    }
  },
  b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' }, s5: { passcode: '5555' }, s9: { passcode: '9999' } } }
});
const gid = (uid, email) => ({ identity: { uid, email: email || uid + '@x.org', name: uid === 't1' ? 'Rabbi Test' : undefined, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });
const T1 = () => gid('t1'), T2 = () => gid('t2'), T3 = () => gid('t3');
const OWNER = () => gid('own', 'simcha5770@gmail.com');
const stu = (id, name, pin, cls) => ({ studentId: id, studentName: name, pin, classId: cls || (id === 's9' ? 'wt' : 'et') });
const S1 = () => stu('s1', 'Sam One', '1111');
let t = 1_700_000_000_000, n = 0;
const tick = (ms = 2000) => (t += ms);
const cid = () => 'c' + (++n);
const call = (store, auth, body, now) => messagesApi(store, auth, body, now ?? tick());
// minimal valid recordings
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 7)]).toString('base64');
const voice = (extra) => ({ mime: 'audio/webm;codecs=opus', seconds: 5, data: webm, ...extra });

test('student and teacher exchange text; unread counts, read state and replies', async () => {
  const store = makeStore(seed());
  const a = await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'Hello Rabbi' });
  assert.equal(a.message.senderRole, 'student');
  let inbox = await call(store, T1(), { action: 'inbox', classId: 'et' });
  assert.deepEqual(inbox.students.map(s => [s.studentId, s.unread]), [['s1', 1], ['s2', 0]]);
  assert.equal(inbox.students[0].lastPreview, 'Hello Rabbi');
  const r = await call(store, T1(), { action: 'send', classId: 'et', studentId: 's1', clientId: cid(), text: 'Hi Sam', replyTo: a.message.id });
  assert.equal(r.message.senderName, 'Rabbi Test');
  const list = await call(store, {}, { action: 'list', ...S1() });
  assert.deepEqual(list.messages.map(m => m.text), ['Hello Rabbi', 'Hi Sam']);
  assert.equal(list.messages[1].replyTo.preview, 'Hello Rabbi');
  assert.equal(list.unread, 1);
  await call(store, {}, { action: 'read', ...S1() });
  assert.equal((await call(store, {}, { action: 'unread', ...S1() })).unread, 0);
  inbox = await call(store, T1(), { action: 'inbox', classId: 'et' });
  assert.equal(inbox.students[0].unread, 1);
  await call(store, T1(), { action: 'read', classId: 'et', studentId: 's1' });
  assert.equal((await call(store, T1(), { action: 'unread', classId: 'et', studentId: 's1' })).unread, 0);
  await assert.rejects(call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'x', replyTo: 'nope' }), { code: 404 });
});

test('repeat taps / reconnect retries never duplicate; ids are in time order; paging works', async () => {
  const store = makeStore(seed());
  const id = cid();
  const a = await call(store, {}, { action: 'send', ...S1(), clientId: id, text: 'once' });
  const b = await call(store, {}, { action: 'send', ...S1(), clientId: id, text: 'once' });
  assert.equal(b.duplicate, true); assert.equal(b.message.id, a.message.id);
  for (let i = 0; i < 5; i++) await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'm' + i });
  const p1 = await call(store, {}, { action: 'list', ...S1(), limit: 3 });
  assert.deepEqual(p1.messages.map(m => m.text), ['m2', 'm3', 'm4']);
  const p2 = await call(store, {}, { action: 'list', ...S1(), limit: 3, before: p1.oldest });
  assert.deepEqual(p2.messages.map(m => m.text), ['once', 'm0', 'm1']);
  await assert.rejects(call(store, {}, { action: 'list', ...S1(), limit: 500 }), { code: 400 });
  await assert.rejects(call(store, {}, { action: 'list', ...S1(), before: '../x' }), { code: 400 });
});

test('text limits and rate limits', async () => {
  const store = makeStore(seed());
  await assert.rejects(call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: '   ' }), { code: 400 });
  const long = await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'x'.repeat(5000) });
  assert.equal(long.message.text.length, LIMITS.textChars);
  const now = tick();
  await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'a' }, now);
  await assert.rejects(call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'b' }, now + 100), { code: 429 });
  let at = now;
  for (let i = 0; i < LIMITS.messagesPerHour; i++) { at += 1000; try { await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'f' }, at); } catch (e) { assert.equal(e.code, 429); break; } }
  await assert.rejects(call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'over' }, at + 1000), { code: 429 });
  await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'new hour' }, at + 3700000);
});

test('voice: stored privately, played back only by the two sides, size/type/format limits', async () => {
  const store = makeStore(seed());
  const v = await call(store, {}, { action: 'send', ...S1(), clientId: cid(), voice: voice() });
  assert.equal(v.message.type, 'voice'); assert.equal(v.message.voice.seconds, 5);
  assert.equal(store.files.size, 1);
  assert.ok([...store.files.keys()][0].startsWith('assignmentCenter/voice/b3-2026/et/s1/'));
  const play = await call(store, T1(), { action: 'voice', classId: 'et', studentId: 's1', messageId: v.message.id });
  assert.equal(play.data, webm);
  assert.equal((await call(store, {}, { action: 'voice', ...S1(), messageId: v.message.id })).mime, 'audio/webm');
  await assert.rejects(call(store, {}, { action: 'voice', ...stu('s2', 'Dan Two', '2222'), messageId: v.message.id }), { code: 404 });
  await assert.rejects(call(store, T2(), { action: 'voice', classId: 'et', studentId: 's1', messageId: v.message.id }), { code: 403 });
  const send = extra => call(store, {}, { action: 'send', ...S1(), clientId: cid(), voice: voice(extra) });
  await assert.rejects(send({ mime: 'audio/mpeg' }), { code: 415 });
  await assert.rejects(send({ data: Buffer.from('not audio at all').toString('base64') }), { code: 415 });
  await assert.rejects(send({ seconds: 61 }), { code: 400 });
  await assert.rejects(send({ seconds: 0 }), { code: 400 });
  await assert.rejects(send({ data: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(LIMITS.voiceBytes)]).toString('base64') }), { code: 413 });
  await assert.rejects(send({ data: '***' }), { code: 413 });
  assert.equal(store.files.size, 1);
});

test('failed upload saves nothing, frees its quota, and a retry succeeds', async () => {
  const store = makeStore(seed());
  const id = cid();
  store.failUpload = true;
  await assert.rejects(call(store, {}, { action: 'send', ...S1(), clientId: id, voice: voice() }));
  const meta = store.data.assignmentCenter.workspaces['b3-2026'].classes.et.threads.s1.meta;
  assert.equal(meta.voiceBytes, 0);
  assert.equal((await call(store, {}, { action: 'list', ...S1() })).messages.length, 0);
  store.failUpload = false;
  const ok = await call(store, {}, { action: 'send', ...S1(), clientId: id, voice: voice() });
  assert.equal(ok.message.type, 'voice');
});

test('voice storage cap per conversation and per-day cap', async () => {
  const store = makeStore(seed());
  const tp = () => store.data.assignmentCenter.workspaces['b3-2026'].classes.et.threads.s1;
  await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'init' });
  tp().meta.voiceBytes = LIMITS.voiceThreadBytes - 10;
  await assert.rejects(call(store, {}, { action: 'send', ...S1(), clientId: cid(), voice: voice() }), { code: 413 });
  tp().meta.voiceBytes = 0;
  for (let i = 0; i < LIMITS.voicePerDay; i++) await call(store, {}, { action: 'send', ...S1(), clientId: cid(), voice: voice() }, 1_800_000_000_000 + i * 2000);
  await assert.rejects(call(store, {}, { action: 'send', ...S1(), clientId: cid(), voice: voice() }, 1_800_000_000_000 + 1e6), { code: 429 });
});

test('voice recordings expire after one year: file deleted, message kept', async () => {
  const store = makeStore(seed());
  const now = tick();
  const v = await call(store, {}, { action: 'send', ...S1(), clientId: cid(), voice: voice() }, now);
  const later = now + LIMITS.retentionMs + 1000;
  const l = await call(store, {}, { action: 'list', ...S1() }, later);
  assert.equal(l.messages[0].voiceExpired, true); assert.equal(l.messages[0].voice, null);
  assert.equal(store.files.size, 0);
  await assert.rejects(call(store, {}, { action: 'voice', ...S1(), messageId: v.message.id }, later), { code: 404 });
});

test('student isolation: wrong passcode, other student, other class, removed student', async () => {
  const store = makeStore(seed());
  await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'private' });
  await assert.rejects(call(store, {}, { action: 'list', ...stu('s1', 'Sam One', '2222') }), { code: 401 });
  await assert.rejects(call(store, {}, { action: 'list', ...stu('s2', 'Dan Two', '1111') }), { code: 401 });
  const s2 = await call(store, {}, { action: 'list', ...stu('s2', 'Dan Two', '2222') });
  assert.equal(s2.messages.length, 0); // s2 cannot see s1's thread: only own thread is ever addressed
  const s9 = await call(store, {}, { action: 'list', ...stu('s9', 'Wes Nine', '9999') });
  assert.equal(s9.messages.length, 0);
  await assert.rejects(call(store, {}, { action: 'list', ...stu('s3', 'Old Three', '1111') }), { code: 401 });
  // a student cannot name another student to read their thread
  const sneaky = await call(store, {}, { action: 'list', ...stu('s2', 'Dan Two', '2222'), studentId: 's2' });
  assert.equal(sneaky.messages.length, 0);
  await assert.rejects(call(store, {}, { action: 'inbox', ...S1() }), { code: 403 });
});

test('teacher isolation: only assigned class, verified Google, active', async () => {
  const store = makeStore(seed());
  await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'private' });
  const read = (auth, cls = 'et', sid = 's1') => call(store, auth, { action: 'list', classId: cls, studentId: sid });
  assert.equal((await read(T1())).messages.length, 1);
  await assert.rejects(read(T2()), { code: 403 });                 // other class's teacher
  await assert.rejects(read(T1(), 'wt', 's9'), { code: 403 });     // my teacher, not my class
  await assert.rejects(read(T1(), 'et', 's9'), { code: 404 });     // student not in this class
  await assert.rejects(read(T1(), 'et', 's3'), { code: 404 });     // removed student
  await assert.rejects(read({ identity: { ...T1().identity, email_verified: false } }), { code: 403 });
  await assert.rejects(read({ identity: { ...T1().identity, firebase: { sign_in_provider: 'password' } } }), { code: 403 });
  await assert.rejects(call(store, {}, { action: 'inbox', classId: 'et' }), { code: 400 }); // no sign-in and no student login: refused
  store.data.b3Games.workspaces['b3-2026'].teachers.t1.active = false;
  await assert.rejects(read(T1()), { code: 403 });                 // revoked teacher
  store.data.b3Games.workspaces['b3-2026'].teachers.t1.active = true;
  store.data.b3Games.workspaces['b3-2026'].teachers.t1.classIds.et = false;
  await assert.rejects(read(T1()), { code: 403 });                 // removed from class
});

test('class with messaging switched off, and a class transfer', async () => {
  const store = makeStore(seed());
  await assert.rejects(call(store, {}, { action: 'list', ...stu('s5', 'Eli Five', '5555', 'off') }), { code: 403 });
  await assert.rejects(call(store, T3(), { action: 'inbox', classId: 'off' }), { code: 403 });
  await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'hi' });
  // student moves from ET to WT: ET teacher loses access, WT teacher sees a fresh thread
  store.data.b3Games.workspaces['b3-2026'].classes.et.members.s1.active = false;
  store.data.b3Games.workspaces['b3-2026'].classes.wt.members.s1 = { active: true };
  store.data.b3Games.students.s1.memberships = { m: { workspaceId: 'b3-2026', classId: 'wt' } };
  await assert.rejects(call(store, T1(), { action: 'list', classId: 'et', studentId: 's1' }), { code: 404 });
  const wt = await call(store, T2(), { action: 'list', classId: 'wt', studentId: 's1' });
  assert.equal(wt.messages.length, 0);
});

test('owner can read for safeguarding but cannot send; co-teachers share a thread', async () => {
  const store = makeStore(seed());
  await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'hello' });
  const o = await call(store, OWNER(), { action: 'list', classId: 'et', studentId: 's1' });
  assert.equal(o.messages.length, 1);
  await assert.rejects(call(store, OWNER(), { action: 'send', classId: 'et', studentId: 's1', clientId: cid(), text: 'x' }), { code: 403 });
  await call(store, OWNER(), { action: 'read', classId: 'et', studentId: 's1' });
  assert.equal((await call(store, T1(), { action: 'unread', classId: 'et', studentId: 's1' })).unread, 1); // owner peeking does not clear it
  await call(store, T3(), { action: 'send', classId: 'et', studentId: 's1', clientId: cid(), text: 'from t3' });
  assert.equal((await call(store, T1(), { action: 'list', classId: 'et', studentId: 's1' })).messages.length, 2);
});

test('impersonation: sender comes from the verified account, never the request', async () => {
  const store = makeStore(seed());
  const m = await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'hi', senderRole: 'teacher', senderId: 't1', senderName: 'Rabbi', role: 'teacher' });
  assert.equal(m.message.senderRole, 'student');
  const rec = Object.values(store.data.assignmentCenter.workspaces['b3-2026'].classes.et.threads.s1.messages)[0];
  assert.equal(rec.senderId, 's1');
  // same clientId from the other side is a different message (dedupe is per sender)
  const id = cid();
  await call(store, {}, { action: 'send', ...S1(), clientId: id, text: 'a' });
  const t = await call(store, T1(), { action: 'send', classId: 'et', studentId: 's1', clientId: id, text: 'b' });
  assert.equal(t.duplicate, undefined);
});

test('reports are stored for the owner; unknown actions refused', async () => {
  const store = makeStore(seed());
  const m = await call(store, {}, { action: 'send', ...S1(), clientId: cid(), text: 'rude' });
  await call(store, T1(), { action: 'report', classId: 'et', studentId: 's1', messageId: m.message.id, reason: 'Not kind' });
  assert.equal(Object.keys(store.data.assignmentCenter.workspaces['b3-2026'].classes.et.reports).length, 1);
  await assert.rejects(call(store, {}, { action: 'wipe', ...S1() }), { code: 400 });
});

test('policy copy in functions matches the tested original', () => {
  assert.equal(fs.readFileSync(__dirname + '/../backend/functions/messages-policy.cjs', 'utf8'),
    fs.readFileSync(__dirname + '/../assignment-center/message-policy.js', 'utf8'));
});
