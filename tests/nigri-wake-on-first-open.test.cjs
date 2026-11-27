const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const authSrc = fs.readFileSync(__dirname + '/../sync-to-nigri/nigri-auth.js', 'utf8');
const connectSrc = fs.readFileSync(__dirname + '/../sync-to-nigri/nigri-connect.js', 'utf8');

// The sync service sleeps overnight; the first open of the day must wait for it, not fail.
function boot({ asleepForCalls = 0, postStatus = 200 }) {
  const calls = [];
  let healthCalls = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    if (url.endsWith('/health')) {
      healthCalls++;
      if (healthCalls <= asleepForCalls) throw new TypeError('Failed to fetch'); // host answers without CORS while waking
      return { status: 200, ok: true };
    }
    return { status: postStatus, ok: postStatus < 400, json: async () => ({ saved: true, hint: 'ab' }) };
  };
  const user = { getIdToken: async () => 'tok' };
  const window = { firebase: { apps: [1], app: () => ({ auth: () => ({ currentUser: user }) }), auth: () => {} } };
  const sandbox = { window, fetch: fetchImpl, setTimeout, clearTimeout, AbortController, Date, document: { readyState: 'complete', querySelectorAll: () => [], getElementById: () => null } };
  vm.createContext(sandbox);
  vm.runInContext(authSrc, sandbox);
  return { window, calls, sandbox };
}

test('scripts are valid JavaScript', () => { new vm.Script(authSrc); new vm.Script(connectSrc); });

test('page load wakes the service straight away', async () => {
  const { window, calls } = boot({});
  await window.NigriAuth.wake();
  assert.ok(calls.some(c => c.url.endsWith('/health')));
});

test('a request waits through a cold start (failed wake pings) and then sends once', async () => {
  const { window, calls } = boot({ asleepForCalls: 2 });
  let said = 0;
  const out = await window.NigriAuth.request('/sync-points', { method: 'POST', body: '{}' }, 'key', () => { said++; });
  assert.equal(out.via, 'signin');
  assert.equal(out.response.status, 200);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1, 'the write is sent exactly once');
  assert.ok(said >= 1, 'the page is told to show "Connecting…"');
});

test('a host 503 (still starting) is retried once, never a network failure', async () => {
  const { window, calls } = boot({ postStatus: 503 });
  const out = await window.NigriAuth.request('/sync-points', { method: 'POST', body: '{}' }, null);
  assert.equal(calls.filter(c => c.method === 'POST').length, 2);
  assert.equal(out.response.status, 503);
});

test('connect box says Connecting… while waiting and never "could not reach"', () => {
  assert.match(connectSrc, /Connecting to Nigri…/);
  assert.match(connectSrc, /await wakeService\(\);\s*const token/);
});
