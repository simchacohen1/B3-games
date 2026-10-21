// Read-only regression guard for sign-in architecture.
// Run: node --test tests/signin-architecture.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('teacher login retains separate remembered and tab sessions', () => {
  const code = read('site-settings.js');
  assert.match(code, /Auth\.Persistence\.LOCAL/);
  assert.match(code, /Auth\.Persistence\.SESSION/);
  assert.match(code, /updateCurrentUser\(result\.user\)/);
});

test('student homepage signs in with a verified custom token', () => {
  const code = read('index.html');
  assert.match(code, /studentAuthCall\(\{action:"login"/);
  assert.match(code, /signInWithCustomToken\(customToken\)/);
  assert.match(code, /Auth\.Persistence\.SESSION/);
});

test('access gate waits for restored auth and retains bounded fail-closed reads', () => {
  const code = read('game-gate.js');
  assert.match(code, /await authReadyPromise/);
  assert.match(code, /FETCH_TIMEOUT_MS\s*=\s*15000/);
  assert.match(code, /reject\(new Error\("Access check timed out"\)\)/);
  assert.match(code, /"memberships\.json"|\/members\/|memberships\.json/);
});

test('Halacha checks existing student claims before requesting a token', () => {
  const code = read('halacha/index.html');
  const existing = code.indexOf('if(halachaAuth.currentUser)');
  const tokenRequest = code.indexOf('action:"halachaToken"');
  assert.ok(existing >= 0 && tokenRequest > existing);
  assert.match(code, /claims\.b3StudentId===HALACHA_STUDENT_ID/);
});

test('student rewards uses Firebase custom token authentication', () => {
  const code = read('student-rewards/student.js');
  assert.match(code, /signInWithCustomToken\(j\.customToken\)/);
});

test('teacher class access reads run concurrently and retain all four checks', () => {
  const code = read('game-gate.js');
  const start = code.indexOf('var teacherFields=await Promise.all([');
  const end = code.indexOf(']);', start);
  assert.ok(start >= 0 && end > start, 'teacher reads must use Promise.all');
  const block = code.slice(start, end);
  for (const field of ['active', 'siteEnabled', 'access', 'toolGrants']) {
    assert.ok(block.includes('"/' + field + '.json"'), field + ' access read missing');
  }
  assert.match(code, /teacherClassRecord=null;/);
});

test('teacher class reads start together and preserve field mapping', async () => {
  const vm = require('node:vm');
  const code = read('game-gate.js');
  const start = code.indexOf('var teacherFields=await Promise.all([');
  const end = code.indexOf('        } else {', start);
  assert.ok(start >= 0 && end > start);
  const snippet = code.slice(start, end).replace(/        }\s*$/, '');
  const pending = new Map();
  const context = {
    Promise,
    teacherClassPath: 'test-class',
    fetchJson: (url) => new Promise((resolve) => pending.set(url, resolve)),
    teacherClassRecord: null,
  };
  const run = vm.runInNewContext('(async () => { ' + snippet + ' })()', context);
  assert.equal(pending.size, 4, 'all four requests must start without waiting for each other');
  for (const [field, value] of [['active', true], ['siteEnabled', true], ['access', {mode:'open'}], ['toolGrants', {halacha:true}]]) {
    pending.get('test-class/' + field + '.json')(value);
  }
  await run;
  assert.equal(context.teacherClassRecord.active, true);
  assert.equal(context.teacherClassRecord.siteEnabled, true);
  assert.equal(context.teacherClassRecord.access.mode, 'open');
  assert.equal(context.teacherClassRecord.toolGrants.halacha, true);
});

test('teacher class access fails closed when any required read fails', async () => {
  const vm = require('node:vm');
  const code = read('game-gate.js');
  const start = code.indexOf('var teacherFields=await Promise.all([');
  const end = code.indexOf('        } else {', start);
  assert.ok(start >= 0 && end > start);
  const snippet = code.slice(start, end).replace(/        }\s*$/, '');
  const context = {
    Promise,
    teacherClassPath: 'test-class',
    fetchJson: (url) => url.endsWith('/access.json')
      ? Promise.reject(new Error('permission_denied'))
      : Promise.resolve(true),
    teacherClassRecord: null,
  };
  await assert.rejects(
    vm.runInNewContext('(async () => { ' + snippet + ' })()', context),
    /permission_denied/
  );
  assert.equal(context.teacherClassRecord, null, 'partial permissions must not authorize a teacher');
});
