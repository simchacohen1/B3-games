'use strict';

/*
 * Weekly Shorashim (staging) — HIGH RISK: student data + database rules.
 *
 * Proves against the real staging rules file, in the Firebase emulator, that
 *  - a student can read and write only his own progress,
 *  - a student cannot read or write another student's progress (same class or not),
 *  - a teacher can read his own class and cannot read another class,
 *  - only the class teacher and the owner can change the grade and week.
 *
 * Run:
 *   $env:B3_RUN_RTDB_EMULATOR_TESTS='1'
 *   npx firebase emulators:exec --project demo-weekly-shorashim --config firebase.security-test.json --only database "node --test tests/weekly-shorashim-rules-emulator.test.cjs"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const enabled = process.env.B3_RUN_RTDB_EMULATOR_TESTS === '1';
const testEmulator = enabled ? test : test.skip;
let env, assertSucceeds, assertFails, get, ref, set, update, remove;

const WS = 'b3Games/workspaces/b3-2026';
const ALEF = WS + '/classes/TEST-ALEF';
const BEIS = WS + '/classes/TEST-BEIS';
const progress = (cls, student, week, game) =>
  cls + '/weeklyShorashim/progress/' + student + (week ? '/' + week : '') + (game ? '/' + game : '');
const record = (extra = {}) => ({ bestScore: 40, timesPlayed: 1, lastPlayed: Date.now(), wordsCorrect: { w1_1: 2 }, wordsMissed: { w1_5: 1 }, ...extra });

const studentA1 = () => env.authenticatedContext('session-a1', { b3StudentId: 'student_a1', b3ClassId: 'TEST-ALEF', b3StudentRole: 'student' }).database();
const studentA2 = () => env.authenticatedContext('session-a2', { b3StudentId: 'student_a2', b3ClassId: 'TEST-ALEF', b3StudentRole: 'student' }).database();
const studentB1 = () => env.authenticatedContext('session-b1', { b3StudentId: 'student_b1', b3ClassId: 'TEST-BEIS', b3StudentRole: 'student' }).database();
const removedStudent = () => env.authenticatedContext('session-gone', { b3StudentId: 'student_gone', b3ClassId: 'TEST-ALEF', b3StudentRole: 'student' }).database();
const teacherAlef = () => env.authenticatedContext('teacher_alef', { email: 'teacher.alef@example.test', email_verified: true }).database();
const teacherBeis = () => env.authenticatedContext('teacher_beis', { email: 'teacher.beis@example.test', email_verified: true }).database();
const inactiveTeacher = () => env.authenticatedContext('teacher_off', { email: 'teacher.off@example.test', email_verified: true }).database();
const owner = () => env.authenticatedContext('owner_uid', { email: 'owner@funtorahtools-staging.test', email_verified: true }).database();
const stranger = () => env.authenticatedContext('random_uid', { email: 'someone@example.test', email_verified: true }).database();
const signedOut = () => env.unauthenticatedContext().database();

async function seed() {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    const rows = {
      [WS + '/teachers/teacher_alef']: { active: true, role: 'teacher', classIds: { 'TEST-ALEF': true } },
      [WS + '/teachers/teacher_beis']: { active: true, role: 'teacher', classIds: { 'TEST-BEIS': true } },
      [WS + '/teachers/teacher_off']: { active: false, role: 'teacher', classIds: { 'TEST-ALEF': true } },
      [ALEF + '/name']: 'Test Class Alef',
      [ALEF + '/active']: true,
      [ALEF + '/members']: { student_a1: { active: true, name: 'A One' }, student_a2: { active: true, name: 'A Two' }, student_gone: { active: false, name: 'Gone' } },
      [BEIS + '/name']: 'Test Class Beis',
      [BEIS + '/active']: true,
      [BEIS + '/members']: { student_b1: { active: true, name: 'B One' } },
      [ALEF + '/weeklyShorashimGrade']: 'B4',
      [ALEF + '/weeklyShorashim/currentWeek']: { week: 3, setAt: Date.now() - 1000, held: false },
      [progress(ALEF, 'student_a2', 3, 'quiz')]: record({ bestScore: 80 }),
      [progress(BEIS, 'student_b1', 1, 'racer')]: record({ bestScore: 120 }),
      [BEIS + '/weeklyShorashimGrade']: 'B2'
    };
    for (const [path, value] of Object.entries(rows)) await set(ref(db, path), value);
  });
}

test.before(async () => {
  if (!enabled) return;
  const rut = require('@firebase/rules-unit-testing');
  ({ assertSucceeds, assertFails } = rut);
  ({ get, ref, set, update, remove } = require('firebase/database'));
  env = await rut.initializeTestEnvironment({
    projectId: 'demo-weekly-shorashim',
    database: {
      host: '127.0.0.1',
      port: Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 19100),
      rules: fs.readFileSync('staging/database.rules.json', 'utf8')
    }
  });
});
test.beforeEach(async () => { if (enabled) await seed(); });
test.after(async () => { if (env) await env.cleanup(); });

testEmulator('a student can save and read his own progress', async () => {
  const db = studentA1();
  await assertSucceeds(set(ref(db, progress(ALEF, 'student_a1', 3, 'racer')), record()));
  await assertSucceeds(set(ref(db, progress(ALEF, 'student_a1', 3, 'multiple-choice')), record({ bestScore: 900 })));
  const mine = await assertSucceeds(get(ref(db, progress(ALEF, 'student_a1'))));
  assert.equal(mine.val()['3'].racer.bestScore, 40);
  // A later game may raise the score and the play count.
  await assertSucceeds(set(ref(db, progress(ALEF, 'student_a1', 3, 'racer')), record({ bestScore: 70, timesPlayed: 2 })));
});

testEmulator('a student CANNOT read another student\'s progress — same class or another class', async () => {
  await assertFails(get(ref(studentA1(), progress(ALEF, 'student_a2'))));
  await assertFails(get(ref(studentA1(), progress(ALEF, 'student_a2', 3, 'quiz'))));
  await assertFails(get(ref(studentA1(), progress(BEIS, 'student_b1'))));
  await assertFails(get(ref(studentB1(), progress(ALEF, 'student_a2', 3, 'quiz'))));
  // Nor the whole class's progress, nor the whole Weekly Shorashim node, nor the class record.
  await assertFails(get(ref(studentA1(), ALEF + '/weeklyShorashim/progress')));
  await assertFails(get(ref(studentA1(), ALEF + '/weeklyShorashim')));
  await assertFails(get(ref(studentA1(), ALEF)));
});

testEmulator('a student CANNOT write another student\'s progress — same class or another class', async () => {
  await assertFails(set(ref(studentA1(), progress(ALEF, 'student_a2', 3, 'quiz')), record({ bestScore: 1 })));
  await assertFails(set(ref(studentA1(), progress(ALEF, 'student_a2', 4, 'racer')), record()));
  await assertFails(remove(ref(studentA1(), progress(ALEF, 'student_a2', 3, 'quiz'))));
  await assertFails(set(ref(studentA1(), progress(BEIS, 'student_b1', 1, 'racer')), record()));
  // His own id under a class he is not signed in to is refused too.
  await assertFails(set(ref(studentA1(), progress(BEIS, 'student_a1', 1, 'racer')), record()));
  await assertFails(set(ref(studentB1(), progress(ALEF, 'student_b1', 1, 'racer')), record()));
  // A multi-path write cannot smuggle in someone else's record.
  await assertFails(update(ref(studentA1(), ALEF + '/weeklyShorashim/progress'), {
    'student_a1/3/racer': record(), 'student_a2/3/quiz': record({ bestScore: 0 })
  }));
  let untouched;
  await env.withSecurityRulesDisabled(async c => { untouched = (await get(ref(c.database(), progress(ALEF, 'student_a2', 3, 'quiz')))).val(); });
  assert.equal(untouched.bestScore, 80);
});

testEmulator('a student removed from the class, a signed-out visitor and an unrelated account get nothing', async () => {
  await assertFails(set(ref(removedStudent(), progress(ALEF, 'student_gone', 1, 'racer')), record()));
  await assertFails(get(ref(removedStudent(), progress(ALEF, 'student_gone'))));
  await assertFails(get(ref(removedStudent(), ALEF + '/weeklyShorashimGrade')));
  for (const db of [signedOut(), stranger()]) {
    await assertFails(get(ref(db, progress(ALEF, 'student_a2'))));
    await assertFails(set(ref(db, progress(ALEF, 'student_a2', 3, 'quiz')), record()));
    await assertFails(get(ref(db, ALEF + '/weeklyShorashimGrade')));
    await assertFails(get(ref(db, ALEF + '/weeklyShorashim/currentWeek')));
    await assertFails(set(ref(db, ALEF + '/weeklyShorashimGrade'), 'B6'));
  }
});

testEmulator('a student cannot delete, lower or malform his own record', async () => {
  const db = studentA1();
  const path = progress(ALEF, 'student_a1', 3, 'racer');
  await assertSucceeds(set(ref(db, path), record({ bestScore: 70, timesPlayed: 2 })));
  await assertFails(remove(ref(db, path)));
  await assertFails(remove(ref(db, progress(ALEF, 'student_a1'))));
  await assertFails(set(ref(db, path), record({ bestScore: 10, timesPlayed: 2 })));
  await assertFails(set(ref(db, path), record({ bestScore: 70, timesPlayed: 1 })));
  await assertFails(set(ref(db, path), record({ bestScore: 'lots', timesPlayed: 3 })));
  await assertFails(set(ref(db, path), record({ bestScore: 71, timesPlayed: 3, note: 'extra field' })));
  await assertFails(set(ref(db, path), record({ bestScore: 71, timesPlayed: 3, wordsMissed: { 'not-a-word': 1 } })));
  await assertFails(set(ref(db, path), record({ bestScore: 71, timesPlayed: 3, lastPlayed: Date.now() + 86400000 })));
  await assertFails(set(ref(db, path), { bestScore: 71 }));
  await assertFails(set(ref(db, progress(ALEF, 'student_a1', 31, 'racer')), record()));
  await assertFails(set(ref(db, progress(ALEF, 'student_a1', 3, 'hebrew-hop')), record()));
});

testEmulator('a class teacher can read his own class\'s progress; a teacher CANNOT read another class', async () => {
  const alef = await assertSucceeds(get(ref(teacherAlef(), ALEF + '/weeklyShorashim/progress')));
  assert.equal(alef.val().student_a2['3'].quiz.bestScore, 80);
  await assertSucceeds(get(ref(teacherAlef(), ALEF + '/members')));
  await assertSucceeds(get(ref(teacherAlef(), ALEF + '/weeklyShorashimGrade')));
  await assertSucceeds(get(ref(teacherAlef(), ALEF + '/weeklyShorashim/currentWeek')));

  await assertFails(get(ref(teacherAlef(), BEIS + '/weeklyShorashim/progress')));
  await assertFails(get(ref(teacherAlef(), progress(BEIS, 'student_b1'))));
  await assertFails(get(ref(teacherAlef(), progress(BEIS, 'student_b1', 1, 'racer'))));
  await assertFails(get(ref(teacherAlef(), BEIS + '/weeklyShorashimGrade')));
  await assertFails(get(ref(teacherAlef(), BEIS + '/weeklyShorashim/currentWeek')));
  await assertFails(get(ref(teacherAlef(), BEIS)));
  await assertFails(get(ref(teacherBeis(), ALEF + '/weeklyShorashim/progress')));
  await assertFails(get(ref(teacherBeis(), progress(ALEF, 'student_a2', 3, 'quiz'))));
  // A teacher account that was switched off loses the class.
  await assertFails(get(ref(inactiveTeacher(), ALEF + '/weeklyShorashim/progress')));
});

testEmulator('a teacher cannot write student progress, in his class or another', async () => {
  await assertFails(set(ref(teacherAlef(), progress(ALEF, 'student_a2', 3, 'quiz')), record({ bestScore: 100 })));
  await assertFails(remove(ref(teacherAlef(), progress(ALEF, 'student_a2'))));
  await assertFails(set(ref(teacherAlef(), progress(BEIS, 'student_b1', 1, 'racer')), record()));
});

testEmulator('the owner can read every class\'s progress', async () => {
  const alef = await assertSucceeds(get(ref(owner(), ALEF + '/weeklyShorashim/progress')));
  assert.equal(alef.val().student_a2['3'].quiz.bestScore, 80);
  const beis = await assertSucceeds(get(ref(owner(), BEIS + '/weeklyShorashim/progress')));
  assert.equal(beis.val().student_b1['1'].racer.bestScore, 120);
});

testEmulator('grade: students of the class can read it; only the class teacher and the owner can set it, to B2-B6 only', async () => {
  assert.equal((await assertSucceeds(get(ref(studentA1(), ALEF + '/weeklyShorashimGrade')))).val(), 'B4');
  await assertFails(get(ref(studentA1(), BEIS + '/weeklyShorashimGrade')));
  await assertFails(set(ref(studentA1(), ALEF + '/weeklyShorashimGrade'), 'B6'));
  await assertSucceeds(set(ref(teacherAlef(), ALEF + '/weeklyShorashimGrade'), 'B5'));
  await assertSucceeds(set(ref(owner(), ALEF + '/weeklyShorashimGrade'), 'B2'));
  await assertFails(set(ref(teacherBeis(), ALEF + '/weeklyShorashimGrade'), 'B6'));
  await assertFails(set(ref(inactiveTeacher(), ALEF + '/weeklyShorashimGrade'), 'B6'));
  for (const bad of ['B7', 'B1', 'b3', '3', 3, { grade: 'B3' }]) {
    await assertFails(set(ref(teacherAlef(), ALEF + '/weeklyShorashimGrade'), bad));
  }
});

testEmulator('current week: students of the class can read it; only the class teacher and the owner can set or hold it', async () => {
  const path = ALEF + '/weeklyShorashim/currentWeek';
  assert.equal((await assertSucceeds(get(ref(studentA1(), path)))).val().week, 3);
  await assertFails(get(ref(studentB1(), path)));
  await assertFails(set(ref(studentA1(), path), { week: 30, setAt: Date.now(), held: true }));
  await assertSucceeds(set(ref(teacherAlef(), path), { week: 7, setAt: Date.now(), held: true }));
  await assertSucceeds(set(ref(owner(), path), { week: 8, setAt: Date.now(), held: false }));
  await assertFails(set(ref(teacherBeis(), path), { week: 9, setAt: Date.now(), held: false }));
  for (const bad of [
    { week: 0, setAt: Date.now(), held: false }, { week: 31, setAt: Date.now(), held: false },
    { week: 2.5, setAt: Date.now(), held: false }, { week: 4, setAt: Date.now(), held: 'yes' },
    { week: 4, setAt: Date.now() + 86400000, held: false }, { week: 4, held: false },
    { week: 4, setAt: Date.now(), held: false, extra: true }
  ]) await assertFails(set(ref(teacherAlef(), path), bad));
  // Nothing else may be stored beside currentWeek and progress.
  await assertFails(set(ref(teacherAlef(), ALEF + '/weeklyShorashim/notes'), 'hello'));
});
