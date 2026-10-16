'use strict';
// Join tickets for Classroom Pointer: SYNTHETIC data only, in-memory database, no Firebase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../backend/functions/class-pointer-share-auth.js', 'utf8');
const ROOM = 'class-pointer-12345678-1234-1234-1234-123456789abc';
const ROOM_WT = 'class-pointer-aaaaaaaa-1234-1234-1234-123456789abc';
const ROOM_NEW = 'class-pointer-bbbbbbbb-1234-1234-1234-123456789abc';
const PEER = 'student-peer-0001', PEER2 = 'attacker-peer-0002';

function fixture() {
  const now = Date.now();
  const cls = (name, extra) => ({ name, active: true, ...extra });
  const rows = new Map([
    ['b3Games/workspaces/b3-2026/classes/et', cls('ET', { members: { avi: { active: true }, benny: { active: true }, gone: { active: false } } })],
    ['b3Games/workspaces/b3-2026/classes/wt', cls('WT', { members: { wes: { active: true } } })],
    ['b3Games/workspaces/b3-2026/classes/synth-new', cls('New', { toolGrants: { 'class-pointer': true }, members: { nate: { active: true } } })],
    ['b3Games/workspaces/b3-2026/classes/synth-off', cls('Off', { members: { olly: { active: true } } })],
    ...[['et', ROOM, 'teacher-et'], ['wt', ROOM_WT, 'teacher-wt'], ['synth-new', ROOM_NEW, 'teacher-new'], ['synth-off', ROOM, 'teacher-off']]
      .map(([c, r, t]) => ['b3Games/workspaces/b3-2026/classes/' + c + '/classPointerSessions/' + r, { roomId: r, createdAt: now, teacherUid: t }]),
    ['b3Games/workspaces/b3-2026/teachers/teacher-et', { active: true, classIds: { et: true } }],
    ['b3Games/workspaces/b3-2026/teachers/teacher-wt', { active: true, classIds: { wt: true } }],
    ['b3Games/workspaces/b3-2026/teachers/teacher-new', { active: true, classIds: { 'synth-new': true } }],
    ['b3Games/workspaces/b3-2026/teachers/teacher-off', { active: true, classIds: { 'synth-off': true } }],
    ...['avi', 'benny', 'gone', 'wes', 'nate', 'olly', 'legacy'].flatMap(id => [
      ['b3Games/students/' + id + '/profile', { name: id[0].toUpperCase() + id.slice(1) + ' Synthetic', active: true }],
      ['b3Games/workspaces/b3-2026/classes/' + (id === 'wes' ? 'wt' : id === 'nate' ? 'synth-new' : id === 'olly' ? 'synth-off' : 'et') + '/members/' + id, { active: id !== 'gone' }]
    ])
  ]);
  // legacy has a class member row but no passcode of its own (only the old shared default would match)
  rows.get('b3Games/workspaces/b3-2026/classes/et').members.legacy = { active: true };
  const passcodes = { avi: '1111', benny: '2222', wes: '3333', nate: '4444', olly: '5555', gone: '6666' };
  const ref = path => ({
    once: async () => ({ val: () => { const v = rows.get(path); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
    set: async value => { if (value === null) rows.delete(path); else rows.set(path, JSON.parse(JSON.stringify(value))); },
    transaction: async callback => {
      const before = rows.get(path) ?? null, after = callback(before === null ? null : JSON.parse(JSON.stringify(before)));
      if (after === undefined) return { committed: false, snapshot: { val: () => before } };
      rows.set(path, after);
      return { committed: true, snapshot: { val: () => after } };
    }
  });
  const admin = { apps: [{}], database: () => ({ ref }), auth: () => ({ verifyIdToken: async token => ({ uid: token }) }) };
  let handler;
  const sandbox = { module: { exports: {} }, exports: {}, require: name => {
    if (name === 'firebase-functions/v2/https') return { onRequest: (_o, fn) => { handler = fn; return fn; } };
    if (name === 'firebase-admin') return admin;
    if (name === 'node:crypto') return require('node:crypto');
    if (name === './student-passcodes.cjs') return {
      // like the real one: the shared default 5770 is only returned when the caller allows it
      readPasscode: async (_get, id, opts) => ({ passcode: passcodes[id] || (id === 'legacy' && opts && opts.allowLegacyDefault ? '5770' : '') }),
      key: s => typeof s === 'string' && /^[a-z0-9_-]+$/i.test(s), equal: (a, b) => a === b };
    throw Error(name);
  }, Buffer, Date, console };
  vm.runInNewContext(source, sandbox);
  async function post(body, uid, ip = '10.0.0.1') {
    const result = { statusCode: 200, body: null };
    const response = { set() { return this; }, status(c) { result.statusCode = c; return this; }, json(v) { result.body = v; return this; } };
    await handler({ method: 'POST', body, ip, headers: uid ? { authorization: 'Bearer ' + uid } : {} }, response);
    return result;
  }
  const issue = (id, pin, classId = 'et', room = ROOM, peerId = PEER, ip) => post({ action: 'joinIssue', studentId: id, pin, classId, room, peerId }, null, ip);
  const verify = (token, uid = 'teacher-et', classId = 'et', room = ROOM, peerId = PEER) => post({ action: 'joinVerify', classId, room, token, peerId }, uid);
  return { rows, post, issue, verify };
}

test('a verified class member gets a ticket and the teacher learns who they are from the server', async () => {
  const f = fixture();
  const t = await f.issue('avi', '1111');
  assert.equal(t.statusCode, 200, JSON.stringify(t.body));
  assert.match(t.body.token, /^[a-f0-9]{64}$/);
  const v = await f.verify(t.body.token);
  assert.equal(v.statusCode, 200, JSON.stringify(v.body));
  assert.equal(v.body.studentId, 'avi'); assert.equal(v.body.studentName, 'Avi Synthetic');
  assert.equal([...f.rows.keys()].some(k => k.includes('1111')), false);
  assert.equal(JSON.stringify(t.body).includes('1111'), false);
});

test('unauthorized: wrong passcode, shared default passcode, not in class, inactive, class without Pointer', async () => {
  const f = fixture();
  assert.equal((await f.issue('avi', '9999')).statusCode, 401);
  assert.equal((await f.issue('legacy', '5770')).statusCode, 401);            // old shared default never opens a lesson
  assert.equal((await f.issue('wes', '3333', 'et')).statusCode, 403);          // WT student asking for ET
  assert.equal((await f.issue('avi', '1111', 'wt', ROOM_WT)).statusCode, 403); // ET student asking for WT
  assert.equal((await f.issue('gone', '6666')).statusCode, 403);               // removed from class
  assert.equal((await f.issue('olly', '5555', 'synth-off')).statusCode, 403);  // Pointer switched off for that class
  assert.equal((await f.issue('nate', '4444', 'synth-new', ROOM_NEW)).statusCode, 200); // third class with the grant works
  assert.equal((await f.issue('avi', '1111', 'et', ROOM, 'x')).statusCode, 400); // bad connection id
  assert.equal((await f.issue('avi', '', 'et')).statusCode, 400);
  assert.equal((await f.post({ action: 'joinIssue', studentId: 'avi', pin: '1111', classId: 'et', room: 'class-pointer-notaroom', peerId: PEER })).statusCode, 400);
  const unknownRoom = 'class-pointer-cccccccc-1234-1234-1234-123456789abc';
  assert.equal((await f.issue('avi', '1111', 'et', unknownRoom)).statusCode, 403);
});

test('stolen or reused tickets fail: other connection, other teacher, other class or room, repeat use', async () => {
  const f = fixture();
  const { token } = (await f.issue('avi', '1111')).body;
  assert.equal((await f.verify(token, 'teacher-et', 'et', ROOM, PEER2)).statusCode, 403); // attacker's connection id
  assert.equal((await f.verify(token, 'teacher-wt', 'et', ROOM)).statusCode, 403);        // another teacher
  assert.equal((await f.verify(token, 'teacher-wt', 'wt', ROOM_WT)).statusCode, 403);     // replay in another class
  assert.equal((await f.verify(token, 'teacher-et', 'et', ROOM_WT)).statusCode, 403);     // wrong room
  assert.equal((await f.verify('0'.repeat(64))).statusCode, 403);                          // invented ticket
  assert.equal((await f.verify('not-a-ticket')).statusCode, 400);
  assert.equal((await f.post({ action: 'joinVerify', classId: 'et', room: ROOM, token, peerId: PEER })).statusCode, 401); // no teacher sign-in
  assert.equal((await f.verify(token)).statusCode, 200);                                   // the real one still works
  assert.equal((await f.verify(token)).statusCode, 200);                                   // same teacher, same connection: retry ok
  assert.equal((await f.verify(token, 'teacher-et', 'et', ROOM, PEER2)).statusCode, 403); // after use, still not for others
  // a later repeat (after the 30 s setup window) is refused: the ticket is single-use
  const key = [...f.rows.keys()].find(k => k.startsWith('b3Private/classPointerJoinTickets/'));
  f.rows.get(key).verifiedAt = Date.now() - 31000;
  assert.equal((await f.verify(token)).statusCode, 403);
});

test('tickets expire after 90 seconds and a newer ticket replaces the older one', async () => {
  const f = fixture();
  const first = (await f.issue('avi', '1111')).body.token;
  const key = [...f.rows.keys()].find(k => k.startsWith('b3Private/classPointerJoinTickets/'));
  f.rows.get(key).expiresAt = Date.now() - 1;
  assert.equal((await f.verify(first)).statusCode, 403);
  const a = (await f.issue('avi', '1111')).body.token, b = (await f.issue('avi', '1111')).body.token;
  assert.equal((await f.verify(a)).statusCode, 403);   // replaced
  assert.equal((await f.verify(b)).statusCode, 200);
  assert.equal([...f.rows.keys()].filter(k => k.startsWith('b3Private/classPointerJoinTickets/')).length, 1); // nothing piles up
  const lifetime = f.rows.get([...f.rows.keys()].find(k => k.startsWith('b3Private/classPointerJoinTickets/')));
  assert.ok(lifetime.expiresAt - lifetime.createdAt <= 90000);
});

test('revocation: removed, blocked or switched-off students fail at verify and show up in the recheck', async () => {
  const f = fixture();
  const t = (await f.issue('avi', '1111')).body.token;
  f.rows.get('b3Games/workspaces/b3-2026/classes/et').members.avi.active = false;
  assert.equal((await f.verify(t)).statusCode, 403);
  const re = await f.post({ action: 'joinRecheck', classId: 'et', room: ROOM, studentIds: ['avi', 'benny', 'gone', 'wes', '../x'] }, 'teacher-et');
  assert.deepEqual([...re.body.allowed], ['benny']);                                          // wes is WT, gone and avi removed
  f.rows.get('b3Games/students/benny/profile').active = false;
  assert.deepEqual([...(await f.post({ action: 'joinRecheck', classId: 'et', room: ROOM, studentIds: ['benny'] }, 'teacher-et')).body.allowed], []);
  assert.equal((await f.post({ action: 'joinRecheck', classId: 'et', room: ROOM, studentIds: ['benny'] }, 'teacher-wt')).statusCode, 403);
  assert.equal((await f.post({ action: 'joinRecheck', classId: 'et', room: ROOM, studentIds: ['benny'] })).statusCode, 401);
  // a teacher removed from the class can no longer verify anything
  const t2 = (await f.issue('benny', '2222')).body.token;
  f.rows.get('b3Games/workspaces/b3-2026/teachers/teacher-et').active = false;
  f.rows.get('b3Games/students/benny/profile').active = true;
  assert.equal((await f.verify(t2)).statusCode, 403);
});

test('reconnection: every reconnect asks for a fresh ticket for its new connection id', async () => {
  const f = fixture();
  const one = (await f.issue('avi', '1111', 'et', ROOM, 'peer-first-001')).body.token;
  assert.equal((await f.verify(one, 'teacher-et', 'et', ROOM, 'peer-first-001')).statusCode, 200);
  const two = (await f.issue('avi', '1111', 'et', ROOM, 'peer-second-02')).body.token;       // page reload, new connection
  assert.equal((await f.verify(one, 'teacher-et', 'et', ROOM, 'peer-second-02')).statusCode, 403);
  assert.equal((await f.verify(two, 'teacher-et', 'et', ROOM, 'peer-second-02')).statusCode, 200);
});

test('guessing is limited: 8 wrong passcodes pause that student, others and other rooms unaffected', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) assert.equal((await f.issue('avi', '000' + i, 'et', ROOM, PEER, '1.1.1.' + i)).statusCode, 401);
  assert.equal((await f.issue('avi', '1111', 'et', ROOM, PEER, '9.9.9.9')).statusCode, 429);   // even the right passcode waits
  assert.equal((await f.issue('benny', '2222', 'et', ROOM, PEER, '9.9.9.9')).statusCode, 200);  // classmate is fine
  const g = fixture();
  let hit = null;
  for (let i = 0; i < 60 && hit === null; i++) if ((await g.issue(i % 2 ? 'avi' : 'benny', 'bad' + i, 'et', ROOM, PEER, '7.7.7.7')).statusCode === 429) hit = i;
  assert.ok(hit !== null && hit <= 41);
});

test('the lesson page refuses unverified joins and the student page asks for a ticket first', () => {
  const classroom = fs.readFileSync(__dirname + '/../class-pointer-prototype/classroom.js', 'utf8').replace(/\r\n/g, '\n');
  const html = fs.readFileSync(__dirname + '/../class-pointer-prototype/classroom.html', 'utf8');
  // teacher: in signed-in lesson mode the join is verified before a member is created; identity is the server's
  assert.match(classroom, /if\(gate&&gate\.required\)\{[\s\S]*gate\.verify\(message\.ticket,connection\.peer\)[\s\S]*admitJoin\(\{\.\.\.message,name:verified\.studentName,studentId:verified\.studentId\}\)/);
  assert.match(classroom, /if\(!verified\|\|member\|\|!connection\.open\|\|!started\)\{connection\.close\(\)/);
  const admit = classroom.indexOf('const admitJoin=message=>{'), data = classroom.indexOf("connection.on('data',message=>{", admit);
  assert.ok(admit > 0 && admit < data, 'member creation lives in admitJoin, only reached after verification');
  assert.equal((classroom.match(/admitted:true/g) || []).length >= 1, true);
  assert.equal(classroom.slice(data).split("message.type==='join'")[1].includes('admitJoin(message)'), true);
  // revocation watcher is started with the lesson
  assert.match(classroom, /ClassPointerJoinGate\.watch\(\(\)=>Array\.from\(members\.values\(\)\)/);
  // student: ticket requested with the student's own connection id before the join message is sent
  assert.match(classroom, /ClassPointerJoinAuth\.issue\(\{room,classId,studentId,peerId:current\.id\}\)/);
  assert.match(classroom, /send\(connection,\{type:'join',name,studentId,ticket\}\)/);
  assert.ok(html.indexOf('join-auth.js') > 0 && html.indexOf('join-auth.js') < html.indexOf('classroom.js'));
});

test('teacher-side gate: malformed tickets are dropped without a server call and verification is rate-limited', async () => {
  const calls = [];
  const sandbox = { window: undefined, location: { search: '?dashboard=teacher&class=et' }, sessionStorage: { getItem: () => '' },
    document: { getElementById: id => id === 'joinLink' ? { value: 'https://x.test/classroom.html?room=' + ROOM } : { disabled: false } },
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'tok' } }) },
    fetch: async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true, studentId: 'avi', studentName: 'Avi Synthetic' }) }; },
    URL, URLSearchParams, setInterval: () => 0, clearInterval: () => {}, console };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(__dirname + '/../class-pointer-prototype/join-auth.js', 'utf8'), sandbox);
  const gate = sandbox.ClassPointerJoinGate;
  assert.equal(gate.required, true);
  assert.equal(await gate.verify(undefined, 'p-12345678'), null);
  assert.equal(await gate.verify('nope', 'p-12345678'), null);
  assert.equal(await gate.verify('A'.repeat(64), 'p-12345678'), null);       // uppercase hex is not a ticket
  assert.equal(calls.length, 0);
  assert.deepEqual({ ...(await gate.verify('a1'.repeat(32), 'p-12345678')) }, { studentId: 'avi', studentName: 'Avi Synthetic' });
  assert.deepEqual({ action: calls[0].action, classId: calls[0].classId, room: calls[0].room, peerId: calls[0].peerId }, { action: 'joinVerify', classId: 'et', room: ROOM, peerId: 'p-12345678' });
  let accepted = 0; for (let i = 0; i < 60; i++) if (await gate.verify('a1'.repeat(32), 'p-12345678')) accepted++;
  assert.ok(accepted <= 29, 'a flood of join messages cannot make the teacher page hammer the server');
  // a plain (non-signed-in) lesson page is not in required mode
  sandbox.location.search = '';
  vm.runInNewContext(fs.readFileSync(__dirname + '/../class-pointer-prototype/join-auth.js', 'utf8'), sandbox);
  assert.equal(sandbox.ClassPointerJoinGate.required, false);
});
