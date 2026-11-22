'use strict';
// Runs the REAL record_pesukim/weekly-nigri.js with fake browser objects and checks which route a send takes.
// (A broken copy of this file once sent the owner with no sign-in and an empty key; a plain "text is in the file" test missed it.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = read('record_pesukim/weekly-nigri.js');

test('the file defines each function once (no pasted-twice code)', () => {
  for (const name of ['injectUi', 'openModal', 'rashiForWeek', 'preview', 'render', 'send', 'sendToNigri', 'isOwnerNow']) {
    const n = src.split('function ' + name + '(').length - 1;
    assert.equal(n, 1, name + ' appears ' + n + ' times');
  }
  assert.ok(!/WEEKLY_NIGRI_OWNER_KEY/.test(src));
});

function load({ role, gateReason, email, hasAuth = true, key = 'KEY123' }) {
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : stub()), set: () => true, apply: () => stub() });
  const calls = { auth: [], connect: [], fetch: [] };
  const window = {
    WeeklyPracticeMarks: require('../shared/weekly-practice-marks-core.js'),
    WEEKLY_NIGRI_ROSTER: { rosters: { et: [] }, names: {}, classSections: { et: 'B3 ET' }, syncKey: key },
    __WEEKLY_NIGRI_TEST__: true,
    NigriConnect: { state: { role }, sendMarks: async b => { calls.connect.push(b); return { response: { ok: true }, via: 'teacher' }; } },
    B3NigriGate: { result: gateReason ? { reason: gateReason } : {}, ready: Promise.resolve({ allowed: true }) },
    B3SchoolScope: { OWNER_EMAIL: 'owner@example.test' }
  };
  if (hasAuth) window.NigriAuth = { request: async (p, init, k) => { calls.auth.push({ p, init, k }); return { response: { ok: true }, via: 'key' }; } };
  const firebase = { auth: () => ({ currentUser: email ? { email, emailVerified: true } : null }), database: { ServerValue: {} } };
  const sandbox = { window, firebase, db: {}, document: stub(), location: { search: '' }, fetch: async (u, o) => { calls.fetch.push({ u, o }); return { ok: true }; },
    console, Date, Promise, studentsMap: {}, setTimeout, URLSearchParams, confirm: () => true };
  sandbox.window.document = sandbox.document;
  vm.runInNewContext(src, sandbox);
  return { api: window.__WEEKLY_NIGRI_TEST__, calls };
}

test('owner (by helper role) goes the owner route: sign-in first, old key only as fallback', async () => {
  const { api, calls } = load({ role: 'owner' });
  const r = await api.sendToNigri({ a: 1 });
  assert.equal(calls.auth.length, 1); assert.equal(calls.auth[0].p, '/sync-marks'); assert.equal(calls.auth[0].k, 'KEY123');
  assert.equal(calls.connect.length, 0); assert.equal(r.via, 'key');
});
test('owner is recognised even if the helper says teacher (by gate result or by verified owner email)', async () => {
  for (const opts of [{ role: 'teacher', gateReason: 'owner' }, { role: 'teacher', email: 'OWNER@example.test' }]) {
    const { api, calls } = load(opts);
    await api.sendToNigri({ a: 1 });
    assert.equal(calls.auth.length, 1, JSON.stringify(opts)); assert.equal(calls.connect.length, 0);
  }
});
test('owner still sends with the key if the sign-in helper is missing', async () => {
  const { api, calls } = load({ role: 'owner', hasAuth: false });
  await api.sendToNigri({ a: 1 });
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].o.headers['X-Sync-Key'], 'KEY123');
  assert.notEqual(calls.fetch[0].o.headers['X-Sync-Key'], '');
});
test('a teacher uses only his own Nigri login, never the key', async () => {
  const { api, calls } = load({ role: 'teacher', email: 'teacher@example.test' });
  const r = await api.sendToNigri({ a: 1 });
  assert.equal(calls.connect.length, 1); assert.equal(calls.auth.length, 0); assert.equal(calls.fetch.length, 0); assert.equal(r.via, 'teacher');
});
test('page pins script versions so stale cached copies cannot run', () => {
  const page = read('record_pesukim/teacher.html');
  for (const f of ['weekly-practice-marks-core.js', 'weekly-nigri-roster.js', 'weekly-nigri.js']) assert.match(page, new RegExp(f.replace('.', '[.]') + '[?]v=[0-9]'));
});
