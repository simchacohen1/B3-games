'use strict';
/* The teacher's Locks panel in a real browser, talking to the REAL server rules (manageLocks answers its requests in this
   test), so what the teacher clicks and what the server allows are checked together. Firebase and sign-in are stand-ins.
   Skipped when Playwright or a browser is not installed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { manageLocks } = require('../backend/functions/student-locks-core.cjs');
const core = require('../student-lock-core.js');
const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://panel.test';
const FN = 'https://us-central1-b3-games.cloudfunctions.net/studentLocks';
let chromium = null;
try { chromium = require('playwright').chromium; } catch { /* not installed */ }
const skip = chromium ? false : 'Playwright is not installed';

const WS = 'b3-2026';
function makeStore(extraLocks) {
  const data = { b3Games: { workspaces: { [WS]: {
    teachers: { t1: { displayName: 'Mr. Cohen', active: true, classIds: { ET1: true } }, t2: { displayName: 'Mr. Levi', active: true, classIds: { ET1: true } } },
    classes: { ET1: { name: 'Alef', active: true, teacherIds: { t1: true, t2: true }, ...(extraLocks ? { locks: extraLocks } : {}) } } } } } };
  const parts = p => p.split('/').filter(Boolean);
  const read = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const write = (p, v) => {
    const ks = parts(p); let o = data;
    ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
    for (let i = ks.length - 1; i > 0; i--) { const parent = ks.slice(0, i).reduce((x, k) => x && x[k], data); if (parent && Object.keys(parent).length === 0) delete ks.slice(0, i - 1).reduce((x, k) => x[k], data)[ks[i - 1]]; else break; }
  };
  return { data, locks: () => (data.b3Games.workspaces[WS].classes.ET1.locks || {}),
    async get(p) { const v = read(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
    async update(map) { for (const [p, v] of Object.entries(map)) write(p, v); } };
}

const stubs = () => `(() => {
  window.B3_FIREBASE_CONFIG = {};
  window.firebase = { apps: [{}], initializeApp() {}, auth: () => ({ currentUser: { uid: 't1', getIdToken: async () => 'token-t1' } }),
    database: () => ({ ref: () => ({ on: (_e, cb) => { window.__cb = cb; }, off() {} }) }) };
  window.B3SiteSettings = { onAuthStateChanged(cb) { setTimeout(() => cb({ uid: 't1' }, true, { role: 'teacher' }), 0); }, signInWithGoogle: async () => {} };
  window.__push = locks => window.__cb && window.__cb({ val: () => locks });
})();`;

async function open(t, { as = 't1', locks } = {}) {
  const store = makeStore(locks);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const context = await browser.newContext();
  await context.addInitScript(stubs());
  const sent = [];
  let page;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href === FN) {
      const body = JSON.parse(route.request().postData() || '{}'); sent.push(body);
      let status = 200, out;
      try { out = await manageLocks(store, { uid: as, email: as + '@school.test', email_verified: true }, body, {}, Date.now()); }
      catch (e) { status = e.code || 500; out = { error: e.message }; }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(out) });
      const locksNow = store.locks();
      setTimeout(() => page && page.evaluate(l => window.__push(l), locksNow).catch(() => {}), 20);   // the database pushes the change
      return;
    }
    if (url.origin === ORIGIN) {
      if (/\/(site-settings|firebase-config)\.js$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ status: 200, contentType: file.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(file) });
      return route.fulfill({ status: 404, body: '' });
    }
    if (/gstatic\.com/.test(url.host)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.abort();
  });
  page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(ORIGIN + '/class-locks/index.html?class=ET1&embed=1');
  await page.waitForSelector('#features .feature', { timeout: 5000 });
  return { page, store, sent, errors };
}
const text = (page, selector) => page.locator(selector).innerText();
const featureRow = (page, label) => page.locator('#features .feature', { has: page.locator('.name', { hasText: label }) });

test('the panel lists every feature, with the Arcade as one switch, and the teacher who opened the class holds it', { skip }, async t => {
  const { page, errors } = await open(t);
  assert.equal(await page.locator('#features .feature').count(), core.FEATURES.length);
  assert.ok(await featureRow(page, 'Arcade (all multiplayer games)').count() === 1);
  assert.match(await text(page, '#holder'), /You have this class now/);
  assert.match(await text(page, '#className'), /Alef/);
  assert.deepEqual(errors, []);
});

test('Lock all and Unlock all, and one switch for one feature', { skip }, async t => {
  const { page, store } = await open(t);
  await page.click('#lockAll');
  await page.waitForFunction(() => [...document.querySelectorAll('#features input[role=switch]')].every(i => i.checked), null, { timeout: 4000 });
  assert.equal(Object.keys(store.locks().features).length, core.FEATURES.length);
  assert.match(await featureRow(page, 'Gematria').innerText(), /Locked/);
  await page.click('#unlockAll');
  await page.waitForFunction(() => [...document.querySelectorAll('#features input[role=switch]')].every(i => !i.checked), null, { timeout: 4000 });
  assert.equal(store.locks().features, undefined);
  const arcade = featureRow(page, 'Arcade');
  await arcade.locator('label.switch').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#features .feature')].some(r => /Arcade/.test(r.innerText) && /Locked/.test(r.querySelector('.chip').innerText)), null, { timeout: 4000 });
  assert.deepEqual(Object.keys(store.locks().features), ['multiplayer-center']);
  assert.match(await featureRow(page, 'Gematria').innerText(), /Open/);
});

test('a timed unlock shows what, until when and why; it counts down and can be ended; the lock comes back', { skip }, async t => {
  const { page, store } = await open(t);
  await page.click('#lockAll');
  await page.waitForFunction(() => [...document.querySelectorAll('#features input[role=switch]')].every(i => i.checked), null, { timeout: 4000 });
  await page.selectOption('#ovTarget', '@games');
  await page.click('#ovButtons button:has-text("15 min")');
  await page.waitForSelector('#ovList .ov', { timeout: 4000 });
  const ov = await text(page, '#ovList .ov');
  assert.match(ov, /All games unlocked/); assert.match(ov, /by Mr\. Cohen/); assert.match(ov, /ends at/);
  const arcadeRow = await featureRow(page, 'Arcade').innerText();
  assert.match(arcadeRow, /Open \(timed\)/); assert.match(arcadeRow, /Unlocked by Mr\. Cohen for 15 min, until/); assert.match(arcadeRow, /ends in/);
  assert.match(await featureRow(page, 'Gematria').innerText(), /Locked by the switch/, 'other features keep their lock');
  const o = store.locks().overrides['@games']; assert.equal(o.state, 'open'); assert.ok(o.until - Date.now() > 14 * 60000 && o.until - Date.now() <= 15 * 60000);
  await page.click('#ovList .ov button:has-text("End now")');
  await page.waitForFunction(() => /No timed unlocks/.test(document.getElementById('ovList').innerText), null, { timeout: 4000 });
  assert.match(await featureRow(page, 'Arcade').innerText(), /Locked/);
});

test('a teacher who does not have the class cannot start timed unlocks, and is told who does; the switches still work', { skip }, async t => {
  const now = Date.now(), p = core.nyParts(now);
  const hhmm = m => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((m % 1440) + 1440) % 1440 % 60).padStart(2, '0');
  const levi = { schedules: { t2: { name: 'Mr. Levi', rules: { r1: { days: [p.day], start: hhmm(p.minutes - 5), end: hhmm(p.minutes + 30), targets: ['@learning'] } } } } };
  const { page, store, sent } = await open(t, { locks: levi });
  const banner = await text(page, '#holder');
  assert.match(banner, /Mr\. Levi has this class now/); assert.match(banner, /his schedule covers right now/);
  for (const b of await page.locator('#ovButtons button').all()) assert.equal(await b.isDisabled(), true);
  // The server agrees (not just the buttons): a request is refused.
  const r = await page.evaluate(async () => { const res = await fetch('https://us-central1-b3-games.cloudfunctions.net/studentLocks', { method: 'POST', body: JSON.stringify({ classId: 'ET1', action: 'override', targets: ['*'], state: 'open', minutes: 15 }) }); return [res.status, (await res.json()).error]; });
  assert.equal(r[0], 403); assert.match(r[1], /Mr\. Levi has this class right now/);
  assert.equal(store.locks().overrides, undefined);
  assert.match(await featureRow(page, 'Gematria').innerText(), /Locked by Mr\. Levi's schedule until/, 'a feature locked by his schedule is shown with why');
  await featureRow(page, 'Chazara').locator('label.switch').click();   // the switches are for every teacher of the class
  await page.waitForTimeout(300);
  assert.ok(sent.some(b => b.action === 'setFeature' && b.featureId === 'chazara' && b.locked === true));
});

test('my weekly schedule: add a line for right now, save, and the feature shows as locked by my schedule', { skip }, async t => {
  const { page, store } = await open(t);
  const now = Date.now(), p = core.nyParts(now);
  const hhmm = m => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((m % 1440) + 1440) % 1440 % 60).padStart(2, '0');
  await page.click('#addLine');
  const line = page.locator('#myLines .line').first();
  // clear the preset days, then tick today only
  for (const cb of await line.locator('.days input').all()) if (await cb.isChecked()) await cb.uncheck({ force: true });
  const dayIndex = core.DAYS.indexOf(p.day);
  await line.locator('.days input').nth(dayIndex).check({ force: true });
  await line.locator('input[type=time]').nth(0).fill(hhmm(p.minutes - 5));
  await line.locator('input[type=time]').nth(1).fill(hhmm(p.minutes + 30));
  await page.click('#saveSchedule');
  await page.waitForFunction(() => [...document.querySelectorAll('#features .feature')].some(r => /Arcade/.test(r.innerText) && /Locked by Mr\. Cohen's schedule/.test(r.innerText)), null, { timeout: 5000 });
  const saved = store.locks().schedules.t1;
  assert.equal(saved.name, 'Mr. Cohen'); assert.deepEqual(saved.rules.r1.targets, ['@games']);
  assert.match(await featureRow(page, 'Gematria').innerText(), /Open/, 'only the games are in that line');
  // A bad line is refused by the server with a clear message.
  await page.click('#addLine');
  const bad = page.locator('#myLines .line').nth(1);
  for (const cb of await bad.locator('.days input').all()) if (await cb.isChecked()) await cb.uncheck({ force: true });
  await page.click('#saveSchedule');
  await page.waitForSelector('#toast.err', { timeout: 4000 });
  assert.match(await text(page, '#toast'), /at least one day/i);
});

test('the older Class Access page stays one click away', { skip }, async t => {
  const { page } = await open(t);
  assert.match(await page.locator('#oldAccess').getAttribute('href'), /admin\.html\?tab=access&class=ET1$/);
});
