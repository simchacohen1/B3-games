'use strict';
// Checks the tighter b3Quiz database rules with made-up people only.
// Static checks always run. Emulator checks run with B3_RUN_RTDB_EMULATOR_TESTS=1, for example:
//   firebase emulators:exec --only database --project demo-b3-quiz "node --test tests/b3-quiz-rules-emulator.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { get, ref, set, update, remove, push } = require('firebase/database');

const rulesText = fs.readFileSync('firebase-rules.json', 'utf8');
const rules = JSON.parse(rulesText).rules;
const emulatorEnabled = process.env.B3_RUN_RTDB_EMULATOR_TESTS === '1';
const emulatorHost = String(process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000');
const emulatorPort = Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || emulatorHost.split(':')[1] || 9000);
const testEmulator = emulatorEnabled ? test : test.skip;
let env;

test('b3Quiz has no unconditional public read or write anywhere', () => {
  const found = [];
  (function walk(node, path) {
    for (const [name, value] of Object.entries(node)) {
      if (name === '.read' || name === '.write') {
        if (value === true || String(value).trim() === 'true') found.push(path + ' ' + name);
      } else if (value && typeof value === 'object') walk(value, path + '/' + name);
    }
  })(rules.b3Quiz, 'b3Quiz');
  assert.deepEqual(found, []);
  assert.equal(rules.b3Quiz['.read'], undefined);
  assert.equal(rules.b3Quiz['.write'], undefined);
});

test('every b3Quiz permission requires a signed-in user', () => {
  const bad = [];
  (function walk(node, path) {
    for (const [name, value] of Object.entries(node)) {
      if (name === '.read' || name === '.write') {
        if (!String(value).startsWith('auth != null')) bad.push(path + ' ' + name);
      } else if (value && typeof value === 'object') walk(value, path + '/' + name);
    }
  })(rules.b3Quiz, 'b3Quiz');
  assert.deepEqual(bad, []);
});

test.before(async () => {
  if (!emulatorEnabled) return;
  env = await initializeTestEnvironment({
    projectId: 'demo-b3-quiz',
    database: { host: '127.0.0.1', port: emulatorPort, rules: rulesText },
  });
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.database();
    const fixtures = {
      'b3Games/workspaces/b3-2026/teachers/t_et': { active: true, classIds: { et: true } },
      'b3Games/workspaces/b3-2026/teachers/t_alpha': { active: true, classIds: { alpha: true } },
      'b3Games/workspaces/b3-2026/teachers/t_beta': { active: true, classIds: { beta: true } },
      'b3Games/workspaces/b3-2026/teachers/t_off': { active: false, classIds: { et: true, alpha: true } },
      'b3Games/admins/admin_one': { active: true },
      // original ET/WT quiz data
      'b3Quiz/launches/L1': { classId: 'et', quizSnapshot: { questions: [{ answer: 'secret' }] } },
      'b3Quiz/responses/L1/kid_et': { 0: { correct: true } },
      'b3Quiz/completions/L1/kid_et': { score: 100 },
      'b3Quiz/settings/activeLaunchByClass/et': 'L1',
      'b3Quiz/settings/studentActiveLaunch/kid_et': 'L1',
      'b3Quiz/practiceAttempts/kid_et/a1': { score: 5 },
      'b3Quiz/quizzes/Q1': { title: 'Synthetic quiz' },
      // per-class quiz data
      'b3Quiz/classes/alpha/launches/A1': { classId: 'alpha' },
      'b3Quiz/classes/alpha/responses/A1/kid_alpha': { 0: { correct: true } },
      'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha': 'A1',
      'b3Quiz/classes/alpha/settings/studentActiveLaunch/kid_alpha': 'A1',
    };
    for (const [path, value] of Object.entries(fixtures)) await set(ref(db, path), value);
  });
});
test.after(async () => { await env?.cleanup(); });

const who = {
  anon: () => env.unauthenticatedContext().database(),
  kidEt: () => env.authenticatedContext('u_kid_et', { b3StudentId: 'kid_et', b3ClassId: 'et', b3StudentRole: 'student' }).database(),
  kidEt2: () => env.authenticatedContext('u_kid_et2', { b3StudentId: 'kid_et2', b3ClassId: 'et', b3StudentRole: 'student' }).database(),
  kidAlpha: () => env.authenticatedContext('u_kid_alpha', { b3StudentId: 'kid_alpha', b3ClassId: 'alpha', b3StudentRole: 'student' }).database(),
  kidBeta: () => env.authenticatedContext('u_kid_beta', { b3StudentId: 'kid_beta', b3ClassId: 'beta', b3StudentRole: 'student' }).database(),
  tEt: () => env.authenticatedContext('t_et', { email: 'et@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } }).database(),
  tAlpha: () => env.authenticatedContext('t_alpha', { email: 'a@example.test', email_verified: true }).database(),
  tBeta: () => env.authenticatedContext('t_beta', { email: 'b@example.test', email_verified: true }).database(),
  tOff: () => env.authenticatedContext('t_off', { email: 'o@example.test', email_verified: true }).database(),
  admin: () => env.authenticatedContext('admin_one', { email: 'adm@example.test', email_verified: true }).database(),
  owner: () => env.authenticatedContext('owner_uid', { email: 'simcha5770@gmail.com', email_verified: true }).database(),
  fakeOwner: () => env.authenticatedContext('fake_owner', { email: 'simcha5770@gmail.com', email_verified: false }).database(),
};
const ok = (p) => assert.doesNotReject(p);
const no = (p) => assert.rejects(p);

testEmulator('signed-out visitors and the old open access are blocked everywhere in b3Quiz', async () => {
  const a = who.anon();
  for (const path of ['b3Quiz', 'b3Quiz/launches', 'b3Quiz/launches/L1', 'b3Quiz/responses', 'b3Quiz/responses/L1/kid_et',
    'b3Quiz/completions/L1/kid_et', 'b3Quiz/settings/activeLaunchByClass/et', 'b3Quiz/practiceAttempts/kid_et', 'b3Quiz/classes/alpha/launches/A1']) {
    await no(get(ref(a, path)));
  }
  await no(set(ref(a, 'b3Quiz/responses/L1/kid_et/5'), { correct: true }));
  await no(set(ref(a, 'b3Quiz/launches/L9'), { classId: 'et' }));
});

testEmulator('students cannot read quiz answers, launches, other kids work or the whole quiz area', async () => {
  const k = who.kidEt();
  await no(get(ref(k, 'b3Quiz')));
  await no(get(ref(k, 'b3Quiz/launches')));
  await no(get(ref(k, 'b3Quiz/launches/L1')));
  await no(get(ref(k, 'b3Quiz/responses/L1/kid_et')));
  await no(get(ref(k, 'b3Quiz/completions/L1/kid_et')));
  await no(get(ref(k, 'b3Quiz/quizzes')));
});

testEmulator('students cannot write responses, completions, launches or settings (answers go through the server)', async () => {
  const k = who.kidEt();
  await no(set(ref(k, 'b3Quiz/responses/L1/kid_et/1'), { correct: true }));
  await no(set(ref(k, 'b3Quiz/completions/L1/kid_et'), { score: 100 }));
  await no(update(ref(k, 'b3Quiz/launches/L1'), { showScore: true }));
  await no(set(ref(k, 'b3Quiz/settings/activeLaunchByClass/et'), 'L9'));
  await no(set(ref(k, 'b3Quiz/settings/studentActiveLaunch/kid_et'), 'L9'));
});

testEmulator('students can still see only their own class and own personal quiz pointer', async () => {
  await ok(get(ref(who.kidEt(), 'b3Quiz/settings/activeLaunchByClass/et')));
  await ok(get(ref(who.kidEt(), 'b3Quiz/settings/studentActiveLaunch/kid_et')));
  await no(get(ref(who.kidEt2(), 'b3Quiz/settings/studentActiveLaunch/kid_et')));
  await no(get(ref(who.kidAlpha(), 'b3Quiz/settings/activeLaunchByClass/et')));
  await no(get(ref(who.kidEt(), 'b3Quiz/settings/activeLaunchByClass')));
  // per-class space
  await ok(get(ref(who.kidAlpha(), 'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha')));
  await ok(get(ref(who.kidAlpha(), 'b3Quiz/classes/alpha/settings/studentActiveLaunch/kid_alpha')));
  await no(get(ref(who.kidBeta(), 'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha')));
  await no(get(ref(who.kidBeta(), 'b3Quiz/classes/alpha/settings/studentActiveLaunch/kid_alpha')));
});

testEmulator('students can save their own practice tries only, and read only their own', async () => {
  await ok(push(ref(who.kidEt(), 'b3Quiz/practiceAttempts/kid_et'), { score: 7 }));
  await no(push(ref(who.kidEt(), 'b3Quiz/practiceAttempts/kid_et2'), { score: 7 }));
  await no(push(ref(who.anon(), 'b3Quiz/practiceAttempts/kid_et'), { score: 7 }));
  await ok(get(ref(who.kidEt(), 'b3Quiz/practiceAttempts/kid_et')));
  await no(get(ref(who.kidEt2(), 'b3Quiz/practiceAttempts/kid_et')));
  await no(get(ref(who.kidEt(), 'b3Quiz/practiceAttempts')));
});

testEmulator('an ET teacher can run original ET quizzes: launches, pointers, quizzes, audit, responses', async () => {
  const t = who.tEt();
  await ok(get(ref(t, 'b3Quiz/launches')));
  await ok(get(ref(t, 'b3Quiz/launches/L1')));
  await ok(get(ref(t, 'b3Quiz/responses')));
  await ok(get(ref(t, 'b3Quiz/responses/L1')));
  await ok(get(ref(t, 'b3Quiz/completions')));
  await ok(get(ref(t, 'b3Quiz/quizzes')));
  await ok(get(ref(t, 'b3Quiz/settings/activeLaunchByClass')));
  await ok(set(ref(t, 'b3Quiz/launches/L2'), { classId: 'et', title: 'New launch' }));
  await ok(update(ref(t, 'b3Quiz/launches/L2'), { showScore: true }));
  await ok(set(ref(t, 'b3Quiz/settings/activeLaunchByClass/et'), 'L2'));
  await ok(set(ref(t, 'b3Quiz/settings/studentActiveLaunch/kid_et'), 'L2'));
  await ok(remove(ref(t, 'b3Quiz/settings/studentActiveLaunch/kid_et')));
  await ok(set(ref(t, 'b3Quiz/quizzes/Q2'), { title: 'Another' }));
  await ok(push(ref(t, 'b3Quiz/audit/L2/kid_et'), { note: 'x' }));
  await ok(remove(ref(t, 'b3Quiz/responses/L1/kid_et')));
  await ok(remove(ref(t, 'b3Quiz/launches/L2')));
});

testEmulator('a teacher cannot create or change launches for a class they do not teach', async () => {
  const t = who.tEt();
  await no(set(ref(t, 'b3Quiz/launches/L3'), { classId: 'wt' }));
  await no(set(ref(t, 'b3Quiz/settings/activeLaunchByClass/wt'), 'L1'));
  // alpha teacher has no access to the original ET/WT data
  const a = who.tAlpha();
  await no(get(ref(a, 'b3Quiz/launches')));
  await no(get(ref(a, 'b3Quiz/launches/L1')));
  await no(get(ref(a, 'b3Quiz/responses/L1/kid_et')));
  await no(set(ref(a, 'b3Quiz/launches/L4'), { classId: 'et' }));
  await no(set(ref(a, 'b3Quiz/quizzes/Q9'), { title: 'x' }));
});

testEmulator('inactive teachers and unverified owner-lookalikes get nothing', async () => {
  await no(get(ref(who.tOff(), 'b3Quiz/launches/L1')));
  await no(set(ref(who.tOff(), 'b3Quiz/launches/L5'), { classId: 'et' }));
  await no(get(ref(who.fakeOwner(), 'b3Quiz/launches')));
  await no(set(ref(who.fakeOwner(), 'b3Quiz/launches/L6'), { classId: 'et' }));
});

testEmulator('per-class teachers manage only their own class quiz space', async () => {
  const a = who.tAlpha();
  await ok(get(ref(a, 'b3Quiz/classes/alpha/launches')));
  await ok(get(ref(a, 'b3Quiz/classes/alpha/responses/A1')));
  await ok(set(ref(a, 'b3Quiz/classes/alpha/launches/A2'), { classId: 'alpha' }));
  await ok(set(ref(a, 'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha'), 'A2'));
  await ok(set(ref(a, 'b3Quiz/classes/alpha/settings/studentActiveLaunch/kid_alpha'), 'A2'));
  await ok(remove(ref(a, 'b3Quiz/classes/alpha/responses/A1')));
  const b = who.tBeta();
  await no(get(ref(b, 'b3Quiz/classes/alpha/launches')));
  await no(get(ref(b, 'b3Quiz/classes/alpha/responses/A1')));
  await no(set(ref(b, 'b3Quiz/classes/alpha/launches/A3'), { classId: 'alpha' }));
  await no(set(ref(b, 'b3Quiz/classes/alpha/settings/activeLaunchByClass/alpha'), 'A3'));
});

testEmulator('owner and admins can read every quiz collection (School Marks, reports)', async () => {
  for (const who_ of [who.owner(), who.admin()]) {
    await ok(get(ref(who_, 'b3Quiz/launches')));
    await ok(get(ref(who_, 'b3Quiz/responses')));
    await ok(get(ref(who_, 'b3Quiz/completions')));
    await ok(get(ref(who_, 'b3Quiz/classes/alpha/launches')));
    await ok(get(ref(who_, 'b3Quiz/sessions')));
  }
  await ok(set(ref(who.owner(), 'b3Quiz/launches/L7'), { classId: 'wt' }));
});

testEmulator('students in the original space cannot read a teacher-only class quiz area', async () => {
  await no(get(ref(who.kidEt(), 'b3Quiz/classes/alpha/launches/A1')));
  await no(get(ref(who.kidAlpha(), 'b3Quiz/classes/alpha/launches/A1')));
  await no(get(ref(who.kidAlpha(), 'b3Quiz/classes/alpha/responses/A1/kid_alpha')));
});
