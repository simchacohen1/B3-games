'use strict';
// The Arcade bug: it ignored the lock. The server now refuses a student's Arcade actions while the class locks the Arcade
// (the Arcade switch, a schedule of ANY of his teachers, or a temporary lock), and honours a temporary unlock.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const core = require('../student-lock-core.js');

const WS = 'testSchool';
function seed(locks) {
  const classes = { grade3: { active: true, toolGrants: { 'multiplayer-center': true }, members: { avi: { name: 'Avi', active: true }, benny: { name: 'Benny', active: true } }, teacherIds: { teacher1: true } } };
  if (locks) classes.grade3.locks = locks;
  return { b3Games: { workspaces: { [WS]: { classes, teachers: { teacher1: { active: true, role: 'teacher', classIds: { grade3: true }, displayName: 'Teacher One' } } } },
    students: { avi: { memberships: { [WS + '_grade3']: { workspaceId: WS, classId: 'grade3', active: true } } } } } };
}
function load(data) {
  const parts = p => String(p || '').split('/').filter(Boolean);
  const read = p => parts(p).reduce((v, k) => v?.[k], data) ?? null;
  const snap = v => ({ val: () => (v == null ? null : structuredClone(v)), exists: () => v != null });
  const database = { ref: p => ({ get: async () => snap(read(p)) }) };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return { apps: [], initializeApp() { this.apps.push({}); }, database: () => database };
    if (request === 'firebase-functions/v2/https') return { onCall: (_o, handler) => handler, HttpsError };
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../backend/functions/multiplayer-games.js')];
    return require('../backend/functions/multiplayer-games.js').multiplayerGameAction;
  } finally { Module._load = original; }
}
const asStudent = (action, data) => action({ auth: { uid: 'auth_avi', token: { b3StudentId: 'avi', b3StudentName: 'Avi', b3ClassId: 'grade3' } }, data: { workspaceId: WS, classId: 'grade3', ...data } });
const asTeacher = (action, data) => action({ auth: { uid: 'teacher1', token: { name: 'Teacher One' } }, data: { workspaceId: WS, classId: 'grade3', ...data } });
const refusal = /locked by your teacher/i;
// A schedule line covering right now (New York time), for whichever day it is.
const coveringNow = (targets) => { const now = Date.now(), p = core.nyParts(now), hhmm = m => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((m % 1440) + 1440) % 1440 % 60).padStart(2, '0');
  return { t1: { name: 'Mr. Cohen', rules: { r1: { days: [p.day], start: hhmm(p.minutes - 3), end: hhmm(p.minutes + 20), targets } } } }; };

test('unlocked: the student can use the Arcade', async () => {
  const action = load(seed());
  assert.ok(Array.isArray((await asStudent(action, { action: 'classmates' })).classmates));
});

test('the Arcade switch locks every Arcade action for students, but not the teacher', async () => {
  const action = load(seed({ features: { 'multiplayer-center': { locked: true } } }));
  for (const a of ['classmates', 'list-rooms', 'quick-play', 'create', 'leaderboard', 'get-coin-policy']) {
    await assert.rejects(asStudent(action, { action: a, gameKey: 'connect-four' }), refusal, a);
  }
  assert.ok(Array.isArray((await asTeacher(action, { action: 'classmates' })).classmates), 'the teacher is not locked out of his own class');
});

test('a schedule of any teacher locks it, and the group "games" covers the Arcade; another feature does not', async () => {
  await assert.rejects(asStudent(load(seed({ schedules: coveringNow(['@games']) })), { action: 'classmates' }), refusal);
  await assert.rejects(asStudent(load(seed({ schedules: coveringNow(['multiplayer-center']) })), { action: 'classmates' }), refusal);
  assert.ok((await asStudent(load(seed({ schedules: coveringNow(['gematria']) })), { action: 'classmates' })).classmates, 'locking Gematria does not touch the Arcade');
});

test('a temporary unlock opens the Arcade despite the switch and the schedule; a temporary lock closes it', async () => {
  const unlock = { features: { 'multiplayer-center': { locked: true } }, schedules: coveringNow(['@games']), overrides: { '@games': { state: 'open', until: Date.now() + 60000, byName: 'Mr. Cohen' } } };
  assert.ok((await asStudent(load(seed(unlock)), { action: 'classmates' })).classmates);
  const ended = { ...unlock, overrides: { '@games': { state: 'open', until: Date.now() - 1000 } } };
  await assert.rejects(asStudent(load(seed(ended)), { action: 'classmates' }), refusal, 'when the time is up the lock is back');
  const lock = { overrides: { '*': { state: 'locked', until: Date.now() + 60000 } } };
  await assert.rejects(asStudent(load(seed(lock)), { action: 'classmates' }), refusal);
});

test('both copies of the Arcade function carry the lock check', () => {
  const fs = require('node:fs');
  for (const f of ['backend/functions/multiplayer-games.js', 'backend/functions-staging/multiplayer-games.js']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /featureLockedForClass\(/);
    assert.match(src, /actor\.classId, 'multiplayer-center', Date\.now\(\), actor\.workspaceId\)/);
    assert.match(src, /Multiplayer Arcade is locked by your teacher/);
  }
});
