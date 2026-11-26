'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../backend/functions/chayus-points-core.cjs');
const { toolForSource, authorizePracticeStudent } = require('../backend/functions/student-practice-auth.cjs');

// A tiny in-memory stand-in for the Realtime Database with the transaction shape the core uses.
function memoryStore() {
  const data = {};
  const get = async p => (p in data ? JSON.parse(JSON.stringify(data[p])) : null);
  const tx = async (p, fn) => {
    const next = fn(p in data ? JSON.parse(JSON.stringify(data[p])) : null);
    if (next === undefined) return { committed: false };
    data[p] = next;
    return { committed: true };
  };
  return { data, get, tx };
}
function awarder(paid = []) {
  return async ({ requestId, level, name, day }) => {
    const already = paid.some(row => row.requestId === requestId);
    if (!already) paid.push({ requestId, level, name, day });
    return { ok: true, newlyAwarded: !already, amount: 1 };
  };
}
const T0 = Date.parse('2026-11-25T14:00:00Z'); // a school day, 9am New York
const S = 1000;

test('the server level table matches the meter: 1, 3, 5, 7, 10, 14, 18, 22, 26, 30 minutes', () => {
  assert.deepEqual([...core.LEVEL_MINUTES], [1, 3, 5, 7, 10, 14, 18, 22, 26, 30]);
  assert.equal(core.LEVEL_NAMES.length, 10);
  const client = require('../chayus-meter/core.js');
  assert.deepEqual(client.LEVELS.map(row => row.minutes), [...core.LEVEL_MINUTES]);
  assert.deepEqual(client.LEVELS.map(row => row.name), [...core.LEVEL_NAMES]);
  for (const seconds of [0, 59, 60, 179, 180, 419, 420, 1799, 1800, 5000]) {
    assert.equal(core.levelFor(seconds), client.levelInfo(seconds).level, 'level at ' + seconds + 's');
  }
});

test('levels pay one point each, once, as they are reached', async () => {
  const store = memoryStore(), paid = [];
  let now = T0;
  let total = 0;
  const seen = [];
  for (let i = 0; i < 40; i++) {            // 40 reports, 30 s apart, 1.5x voice
    now += 30 * S; total += 45;
    const r = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: total, nowMs: now });
    assert.equal(r.ok, true);
    seen.push(r.points);
  }
  assert.equal(paid.length, 10);
  assert.deepEqual(paid.map(row => row.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(paid.map(row => row.requestId)).size, 10);
  assert.equal(seen[seen.length - 1], 10);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'points never go down');
});

test('a day can never pay more than 10 points, however much time is reported', async () => {
  const store = memoryStore(), paid = [];
  let now = T0;
  for (let i = 0; i < 200; i++) {
    now += 30 * S;
    await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 999999, nowMs: now });
  }
  assert.equal(paid.length, 10);
  const r = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 999999, nowMs: now + 30 * S });
  assert.equal(r.points, 10);
  assert.ok(r.countedSeconds <= core.MAX_DAY_SECONDS);
});

test('reported time can only grow as fast as 2x real time, so a hand-made request cannot jump to the top', async () => {
  const store = memoryStore(), paid = [];
  const first = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 1800, nowMs: T0 });
  assert.ok(first.countedSeconds <= 2 * 90 + 4, 'first report accepted ' + first.countedSeconds);
  assert.ok(first.level <= 3);
  const second = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 1800, nowMs: T0 + 10 * S });
  assert.ok(second.countedSeconds - first.countedSeconds <= 2 * 10 + 4 + 0.01);
  assert.ok(paid.length <= 3);
  // Real elapsed time is capped per report, so waiting an hour and then asking is not a shortcut either.
  const third = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 1800, nowMs: T0 + 3600 * S });
  assert.ok(third.countedSeconds - second.countedSeconds <= 2 * 300 + 4 + 0.01);
});

test('a lower or repeated number never lowers or double counts the day', async () => {
  const store = memoryStore(), paid = [];
  let r = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 100, nowMs: T0 + 60 * S });
  const high = r.countedSeconds;
  r = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 10, nowMs: T0 + 90 * S });
  assert.equal(r.countedSeconds, high);
  r = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 100, nowMs: T0 + 91 * S });
  assert.equal(r.countedSeconds, high);
  assert.equal(paid.length, 1);
});

test('bad input is refused and nothing is paid', async () => {
  const store = memoryStore(), paid = [];
  for (const bad of [-5, NaN, Infinity, 'abc']) {
    const r = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: bad, nowMs: T0 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  }
  assert.equal((await core.report({ store, award: awarder(paid), studentId: '', reportedSeconds: 10, nowMs: T0 })).ok, false);
  assert.equal(paid.length, 0);
});

test('each school day starts from zero, and a student only has their own day', async () => {
  const store = memoryStore(), paid = [];
  let now = T0, total = 0;
  for (let i = 0; i < 10; i++) { now += 30 * S; total += 60; await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: total, nowMs: now }); }
  const today = await core.report({ store, award: awarder(paid), studentId: 's1', nowMs: now });
  assert.ok(today.level >= 2);
  const tomorrow = await core.report({ store, award: awarder(paid), studentId: 's1', nowMs: now + 24 * 3600 * S });
  assert.equal(tomorrow.countedSeconds, 0);
  assert.equal(tomorrow.points, 0);
  assert.notEqual(tomorrow.day, today.day);
  const other = await core.report({ store, award: awarder(paid), studentId: 's2', nowMs: now });
  assert.equal(other.countedSeconds, 0);
  // The day is the New York school day, not UTC: 11pm New York is still the same day.
  assert.equal(core.nyDay(Date.parse('2026-11-26T03:30:00Z')), '2026-11-25');
  assert.equal(core.nyDay(Date.parse('2026-11-26T05:30:00Z')), '2026-11-26');
});

test('reading the status never pays or changes anything', async () => {
  const store = memoryStore(), paid = [];
  const r = await core.report({ store, award: awarder(paid), studentId: 's1', nowMs: T0 });
  assert.equal(r.ok, true);
  assert.equal(r.points, 0);
  assert.equal(paid.length, 0);
  assert.deepEqual(Object.keys(store.data), []);
});

test('a failed point payment is retried on the next report without paying twice', async () => {
  const store = memoryStore(), paid = [];
  let fail = true;
  const flaky = async args => (fail ? { ok: false, error: 'down' } : awarder(paid)(args));
  let now = T0 + 60 * S;
  let r = await core.report({ store, award: flaky, studentId: 's1', reportedSeconds: 100, nowMs: now });
  assert.equal(r.points, 0);
  assert.ok(r.awardError);
  fail = false;
  r = await core.report({ store, award: flaky, studentId: 's1', reportedSeconds: 100, nowMs: now + 30 * S });
  assert.equal(r.points, 1);
  r = await core.report({ store, award: flaky, studentId: 's1', reportedSeconds: 100, nowMs: now + 60 * S });
  assert.equal(r.points, 1);
  assert.equal(paid.length, 1);
});

test('the Chayus tool is checked like any student tool, and only the Chayus source maps to it', () => {
  assert.equal(toolForSource('chayus-meter'), 'chayus-meter');
  assert.equal(toolForSource('chayus-level'), 'chayus-meter');
  assert.equal(toolForSource('chazara'), 'chazara');
  assert.equal(require('../backend/functions-staging/student-practice-auth.cjs').toolForSource('chayus-meter'), 'chayus-meter');
});

test('a student whose class does not have the Chayus Meter turned on is refused', async () => {
  const studentTools = require('../backend/functions/student-tool-policy.js');
  const db = {
    'b3Games/students/st1/profile': { classId: 'c1' },
    'b3Games/students/st1/memberships': { m: { active: true, workspaceId: 'b3-2026', classId: 'c1' } },
    'b3Games/workspaces/b3-2026/classes/c1/active': true,
    'b3Games/workspaces/b3-2026/classes/c1/members/st1': { active: true }
  };
  const result = await authorizePracticeStudent({
    authorization: 'Bearer x',
    verifyToken: async () => ({ b3StudentId: 'st1', b3ClassId: 'c1', b3StudentRole: 'student' }),
    get: async p => (p in db ? db[p] : null), source: 'chayus-meter', studentTools
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('the server routes both Chayus actions through the student check, in live and staging code', () => {
  for (const dir of ['functions', 'functions-staging']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'backend', dir, 'student-rewards-auto-award.js'), 'utf8');
    assert.match(src, /action==="chayus-report"\|\|action==="chayus-status"/);
    assert.match(src, /requirePracticeStudent\(req,'chayus-meter'\)/);
    assert.match(src, /source:chayusPoints\.SOURCE,amount:1/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'backend', dir, 'chayus-points-core.cjs')));
  }
  const a = fs.readFileSync(path.join(__dirname, '..', 'backend', 'functions', 'chayus-points-core.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const b = fs.readFileSync(path.join(__dirname, '..', 'backend', 'functions-staging', 'chayus-points-core.cjs'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(a, b, 'live and staging copies of chayus-points-core.cjs must match');
});

test('the owner off-switch pauses everything: nothing is recorded or paid, and the page is told', async () => {
  const store = memoryStore(), paid = [];
  const r = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 600, nowMs: T0 + 60 * S, enabled: false });
  assert.equal(r.ok, true);
  assert.equal(r.paused, true);
  assert.equal(r.points, 0);
  assert.equal(paid.length, 0);
  assert.deepEqual(Object.keys(store.data), []);
  // Turned back on, it works as before.
  const on = await core.report({ store, award: awarder(paid), studentId: 's1', reportedSeconds: 100, nowMs: T0 + 90 * S, enabled: true });
  assert.equal(on.paused, undefined);
  assert.equal(on.points, 1);
});

test('both server copies read the off-switch setting before doing anything', () => {
  for (const dir of ['functions', 'functions-staging']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'backend', dir, 'student-rewards-auto-award.js'), 'utf8');
    assert.match(src, /settings\/chayusPointsEnabled/);
    assert.match(src, /\)\.val\(\)!==false/);
  }
});
