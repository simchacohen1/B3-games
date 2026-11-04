// Local-only: needs the Firebase Auth emulator running (see RELEASE-PLAN.md) and `npm ci` in backend/functions.
// Runs the REAL homework.js handler with REAL firebase-admin token verification against the
// local Auth emulator. The database is an in-memory fake (Java 21 needed for the DB emulator).
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-homework';
const assert = require('node:assert/strict');
const path = require('node:path');
const req = require('node:module').createRequire(path.join(__dirname, '..', 'backend', 'functions', 'homework-staging', 'package.json'));
const admin = req('firebase-admin');
admin.initializeApp({ projectId: 'demo-homework' });

const data = {
  b3Games: { admins: {}, workspaces: { 'b3-2026': {
    classes: { c1: { name: 'C1', toolGrants: { homework: true }, members: { s1: { active: true } } },
               c2: { name: 'C2', toolGrants: { homework: true }, members: { s2: { active: true } } } },
    teachers: {} } },
    students: { s1: { profile: { name: 'Sam Test' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'c1' } } },
                s2: { profile: { name: 'Dan Test' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'c2' } } } } },
  b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' } } }
};
const walk = (p, create) => { let n = data; const k = p.split('/'); for (const s of k.slice(0, -1)) { if (n[s] == null) { if (!create) return [null, k]; n[s] = {}; } n = n[s]; } return [n, k]; };
const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
Object.defineProperty(admin, "database", { configurable: true, value: () => ({ ref: p => ({
  once: async () => { const [n, k] = walk(p, false); return { val: () => n == null ? null : clone(n[k[k.length - 1]]) }; },
  set: async v => { const [n, k] = walk(p, true); if (v === null) delete n[k[k.length - 1]]; else n[k[k.length - 1]] = clone(v); },
  transaction: async fn => { const [n, k] = walk(p, true); const out = fn(n[k[k.length - 1]] === undefined ? null : clone(n[k[k.length - 1]])); if (out === undefined) return { committed: false }; n[k[k.length - 1]] = clone(out); return { committed: true }; }
}) }) });
const { homeworkPortal } = req('./homework.js');

async function googleLogin(email, verified = true) {
  const idp = JSON.stringify({ sub: 'g-' + email, email, email_verified: verified, provider_id: 'google.com' });
  const r = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postBody: 'id_token=' + encodeURIComponent(idp) + '&providerId=google.com', requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }) });
  const j = await r.json(); return { token: j.idToken, uid: j.localId };
}
async function emailLogin(email) {
  const r = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'not-a-real-password', returnSecureToken: true }) });
  return (await r.json()).idToken;
}
const express = req('express');
const app = express(); app.use(express.json()); app.all('/', homeworkPortal);
const server = app.listen(0);
async function call(body, token, method = 'POST') {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  return { code: r.status, body: await r.json().catch(() => ({})) };
}
(async () => {
  const t1 = await googleLogin('teacher1@test.example');
  const t2 = await googleLogin('teacher2@test.example');
  const unverified = await googleLogin('unverified@test.example', false);
  const pwd = await emailLogin('pw'+Date.now()+'@test.example');
  data.b3Games.workspaces['b3-2026'].teachers[t1.uid] = { active: true, classIds: { c1: true } };
  data.b3Games.workspaces['b3-2026'].teachers[t2.uid] = { active: true, classIds: { c2: true } };
  const log = (n, r) => console.log(String(r.code).padEnd(4), n, r.body.error ? '-> ' + r.body.error : '');
  let r;
  r = await call({ action: 'authorizedClasses' }, t1.token); log('teacher1 authorized classes', r); assert.deepEqual(r.body.classes.map(c => c.id), ['c1']);
  const emailOnly = await googleLogin('simcha5770@gmail.com'); r = await call({ action: 'authorizedClasses' }, emailOnly.token); log('owner email without UID grant', r); assert.equal(r.code, 403);

  r = await call({}, null, 'GET'); log('GET health', r); assert.equal(r.code, 200);
  r = await call({ action: 'create', classId: 'c1', type: 'audio', title: 'Real-token test' }, t1.token); log('teacher1 creates in c1', r); assert.equal(r.code, 200);
  r = await call({ action: 'publish', classId: 'c1', assignmentId: r.body.id }, t1.token); log('teacher1 publishes in c1', r); assert.equal(r.code, 200);
  r = await call({ action: 'teacherList', classId: 'c1' }, t1.token); assert.equal(r.body.assignments.length, 1);
  r = await call({ action: 'teacherList', classId: 'c2' }, t1.token); log('teacher1 reads c2 (not hers)', r); assert.equal(r.code, 403);
  r = await call({ action: 'teacherList', classId: 'c1' }, t2.token); log('teacher2 reads c1 (not hers)', r); assert.equal(r.code, 403);
  r = await call({ action: 'teacherList', classId: 'c1' }, unverified.token); log('unverified-email Google token', r); assert.equal(r.code, 403);
  r = await call({ action: 'teacherList', classId: 'c1' }, pwd); log('email/password token', r); assert.equal(r.code, 403);
  r = await call({ action: 'teacherList', classId: 'c1' }, 'garbage'); log('garbage token', r); assert.equal(r.code, 401);
  r = await call({ action: 'teacherList', classId: 'c1' }, null); log('no token', r); assert.equal(r.code, 401);
  const s = { studentId: 's1', studentName: 'Sam Test', pin: '1111', classId: 'c1' };
  r = await call({ action: 'studentList', ...s }); log('student s1 lists', r); assert.equal(r.body.assignments.length, 1);
  r = await call({ action: 'studentList', ...s, pin: '9999' }); log('student wrong passcode', r); assert.equal(r.code, 401);
  r = await call({ action: 'studentList', studentId: 's2', studentName: 'Dan Test', pin: '2222', classId: 'c2' }); log('student s2 (other class) lists', r); assert.equal(r.body.assignments.length, 0);
  r = await call({ action: 'studentList', ...s, classId: 'c2' }); log('student s1 requests c2', r); assert.equal(r.code, 403);
  const created = await call({ action: 'create', classId: 'c1', type: 'workbook', title: 'Correction cycle' }, t1.token); assert.equal(created.code, 200); const secondId = created.body.id;
  r = await call({ action: 'publish', classId: 'c1', assignmentId: secondId }, t1.token); assert.equal(r.code, 200);
  r = await call({ action: 'submit', ...s, assignmentId: secondId, answer: 'First attempt' }); log('student submits work', r); assert.equal(r.code, 200);
  r = await call({ action: 'return', classId: 'c1', assignmentId: secondId, studentId: 's1', feedback: 'Please add one more detail.' }, t1.token); log('teacher returns work', r); assert.equal(r.code, 200);
  r = await call({ action: 'studentList', ...s }); assert.equal(r.body.assignments.find(a => a.id === secondId).status, 'returned');
  r = await call({ action: 'submit', ...s, assignmentId: secondId, answer: 'Revised work with more detail' }); log('student resubmits corrections', r); assert.equal(r.code, 200);
  r = await call({ action: 'approve', classId: 'c1', assignmentId: secondId, studentId: 's1', stars: 5 }, t1.token); log('teacher approves resubmission', r); assert.equal(r.code, 200);
  await new Promise(x => setTimeout(x, 1200));
  await admin.auth().revokeRefreshTokens(t1.uid);
  await new Promise(x => setTimeout(x, 1500));
  r = await call({ action: 'teacherList', classId: 'c1' }, t1.token); log('teacher1 after sign-out everywhere (revoked)', r); assert.equal(r.code, 401);
  console.log('ALL CHECKS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
