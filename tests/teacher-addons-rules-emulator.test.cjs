'use strict';
// Teacher Add-ons, step 1: the database rules for the records, run against the real Realtime Database emulator.
// Runs in CI with B3_RUN_RTDB_EMULATOR_TESTS=1 (see .github/workflows/migration-checks.yml); skipped otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { get, ref, set, update } = require('firebase/database');

const projectId = 'demo-b3-addons';
const rulesFile = process.env.B3_ADDONS_RULES_FILE || 'firebase-rules.hardened.json';
const rules = fs.readFileSync(rulesFile, 'utf8');
const emulatorEnabled = process.env.B3_RUN_RTDB_EMULATOR_TESTS === '1';
const emulatorPort = Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 19100);
const testEmulator = emulatorEnabled ? test : test.skip;
let env;

test.before(async () => {
  if (!emulatorEnabled) return;
  env = await initializeTestEnvironment({ projectId, database: { host: '127.0.0.1', port: emulatorPort, rules } });
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    const rows = {
      'b3Games/workspaces/b3-2026/teachers/teacher_a': { active: true, classIds: { alpha: true } },
      'b3Games/workspaces/b3-2026/teachers/teacher_b': { active: true, classIds: { beta: true } },
      'b3Games/workspaces/b3-2026/teachers/teacher_off': { active: false, classIds: { alpha: true } },
      'b3Games/admins/admin_one': { active: true },
      'b3Games/workspaces/b3-2026/classes/alpha': { active: true, members: { student_a: { active: true } } },
    };
    for (const [path, value] of Object.entries(rows)) await set(ref(db, path), value);
  });
});
test.after(async () => { if (env) await env.cleanup(); });
// Each test starts with no add-ons (the teachers and admin above stay).
test.beforeEach(async () => {
  if (!env) return;
  await env.withSecurityRulesDisabled(async context => { await set(ref(context.database(), 'teacherAddons'), null); });
});

const ID = 'ad_abcdefgh1234';
const profile = { name: 'Times Tables', icon: '🧮', classIds: { alpha: true }, version: 1, createdAt: 1, updatedAt: 1 };
const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).database();

testEmulator('a teacher claims a free add-on id, then writes the record for their own classes', async () => {
  const a = as('teacher_a');
  await assertSucceeds(set(ref(a, 'teacherAddons/owners/' + ID), 'teacher_a'));
  await assertSucceeds(set(ref(a, 'teacherAddons/profile/' + ID), profile));
  assert.equal((await get(ref(a, 'teacherAddons/profile/' + ID + '/name'))).val(), 'Times Tables');
});

testEmulator('a teacher cannot claim for someone else, take an id that is taken, or use a badly formed id', async () => {
  const a = as('teacher_a'), b = as('teacher_b');
  await assertSucceeds(set(ref(a, 'teacherAddons/owners/' + ID), 'teacher_a'));
  await assertFails(set(ref(b, 'teacherAddons/owners/' + ID), 'teacher_b'));                         // taken
  await assertFails(set(ref(b, 'teacherAddons/owners/ad_zzzzzzzz9999'), 'teacher_a'));               // for someone else
  await assertFails(set(ref(b, 'teacherAddons/owners/bad id!'), 'teacher_b'));                       // bad id
  await assertFails(set(ref(b, 'teacherAddons/owners/short'), 'teacher_b'));
});

testEmulator('only the owning teacher (or owner/admin) can read or change the record; other teachers, students and visitors cannot', async () => {
  const a = as('teacher_a'), b = as('teacher_b'), off = as('teacher_off');
  const student = as('s1', { b3StudentId: 'student_a', b3ClassId: 'alpha' }), anon = env.unauthenticatedContext().database(), admin = as('admin_one');
  await assertSucceeds(set(ref(a, 'teacherAddons/owners/' + ID), 'teacher_a'));
  await assertSucceeds(set(ref(a, 'teacherAddons/profile/' + ID), profile));
  for (const other of [b, off, student, anon]) {
    await assertFails(get(ref(other, 'teacherAddons/profile/' + ID)));
    await assertFails(set(ref(other, 'teacherAddons/profile/' + ID + '/name'), 'Hijacked'));
    await assertFails(get(ref(other, 'teacherAddons/admin/' + ID)));
    await assertFails(get(ref(other, 'teacherAddons')));
  }
  await assertSucceeds(get(ref(admin, 'teacherAddons/profile/' + ID)));
  await assertSucceeds(set(ref(admin, 'teacherAddons/profile/' + ID + '/name'), 'Renamed by admin'));
});

testEmulator('a teacher can only pick classes they teach, and the record is size- and type-checked', async () => {
  const a = as('teacher_a');
  await assertSucceeds(set(ref(a, 'teacherAddons/owners/' + ID), 'teacher_a'));
  await assertFails(set(ref(a, 'teacherAddons/profile/' + ID), { ...profile, classIds: { beta: true } }));   // not their class
  await assertFails(set(ref(a, 'teacherAddons/profile/' + ID), { ...profile, name: '' }));
  await assertFails(set(ref(a, 'teacherAddons/profile/' + ID), { ...profile, name: 'x'.repeat(61) }));
  await assertFails(set(ref(a, 'teacherAddons/profile/' + ID), { ...profile, icon: 'x'.repeat(17) }));
  await assertFails(set(ref(a, 'teacherAddons/profile/' + ID), { ...profile, description: 'x'.repeat(301) }));
  await assertFails(set(ref(a, 'teacherAddons/profile/' + ID), { ...profile, version: -1 }));
  await assertFails(set(ref(a, 'teacherAddons/profile/' + ID), { ...profile, secretField: 'x' }));            // no unknown fields
  await assertSucceeds(set(ref(a, 'teacherAddons/profile/' + ID), profile));
});

testEmulator('the off switch belongs to the owner/admin: a teacher can see it but never set or clear it', async () => {
  const a = as('teacher_a'), admin = as('admin_one');
  await assertSucceeds(set(ref(a, 'teacherAddons/owners/' + ID), 'teacher_a'));
  await assertSucceeds(set(ref(a, 'teacherAddons/profile/' + ID), profile));
  await assertFails(set(ref(a, 'teacherAddons/admin/' + ID + '/disabled'), false));
  await assertSucceeds(set(ref(admin, 'teacherAddons/admin/' + ID), { disabled: true, disabledBy: 'admin_one', disabledAt: 5, reason: 'test' }));
  assert.equal((await get(ref(a, 'teacherAddons/admin/' + ID + '/disabled'))).val(), true);
  await assertFails(set(ref(a, 'teacherAddons/admin/' + ID + '/disabled'), false));                           // cannot switch it back on
  await assertFails(set(ref(admin, 'teacherAddons/admin/' + ID), { disabled: 'yes' }));
});

testEmulator('removing an add-on removes the owner link and the record together; nobody else can', async () => {
  const a = as('teacher_a'), b = as('teacher_b');
  await assertSucceeds(set(ref(a, 'teacherAddons/owners/' + ID), 'teacher_a'));
  await assertSucceeds(set(ref(a, 'teacherAddons/profile/' + ID), profile));
  await assertFails(update(ref(b), { ['teacherAddons/owners/' + ID]: null, ['teacherAddons/profile/' + ID]: null }));
  await assertSucceeds(update(ref(a), { ['teacherAddons/owners/' + ID]: null, ['teacherAddons/profile/' + ID]: null }));
  assert.equal((await get(ref(env.authenticatedContext('admin_one').database(), 'teacherAddons/profile/' + ID))).exists(), false);
});

testEmulator('students and visitors can read and write nothing under teacherAddons in step 1', async () => {
  const student = as('s1', { b3StudentId: 'student_a', b3ClassId: 'alpha' }), anon = env.unauthenticatedContext().database();
  for (const db of [student, anon]) {
    await assertFails(get(ref(db, 'teacherAddons/profile')));
    await assertFails(set(ref(db, 'teacherAddons/owners/' + ID), 'x'));
    await assertFails(set(ref(db, 'teacherAddons/admin/' + ID), { disabled: false }));
  }
});
