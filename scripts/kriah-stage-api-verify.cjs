'use strict';
// Authenticated, fictional-only staging verification, including a valid silent
// Ogg/Opus original. No passwords, bearer tokens or private headers are logged.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const admin = require('../backend/kriah-staging/node_modules/firebase-admin');
const PROJECT = 'fun-torah-tools-staging';
if (process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('Explicit staging project required.');
const origin = process.env.KRIAH_PREVIEW_URL;
if (!/^https:\/\/fun-torah-tools-staging--kriah-624-[a-z0-9-]+\.web\.app$/.test(origin || '')) throw new Error('Kriah preview required.');
const credentials = JSON.parse(fs.readFileSync(process.env.KRIAH_CREDENTIALS_FILE, 'utf8'));
assert.equal(credentials.projectId, PROJECT);
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('.kriah-preview/staging/firebase-config.generated.js', 'utf8'), context);
const cfg = context.window.B3_STAGING_FIREBASE_CONFIG;
assert.equal(cfg.projectId, PROJECT);
admin.initializeApp({ projectId: PROJECT, databaseURL: cfg.databaseURL });
const db = admin.database(), auth = admin.auth(), traffic = [];
const endpoint = 'https://us-central1-' + PROJECT + '.cloudfunctions.net/kriahAssessment';
function original() {
  function page(packets, sequence, flags, granule) {
    const header = Buffer.alloc(27 + packets.length);
    header.write('OggS'); header[5] = flags; header.writeBigUInt64LE(BigInt(granule), 6); header.writeUInt32LE(624, 14); header.writeUInt32LE(sequence, 18); header[26] = packets.length;
    packets.forEach((packet, i) => header[27 + i] = packet.length);
    const bytes = Buffer.concat([header, ...packets]);
    let crc = 0;
    for (const byte of bytes) { crc ^= byte << 24; for (let i = 0; i < 8; i++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0); }
    bytes.writeUInt32LE(crc >>> 0, 22); return bytes;
  }
  const head = Buffer.alloc(19); head.write('OpusHead'); head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10); head.writeUInt32LE(48000, 12);
  const tags = Buffer.alloc(16); tags.write('OpusTags');
  return Buffer.concat([page([head], 0, 2, 0), page([tags], 1, 0, 0), page(Array.from({ length: 50 }, () => Buffer.from([0xf8, 0xff, 0xfe])), 2, 4, 48000)]);
}
async function login(uid) {
  const account = credentials.accounts.find(a => a.uid === uid);
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + cfg.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }) });
  const body = await r.json(); assert.equal(r.status, 200, 'Fictional Firebase sign-in failed'); return body.idToken;
}
async function call(token, body, expected = 200) {
  const r = await fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const text = await r.text(); traffic.push({ action: body.action, status: r.status, bytes: Buffer.byteLength(text) });
  assert.equal(r.status, expected, body.action + ' returned ' + r.status + ': ' + (r.status === 200 ? '' : text.slice(0, 300)));
  return JSON.parse(text);
}
(async () => {
  const [ta, tb, sa, sb] = await Promise.all(['kriah-fixture-teacher-et', 'kriah-fixture-teacher-wt', 'kriah-fixture-auth-et', 'kriah-fixture-auth-wt'].map(login));
  const classId = 'kriah-test-et', studentId = 'kriah_fixture_student_et';
  assert.deepEqual((await call(ta, { action: 'classes' })).classes.map(c => c.id), [classId]);
  await call(null, { action: 'classes' }, 401);
  const assigned = await call(ta, { action: 'assign', classId, exerciseId: 'starter-1', studentIds: [studentId] });
  const id = assigned.assigned[0].id, target = { classId, studentId, id };
  const bytes = original(), upload = { ...target, action: 'submit', audio: bytes.toString('base64'), type: 'audio/ogg', duration: 1 };
  await call(sa, upload);
  assert.equal((await call(sa, upload)).duplicate, true);
  const row = (await call(ta, { action: 'get', ...target })).record;
  assert.equal(row.status, 'submitted');
  await call(ta, { action: 'grade', ...target, revision: row.revision, marks: [{ unitId: 'n:0:1464', category: 'wrong-vowel', note: 'Synthetic staging observation' }], final: true, shareFeedback: true, feedback: 'Fictional practice: listen to kamatz.', recommendation: 'Read the marked syllable again.' });
  const report = await call(sa, { action: 'list', classId, studentId });
  const reviewed = report.records.find(r => r.id === id);
  assert.equal(reviewed.status, 'reviewed'); assert.equal(reviewed.summary.incorrect, 1); assert.equal(reviewed.summary.skills.find(s => s.label === 'Kamatz').errors, 1);
  assert.equal(traffic.filter(r => r.action === 'audioRead').length, 0);
  const audio = await call(ta, { action: 'audioRead', ...target }); assert(Buffer.from(audio.audio, 'base64').equals(bytes));
  for (const token of [tb, sb]) for (const action of ['get', 'audioRead', 'grade']) await call(token, { action, ...target }, 403);
  await call(sa, { action: 'grade', ...target }, 403);
  const teacherPath = 'b3Games/workspaces/b3-2026/teachers/kriah-fixture-teacher-et/active';
  await db.ref(teacherPath).set(false);
  try { await call(ta, { action: 'get', ...target }, 403); } finally { await db.ref(teacherPath).set(true); }
  const membership = 'b3Games/students/' + studentId + '/memberships/kriah624/active';
  await db.ref(membership).set(false);
  try { await call(sa, { action: 'get', ...target }, 403); } finally { await db.ref(membership).set(true); }
  await new Promise(r => setTimeout(r, 1200)); await auth.revokeRefreshTokens('kriah-fixture-teacher-wt');
  await call(tb, { action: 'classes' }, 401);
  const privateRead = await fetch(cfg.databaseURL + '/b3Private/kriahAssessmentCenter/classes/' + classId + '.json?auth=' + sa);
  assert([401, 403].includes(privateRead.status), 'Private RTDB was client-readable');
  const publicRead = await fetch('https://storage.googleapis.com/' + PROJECT + '-kriah-private/kriah/' + classId + '/' + studentId + '/' + id);
  assert.equal(publicRead.status, 403, 'Original recording was publicly readable');
  fs.mkdirSync('.kriah-evidence', { recursive: true }); fs.writeFileSync('.kriah-evidence/synthetic-original.ogg', bytes);
  const result = { passed: true, source: 'authenticated staging API + separate real-browser teacher sign-in', preview: origin, assignment: { id, classId, studentId }, originalAudioBytes: bytes.length, originalPreserved: true, directDatabaseDenied: privateRead.status, publicAudioDenied: publicRead.status, apiRequests: traffic.length, apiResponseBytes: traffic.reduce((n, r) => n + r.bytes, 0), audioReadRequests: traffic.filter(r => r.action === 'audioRead').length, checks: ['4 actual fictional Firebase sign-ins', 'assign-submit-duplicate-review-report', 'original audio byte equality', 'cross-teacher/student denial', 'student cannot grade', 'teacher and membership revocation', 'revoked ID token denial', 'private RTDB direct denial', 'public audio denial'] };
  fs.writeFileSync('.kriah-evidence/api-result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); await admin.app().delete();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
