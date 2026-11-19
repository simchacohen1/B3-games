'use strict';
/* student-lock.js in a real browser. Everything outside the page is replaced by stand-ins: the lock data is pushed by the
   test the way the database pushes it, so this checks what a student actually sees and how fast. Skipped when Playwright
   or a browser is not installed (tests/student-lock-core.test.cjs covers the rules without a browser). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://lock.test';
let chromium = null;
try { chromium = require('playwright').chromium; } catch { /* not installed */ }
const skip = chromium ? false : 'Playwright is not installed';

const PAGES = {
  '/gematria/index.html': '<!doctype html><title>Gematria</title><body><main id="app">GEMATRIA ACTIVITY</main><audio id="a" src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="></audio>' +
    '<script defer src="/student-lock.js?v=test" data-feature="gematria"></script>',
  '/index.html': '<!doctype html><title>Home</title><body><a class="game-card" id="t-gematria" data-game-id="gematria" href="/gematria/index.html">Gematria</a>' +
    '<a class="game-card" id="t-arcade" data-game-id="multiplayer-center" href="/multiplayer/index.html">Arcade</a>' +
    '<script defer src="/student-lock.js?v=test" data-feature="home"></script>',
  '/multiplayer/index.html': '<!doctype html><title>Arcade</title><body>ARCADE<script defer src="/student-lock.js?v=test" data-feature="multiplayer-center"></script>'
};

const stubs = ({ signedIn, classes }) => `(() => {
  try { ${signedIn ? "if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');sessionStorage.setItem('b3Games_studentId','test-boy');}" : ''} } catch (e) {}
  window.B3_FIREBASE_CONFIG = { projectId: 'x' };
  const handlers = {};
  const memberships = {}; ${JSON.stringify(classes)}.forEach(c => { memberships['b3-2026_' + c] = { workspaceId: 'b3-2026', classId: c, active: true }; });
  const db = { ref: p => ({
    once: async () => ({ val: () => (p.endsWith('/memberships') ? memberships : null) }),
    on: (_e, cb) => { handlers[p] = cb; } }) };
  window.firebase = { apps: [{}], database: () => db, auth: () => ({ authStateReady: async () => {} }) };
  window.__push = (classId, locks) => { const cb = handlers['b3Games/workspaces/b3-2026/classes/' + classId + '/locks']; if (!cb) throw new Error('not subscribed to ' + classId); cb({ val: () => locks }); };
  window.__subscribed = () => Object.keys(handlers);
})();`;

async function open(t, url, { signedIn = true, classes = ['ET1'] } = {}) {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const context = await browser.newContext();
  await context.addInitScript(stubs({ signedIn, classes }));
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    if (PAGES[u.pathname]) return route.fulfill({ status: 200, contentType: 'text/html', body: PAGES[u.pathname] });
    const file = path.join(ROOT, u.pathname);
    if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await context.newPage();
  await page.goto(ORIGIN + url);
  return { page, context };
}
const waitSubscribed = (page, n = 1) => page.waitForFunction(k => window.__subscribed && window.__subscribed().length >= k, n, { timeout: 5000 });
const covered = page => page.evaluate(() => { const c = document.getElementById('b3StudentLockCover'); return !!c && !c.hidden; });
const NOW = () => Date.now();

test('a student already inside the page is moved to "Locked by your teacher" within a second, and released again', { skip }, async t => {
  const { page } = await open(t, '/gematria/index.html');
  await waitSubscribed(page);
  await page.evaluate(() => window.__push('ET1', {}));
  await page.waitForTimeout(300);
  assert.equal(await covered(page), false, 'open: no cover');
  const t0 = Date.now();
  await page.evaluate(() => window.__push('ET1', { features: { gematria: { locked: true } } }));
  await page.waitForFunction(() => { const c = document.getElementById('b3StudentLockCover'); return c && !c.hidden; }, null, { timeout: 3000 });
  assert.ok(Date.now() - t0 < 2000, 'the cover came up within about a second of the change');
  assert.match(await page.locator('#b3StudentLockCover').innerText(), /Locked by your teacher/);
  assert.match(await page.locator('#b3StudentLockCover a').getAttribute('href'), /\/index\.html$/, 'a way back home');
  assert.equal(await page.evaluate(() => document.body.inert), true, 'the page behind it cannot be used from the keyboard either');
  assert.equal(await page.evaluate(() => document.getElementById('a').paused), true, 'sound stops');
  await page.evaluate(() => window.__push('ET1', {}));
  await page.waitForFunction(() => document.getElementById('b3StudentLockCover').hidden, null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => document.body.inert), false, 'unlocked: the page works again');
});

test('only the locked feature is covered; the same lock on another feature leaves this page alone', { skip }, async t => {
  const { page } = await open(t, '/gematria/index.html');
  await waitSubscribed(page);
  await page.evaluate(() => window.__push('ET1', { features: { 'multiplayer-center': { locked: true } } }));
  await page.waitForTimeout(400);
  assert.equal(await covered(page), false);
});

test('a weekly schedule covering right now locks by itself, and one that has ended does not', { skip }, async t => {
  const { page } = await open(t, '/gematria/index.html');
  await waitSubscribed(page);
  const rule = (startOffsetMin, endOffsetMin) => page.evaluate(([a, b]) => {
    const core = window.B3StudentLockCore, now = Date.now(), at = ms => { const x = new Intl.DateTimeFormat('en-US', { timeZone: core.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)); return x; };
    const day = core.nyParts(now).day;
    window.__push('ET1', { schedules: { t1: { name: 'Mr. Cohen', rules: { r1: { days: [day], start: at(now + a * 60000), end: at(now + b * 60000), targets: ['@learning'] } } } } });
  }, [startOffsetMin, endOffsetMin]);
  await rule(-5, 30);
  await page.waitForFunction(() => { const c = document.getElementById('b3StudentLockCover'); return c && !c.hidden; }, null, { timeout: 3000 });
  await rule(-60, -30);
  await page.waitForFunction(() => document.getElementById('b3StudentLockCover').hidden, null, { timeout: 3000 });
});

test('a temporary unlock opens a feature the teacher had locked, then the lock comes back when the time is up', { skip }, async t => {
  const { page } = await open(t, '/gematria/index.html');
  await waitSubscribed(page);
  const until = NOW() + 2500;
  await page.evaluate(u => window.__push('ET1', { features: { gematria: { locked: true } }, overrides: { gematria: { state: 'open', until: u, byName: 'Mr. Cohen', label: '2 sec' } } }), until);
  await page.waitForTimeout(400);
  assert.equal(await covered(page), false, 'unlocked by the override');
  assert.equal(await page.evaluate(() => window.B3StudentLock.overrideOpen('gematria')), true, 'the older page gate is told');
  await page.waitForFunction(() => { const c = document.getElementById('b3StudentLockCover'); return c && !c.hidden; }, null, { timeout: 5000 });
});

test('a student in two classes is locked when either teacher locks it', { skip }, async t => {
  const { page } = await open(t, '/gematria/index.html', { classes: ['ET1', 'WT2'] });
  await waitSubscribed(page, 2);
  await page.evaluate(() => { window.__push('ET1', {}); window.__push('WT2', { features: { gematria: { locked: true } } }); });
  await page.waitForFunction(() => { const c = document.getElementById('b3StudentLockCover'); return c && !c.hidden; }, null, { timeout: 3000 });
});

test('a reload while locked shows the lock at once (from the last known state), before the network answers', { skip }, async t => {
  const { page } = await open(t, '/gematria/index.html');
  await waitSubscribed(page);
  await page.evaluate(() => window.__push('ET1', { features: { gematria: { locked: true } } }));
  await page.waitForFunction(() => { const c = document.getElementById('b3StudentLockCover'); return c && !c.hidden; });
  await page.reload();
  await page.waitForFunction(() => { const c = document.getElementById('b3StudentLockCover'); return c && !c.hidden; }, null, { timeout: 3000 });
});

test('nobody signed in: the page is never covered', { skip }, async t => {
  const { page } = await open(t, '/gematria/index.html', { signedIn: false });
  await page.waitForTimeout(1500);
  assert.equal(await covered(page), false);
  assert.deepEqual(await page.evaluate(() => window.__subscribed()), []);
});

test('home page: a locked tile shows a lock and does not open; the others still do', { skip }, async t => {
  const { page } = await open(t, '/index.html');
  await waitSubscribed(page);
  await page.evaluate(() => window.__push('ET1', { features: { 'multiplayer-center': { locked: true } } }));
  await page.waitForFunction(() => document.querySelector('#t-arcade .b3-lock-badge'), null, { timeout: 3000 });
  assert.equal(await page.locator('#t-gematria .b3-lock-badge').count(), 0, 'an open tile has no lock');
  assert.equal(await page.locator('#t-arcade').getAttribute('aria-disabled'), 'true');
  assert.equal(await covered(page), false, 'the home page itself is never covered');
  await page.locator('#t-arcade').click({ force: true });   // a real student can tap it; Playwright treats aria-disabled as not clickable
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).pathname, '/index.html', 'the locked tile did not navigate');
  assert.match(await page.locator('#b3StudentLockToast').innerText(), /Locked by your teacher/);
  await page.evaluate(() => window.__push('ET1', {}));
  await page.waitForFunction(() => !document.querySelector('#t-arcade .b3-lock-badge'), null, { timeout: 3000 });
});

test('the Arcade page is covered like every other page', { skip }, async t => {
  const { page } = await open(t, '/multiplayer/index.html');
  await waitSubscribed(page);
  await page.evaluate(() => window.__push('ET1', { features: { 'multiplayer-center': { locked: true } } }));
  await page.waitForFunction(() => { const c = document.getElementById('b3StudentLockCover'); return c && !c.hidden; }, null, { timeout: 3000 });
});
