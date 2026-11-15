'use strict';
// Run only in the approved staging deployment session. Never prints passwords.
const fs = require('node:fs');
const crypto = require('node:crypto');
const admin = require('../backend/kriah-staging/node_modules/firebase-admin');
const Core = require('../kriah-assessment/core.js');
const PROJECT = 'fun-torah-tools-staging';
if (process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('Explicit staging project required.');
admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + PROJECT + '-default-rtdb.firebaseio.com' });
const db = admin.database(), auth = admin.auth();
const credentialsFile = process.env.KRIAH_CREDENTIALS_FILE;
if (!credentialsFile || !credentialsFile.startsWith('/tmp/')) throw new Error('Use a private temporary credentials file.');
const previous = fs.existsSync(credentialsFile) ? JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) : null;
const accounts = [];
const WS = 'b3Games/workspaces/b3-2026/';
async function owned(path) {
  const value = (await db.ref(path).get()).val();
  if (value && value.kriahFixtureOwner !== 'issue-624') throw new Error('Refusing to overwrite an unrelated staging fixture: ' + path);
}
async function user(uid, email, name, claims) {
  let existing;
  try { existing = await auth.getUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  const old = previous?.accounts?.find(a => a.uid === uid);
  if (existing && (existing.email !== email || !old?.password)) throw new Error('Existing fixture requires its original private credentials file; no password reset performed.');
  const password = old?.password || crypto.randomBytes(24).toString('base64url');
  if (!existing) await auth.createUser({ uid, email, password, emailVerified: true, displayName: name });
  if (claims) await auth.setCustomUserClaims(uid, claims);
  accounts.push({ uid, email, password, name, ...claims });
  fs.writeFileSync(credentialsFile, JSON.stringify({ projectId: PROJECT, accounts }, null, 2), { mode: 0o600 });
  fs.chmodSync(credentialsFile, 0o600);
}
(async () => {
  for (const [suffix, label] of [['et', 'Alef'], ['wt', 'Beis']]) {
    const cid = 'kriah-test-' + suffix, tid = 'kriah-fixture-teacher-' + suffix, sid = 'kriah_fixture_student_' + suffix;
    await owned(WS + 'classes/' + cid);
    await owned(WS + 'teachers/' + tid);
    await owned('b3Games/students/' + sid + '/profile');
    await user(tid, 'teacher.kriah.' + suffix + '@funtorahtools-staging.test', 'Fictional Kriah Teacher ' + label);
    await user('kriah-fixture-auth-' + suffix, 'student.kriah.' + suffix + '@funtorahtools-staging.test', 'Fictional Kriah Student ' + label, { b3StudentRole: 'student', b3StudentId: sid, b3ClassId: cid });
    const mark = { active: true, kriahSynthetic: true, kriahFixtureOwner: 'issue-624' };
    await db.ref().update({
      [WS + 'classes/' + cid]: { ...mark, name: 'Kriah ' + label + ' · fictional', toolGrants: { 'kriah-assessment': true }, members: { [sid]: { active: true } } },
      [WS + 'teachers/' + tid]: { ...mark, name: 'Fictional Kriah Teacher ' + label, classIds: { [cid]: true } },
      ['b3Games/students/' + sid + '/profile']: { ...mark, name: 'Fictional Kriah Student ' + label, classId: cid },
      ['b3Games/students/' + sid + '/memberships/kriah624']: { active: true, classId: cid, workspaceId: 'b3-2026' }
    });
    const library = 'b3Private/kriahAssessmentCenter/classes/' + cid + '/library';
    for (let i = 0; i < Core.STARTERS.length; i++) {
      await db.ref(library + '/starter-' + i).transaction(value => value || { ...Core.exercise(Core.STARTERS[i]), id: 'starter-' + i });
    }
  }
  fs.writeFileSync(credentialsFile, JSON.stringify({ projectId: PROJECT, accounts }, null, 2), { mode: 0o600 });
  fs.chmodSync(credentialsFile, 0o600);
  console.log('Provisioned 2 fictional teachers / 2 students in isolated kriah-test-* classes. Credentials retained privately at ' + credentialsFile);
  await admin.app().delete();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
