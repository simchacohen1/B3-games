'use strict';
// Issue #627: Shorashim data and pictures belong to each class's own teachers.
// - posukPractice/shorashimLearning is no longer public.
// - Only a class's active teachers write that class; only that class's students read it.
// - A teacher's added pictures are readable only by that teacher (plus owner/admins);
//   students read only the copies of ticked pictures kept in their class.
// Runs against BOTH firebase-rules.json and firebase-rules.hardened.json.
// Run with B3_RUN_RTDB_EMULATOR_TESTS=1 set:
//   firebase emulators:exec --only database --project demo-ftt-security
//     --config firebase.security-test.json
//     "node --test tests/shorashim-rules-emulator.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { get, ref, set, update, remove } = require('firebase/database');

const emulatorEnabled = process.env.B3_RUN_RTDB_EMULATOR_TESTS === '1';
const emulatorPort = Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 19100);
const OWNER = 'simcha5770@gmail.com';
const SL = 'posukPractice/shorashimLearning';
const ALPHA = SL + '/classes/alpha';
const BETA = SL + '/classes/beta';
const PIC = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4';
const picture = () => ({ data: PIC, createdAt: 1 });

const ok = p => assert.doesNotReject(p);
const no = p => assert.rejects(p);

for (const rulesFile of ['firebase-rules.json', 'firebase-rules.hardened.json']) {
  const projectId = 'demo-shorashim-' + rulesFile.replace(/[^a-z]/g, '').slice(0, 20);
  const suite = emulatorEnabled ? test : test.skip;
  let env;
  const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).database();
  const anon = () => env.unauthenticatedContext().database();
  const teacher = uid => as(uid, { email: uid + '@example.test', email_verified: true });
  const student = (id, classId) => as('student_' + id, { b3StudentId: id, b3ClassId: classId, b3StudentRole: 'student' });

  suite(rulesFile + ': Shorashim rules', async t => {
    env = await initializeTestEnvironment({
      projectId,
      database: { host: '127.0.0.1', port: emulatorPort, rules: fs.readFileSync(rulesFile, 'utf8') }
    });
    t.after(() => env.cleanup());
    t.beforeEach(async () => {
      await env.clearDatabase();
      await env.withSecurityRulesDisabled(async ctx => {
        const db = ctx.database();
        const fixtures = {
          'b3Games/workspaces/b3-2026/teachers/teacher_alpha': { active: true, classIds: { alpha: true } },
          'b3Games/workspaces/b3-2026/teachers/teacher_beta': { active: true, classIds: { beta: true } },
          'b3Games/workspaces/b3-2026/teachers/teacher_et': { active: true, classIds: { et: true } },
          'b3Games/workspaces/b3-2026/teachers/teacher_inactive': { active: false, classIds: { alpha: true, et: true } },
          'b3Games/admins/admin_active': { active: true },
          'b3Games/admins/admin_inactive': { active: false },
          'b3Games/students/s_et/profile': { classId: 'et' },
          'b3Games/students/s_beta/profile': { classId: 'beta' },
          [ALPHA + '/catalog/shorashim/0']: { id: 'w1', front: 'ראה', art: ['teacher-picture:teacher_alpha/pic-000001'] },
          [ALPHA + '/settings']: { studentSiteOpen: true },
          [ALPHA + '/pictures/teacher_alpha/pic-000001']: picture(),
          [ALPHA + '/students/s_alpha']: { name: 'Synthetic Alpha' },
          [ALPHA + '/students/s_alpha2']: { name: 'Synthetic Alpha Two' },
          [ALPHA + '/recordingEvents/s_alpha/e1']: { mode: 'x' },
          [ALPHA + '/leaderboards/match/8/s_alpha2']: { best: 10 },
          [BETA + '/catalog/shorashim/0']: { id: 'b1', front: 'שמע' },
          [SL + '/catalog/shorashim/0']: { id: 'base1', front: 'ישב' },
          [SL + '/settings']: { studentSiteOpen: true },
          [SL + '/pictures/teacher_et/pic-000002']: picture(),
          [SL + '/students/s_et']: { name: 'Synthetic ET' },
          [SL + '/students/s_beta']: { name: 'Synthetic old record' },
          [SL + '/recordingEvents/s_et/e1']: { mode: 'x' },
          [SL + '/leaderboards/match/8/s_et']: { best: 9 },
          'shorashimTeacherPictures/teacher_alpha/pic-000001': picture(),
          'shorashimTeacherPictures/teacher_alpha/pic-000003': picture()
        };
        for (const [p, v] of Object.entries(fixtures)) await set(ref(db, p), v);
      });
    });

    await t.test('strangers and plain Google accounts read and write nothing', async () => {
      for (const db of [anon(), teacher('random_google')]) {
        for (const p of [SL, SL + '/catalog', SL + '/settings', SL + '/pictures', ALPHA + '/catalog', ALPHA + '/pictures',
          ALPHA + '/students/s_alpha', SL + '/students/s_et', 'shorashimTeacherPictures/teacher_alpha/pic-000001']) {
          await no(get(ref(db, p)));
        }
        await no(set(ref(db, SL + '/catalog/shorashim/0/art'), ['🙂']));
        await no(set(ref(db, ALPHA + '/catalog/shorashim/0/art'), ['🙂']));
        await no(set(ref(db, ALPHA + '/pictures/x/pic-000009'), picture()));
      }
    });

    await t.test('a class teacher owns their class and nothing else', async () => {
      const a = teacher('teacher_alpha');
      for (const p of [ALPHA, ALPHA + '/catalog', ALPHA + '/students', ALPHA + '/leaderboards', ALPHA + '/recordingEvents', ALPHA + '/pictures'])
        await ok(get(ref(a, p)));
      await ok(set(ref(a, ALPHA + '/catalog/shorashim/0/art'), []));
      await ok(set(ref(a, ALPHA + '/settings/studentSiteOpen'), false));
      await ok(set(ref(a, ALPHA + '/pictures/teacher_alpha/pic-000003'), picture()));
      await ok(remove(ref(a, ALPHA + '/pictures/teacher_alpha/pic-000003')));
      // Another class, the base (et/wt) lists, and the whole tree are off limits.
      await no(get(ref(a, BETA + '/catalog')));
      await no(set(ref(a, BETA + '/catalog/shorashim/0/art'), ['🙂']));
      await no(set(ref(a, BETA + '/pictures/teacher_alpha/pic-000001'), picture()));
      await no(get(ref(a, SL + '/catalog')));
      await no(set(ref(a, SL + '/catalog/shorashim/0/art'), ['🙂']));
      await no(get(ref(a, SL)));
      // A teacher of another class cannot touch alpha.
      const b = teacher('teacher_beta');
      await no(get(ref(b, ALPHA + '/catalog')));
      await no(set(ref(b, ALPHA + '/catalog/shorashim/0/art'), ['🙂']));
      await no(remove(ref(b, ALPHA + '/pictures/teacher_alpha/pic-000001')));
      // Inactive teachers lose access.
      const off = teacher('teacher_inactive');
      await no(get(ref(off, ALPHA + '/catalog')));
      await no(set(ref(off, ALPHA + '/catalog/shorashim/0/art'), []));
      await no(set(ref(off, SL + '/catalog/shorashim/0/art'), []));
    });

    await t.test('class picture copies must be small image data', async () => {
      const a = teacher('teacher_alpha');
      await no(set(ref(a, ALPHA + '/pictures/teacher_alpha/pic-000004'), { data: 'https://evil.example/x.png', createdAt: 1 }));
      await no(set(ref(a, ALPHA + '/pictures/teacher_alpha/pic-000004'), { data: PIC, createdAt: 1, extra: 1 }));
      await no(set(ref(a, ALPHA + '/pictures/teacher_alpha/pic-000004'), { data: 'data:image/webp;base64,' + 'A'.repeat(200001), createdAt: 1 }));
    });

    await t.test('a student reads only their own class, and writes only their own records', async () => {
      const s = student('s_alpha', 'alpha');
      for (const p of [ALPHA + '/catalog', ALPHA + '/settings', ALPHA + '/settings/studentSiteOpen', ALPHA + '/pictures',
        ALPHA + '/pictures/teacher_alpha/pic-000001/data', ALPHA + '/leaderboards/match/8', ALPHA + '/students/s_alpha',
        ALPHA + '/recordingEvents/s_alpha'])
        await ok(get(ref(s, p)));
      await ok(set(ref(s, ALPHA + '/students/s_alpha/lastActive'), 5));
      await ok(set(ref(s, ALPHA + '/recordingEvents/s_alpha/e2'), { mode: 'y' }));
      await ok(set(ref(s, ALPHA + '/recordings/s_alpha/2026-11-09'), { points: 1 }));
      await ok(set(ref(s, ALPHA + '/leaderboards/match/8/s_alpha'), { best: 3 }));
      // Not other students, not the word list, not pictures, not other classes or the base lists.
      await no(get(ref(s, ALPHA + '/students/s_alpha2')));
      await no(get(ref(s, ALPHA + '/students')));
      await no(set(ref(s, ALPHA + '/students/s_alpha2/name'), 'x'));
      await no(set(ref(s, ALPHA + '/leaderboards/match/8/s_alpha2'), { best: 99 }));
      await no(set(ref(s, ALPHA + '/catalog/shorashim/0/art'), ['🙂']));
      await no(set(ref(s, ALPHA + '/catalog'), { shorashim: [] }));
      await no(set(ref(s, ALPHA + '/settings/studentSiteOpen'), true));
      await no(set(ref(s, ALPHA + '/pictures/teacher_alpha/pic-000005'), picture()));
      await no(get(ref(s, BETA + '/catalog')));
      await no(get(ref(s, SL + '/catalog')));
      await no(get(ref(s, SL + '/pictures')));
      // A teacher's own pictures are never readable by students, ticked or not.
      await no(get(ref(s, 'shorashimTeacherPictures/teacher_alpha/pic-000001')));
      await no(get(ref(s, 'shorashimTeacherPictures/teacher_alpha/pic-000003/data')));
      // A student token for another class cannot use alpha's student paths.
      const other = student('s_alpha', 'beta');
      await no(get(ref(other, ALPHA + '/catalog')));
      await no(set(ref(other, ALPHA + '/students/s_alpha/lastActive'), 6));
    });

    await t.test('B3 et/wt base lists: only et/wt students read, only et/wt teachers write', async () => {
      const s = student('s_et', 'et');
      for (const p of [SL + '/catalog', SL + '/settings', SL + '/pictures/teacher_et/pic-000002', SL + '/leaderboards/match/8', SL + '/students/s_et'])
        await ok(get(ref(s, p)));
      await ok(set(ref(s, SL + '/students/s_et/lastActive'), 5));
      await ok(set(ref(s, SL + '/recordingEvents/s_et/e2'), { mode: 'y' }));
      await ok(set(ref(s, SL + '/leaderboards/match/8/s_et'), { best: 4 }));
      await no(set(ref(s, SL + '/catalog/shorashim/0/art'), ['🙂']));
      await no(set(ref(s, SL + '/settings/studentSiteOpen'), true));
      await no(set(ref(s, SL + '/pictures/teacher_et/pic-000006'), picture()));
      await no(get(ref(s, SL + '/students/s_beta')));
      await no(get(ref(s, SL + '/students')));
      // Students of other classes cannot read the base lists.
      await no(get(ref(student('s_beta', 'beta'), SL + '/catalog')));

      const e = teacher('teacher_et');
      await ok(get(ref(e, SL + '/catalog')));
      await ok(set(ref(e, SL + '/catalog/shorashim/0/art'), []));
      await ok(set(ref(e, SL + '/pictures/teacher_et/pic-000007'), picture()));
      await ok(get(ref(e, SL + '/students/s_et')));
      await ok(get(ref(e, SL + '/recordingEvents/s_et')));
      await ok(get(ref(e, SL + '/leaderboards/match/8/s_et')));
      await ok(get(ref(e, SL + '/classes/et/settings')));
      // Only students whose profile class is theirs, one at a time.
      await no(get(ref(e, SL + '/students/s_beta')));
      await no(get(ref(e, SL + '/students')));
      await no(get(ref(e, ALPHA + '/catalog')));
    });

    await t.test("a teacher's added pictures are private to that teacher", async () => {
      const a = teacher('teacher_alpha');
      await ok(get(ref(a, 'shorashimTeacherPictures/teacher_alpha/pic-000001')));
      await ok(get(ref(a, 'shorashimTeacherPictures/teacher_alpha')));
      await ok(set(ref(a, 'shorashimTeacherPictures/teacher_alpha/pic-000008'), picture()));
      await no(set(ref(a, 'shorashimTeacherPictures/teacher_alpha/pic-000008'), { data: PIC, createdAt: 2 }));
      await ok(remove(ref(a, 'shorashimTeacherPictures/teacher_alpha/pic-000008')));
      await no(set(ref(a, 'shorashimTeacherPictures/teacher_beta/pic-000009'), picture()));
      await no(set(ref(a, 'shorashimTeacherPictures/teacher_alpha/pic-000010'), { data: 'javascript:alert(1)', createdAt: 1 }));
      for (const other of [teacher('teacher_beta'), teacher('teacher_et'), teacher('teacher_inactive'), student('s_alpha', 'alpha'),
        as('admin_inactive', {}), anon()]) {
        await no(get(ref(other, 'shorashimTeacherPictures/teacher_alpha/pic-000001')));
        await no(get(ref(other, 'shorashimTeacherPictures/teacher_alpha')));
      }
      // The inactive teacher cannot add pictures even under their own uid.
      await no(set(ref(teacher('teacher_inactive'), 'shorashimTeacherPictures/teacher_inactive/pic-000011'), picture()));
    });

    await t.test('owner and active admins read and write everything', async () => {
      for (const db of [as('owner_uid', { email: OWNER, email_verified: true }), as('admin_active', {})]) {
        await ok(get(ref(db, SL)));
        await ok(get(ref(db, SL + '/recordingEvents')));
        await ok(get(ref(db, 'shorashimTeacherPictures/teacher_alpha/pic-000001')));
        await ok(update(ref(db, ALPHA + '/settings'), { studentSiteOpen: true }));
        await ok(set(ref(db, SL + '/catalog/shorashim/0/art'), []));
      }
      // An unverified email using the owner's address gets nothing.
      await no(get(ref(as('fake_owner', { email: OWNER, email_verified: false }), SL)));
    });
  });
}
