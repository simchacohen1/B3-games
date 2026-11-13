'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const enabled = process.env.B3_RUN_RTDB_EMULATOR_TESTS === '1';
const port = Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 9000);
const namespace = 'demo-b3-davening-default-rtdb';
const run = enabled ? test : test.skip;
let adminApp;

test.before(async () => {
  if (!enabled) return;
  const admin = require('firebase-admin');
  adminApp = admin.initializeApp({ projectId: 'demo-b3-davening',
    databaseURL: 'https://demo-b3-davening-default-rtdb.firebaseio.com' }, 'davening-rules-test');
  const db = adminApp.database();
  for (const path of ['daveningSessions/et', 'daveningSessions/wt', 'chayusSessions/et', 'chayusSessions/wt']) {
    await db.ref(path).set({ id: 'fictional-session', reports: { fictional_student: { metrics: { measuredSeconds: 10 } } } });
  }
});

test.after(async () => { await adminApp?.delete(); });

async function request(method, path, identity) {
  const url = new URL(`http://127.0.0.1:${port}/${path}.json`);
  url.searchParams.set('ns', namespace);
  if (identity) url.searchParams.set('auth_variable_override', JSON.stringify(identity));
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' },
    ...(method === 'PUT' ? { body: JSON.stringify({ forged: true }) } : {}) });
}

run('Davening assignment and Chayus aggregates are private from every client identity', async () => {
  const identities = [
    { uid: 'fictional-auth', token: { b3StudentRole: 'student', b3StudentId: 'fictional_student', b3ClassId: 'et' } },
    { uid: 'fictional-teacher', token: { email: 'teacher@example.test', email_verified: true } },
    null
  ];
  for (const identity of identities) {
    for (const path of ['daveningSessions/et', 'daveningSessions/wt', 'chayusSessions/et', 'chayusSessions/wt']) {
      const read = await request('GET', path, identity);
      assert.equal(read.ok, false, `client read ${path} must be denied (HTTP ${read.status}: ${await read.text()})`);
      const write = await request('PUT', path, identity);
      assert.equal(write.ok, false, `client write ${path} must be denied (HTTP ${write.status}: ${await write.text()})`);
    }
  }
});
