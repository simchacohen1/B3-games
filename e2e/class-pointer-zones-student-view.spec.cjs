'use strict';
// Real browsers, real PeerJS/WebRTC, real classroom.js / join-auth.js / classPointerShareAuth handler.
// Everything else is synthetic and local: a local PeerJS signaling server, an in-memory database behind the
// real backend handler, a stub Firebase object, made-up students/teacher. Nothing touches Firebase or the internet.
// Needs the `peer` package: set PEER_MODULE to the folder of an installed `peer` (not a repo dependency).
//   PEER_MODULE=C:/path/to/node_modules/peer npx playwright test e2e/pointer-join-ticket-two-browser.spec.cjs --project=chromium
// PEER_CLOUD=1 instead uses the real public PeerJS signaling service (0.peerjs.com), as the live site does.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://pointer.test';
const API = 'https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
const STUDENT_API = 'https://us-central1-b3-games.cloudfunctions.net/funTorahStudentAuth';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = 9319;
const STUB_EMPTY = ['site-settings.js', 'dashboard-session.js', 'firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js', 'firebase-storage-compat.js'];

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests'] } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(150000);

let peerServer, backend;

// ---- the real backend handler on an in-memory database (same approach as the unit tests) ----
function makeBackend() {
  const source = fs.readFileSync(path.join(ROOT, 'backend/functions/class-pointer-share-auth.js'), 'utf8');
  const rows = new Map();
  const members = { avi: 'Avi Synthetic', benny: 'Benny Synthetic' };
  rows.set('b3Games/workspaces/b3-2026/classes/et', { name: 'ET', active: true, members: { avi: { active: true }, benny: { active: true } } });
  rows.set('b3Games/workspaces/b3-2026/classes/wt', { name: 'WT', active: true, members: { wes: { active: true } } });
  rows.set('b3Games/workspaces/b3-2026/teachers/teacher-et', { active: true, classIds: { et: true } });
  for (const [id, name] of Object.entries({ ...members, wes: 'Wes Synthetic' })) rows.set('b3Games/students/' + id + '/profile', { name, active: true });
  for (const id of ['avi', 'benny']) rows.set('b3Games/workspaces/b3-2026/classes/et/members/' + id, { active: true });
  rows.set('b3Games/workspaces/b3-2026/classes/wt/members/wes', { active: true });
  const passcodes = { avi: '1111', benny: '2222', wes: '3333' };
  const ref = p => ({
    once: async () => ({ val: () => { const v = rows.get(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
    set: async v => { if (v === null) rows.delete(p); else rows.set(p, JSON.parse(JSON.stringify(v))); },
    transaction: async cb => { const before = rows.get(p) ?? null, after = cb(before === null ? null : JSON.parse(JSON.stringify(before))); if (after === undefined) return { committed: false, snapshot: { val: () => before } }; rows.set(p, after); return { committed: true, snapshot: { val: () => after } }; }
  });
  let handler;
  vm.runInNewContext(source, { module: { exports: {} }, exports: {}, Buffer, Date, console, require: name => {
    if (name === 'firebase-functions/v2/https') return { onRequest: (_o, fn) => { handler = fn; return fn; } };
    if (name === 'firebase-admin') return { apps: [{}], database: () => ({ ref }), auth: () => ({ verifyIdToken: async t => ({ uid: t }) }) };
    if (name === 'node:crypto') return require('node:crypto');
    if (name === './student-locks-core.cjs') return { featureLockedForClass: () => false };
    if (name === './student-passcodes.cjs') return { readPasscode: async (_g, id) => ({ passcode: passcodes[id] || '' }), key: s => typeof s === 'string' && /^[a-z0-9_-]+$/i.test(s), equal: (a, b) => a === b };
    throw Error(name);
  } });
  const post = (body, authorization, ip = '10.0.0.1') => new Promise(async resolve => {
    const result = { status: 200, body: null };
    await handler({ method: 'POST', body, ip, headers: authorization ? { authorization } : {} }, { set() { return this; }, status(c) { result.status = c; return this; }, json(v) { result.body = v; resolve(result); return this; } });
    resolve(result);
  });
  const log = [];
  return { rows, post, log, publishSession(room, classId = 'et', teacherUid = 'teacher-et') { rows.set('b3Games/workspaces/b3-2026/classes/' + classId + '/classPointerSessions/' + room, { roomId: room, createdAt: Date.now(), teacherUid }); }, publishActivityRequest(room, shareRequestAt = Date.now(), classId = 'et', teacherUid = 'teacher-et') { const session = { roomId: room, createdAt: Date.now(), teacherUid, studentScreenSharing: true, shareRequest: { at: shareRequestAt } }; rows.set('b3Games/workspaces/b3-2026/classes/' + classId + '/classPointerSessions/' + room, session); return session; } };
}

test.beforeAll(async () => {
  test.skip(!process.env.PEER_MODULE && !process.env.PEER_CLOUD, 'set PEER_MODULE (local signaling) or PEER_CLOUD=1 (public PeerJS) to run the real-browser test');
  if (!process.env.PEER_CLOUD && !process.env.PEER_EXTERNAL) { const { PeerServer } = require(process.env.PEER_MODULE); peerServer = PeerServer({ port: PORT, path: '/', allow_discovery: false }); }
  backend = makeBackend();
});
test.afterAll(async () => { try { peerServer && peerServer.close && peerServer.close(); } catch { /* done */ } });

async function wire(context, { token, student, extra, session, realFirebase = false } = {}) {
  await context.route(BASE + '/**', route => {
    const url = new URL(route.request().url()); let p = decodeURIComponent(url.pathname);
    if (p === '/blank.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/class-pointer-prototype/vendor/peerjs-1.5.5.min.js"></script>' });
    if (p === '/firebase-app-compat.js' || p === '/firebase-database-compat.js') {
      const name = p.slice(1), sdk = process.env.FIREBASE_SDK_DIR;
      if (!sdk) return route.fulfill({ status: 500, body: 'FIREBASE_SDK_DIR is required' });
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(sdk, name), 'utf8') });
    }
    if (p === '/activity-test.html') {
      const firebaseTags = realFirebase ? '<script src="/firebase-app-compat.js"></script><script src="/firebase-database-compat.js"></script><script>firebase.initializeApp({projectId:"demo-pointer-test",databaseURL:"http://127.0.0.1:9009?ns=demo-pointer-test"});firebase.database().useEmulator("127.0.0.1",9009)</script>' : '';
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><main id="stage"></main>' + firebaseTags + '<script src="/class-pointer-prototype/vendor/peerjs-1.5.5.min.js"></script><script defer src="/class-pointer-prototype/activity-share.js"></script></body></html>' });
    }
    const file = process.env.OLD_CLASSROOM && p.endsWith('/class-pointer-prototype/classroom.js') ? process.env.OLD_CLASSROOM : path.join(ROOT, p); // negative control: the page as it was before the fix
    if (STUB_EMPTY.some(n => p.endsWith('/' + n)) || p.endsWith('/firebase-config.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if ((!file.startsWith(ROOT) && file !== process.env.OLD_CLASSROOM) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await context.route('https://www.gstatic.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route(STUDENT_API, async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const ok = body.action === 'verify' && student && body.studentId === student.id && body.pin === student.pin;
    route.fulfill({ status: ok ? 200 : 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok }) });
  });
  await context.route(API, async route => {
    const req = route.request(), body = JSON.parse(req.postData() || '{}');
    const res = await backend.post(body, req.headers()['authorization'], 'ip-' + (token || 'student'));
    backend.log.push({ action: body.action, status: res.status });
    route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res.body) });
  });
  await context.addInitScript(({ port, token, student, extra, session, realFirebase }) => {
    // local signaling server instead of the public PeerJS cloud
    // (port 0 = PEER_CLOUD: keep the real public PeerJS service, exactly as the live site uses it)
    if (port) { let RealPeer; Object.defineProperty(window, 'Peer', { configurable: true, get() { return RealPeer && function (id, opts) { return new RealPeer(id, { host: 'localhost', port, secure: false, ...(opts || {}) }); }; }, set(v) { RealPeer = v; } }); }
    const noop = () => {};
    const ref = path => ({ set: async () => {}, update: async () => {}, remove: async () => {}, on: (_event, callback) => { if (session && path.includes('/classPointerSessions')) { window.__activitySessionCallback = callback; setTimeout(() => callback({ val: () => ({ [session.roomId]: session }) }), 0); } }, off: noop, once: async () => ({ val: () => null }), onDisconnect: () => ({ remove: noop, set: noop }) });
    if (!realFirebase) window.firebase = { apps: [{}], initializeApp: noop, auth: () => ({ currentUser: token ? { uid: token, getIdToken: async () => token } : null, onAuthStateChanged: cb => cb(token ? { uid: token } : null) }), database: () => ({ ref }), storage: () => ({ ref }) };
    window.B3_FIREBASE_CONFIG = {}; window.B3SiteSettings = {};
    window.FunTorahStudentClass = { resolve: async () => ({ workspaceId: 'b3-2026', classId: student?.classId || 'et' }) };
    if (student) { sessionStorage.setItem('b3Games_studentId', student.id); sessionStorage.setItem('b3Games_classPin', student.pin); sessionStorage.setItem('b3Games_studentClass', student.classId); sessionStorage.setItem('b3Games_studentName', student.name); }
    if (extra === 'canvas') { // synthetic "screen" for this browser only
      window.__captureStreams = [];
      if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const c = canvas.getContext('2d'); c.fillStyle = '#1d4ed8'; c.fillRect(0, 0, 320, 180);
        const stream = canvas.captureStream(5); setInterval(() => { c.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); c.fillRect(0, 0, 320, 180); }, 200);
        window.__captureStreams.push(stream); return stream;
      } });
    }
  }, { port: process.env.PEER_CLOUD ? 0 : PORT, token, student, extra, session, realFirebase });
}

async function startTeacher(browser) {
  const context = await browser.newContext();
  await wire(context, { token: 'teacher-et', extra: 'canvas' });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('teacher pageerror:', e.message)); page.on('console', m => { if (['error','warning'].includes(m.type())) console.log('teacher console:', m.text().slice(0, 400)); });
  await page.goto(BASE + '/class-pointer-prototype/classroom.html?dashboard=teacher&class=et');
  await expect.poll(() => page.evaluate(() => (document.getElementById('joinLink') || {}).value || ''), { timeout: 20000 }).toContain('room=');
  const room = new URL(await page.inputValue('#joinLink')).searchParams.get('room');
  backend.publishSession(room);
  return { context, page, room };
}
async function joinStudent(browser, room, student, handoffClass) {
  const context = await browser.newContext();
  await wire(context, { student });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('student pageerror:', e.message)); 
  await page.addInitScript(({ room, student, handoffClass }) => sessionStorage.setItem('classPointerDashboardJoin', JSON.stringify({ room, name: student.name, studentId: student.id, classId: handoffClass || student.classId, at: Date.now() })), { room, student, handoffClass });
  await page.goto(BASE + '/class-pointer-prototype/classroom.html?dashboard=student&room=' + encodeURIComponent(room));
  return { context, page };
}
const roster = page => page.evaluate(() => document.getElementById('roster').textContent);
const AVI = { id: 'avi', name: 'x', pin: '1111', classId: 'et' };
const BENNY = { id: 'benny', name: 'y', pin: '2222', classId: 'et' };

test('a student sees his own space clearly, other names, and a note when he has none', async ({ browser }) => {
  const t = await startTeacher(browser);
  const a = await joinStudent(browser, t.room, AVI), b = await joinStudent(browser, t.room, BENNY);
  await expect.poll(() => roster(t.page), { timeout: 30000 }).toMatch(/Avi Synthetic — admitted[\s\S]*Benny Synthetic — admitted|Benny Synthetic — admitted[\s\S]*Avi Synthetic — admitted/);
  await expect(t.page.locator('#openWhiteboard')).toBeEnabled({ timeout: 10000 });
  await t.page.evaluate(() => document.getElementById('openWhiteboard').click());
  await expect.poll(() => t.page.evaluate(() => window.ClassPointerPdf.zones.available()), { timeout: 15000 }).toBe(true);
  const set = list => t.page.evaluate(list => window.ClassPointerPdf.zones.set(list, false), list);
  await set([
    { id: 'z1', x: .05, y: .1, w: .4, h: .5, owners: [{ k: 'avi', n: 'Avi Synthetic' }] },
    { id: 'z2', x: .55, y: .1, w: .4, h: .5, owners: [{ k: 'benny', n: 'Benny Synthetic' }] }
  ]);
  for (const [s, mineLabel, otherName] of [[a, 'Your space', 'Benny Synthetic'], [b, 'Your space', 'Avi Synthetic']]) {
    await expect.poll(() => s.page.locator('.board-zone-box.mine').count(), { timeout: 20000 }).toBe(1);
    expect(await s.page.locator('.board-zone-box.other').count()).toBe(1);
    expect(await s.page.locator('.board-zone-halo').count()).toBe(1);
    await expect(s.page.locator('.board-zone-label.mine')).toHaveText(mineLabel);
    await expect(s.page.locator('.board-zone-label.other')).toHaveText(otherName);
    expect(await s.page.locator('.board-zone-dim').count()).toBe(1);
    expect(await s.page.locator('.board-zone-notice').count()).toBe(0);
  }
  await a.page.screenshot({ path: test.info().outputPath('avi-sees-his-space.png') });
  // Only Avi has a space now: Benny is told he has none, and everything is dimmed for him.
  await set([{ id: 'z1', x: .05, y: .1, w: .4, h: .5, owners: [{ k: 'avi', n: 'Avi Synthetic' }] }]);
  await expect(b.page.locator('.board-zone-notice')).toHaveText("Your teacher hasn't given you a space yet.", { timeout: 20000 });
  expect(await b.page.locator('.board-zone-box.mine').count()).toBe(0);
  await expect(a.page.locator('.board-zone-box.mine')).toHaveCount(1);
  await expect(a.page.locator('.board-zone-notice')).toHaveCount(0);
  await b.page.screenshot({ path: test.info().outputPath('benny-has-no-space.png') });
  // No zones at all: the board is free again and nothing is drawn.
  await set([]);
  await expect(b.page.locator('.board-zones')).toHaveCount(0, { timeout: 20000 });
  await expect(b.page.locator('.board-zone-notice')).toHaveCount(0);
  for (const s of [a, b]) await s.context.close();
  await t.context.close();
});

test('inside his own space a student moves the teacher\'s marks; outside it they stay put', async ({ browser }) => {
  const t = await startTeacher(browser);
  const a = await joinStudent(browser, t.room, AVI);
  await expect.poll(() => roster(t.page), { timeout: 30000 }).toContain('Avi Synthetic — admitted');
  await t.page.evaluate(() => { for (const id of ['allowPointer', 'allowHighlight', 'allowPen']) { const box = document.getElementById(id); if (box) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); } } for (const box of document.querySelectorAll('#roster input[type=checkbox]')) if (!box.checked) box.click(); });
  await expect(t.page.locator('#openWhiteboard')).toBeEnabled({ timeout: 10000 });
  await t.page.evaluate(() => document.getElementById('openWhiteboard').click());
  await expect.poll(() => t.page.evaluate(() => window.ClassPointerPdf.zones.available()), { timeout: 15000 }).toBe(true);
  await t.page.evaluate(() => window.ClassPointerPdf.zones.set([{ id: 'z1', x: .05, y: .1, w: .4, h: .5, owners: [{ k: 'avi', n: 'Avi Synthetic' }] }], false));
  const rect = (x1, y1, x2, y2) => ({ tool: 'rectangle', color: '#1d4ed8', size: .016, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
  await t.page.evaluate(([inside, outside]) => { window.ClassPointerBridge.submitStroke(inside); window.ClassPointerBridge.submitStroke(outside); }, [rect(.1, .2, .2, .3), rect(.6, .2, .7, .3)]);
  const marks = () => t.page.evaluate(() => window.ClassPointerBridge.highlights().map(s => [s.owner, s.points[0].x, s.points[0].y]));
  await expect.poll(async () => (await marks()).length, { timeout: 10000 }).toBe(2);
  await expect.poll(() => a.page.evaluate(() => !!document.querySelector('.board-zone-box.mine')), { timeout: 20000 }).toBe(true);
  await a.page.getByRole('button', { name: 'Select', exact: true }).first().click();   // the student's own toolbar
  const drag = async (fx, fy, tx, ty) => {
    const box = await a.page.locator('#pdfContent').boundingBox();
    await a.page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await a.page.mouse.down(); await a.page.mouse.move(box.x + box.width * (fx + tx) / 2, box.y + box.height * (fy + ty) / 2, { steps: 4 });
    await a.page.mouse.move(box.x + box.width * tx, box.y + box.height * ty, { steps: 4 }); await a.page.mouse.up();
  };
  await a.page.setViewportSize({ width: 1280, height: 1500 }); await a.page.evaluate(() => document.getElementById('pdfContent').scrollIntoView({ block: 'start' })); await a.page.waitForTimeout(300);
  await drag(.15, .25, .3, .4);                                   // inside his space: the teacher's mark moves
  await expect.poll(async () => (await marks())[0][1], { timeout: 10000 }).toBeCloseTo(.25, 1);
  expect((await marks())[0][0]).toBe('teacher');
  await drag(.65, .25, .4, .4);                                   // outside his space: nothing moves
  await a.page.waitForTimeout(1500);
  expect((await marks())[1][1]).toBeCloseTo(.6, 2);
  await a.context.close(); await t.context.close();
});
