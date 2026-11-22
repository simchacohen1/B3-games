const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = f => fs.readFileSync(f, 'utf8');

// Every teacher/owner page signs in through the one shared B3SiteSettings.signInWithGoogle(),
// so the login is remembered and the next page or tab never asks for Google again.
const PAGES = [
  'owner-admin.html', 'assignment-center/teacher.html', 'class-dashboard/index.html',
  'student-rewards/teacher.js', 'chazara/teacher.html', 'shorashim/teacher.js',
  'sync-to-nigri/classtime-review.js', 'sync-to-nigri/my-login.js',
  'sync-to-nigri/nigri-school-gate.js', 'sync-to-nigri/school-marks.html'
];
test('no teacher page opens its own Google popup', () => {
  for (const f of PAGES) assert.doesNotMatch(read(f), /signInWithPopup|signInWithRedirect/, f + ' still has its own Google popup');
});
test('pages reach the shared sign-in', () => {
  for (const f of PAGES) assert.match(read(f), /B3TeacherSignIn|B3SiteSettings\.signInWithGoogle/, f);
});
test('pages that use the loader include it', () => {
  for (const f of ['owner-admin.html', 'assignment-center/teacher.html', 'class-dashboard/index.html', 'student-rewards/teacher.html',
    'sync-to-nigri/index.html', 'sync-to-nigri/chossid-lamdan.html', 'sync-to-nigri/classtime.html', 'sync-to-nigri/school-marks.html', 'sync-to-nigri/my-login.html'])
    assert.match(read(f), /teacher-signin\.js/, f);
});

function run({ withSettings }) {
  const loaded = [], calls = [];
  const head = { appendChild(tag) { loaded.push(tag.src); if (/site-settings/.test(tag.src)) window.B3SiteSettings = { signInWithGoogle: async () => { calls.push('shared'); return { uid: 'teacher' }; } }; if (/database/.test(tag.src)) window.firebase.database = () => ({}); setImmediate(() => tag.onload()); } };
  const document = { currentScript: { src: 'https://sols.tools/teacher-signin.js' }, head, createElement: () => ({}) };
  const window = { firebase: { auth: () => ({}) }, document };
  window.firebase.auth.Auth = {};
  if (withSettings) { window.firebase.database = () => ({}); window.B3SiteSettings = { signInWithGoogle: async () => { calls.push('shared'); return { uid: 'teacher' }; } }; }
  vm.runInNewContext(read('teacher-signin.js'), { window, document, Promise, URL, Error, setImmediate });
  return { window, loaded, calls };
}
test('loader calls the shared sign-in when site-settings is already on the page', async () => {
  const t = run({ withSettings: true });
  assert.deepEqual(await t.window.B3TeacherSignIn(), { uid: 'teacher' });
  assert.deepEqual(t.loaded, []); assert.deepEqual(t.calls, ['shared']);
});
test('loader brings in the database library and site-settings, then signs in once', async () => {
  const t = run({ withSettings: false });
  await t.window.B3TeacherSignIn();
  assert.equal(t.loaded.length, 2);
  assert.match(t.loaded[0], /firebase-database-compat\.js$/); assert.match(t.loaded[1], /site-settings\.js/);
  assert.deepEqual(t.calls, ['shared']);
});

test('Class Access waits for the remembered login before showing Google sign-in', () => {
  const html = read('admin.html');
  const fn = html.slice(html.indexOf('async function renderTeacherAccess'), html.indexOf('// ---- Owner Control page'));
  // The wait is unconditional (it used to run only when a user already existed).
  assert.match(fn, /\n\s*await waitForTeacherAuth\(w\);/);
  assert.doesNotMatch(fn, /if\(auth\?\.currentUser\)await waitForTeacherAuth/);
  // A later authorized login swaps the panel without asking again.
  assert.match(html, /function watchTeacherAuth/);
  assert.ok(fn.indexOf('await waitForTeacherAuth(w)') < fn.indexOf('id="taSignIn"'));
});
