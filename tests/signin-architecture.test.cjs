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
