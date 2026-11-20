'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { manageLocks, featureLockedForClass } = require('../backend/functions/student-locks-core.cjs');

const WS = 'b3-2026';
const ny = (hh, mm = 0) => Date.UTC(2026, 10, 19, hh + 5, mm);   // Thursday, New York time
function fakeDb(initial) {
  const root = JSON.parse(JSON.stringify(initial));
  const parts = p => p.split('/').filter(Boolean);
  const read = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), root);
  const write = (p, v) => {
    const ks = parts(p); let o = root;
    ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
    // Like the real database: a node with no children is not kept.
    for (let i = ks.length - 1; i > 0; i--) {
      const parent = ks.slice(0, i).reduce((x, k) => x && x[k], root);
      if (parent && typeof parent === 'object' && Object.keys(parent).length === 0) { const up = ks.slice(0, i - 1).reduce((x, k) => x[k], root); delete up[ks[i - 1]]; } else break;
    }
  };
  return { root, writes: [], async get(p) { const v = read(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
    async update(map) { this.writes.push(map); for (const [p, v] of Object.entries(map)) write(p, v); } };
}
const cls = `b3Games/workspaces/${WS}/classes/ET1`;
const base = () => fakeDb({ b3Games: { workspaces: { [WS]: {
  teachers: { t1: { displayName: 'Mr. Cohen', active: true, classIds: { ET1: true } }, t2: { displayName: 'Mr. Levi', active: true, classIds: { ET1: true } },
              out: { displayName: 'Other', active: true, classIds: { ZZ: true } } },
  classes: { ET1: { name: 'Alef', active: true, teacherIds: { t1: true, t2: true } } } } }, admins: { boss: { active: true } } } });
const who = (uid, extra = {}) => ({ uid, email: uid + '@school.test', email_verified: true, ...extra });
const locksOf = db => db.root.b3Games.workspaces[WS].classes.ET1.locks || {};
const call = (db, uid, body, now = ny(10)) => manageLocks(db, who(uid), { classId: 'ET1', ...body }, {}, now);
const rejects = (promise, code, text) => assert.rejects(promise, e => e.code === code && (!text || text.test(e.message)));

test('only a teacher of the class (or an admin) may touch its locks', async () => {
  const db = base();
  await rejects(manageLocks(db, {}, { classId: 'ET1', action: 'state' }, {}, ny(10)), 401);
  await rejects(call(db, 'out', { action: 'setAll', locked: true }), 403, /not assigned/);
  await rejects(call(db, 't1', { action: 'state', classId: 'nope' }), 404);
  await rejects(manageLocks(db, who('t1'), { classId: '../x', action: 'state' }, {}, ny(10)), 400);
  await rejects(call(db, 't1', { action: 'launch' }), 400, /Unknown/);
  assert.equal((await call(db, 'boss', { action: 'state' })).ok, true, 'an admin can see any class');
});

test('switches: one feature, and Lock all / Unlock all', async () => {
  const db = base();
  await call(db, 't1', { action: 'setFeature', featureId: 'multiplayer-center', locked: true });
  assert.deepEqual(Object.keys(locksOf(db).features), ['multiplayer-center']);
  assert.equal(locksOf(db).features['multiplayer-center'].by, 't1');
  await call(db, 't2', { action: 'setAll', locked: true });
  const core = require('../student-lock-core.js');
  assert.equal(Object.keys(locksOf(db).features).length, core.FEATURES.length, 'every feature, including the Arcade');
  await call(db, 't1', { action: 'setAll', locked: false });
  assert.equal(locksOf(db).features, undefined, 'Unlock all removes the switches');
  await rejects(call(db, 't1', { action: 'setFeature', featureId: 'nonsense', locked: true }), 400);
  await rejects(call(db, 't1', { action: 'setFeature', featureId: 'gematria', locked: 'yes' }), 400);
});

test('each teacher saves only his own schedule; bad lines are refused; an empty list clears it', async () => {
  const db = base();
  const rules = [{ days: ['mon', 'thu'], start: '09:00', end: '15:00', targets: ['@games'], label: 'Games' }];
  const r = await call(db, 't1', { action: 'saveSchedule', rules });
  assert.deepEqual(Object.keys(r.rules), ['r1']);
  assert.equal(locksOf(db).schedules.t1.name, 'Mr. Cohen');
  assert.equal(locksOf(db).schedules.t2, undefined, 'the other teacher has none');
  await rejects(call(db, 't1', { action: 'saveSchedule', rules: [{ days: [], start: '09:00', end: '10:00', targets: ['*'] }] }), 400, /day/);
  await rejects(call(db, 'boss', { action: 'saveSchedule', rules }), 403, /teacher of this class/);
  await call(db, 't1', { action: 'saveSchedule', rules: [] });
  assert.equal(locksOf(db).schedules, undefined);
});

test('opening the class is remembered (not more than once a minute) and makes the opener the holder', async () => {
  const db = base();
  await call(db, 't1', { action: 'opened' }, ny(9, 0));
  await call(db, 't1', { action: 'opened' }, ny(9, 0, 30 * 0) + 30000);   // 30 seconds later: skipped
  assert.equal(db.writes.length, 1);
  await call(db, 't2', { action: 'opened' }, ny(9, 5));
  const s = await call(db, 't1', { action: 'state' }, ny(10));
  assert.deepEqual([s.holder.uid, s.holder.why, s.holder.name], ['t2', 'opened', 'Mr. Levi']);
  assert.equal(s.me.isHolder, false);
  assert.deepEqual(s.teachers.map(t => t.name).sort(), ['Mr. Cohen', 'Mr. Levi']);
});

test('only the holder changes overrides; a scheduled teacher holds the class even if the other opened it later', async () => {
  const db = base();
  await call(db, 't1', { action: 'saveSchedule', rules: [{ days: ['thu'], start: '09:00', end: '15:00', targets: ['@games'] }] });
  await call(db, 't2', { action: 'opened' }, ny(9, 30));
  await rejects(call(db, 't2', { action: 'override', targets: ['@games'], state: 'open', minutes: 15 }), 403, /Mr\. Cohen has this class right now \(it is on his schedule\)/);
  const ok = await call(db, 't1', { action: 'override', targets: ['@games'], state: 'open', minutes: 15 });
  assert.equal(ok.until, ny(10) + 15 * 60000);
  const o = locksOf(db).overrides['@games'];
  assert.deepEqual([o.state, o.byName, o.label, o.by], ['open', 'Mr. Cohen', '15 min', 't1']);
  // Outside his schedule the most recent opener holds it.
  await rejects(call(db, 't1', { action: 'override', targets: ['*'], state: 'locked', minutes: 10 }, ny(16)), 403, /opened it most recently/);
  assert.equal((await call(db, 't2', { action: 'override', targets: ['*'], state: 'locked', minutes: 10 }, ny(16))).ok, true);
  assert.equal((await call(db, 'boss', { action: 'override', targets: ['gematria'], state: 'open', minutes: 5 }, ny(16))).ok, true, 'an admin can always');
});

test('nobody holds a class nobody opened: opening it comes first', async () => {
  const db = base();
  await rejects(call(db, 't1', { action: 'override', targets: ['*'], state: 'open', minutes: 5 }), 403, /Open this class first/);
});

test('override lengths: minutes are bounded; "until end of class" follows the holder\'s schedule line', async () => {
  const db = base();
  await call(db, 't1', { action: 'opened' }, ny(9));
  for (const minutes of [0, 241, 'x']) await rejects(call(db, 't1', { action: 'override', targets: ['*'], state: 'open', minutes }), 400, /minutes/);
  await rejects(call(db, 't1', { action: 'override', targets: ['nope'], state: 'open', minutes: 5 }), 400, /Choose what/);
  await rejects(call(db, 't1', { action: 'override', targets: ['*'], state: 'maybe', minutes: 5 }), 400, /unlock or lock/);
  const noSchedule = await call(db, 't1', { action: 'override', targets: ['*'], state: 'open', endOfClass: true });
  assert.equal(noSchedule.until, ny(10) + 45 * 60000); assert.match(noSchedule.label, /no schedule/);
  await call(db, 't1', { action: 'saveSchedule', rules: [{ days: ['thu'], start: '09:00', end: '11:30', targets: ['*'] }] });
  const scheduled = await call(db, 't1', { action: 'override', targets: ['*'], state: 'open', endOfClass: true });
  assert.equal(scheduled.until, ny(11, 30)); assert.equal(scheduled.label, 'until the end of class');
});

test('clearing an override, and ended overrides are tidied away', async () => {
  const db = base();
  await call(db, 't1', { action: 'opened' }, ny(8));
  await call(db, 't1', { action: 'override', targets: ['gematria'], state: 'locked', minutes: 5 }, ny(8));
  await call(db, 't1', { action: 'override', targets: ['@games'], state: 'open', minutes: 30 }, ny(10));
  assert.equal(locksOf(db).overrides.gematria, undefined, 'the 8:05 override had ended by 10:00 and was removed');
  assert.ok(locksOf(db).overrides['@games']);
  await call(db, 't1', { action: 'clearOverride', targets: ['@games'] }, ny(10, 5));
  assert.equal(locksOf(db).overrides, undefined);
});

test('the server answers "is it locked for a student of this class right now"', async () => {
  const db = base();
  await call(db, 't1', { action: 'setFeature', featureId: 'multiplayer-center', locked: true });
  const arcade = await featureLockedForClass(db, 'ET1', 'multiplayer-center', ny(10));
  assert.equal(arcade.locked, true); assert.match(arcade.message, /Locked by your teacher/);
  assert.equal((await featureLockedForClass(db, 'ET1', 'gematria', ny(10))).locked, false);
  assert.equal((await featureLockedForClass(db, 'ET1', 'unknown-feature', ny(10))).locked, false);
  assert.equal((await featureLockedForClass(db, '../x', 'gematria', ny(10))).locked, false);
});

test('prod and staging carry identical lock code; the staging function is limited to the staging site; no address is hard-coded', () => {
  const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(read('student-lock-core.js'), read('backend/functions/student-lock-core.js'), 'the browser file and the server copy are the same');
  assert.equal(read('student-lock-core.js'), read('backend/functions-staging/student-lock-core.js'));
  assert.equal(read('backend/functions/student-locks-core.cjs'), read('backend/functions-staging/student-locks-core.cjs'));
  const staging = read('backend/functions-staging/student-locks.js'), prod = read('backend/functions/student-locks.js');
  assert.match(staging, /fun-torah-tools-staging\.web\.app/); assert.doesNotMatch(staging, /sols\.tools|simchacohen1\.github\.io/);
  assert.match(staging, /assertNoProductionFirebaseTarget/);
  for (const src of [staging, prod, read('backend/functions/student-locks-core.cjs')]) assert.doesNotMatch(src, /@gmail\.com|@funtorahtools/);
  assert.match(read('backend/functions/index.js'), /exports\.studentLocks = require\("\.\/student-locks"\)\.studentLocks/);
  assert.match(read('backend/functions-staging/index.js'), /exports\.studentLocks = require\('\.\/student-locks'\)\.studentLocks/);
});

test('rules: the locks node is readable by the class (and a student by his membership), never writable by a client', () => {
  for (const file of ['firebase-rules.hardened.json', 'staging/database.rules.json']) {
    const node = JSON.parse(fs.readFileSync(file, 'utf8')).rules.b3Games.workspaces.$workspaceId.classes.$classId.locks;
    assert.ok(node && node['.read'], file + ' has a read rule');
    assert.match(node['.read'], /b3ClassId == \$classId/); assert.match(node['.read'], /memberships\/' \+ \$workspaceId/);
    assert.equal(node['.write'], undefined, 'no write rule of its own: only the class\'s owner/admin write rule applies');
  }
  const live = JSON.parse(fs.readFileSync('firebase-rules.json', 'utf8')).rules.b3Games.workspaces.$workspaceId.classes.$classId;
  assert.ok(live.locks, 'the live rules file knows the node too');
});
