'use strict';
// Staging only. Checks (default) or repairs (--apply) what a fictional account
// needs to open the Kriah Assessment Center. Additive: it never resets a
// password, never deletes anything and never touches non-Kriah records.
//
//   GCLOUD_PROJECT=fun-torah-tools-staging GOOGLE_APPLICATION_CREDENTIALS=<staging key>
//   KRIAH_CREDENTIALS_FILE=<private file outside the repository>   (only with --apply)
//   node scripts/kriah-stage-accounts.cjs [--apply]
//
// What the center requires (see docs/KRIAH-ASSESSMENT-624.md, "Staging accounts"):
//   student sign-in token claims: b3StudentRole='student', b3StudentId, b3ClassId
//   class row:   active, kriahSynthetic, toolGrants['kriah-assessment'], members[studentId].active, id starts kriah-test-
//   student:     profile.active + profile.kriahSynthetic, one active membership for that class in workspace b3-2026
//   teacher:     email/password account on @funtorahtools-staging.test with verified email,
//                teacher row active + kriahSynthetic + classIds[classId] (no custom claims needed)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PROJECT = 'fun-torah-tools-staging', WS = 'b3Games/workspaces/b3-2026/', OWNER = 'issue-624', DOMAIN = '@funtorahtools-staging.test';
const apply = process.argv.includes('--apply');
if (process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('Explicit staging project required (GCLOUD_PROJECT=' + PROJECT + ').');
const admin = require(process.env.KRIAH_FIREBASE_ADMIN || '../backend/kriah-staging/node_modules/firebase-admin');
admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const db = admin.database(), auth = admin.auth();
const file = process.env.KRIAH_CREDENTIALS_FILE ? path.resolve(process.env.KRIAH_CREDENTIALS_FILE) : '';
const repo = path.resolve(__dirname, '..');
if (apply && (!file || file === repo || file.startsWith(repo + path.sep))) throw new Error('KRIAH_CREDENTIALS_FILE must be a private file outside the repository.');
const saved = apply && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { projectId: PROJECT, accounts: [] };
const get = async p => (await db.ref(p).get()).val();
const problems = [], done = [];

// Accounts the owner can sign in with on the Kriah page ("Fictional staging account" form).
const WANTED = [
  { kind: 'teacher', uid: 'kriah-demo-teacher', email: 'teacher.kriah.demo' + DOMAIN, name: 'Fictional Kriah Demo Teacher', classId: 'kriah-test-et' },
  { kind: 'student', uid: 'kriah-demo-student-auth', email: 'student.kriah.demo' + DOMAIN, name: 'Fictional Kriah Demo Student', classId: 'kriah-test-et', studentId: 'kriah_demo_student' }
];
// Only Kriah fixture records (or records that do not exist yet) may be written.
const kriahOwned = v => !v || v.kriahFixtureOwner === OWNER || v.kriahSynthetic === true;
async function ensureUser(w) {
  let user; try { user = await auth.getUser(w.uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  if (user) return user;
  if (!apply) { problems.push(w.email + ': sign-in account does not exist'); return null; }
  const password = crypto.randomBytes(18).toString('base64url');
  user = await auth.createUser({ uid: w.uid, email: w.email, password, emailVerified: true, displayName: w.name });
  saved.accounts = saved.accounts.filter(a => a.uid !== w.uid).concat({ role: w.kind, uid: w.uid, email: w.email, password, classId: w.classId, studentId: w.studentId || null });
  fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  done.push('created sign-in account ' + w.email + ' (password saved privately)');
  return user;
}
async function student(user, studentId, classId, name) {
  const want = { b3StudentRole: 'student', b3StudentId: studentId, b3ClassId: classId }, have = user.customClaims || {};
  if (Object.keys(want).some(k => have[k] !== want[k])) {
    if (apply) { await auth.setCustomUserClaims(user.uid, { ...have, ...want }); done.push(user.email + ': added the three student claims'); }
    else problems.push(user.email + ': missing student claims b3StudentRole / b3StudentId / b3ClassId');
  }
  const cls = await get(WS + 'classes/' + classId);
  if (!(cls?.active === true && cls.kriahSynthetic === true && cls.toolGrants?.['kriah-assessment'] === true && classId.startsWith('kriah-test-'))) { problems.push(classId + ': class is not an enabled Kriah test class'); return; }
  const profile = await get('b3Games/students/' + studentId + '/profile'), memberships = await get('b3Games/students/' + studentId + '/memberships');
  const member = Object.values(memberships || {}).some(m => m?.active === true && m.workspaceId === 'b3-2026' && m.classId === classId);
  // Student ids are only ever repaired inside the Kriah fixture namespace.
  if (!/^kriah_/.test(studentId)) { problems.push(user.email + ': student record ' + studentId + ' is not a Kriah fixture; left untouched'); return; }
  const changes = {};
  if (!(profile?.active === true && profile.kriahSynthetic === true)) {
    // Field-level writes: an existing profile keeps everything else it has.
    const base = 'b3Games/students/' + studentId + '/profile/';
    Object.assign(changes, { [base + 'active']: true, [base + 'kriahSynthetic']: true, [base + 'kriahFixtureOwner']: OWNER });
    if (!profile) Object.assign(changes, { [base + 'name']: name, [base + 'classId']: classId });
  }
  if (!member) changes['b3Games/students/' + studentId + '/memberships/kriah624'] = { active: true, classId, workspaceId: 'b3-2026' };
  if (cls.members?.[studentId]?.active !== true) changes[WS + 'classes/' + classId + '/members/' + studentId] = { active: true };
  if (Object.keys(changes).length) {
    if (apply) { await db.ref().update(changes); done.push(user.email + ': added Kriah student rows (' + Object.keys(changes).length + ')'); }
    else problems.push(user.email + ': missing Kriah student rows (' + Object.keys(changes).length + ')');
  }
}
async function teacher(user, classId, name) {
  if (!user.emailVerified) problems.push(user.email + ': teacher email is not marked verified');
  const row = await get(WS + 'teachers/' + user.uid);
  if (row?.active === true && row.kriahSynthetic === true && row.classIds?.[classId] === true) return;
  if (!kriahOwned(row)) { problems.push(user.email + ': teacher record is not a Kriah fixture; left untouched'); return; }
  if (!apply) { problems.push(user.email + ': missing Kriah teacher row'); return; }
  await db.ref(WS + 'teachers/' + user.uid).update({ active: true, kriahSynthetic: true, kriahFixtureOwner: OWNER, name: row?.name || name, ['classIds/' + classId]: true });
  done.push(user.email + ': added Kriah teacher row');
}
(async () => {
  for (const w of WANTED) {
    const user = await ensureUser(w); if (!user) continue;
    if (w.kind === 'student') await student(user, w.studentId, w.classId, w.name); else await teacher(user, w.classId, w.name);
  }
  // Any other fictional Kriah student sign-in (student.kriah.<label>@...) that
  // was created by hand without claims gets the same treatment.
  let token;
  do {
    const page = await auth.listUsers(1000, token); token = page.pageToken;
    for (const user of page.users) {
      const match = /^student\.kriah\.([a-z0-9]+)@funtorahtools-staging\.test$/.exec(user.email || '');
      if (!match || WANTED.some(w => w.uid === user.uid)) continue;
      const claims = user.customClaims || {};
      const classId = claims.b3ClassId || 'kriah-test-' + match[1].replace(/\d+$/, '');
      await student(user, claims.b3StudentId || 'kriah_fixture_student_' + match[1], classId, user.displayName || 'Fictional Kriah Student ' + match[1]);
    }
  } while (token);
  done.forEach(line => console.log('FIXED  ' + line));
  problems.forEach(line => console.log('NEEDS  ' + line));
  console.log((apply ? 'Applied. ' : 'Check only (use --apply to repair). ') + done.length + ' fixed, ' + problems.length + ' still needing attention. No passwords printed.');
  await admin.app().delete();
  if (problems.length) process.exitCode = 2;
})().catch(async error => { console.error(error.message); process.exitCode = 1; await admin.app().delete().catch(() => {}); });
