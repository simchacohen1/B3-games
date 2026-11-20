'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../student-lock-core.js');

// Thursday 19 Nov 2026, New York time (EST, UTC-5).
const ny = (hh, mm = 0, dayOffset = 0) => Date.UTC(2026, 10, 19 + dayOffset, hh + 5, mm);
const games = (extra = {}) => ({ days: ['mon', 'tue', 'wed', 'thu'], start: '09:00', end: '15:00', targets: ['@games'], ...extra });
const sched = (name, rules) => ({ name, rules: Object.fromEntries(rules.map((r, i) => ['r' + i, r])) });
const state = (locks, feature, now) => core.evaluate(locks, now)[feature];

test('a weekly schedule locks its features only inside its window, in New York time', () => {
  const locks = { schedules: { t1: sched('Mr. Cohen', [games()]) } };
  assert.equal(state(locks, 'multiplayer-center', ny(8, 59)).locked, false, 'before');
  assert.equal(state(locks, 'multiplayer-center', ny(9, 0)).locked, true, 'at the start');
  assert.equal(state(locks, 'game-show', ny(14, 59)).locked, true, 'a game in the group');
  assert.equal(state(locks, 'multiplayer-center', ny(15, 0)).locked, false, 'the end is not locked');
  assert.equal(state(locks, 'gematria', ny(10)).locked, false, 'a feature outside the group');
  assert.equal(state(locks, 'multiplayer-center', ny(10, 0, 1)).locked, false, 'Friday is not in Mon to Thu');
  const s = state(locks, 'multiplayer-center', ny(10));
  assert.equal(s.kind, 'schedule'); assert.equal(s.teacherName, 'Mr. Cohen'); assert.equal(s.until, ny(15));
});

test('a window that runs past midnight covers the early morning of the next day', () => {
  const locks = { schedules: { t1: sched('T', [{ days: ['thu'], start: '22:00', end: '06:00', targets: ['*'] }]) } };
  assert.equal(state(locks, 'gematria', ny(23)).locked, true);
  assert.equal(state(locks, 'gematria', ny(5, 0, 1)).locked, true, 'Friday 5:00 belongs to Thursday night');
  assert.equal(state(locks, 'gematria', ny(6, 0, 1)).locked, false);
  assert.equal(state(locks, 'gematria', ny(5, 0)).locked, false, 'Thursday 5:00 does not (Wednesday night is not listed)');
  assert.equal(state(locks, 'gematria', ny(23)).until, ny(6, 0, 1), 'the end is tomorrow morning');
});

test('a student follows ALL his teachers: any teacher scheduling it locked locks it', () => {
  const locks = { schedules: { t1: sched('A', [games({ days: ['fri'] })]), t2: sched('B', [{ days: ['thu'], start: '10:00', end: '11:00', targets: ['multiplayer-center'] }]) } };
  const s = state(locks, 'multiplayer-center', ny(10, 30));
  assert.equal(s.locked, true); assert.equal(s.teacherName, 'B');
  assert.equal(state(locks, 'game-show', ny(10, 30)).locked, false, "B locks only the arcade; A's rule is Fridays");
  const both = { schedules: { t1: sched('A', [games()]), t2: sched('B', [games({ end: '16:00' })]) } };
  const b = state(both, 'game-show', ny(10));
  assert.equal(b.schedules.length, 2); assert.equal(b.until, ny(16), 'it stays locked until the later of the two ends');
});

test('the teacher switch locks until switched back; a temporary override beats the switch and the schedules', () => {
  const base = { features: { 'multiplayer-center': { locked: true } }, schedules: { t1: sched('A', [games()]) } };
  assert.equal(state(base, 'multiplayer-center', ny(20)).kind, 'manual');
  const open = { ...base, overrides: { 'multiplayer-center': { state: 'open', until: ny(10, 15), byName: 'Mr. A', label: '15 min' } } };
  const s = state(open, 'multiplayer-center', ny(10));
  assert.deepEqual([s.locked, s.kind, s.until, s.byName], [false, 'override-open', ny(10, 15), 'Mr. A']);
  assert.equal(state(open, 'multiplayer-center', ny(10, 15)).locked, true, 'when time runs out the schedules (and switch) take over again');
  assert.equal(state(open, 'multiplayer-center', ny(10, 15)).kind, 'manual');
  const locked = { overrides: { '*': { state: 'locked', until: ny(11) } } };
  assert.equal(state(locked, 'gematria', ny(10)).kind, 'override-locked');
  assert.equal(state(locked, 'gematria', ny(11)).locked, false);
});

test('the most specific override wins: a feature beats its group, which beats "all"', () => {
  const locks = { overrides: { '*': { state: 'locked', until: ny(12) }, '@games': { state: 'open', until: ny(12) }, 'game-show': { state: 'locked', until: ny(12) } } };
  assert.equal(state(locks, 'gematria', ny(10)).locked, true, 'all locked');
  assert.equal(state(locks, 'multiplayer-center', ny(10)).locked, false, 'the games group is opened');
  assert.equal(state(locks, 'game-show', ny(10)).locked, true, 'but this one game is locked again');
});

test('a student in two classes is locked if either class locks it', () => {
  const a = { features: { gematria: { locked: true } } }, b = {};
  const result = core.evaluateStudent([b, a], ny(10));
  assert.equal(result.gematria.locked, true); assert.equal(result.chazara.locked, false);
  assert.equal(core.evaluateStudent([], ny(10)).gematria.locked, false, 'no class data: nothing locked');
  // An override in one class does not unlock what the other class locks.
  const over = { overrides: { gematria: { state: 'open', until: ny(12) } } };
  assert.equal(core.evaluateStudent([over, a], ny(10)).gematria.locked, true);
});

test('who has the class: the scheduled teacher; else the one who opened it most recently', () => {
  const locks = { schedules: { t1: sched('A', [games()]), t2: sched('B', []) }, opened: { t1: ny(8), t2: ny(9, 30) } };
  assert.deepEqual(core.holderOf(locks, ['t1', 't2'], ny(10)), { uid: 't1', why: 'scheduled' }, 'A is scheduled now even though B opened it later');
  assert.deepEqual(core.holderOf(locks, ['t1', 't2'], ny(16)), { uid: 't2', why: 'opened' }, 'nothing scheduled: B opened last');
  const clash = { schedules: { t1: sched('A', [games()]), t2: sched('B', [games()]) }, opened: { t1: ny(9), t2: ny(9, 5) } };
  assert.equal(core.holderOf(clash, ['t1', 't2'], ny(10)).uid, 't2', 'two scheduled: the most recent opener');
  assert.equal(core.holderOf({}, ['t1'], ny(10)), null, 'nobody ever opened it');
  assert.equal(core.holderOf({ opened: { gone: ny(9) } }, ['t1'], ny(10)), null, 'someone no longer teaching the class never holds it');
});

test('"until end of class" is the end of the holder\'s own schedule line, else 45 minutes', () => {
  const locks = { schedules: { t1: sched('A', [games()]) } };
  assert.deepEqual(core.endOfClass(locks, 't1', ny(10)), { until: ny(15), fromSchedule: true });
  const d = core.endOfClass(locks, 't1', ny(16));
  assert.deepEqual([d.fromSchedule, d.until], [false, ny(16) + 45 * 60000]);
});

test('saved schedule lines are checked and cleaned', () => {
  const ok = core.normalizeRules([{ days: ['mon', 'mon', 'xyz', 'tue'], start: '09:00', end: '15:00', targets: ['@games', 'nope', '*'], label: 'Games' }]);
  assert.deepEqual(ok.r1, { days: ['mon', 'tue'], start: '09:00', end: '15:00', targets: ['@games', '*'], label: 'Games' });
  assert.throws(() => core.normalizeRules([{ days: [], start: '09:00', end: '15:00', targets: ['*'] }]), /at least one day/);
  assert.throws(() => core.normalizeRules([{ days: ['mon'], start: '9:00', end: '15:00', targets: ['*'] }]), /Times/);
  assert.throws(() => core.normalizeRules([{ days: ['mon'], start: '09:00', end: '09:00', targets: ['*'] }]), /differ/);
  assert.throws(() => core.normalizeRules([{ days: ['mon'], start: '09:00', end: '10:00', targets: ['nope'] }]), /what to lock/);
  assert.throws(() => core.normalizeRules(Array.from({ length: 21 }, () => games())), /At most/);
});

test('every student tool the site already knows is in the lock catalog', () => {
  const policy = require('../backend/functions/student-tool-policy.js');
  const known = new Set(core.FEATURES.map(f => f.id));
  const alias = { gallery: 'class-gallery', tag: 'class-gallery', rashi: 'rashi-letters' };
  for (const id of policy.studentActivities) assert.ok(known.has(alias[id] || id), id + ' is missing from student-lock-core.js FEATURES');
  assert.ok(known.has('multiplayer-center'), 'the Arcade has its own switch');
});
