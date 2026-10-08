const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { authenticate, reserve, LIMITS } = require('../backend/functions/paid-api-core.cjs');

function store(rows = {}) {
  const values = new Map(Object.entries(rows));
  let queue = Promise.resolve();
  return {
    values,
    get: async p => structuredClone(values.get(p) ?? null),
    tx(p, fn) {
      const result = queue.then(() => {
        const next = fn(structuredClone(values.get(p) ?? null));
        if (next !== undefined) { if (next === null) values.delete(p); else values.set(p, next); }
        return { committed: next !== undefined, snapshot: { val: () => structuredClone(values.get(p) ?? null) } };
      });
      queue = result.catch(() => {});
      return result;
    }
  };
}
const student = () => store({
  'b3Games/students/alice/profile': { active: true },
  'b3Private/passcodes/alice': { passcode: 'individual-test-passcode' }
});
const headers = { 'x-b3-student-id': 'alice', 'x-b3-student-pin': 'individual-test-passcode' };
const response = () => ({ statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.value = v; this.headersSent = true; return this; } });
function runtime(s) {
  const admin = { apps: [{}], database: () => ({ ref: p => ({
    get: async () => ({ val: () => s.values.get(p) ?? null }),
    transaction: fn => s.tx(p, fn), set: async value => s.values.set(p, value)
  }) }), auth: () => ({ verifyIdToken: async () => { throw Error('invalid'); } }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('backend/functions/paid-api.js', 'utf8'), {
    module, require: name => name === 'firebase-admin' ? admin : require(name === './paid-api-core.cjs' ? '../backend/functions/paid-api-core.cjs' : name),
    console, Buffer, Date, Map
  });
  return module.exports;
}

test('anonymous and incorrect passcode requests cannot reach paid services', async () => {
  const s = student();
  await assert.rejects(authenticate(s, () => {}, {}), e => e.code === 401);
  await assert.rejects(authenticate(s, () => {}, { ...headers, 'x-b3-student-pin': 'wrong' }), e => e.code === 401);
  assert.deepEqual(await authenticate(s, () => {}, headers), { id: 'student:alice' });
});
test('disabled central student cannot fall back to an active legacy record', async () => {
  const s = student();
  s.values.set('b3Games/students/alice/profile', { active: false });
  s.values.set('posukPractice/allowedStudents/alice', { active: true, passcode: 'individual-test-passcode' });
  await assert.rejects(authenticate(s, () => {}, headers), e => e.code === 403);
});
test('bearer tokens require an authorized verified Google teacher or active student', async () => {
  const s = student();
  const bearer = { authorization: 'Bearer test' };
  const token = { uid: 'teacher', email: 'teacher@example.test', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
  await assert.rejects(authenticate(s, async () => token, bearer), e => e.code === 403);
  s.values.set('b3Games/workspaces/b3-2026/teachers/teacher', { active: true });
  assert.equal((await authenticate(s, async () => token, bearer)).id, 'teacher:teacher');
  await assert.rejects(authenticate(s, async () => ({ ...token, email_verified: false }), bearer), e => e.code === 403);
  await assert.rejects(authenticate(s, async () => { throw new Error('revoked'); }, bearer), e => e.code === 401);
  assert.equal((await authenticate(s, async () => ({ b3StudentId: 'alice' }), bearer)).id, 'student:alice');
});
test('concurrent function instances cannot exceed the shared daily allowance', async () => {
  const s = store(), now = Date.UTC(2026, 9, 8, 12);
  s.values.set('b3Private/paidApiUsage/generation', { day: '2026-10-08', month: '2026-10', dayCount: LIMITS.generation.day - 1 });
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => reserve(s, 'generation', { id: 'student:' + i }, 0, now)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 429));
});
test('daily reset preserves monthly usage; monthly rollover resets characters', async () => {
  const s = store();
  s.values.set('b3Private/paidApiUsage/speech', { day: '2026-10-07', month: '2026-10', dayCount: 3000, monthChars: 999990 });
  const actor = { id: 'student:alice' };
  await assert.rejects(reserve(s, 'speech', actor, 11, Date.UTC(2026, 9, 8)), e => e.code === 429);
  await reserve(s, 'speech', actor, 10, Date.UTC(2026, 9, 8));
  await reserve(s, 'speech', actor, 20, Date.UTC(2026, 10, 1));
  assert.equal(s.values.get('b3Private/paidApiUsage/speech').monthChars, 20);
});
test('a cached shared result needs authentication and bypasses a second paid call', async () => {
  const s = student();
  let calls = 0;
  const handler = runtime(s).paidHandler('generateWeeklyQuiz', 'generation', async (req, res) => { calls++; res.status(200).json({ questions: ['test'] }); });
  const req = { method: 'POST', ip: 'test', headers, body: { sourceText: 'test source' } };
  const first = response(), second = response(), anonymous = response();
  await handler(req, first); await handler(req, second); await handler({ ...req, headers: {} }, anonymous);
  assert.equal(calls, 1); assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200); assert.equal(anonymous.statusCode, 401);
  assert.equal(s.values.get('b3Private/paidApiUsage/generation').dayCount, 1);
});
for (const category of ['generation', 'speech']) test(category + ' duplicate requests cannot clear another request\'s lock or trigger a second provider call', async () => {
  const s = student(), api = runtime(s);
  let start, finish, calls = 0;
  const started = new Promise(resolve => { start = resolve; });
  const completed = new Promise(resolve => { finish = resolve; });
  const handler = api.paidHandler(category === 'speech' ? 'synthesizeSpeech' : 'generateWeeklyQuiz', category, async (req, res) => {
    calls++; start(); await completed; res.status(200).json({ audioContent: 'test', items: ['test'] });
  });
  const req = { method: 'POST', ip: 'test', headers, body: { text: 'test' } };
  const first = response(), second = response(), third = response(), cached = response();
  const pending = handler(req, first); await started;
  await handler(req, second); await handler(req, third);
  assert.equal(second.statusCode, 409); assert.equal(third.statusCode, 409);
  finish(); await pending; await handler(req, cached);
  assert.equal(calls, 1); assert.equal(cached.statusCode, 200);
  assert.equal(s.values.get('b3Private/paidApiUsage/' + category).dayCount, 1);
});
test('repeated bad passcodes are blocked before reaching providers', async () => {
  const s = student(); let calls = 0;
  const handler = runtime(s).paidHandler('synthesizeSpeech', 'speech', async () => { calls++; });
  const req = { method: 'POST', ip: 'test', headers: { ...headers, 'x-b3-student-pin': 'wrong' }, body: { text: 'test' } };
  for (let n = 0; n < 20; n++) { const r = response(); await handler(req, r); assert.equal(r.statusCode, 401); }
  const r = response(); await handler(req, r); assert.equal(r.statusCode, 429); assert.equal(calls, 0);
});
test('students cannot invoke the restored teacher-only picture helper', async () => {
  const s = student(); let calls = 0;
  const handler = runtime(s).paidHandler('generateShorashimArt', 'generation', async () => { calls++; });
  const r = response(); await handler({ method: 'POST', ip: 'test', headers, body: { items: [] } }, r);
  assert.equal(r.statusCode, 403); assert.equal(calls, 0);
});
test('browser keeps student identity per tab and never sends credentials to other URLs', async () => {
  const data = new Map([['b3Games_studentId', 'alice'], ['b3Games_classPin', 'individual-test-passcode']]);
  let sent;
  const window = { location: { pathname: '/B3-games/record_pesukim/student.html' },
    firebase: { auth: () => ({ currentUser: { getIdToken: async () => 'teacher-token' } }) },
    fetch: async (url, options) => { sent = options; return { ok: true }; } };
  vm.runInNewContext(fs.readFileSync('paid-api.js', 'utf8'), { window, Headers, sessionStorage: { getItem: k => data.get(k) } });
  const url = 'https://us-central1-b3-games.cloudfunctions.net/synthesizeSpeech';
  await window.B3PaidApi.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  assert.equal(sent.headers.get('X-B3-Student-Id'), 'alice'); assert.equal(sent.headers.get('Authorization'), null);
  await assert.rejects(window.B3PaidApi.fetch('https://example.test/synthesizeSpeech', {}));
  window.location.pathname = '/B3-games/weekly-quiz/teacher.html';
  await window.B3PaidApi.fetch(url, { method: 'POST' });
  assert.equal(sent.headers.get('Authorization'), 'Bearer teacher-token'); assert.equal(sent.headers.get('X-B3-Student-Pin'), null);
});
