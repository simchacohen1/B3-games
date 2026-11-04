'use strict';
// Shared student sign-in: wrong-passcode limiter + cheaper lookup. SYNTHETIC data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStudent } = require('../backend/functions/student-login-core.cjs');
const reference = require('./fixtures/student-login-core.reference.cjs'); // the sign-in exactly as it was on main
const { studentAuth } = require('../backend/functions/student-auth-core.cjs');
const { LIMITS } = require('../backend/functions/auth-attempts.cjs');

// In-memory database; paths resolve inside nested objects like Realtime Database. Counts reads/writes.
function db(tree) {
  const parts = p => p.split('/').filter(Boolean);
  const stats = { reads: [], bytes: 0, writes: 0 };
  const read = p => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree) ?? null;
  const get = async p => { const v = read(p); stats.reads.push(p); stats.bytes += JSON.stringify(v ?? null).length; return structuredClone(v); };
  const set = (p, v) => { stats.writes++; const k = parts(p), last = k.pop(); let o = tree; for (const x of k) o = o[x] ??= {}; if (v === null) delete o[last]; else o[last] = structuredClone(v); };
  return { tree, stats, get, set: async (p, v) => set(p, v), update: async u => { for (const [p, v] of Object.entries(u)) set(p, v); },
    tx: async (p, f) => { const v = f(structuredClone(read(p))); if (v === undefined) return { committed: false }; set(p, v); return { committed: true }; } };
}
const member = id => ({ [id]: { active: true } });
const mship = classId => ({ m: { workspaceId: 'b3-2026', classId, active: true } });
function seed() {
  return {
    b3Games: {
      students: {
        etKid: { profile: { name: 'Eli Test', active: true }, memberships: { m: mship('et').m } },
        wtKid: { profile: { name: 'Wes Test', active: true }, memberships: { m: mship('wt').m } },
        newKid: { profile: { name: 'Nate Test', active: true }, memberships: { m: mship('synth-new').m } },
        twoKid: { profile: { name: 'Tov Test', active: true }, memberships: { a: mship('et').m, b: mship('synth-new').m } },
        offKid: { profile: { name: 'Off Test', active: false }, memberships: { m: mship('et').m } },
        goneKid: { profile: { name: 'Gone Test', active: true }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et', active: false } } },
        dupA: { profile: { name: 'Same Name', active: true }, memberships: { m: mship('et').m } },
        dupB: { profile: { name: 'Same Name', active: true }, memberships: { m: mship('wt').m } },
        oldKid: { profile: { name: 'Old Test', active: true, classId: 'et' } }
      },
      workspaces: { 'b3-2026': { classes: {
        et: { name: 'ET', active: true, members: { ...member('etKid'), ...member('twoKid'), ...member('offKid'), ...member('dupA'), ...member('oldKid'), goneKid: { active: true } } },
        wt: { name: 'WT', active: true, members: { ...member('wtKid'), ...member('dupB') } },
        'synth-new': { name: 'New', active: true, members: { ...member('newKid'), ...member('twoKid') } }
      } } }
    },
    posukPractice: { allowedStudents: { legacyOnly: { name: 'Leo Legacy', classId: 'et', passcode: '4444' }, legacyOff: { name: 'Lou Off', active: false, passcode: '5555' } } },
    b3Private: { passcodes: {
      etKid: { passcode: '1001' }, wtKid: { passcode: '1002' }, newKid: { passcode: '1003' }, twoKid: { passcode: '1004' },
      offKid: { passcode: '1005' }, goneKid: { passcode: '1006' }, dupA: { passcode: '1007' }, dupB: { passcode: '1007' }, oldKid: { passcode: '1008' } } }
  };
}
const outcome = async f => { try { const r = await f(); return { ok: true, id: r.id, classId: r.classId, name: r.profile && r.profile.name }; } catch (e) { return { ok: false, code: e.code, msg: e.message }; } };

test('existing sign-in behaves exactly as before for every kind of student (old vs new, side by side)', async () => {
  const cases = [
    { name: 'Eli Test', pin: '1001', b3StudentId: 'etKid', classId: 'et' },
    { name: 'eli test', pin: '1001', b3StudentId: 'etKid' },
    { name: 'Eli Test', pin: '1001' },
    { name: 'Eli Test', pin: '9999', b3StudentId: 'etKid' },
    { name: 'Not Eli', pin: '1001', b3StudentId: 'etKid' },
    { name: 'Eli Test', pin: '1001', b3StudentId: 'wtKid' },
    { name: 'Wes Test', pin: '1002', b3StudentId: 'wtKid', classId: 'wt' },
    { name: 'Wes Test', pin: '1002', b3StudentId: 'wtKid', classId: 'et' },
    { name: 'Wes Test', pin: '1002' },
    { name: 'Nate Test', pin: '1003', b3StudentId: 'newKid' },
    { name: 'Nate Test', pin: '1003' },
    { name: 'Tov Test', pin: '1004', b3StudentId: 'twoKid' },
    { name: 'Tov Test', pin: '1004', b3StudentId: 'twoKid', classId: 'synth-new' },
    { name: 'Tov Test', pin: '1004', b3StudentId: 'twoKid', classId: 'et' },
    { name: 'Off Test', pin: '1005', b3StudentId: 'offKid' },
    { name: 'Off Test', pin: '1005' },
    { name: 'Gone Test', pin: '1006', b3StudentId: 'goneKid' },
    { name: 'Same Name', pin: '1007' },
    { name: 'Same Name', pin: '1007', b3StudentId: 'dupA' },
    { name: 'Same Name', pin: '1007', b3StudentId: 'dupB', classId: 'wt' },
    { name: 'Old Test', pin: '1008', b3StudentId: 'oldKid' },
    { name: 'Leo Legacy', pin: '4444' },
    { name: 'Leo Legacy', pin: '4444', b3StudentId: 'legacyOnly' },
    { name: 'Leo Legacy', pin: '5770', b3StudentId: 'legacyOnly' },
    { name: 'Lou Off', pin: '5555' },
    { name: 'Nobody Here', pin: '1234' },
    { name: 'Nobody Here', pin: '1234', b3StudentId: 'ghost' },
    { name: '', pin: '1001' }, { name: 'Eli Test', pin: '' },
    { name: 'Eli Test', pin: '1001', b3StudentId: '../etKid' },
    { name: 'Eli Test', pin: '1001', b3StudentId: '__proto__' },
    { name: 'Eli Test', pin: '1001', b3StudentId: ['etKid'] },
  ];
  for (const c of cases) {
    const a = db(seed()), b = db(seed());
    const was = await outcome(() => reference.resolveStudent(a.get, c));
    const now = await outcome(() => resolveStudent(b.get, c));
    assert.deepEqual(now, was, 'differs for ' + JSON.stringify(c));
  }
});

test('ET and WT stay separate: a WT student never lands in ET, and class choice is honoured', async () => {
  const d = db(seed());
  const wt = await resolveStudent(d.get, { name: 'Wes Test', pin: '1002', b3StudentId: 'wtKid', classId: 'et' });
  assert.equal(wt.classId, 'wt');
  await assert.rejects(resolveStudent(d.get, { name: 'Eli Test', pin: '1001', b3StudentId: 'wtKid' }), { code: 401 });
  await assert.rejects(resolveStudent(d.get, { name: 'Wes Test', pin: '1001', b3StudentId: 'wtKid' }), { code: 401 }); // another student's passcode
  assert.equal((await resolveStudent(d.get, { name: 'Tov Test', pin: '1004', b3StudentId: 'twoKid', classId: 'synth-new' })).classId, 'synth-new');
});

test('cost: signing in with a student id no longer downloads the whole student list', async () => {
  const big = seed();
  for (let i = 0; i < 400; i++) big.b3Games.students['pad' + i] = { profile: { name: 'Pad Kid ' + i, active: true, note: 'x'.repeat(200) }, memberships: { m: mship('et').m } };
  for (let i = 0; i < 400; i++) big.posukPractice.allowedStudents['old' + i] = { name: 'Old Pad ' + i, classId: 'et' };
  const c = { name: 'Eli Test', pin: '1001', b3StudentId: 'etKid', classId: 'et' };
  const a = db(structuredClone(big)), b = db(structuredClone(big));
  await reference.resolveStudent(a.get, c);
  await resolveStudent(b.get, c);
  assert.ok(a.stats.bytes > 100000, 'old version read the whole list (' + a.stats.bytes + ' bytes)');
  assert.ok(b.stats.bytes < 3000, 'new version reads only this student (' + b.stats.bytes + ' bytes)');
  assert.equal(b.stats.reads.includes('b3Games/students'), false);
  assert.equal(b.stats.reads.includes('posukPractice/allowedStudents'), false);
  console.log('      sign-in read: old ' + a.stats.bytes + ' bytes -> new ' + b.stats.bytes + ' bytes (400 padding students)');
  // a wrong passcode with an id is also cheap; a name-only sign-in still searches (unchanged)
  const w = db(structuredClone(big)); await assert.rejects(resolveStudent(w.get, { ...c, pin: '0000' }), { code: 401 });
  assert.ok(w.stats.bytes < 3000);
  const n = db(structuredClone(big)); assert.equal((await resolveStudent(n.get, { name: 'Eli Test', pin: '1001' })).id, 'etKid');
});

test('limiter on the shared check: wrong guesses are stopped, recovery works, others unaffected, no extra writes for normal sign-in', async () => {
  const d = db(seed());
  const T0 = 50_000_000, opt = (t, ip) => ({ store: d, ip, now: t });
  const good = (t, ip) => resolveStudent(d.get, { name: 'Eli Test', pin: '1001', b3StudentId: 'etKid' }, opt(t, ip));
  const bad = (t, ip) => resolveStudent(d.get, { name: 'Eli Test', pin: '0000', b3StudentId: 'etKid' }, opt(t, ip));
  const w0 = d.stats.writes;
  await good(T0); await good(T0 + 1000);
  assert.equal(d.stats.writes, w0, 'a normal sign-in writes nothing');
  for (let i = 0; i < LIMITS.studentFails; i++) await assert.rejects(bad(T0 + 2000 + i), { code: 401 });
  await assert.rejects(good(T0 + 3000), { code: 429 });            // even the right passcode waits
  await assert.rejects(bad(T0 + 3001), { code: 429 });
  // another student, and the same class, still sign in normally
  assert.equal((await resolveStudent(d.get, { name: 'Wes Test', pin: '1002', b3StudentId: 'wtKid' }, opt(T0 + 3002))).classId, 'wt');
  assert.equal((await resolveStudent(d.get, { name: 'Nate Test', pin: '1003' }, opt(T0 + 3003))).id, 'newKid');
  // recovery after the short lock; a correct passcode clears the count
  await good(T0 + LIMITS.studentWindow + 10_000);
  for (let i = 0; i < LIMITS.studentFails - 1; i++) await assert.rejects(bad(T0 + LIMITS.studentWindow + 20_000 + i), { code: 401 });
  await good(T0 + LIMITS.studentWindow + 30_000);
  for (let i = 0; i < LIMITS.studentFails - 1; i++) await assert.rejects(bad(T0 + LIMITS.studentWindow + 40_000 + i), { code: 401 });
  await good(T0 + LIMITS.studentWindow + 50_000); // still fine: the earlier success reset the counter
  // one address cannot spray guesses over many names
  const T1 = T0 + 5 * 3600000; let hit = null;
  for (let i = 0; i < 80 && hit === null; i++) await resolveStudent(d.get, { name: 'Nobody ' + i, pin: '1', b3StudentId: 'ghost' + i }, opt(T1 + i, '7.7.7.7')).catch(e => { if (e.code === 429) hit = i; });
  assert.ok(hit !== null && hit <= LIMITS.ipFails + 1);
  await assert.rejects(good(T1 + 500, '7.7.7.7'), { code: 429 });
  await good(T1 + 500, '6.6.6.6'); // a different classroom/address is fine
});

test('limiter on the home sign-in (login, verify, choosePin): same rules, normal use unchanged', async () => {
  const d = db({ b3Games: { students: { moshe: { profile: { name: 'Moshe Levi', active: true } } }, workspaces: { 'b3-2026': { classes: { et: { name: 'ET', active: true, members: { moshe: { active: true } } } } } } },
    b3Private: { passcodes: { moshe: { passcode: '1111', chosenPinVersion: 1 } } } });
  const T0 = 60_000_000;
  const login = (pin, t, ip = '1.1.1.1') => studentAuth(d, { action: 'login', name: 'Moshe Levi', pin }, ip, t);
  const verify = (pin, t, ip = '1.1.1.1') => studentAuth(d, { action: 'verify', studentId: 'moshe', pin }, ip, t);
  const w0 = d.stats.writes;
  assert.equal((await login('1111', T0)).id, 'moshe'); assert.ok((await verify('1111', T0 + 1)).ok);
  const writesAfterLogin = d.stats.writes;
  await verify('1111', T0 + 2); await verify('1111', T0 + 3);
  assert.ok(d.stats.writes - writesAfterLogin <= 4, 'verify only touches the existing per-IP counter');
  for (let i = 0; i < LIMITS.studentFails; i++) await assert.rejects(login('0000', T0 + 100 + i, '2.2.2.' + i), { code: 401 }); // many addresses, one student
  await assert.rejects(login('1111', T0 + 200, '9.9.9.9'), { code: 429 });
  assert.equal((await login('1111', T0 + LIMITS.studentWindow + 5000, '9.9.9.9')).id, 'moshe');
  for (let i = 0; i < LIMITS.studentFails; i++) await assert.rejects(verify('0000', T0 + 2 * LIMITS.studentWindow + i, '3.3.3.' + i), { code: 401 });
  await assert.rejects(verify('1111', T0 + 2 * LIMITS.studentWindow + 50, '3.3.3.99'), { code: 429 });
  assert.ok(w0 >= 0);
});
