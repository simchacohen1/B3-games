// Issue 550 step 2: the teacher "My Nigri login" screen. Made-up values only; no network, never the real Nigri.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const dir = __dirname + '/../sync-to-nigri/';
const html = fs.readFileSync(dir + 'my-login.html', 'utf8');
const screen = fs.readFileSync(dir + 'my-login.js', 'utf8');
const clientSrc = fs.readFileSync(dir + 'nigri-login-client.js', 'utf8');
const C = require(dir + 'nigri-login-client.js');
const PW = 'Fake-Pa55word!-never-real', USER = 'faketeacher@example.test';

test('scripts are valid JavaScript', () => { new vm.Script(screen); new vm.Script(clientSrc); });

test('only the staging hosts and localhost are allowed; the live site is not', () => {
  assert.ok(C.isStagingHost('fun-torah-tools-staging.web.app') && C.isStagingHost('localhost'));
  for (const h of ['funtorahtools.com', 'www.funtorahtools.org', 'simchacohen1.github.io', 'evil.example.test'])
    assert.equal(C.isStagingHost(h), false, h);
});

test('server address: staging value only; the real NigriSync address and junk are refused', () => {
  const loc = { hostname: 'fun-torah-tools-staging.web.app', search: '' };
  assert.equal(C.serverBase(loc, 'https://staging-sync.example.test/'), 'https://staging-sync.example.test');
  assert.equal(C.serverBase(loc, ''), '');
  assert.equal(C.serverBase(loc, 'https://nigrisync.onrender.com'), '');
  assert.equal(C.serverBase(loc, 'javascript:alert(1)'), '');
  assert.equal(C.serverBase(loc, 'http://staging-sync.example.test'), '');
  assert.equal(C.serverBase({ hostname: 'fun-torah-tools-staging.web.app', search: '?server=https://x.example.test' }, ''), '');
  assert.equal(C.serverBase({ hostname: 'localhost', search: '?server=http://localhost:5000' }, ''), 'http://localhost:5000');
});

function env(replies, token = 'tok') {
  const calls = [];
  return { calls, base: 'https://staging-sync.example.test', getToken: async () => token,
    fetch: async (url, opt) => { calls.push({ url, opt }); const r = replies.shift();
      if (r instanceof Error) throw r; return { ok: r.status < 300, status: r.status, json: async () => r.body }; } };
}

test('Saved view shows only the last letters, never the password or full username', async () => {
  const e = env([{ status: 200, body: { saved: true, hint: 'test', updatedAt: 1 } }]);
  const r = await C.save(e, USER, PW);
  assert.deepEqual([r.ok, r.saved], [true, true]);
  assert.equal(r.text, 'Saved ✓ (username ending …test)');
  assert.ok(!r.text.includes(PW) && !r.text.includes(USER));
  assert.equal(e.calls[0].url, 'https://staging-sync.example.test/nigri-login');
  assert.equal(e.calls[0].opt.method, 'PUT');
  assert.equal(e.calls[0].opt.credentials, 'omit');
  assert.equal(e.calls[0].opt.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(e.calls[0].opt.body), { username: USER, password: PW });
});

test('status, replace and remove use GET / PUT / DELETE; nothing saved reads plainly', async () => {
  const e = env([{ status: 200, body: { saved: false } }, { status: 200, body: { saved: true, hint: 'abcd' } }, { status: 200, body: { saved: false } }]);
  assert.equal((await C.status(e)).text, 'No Nigri login saved.');
  assert.equal((await C.save(e, USER, PW)).saved, true);
  assert.equal((await C.remove(e)).saved, false);
  assert.deepEqual(e.calls.map(c => c.opt.method), ['GET', 'PUT', 'DELETE']);
  assert.equal(e.calls[0].opt.body, undefined);
});

test('errors never echo the password and have plain wording', async () => {
  for (const [status, body, expect] of [[401, {}, /sign in/i], [404, {}, /not turned on/i], [429, {}, /too many/i], [500, { error: PW }, /could not/i], [400, { error: 'Enter both a Nigri username and password' }, /Enter both/]]) {
    const r = await C.save(env([{ status, body }]), USER, PW);
    assert.equal(r.ok, false); assert.match(r.message, expect); assert.ok(!r.message.includes(PW));
  }
  assert.match((await C.save(env([new Error('net ' + PW)]), USER, PW)).message, /reach/);
  const noSignIn = env([], null);
  assert.match((await C.status(noSignIn)).message, /sign in/i);
  assert.equal(noSignIn.calls.length, 0);
});

test('screen: password field is hidden-type, cleared after use, never stored or logged', () => {
  assert.match(html, /id="password" name="nigri-pass" type="password" autocomplete="new-password"/);
  assert.match(screen, /pass\.value = ''/);
  for (const src of [screen, clientSrc]) {
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
  }
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});

test('screen only works on staging, never loads the old key or the live server, and never links Nigri', () => {
  assert.match(screen, /C\.isStagingHost\(location\.hostname\)/);
  for (const src of [html, screen]) {
    assert.doesNotMatch(src, /nigrisync\.onrender\.com/);
    assert.doesNotMatch(src, /SYNC_KEY|X-Sync-Key|nigri-auth\.js/);
    assert.doesNotMatch(src, /nigrishluchim|nigrijewish/i);
  }
  assert.doesNotMatch(clientSrc, /SYNC_KEY|X-Sync-Key|nigrishluchim|nigrijewish/i);
});

test('the existing Sync to Nigri page is untouched by this screen', () => {
  const index = fs.readFileSync(dir + 'index.html', 'utf8');
  assert.doesNotMatch(index, /my-login|nigri-login/);
});
