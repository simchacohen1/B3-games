'use strict';
// Real browsers, real PeerJS/WebRTC, real classroom.js / join-auth.js / classPointerShareAuth handler.
// Everything else is synthetic and local: a local PeerJS signaling server, an in-memory database behind the
// real backend handler, a stub Firebase object, made-up students/teacher. Nothing touches Firebase or the internet.
// Needs the `peer` package: set PEER_MODULE to the folder of an installed `peer` (not a repo dependency).
//   PEER_MODULE=C:/path/to/node_modules/peer npx playwright test e2e/pointer-join-ticket-two-browser.spec.cjs --project=chromium
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://pointer.test';
const API = 'https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = 9319;
const STUB_EMPTY = ['site-settings.js', 'dashboard-session.js', 'firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js', 'firebase-storage-compat.js'];

test.skip(!process.env.PEER_MODULE, 'set PEER_MODULE to an installed `peer` package folder to run the real-browser test');
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
    if (name === './student-passcodes.cjs') return { readPasscode: async (_g, id) => ({ passcode: passcodes[id] || '' }), key: s => typeof s === 'string' && /^[a-z0-9_-]+$/i.test(s), equal: (a, b) => a === b };
    throw Error(name);
  } });
  const post = (body, authorization, ip = '10.0.0.1') => new Promise(async resolve => {
    const result = { status: 200, body: null };
    await handler({ method: 'POST', body, ip, headers: authorization ? { authorization } : {} }, { set() { return this; }, status(c) { result.status = c; return this; }, json(v) { result.body = v; resolve(result); return this; } });
    resolve(result);
  });
  const log = [];
  return { rows, post, log, publishSession(room, classId = 'et', teacherUid = 'teacher-et') { rows.set('b3Games/workspaces/b3-2026/classes/' + classId + '/classPointerSessions/' + room, { roomId: room, createdAt: Date.now(), teacherUid }); } };
}

test.beforeAll(async () => {
  const { PeerServer } = require(process.env.PEER_MODULE);
  if (!process.env.PEER_EXTERNAL) peerServer = PeerServer({ port: PORT, path: '/', allow_discovery: false });
  backend = makeBackend();
});
test.afterAll(async () => { try { peerServer && peerServer.close && peerServer.close(); } catch { /* done */ } });

async function wire(context, { token, student, extra } = {}) {
  await context.route(BASE + '/**', route => {
    const url = new URL(route.request().url()); let p = decodeURIComponent(url.pathname);
    if (p === '/blank.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/class-pointer-prototype/vendor/peerjs-1.5.5.min.js"></script>' });
    const file = process.env.OLD_CLASSROOM && p.endsWith('/class-pointer-prototype/classroom.js') ? process.env.OLD_CLASSROOM : path.join(ROOT, p); // negative control: the page as it was before the fix
    if (STUB_EMPTY.some(n => p.endsWith('/' + n)) || p.endsWith('/firebase-config.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if ((!file.startsWith(ROOT) && file !== process.env.OLD_CLASSROOM) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await context.route('https://www.gstatic.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route(API, async route => {
    const req = route.request(), body = JSON.parse(req.postData() || '{}');
    const res = await backend.post(body, req.headers()['authorization'], 'ip-' + (token || 'student'));
    backend.log.push({ action: body.action, status: res.status });
    route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(res.body) });
  });
  await context.addInitScript(({ port, token, student, extra }) => {
    // local signaling server instead of the public PeerJS cloud
    let RealPeer; Object.defineProperty(window, 'Peer', { configurable: true, get() { return RealPeer && function (id, opts) { return new RealPeer(id, { host: 'localhost', port, secure: false, ...(opts || {}) }); }; }, set(v) { RealPeer = v; } });
    const noop = () => {};
    const ref = () => ({ set: async () => {}, update: async () => {}, remove: async () => {}, on: noop, off: noop, once: async () => ({ val: () => null }), onDisconnect: () => ({ remove: noop, set: noop }) });
    window.firebase = { apps: [{}], initializeApp: noop, auth: () => ({ currentUser: token ? { uid: token, getIdToken: async () => token } : null, onAuthStateChanged: cb => cb(token ? { uid: token } : null) }), database: () => ({ ref }), storage: () => ({ ref }) };
    window.B3_FIREBASE_CONFIG = {}; window.B3SiteSettings = {};
    if (student) { sessionStorage.setItem('b3Games_studentId', student.id); sessionStorage.setItem('b3Games_classPin', student.pin); sessionStorage.setItem('b3Games_studentClass', student.classId); sessionStorage.setItem('b3Games_studentName', student.name); }
    if (extra === 'canvas') { // synthetic "screen" for the teacher
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const c = canvas.getContext('2d'); c.fillStyle = '#1d4ed8'; c.fillRect(0, 0, 320, 180);
      const stream = canvas.captureStream(5); setInterval(() => { c.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); c.fillRect(0, 0, 320, 180); }, 200);
      if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => stream });
    }
  }, { port: PORT, token, student, extra });
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
const AVI = { id: 'avi', name: 'Whatever The Page Claims', pin: '1111', classId: 'et' };

test('legitimate student joins; identity comes from the server, not from the page', async ({ browser }) => {
  const t = await startTeacher(browser);
  const s = await joinStudent(browser, t.room, AVI);
  await expect.poll(() => roster(t.page), { timeout: 25000 }).toContain('Avi Synthetic — admitted');
  expect(await roster(t.page)).not.toContain('Whatever The Page Claims');
  expect(backend.log.some(l => l.action === 'joinIssue' && l.status === 200)).toBe(true);
  expect(backend.log.some(l => l.action === 'joinVerify' && l.status === 200)).toBe(true);
  await s.context.close(); await t.context.close();
});

test('outsiders who know the public room id are refused and receive nothing', async ({ browser }) => {
  const t = await startTeacher(browser);
  // a real ticket issued to student 1's connection, stolen and replayed from another connection
  const stolen = (await backend.post({ action: 'joinIssue', studentId: 'avi', pin: '1111', classId: 'et', room: t.room, peerId: 'avi-real-peer-1' })).body.token;
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); await page.goto(BASE + '/blank.html');
  const attempts = [['no ticket', undefined], ['invented ticket', 'ab'.repeat(32)], ['stolen ticket', stolen], ['malformed ticket', 'zzz']];
  for (const [label, ticket] of attempts) {
    const outcome = await page.evaluate(({ room, ticket }) => new Promise(resolve => {
      const peer = new Peer(); const received = []; let closed = false;
      peer.on('open', () => {
        const c = peer.connect(room, { reliable: true });
        c.on('data', m => received.push(m && m.type)); c.on('close', () => { closed = true; });
        c.on('open', () => c.send({ type: 'join', name: 'Intruder', studentId: 'benny', ticket }));
        setTimeout(() => { resolve({ received, closed }); try { peer.destroy(); } catch { /* done */ } }, 4000);
      });
      peer.on('error', e => resolve({ received, closed, error: e.type }));
    }), { room: t.room, ticket });
    expect(outcome.received, label + ' must receive nothing').toEqual([]);
    expect(outcome.closed || !!outcome.error, label + ' connection must be closed').toBe(true);
    expect(await roster(t.page), label + ' must not be on the roster').not.toContain('Intruder');
  }
  expect(await roster(t.page)).not.toContain('admitted');
  await context.close(); await t.context.close();
});

test('students with a wrong passcode, from another class, or without sign-in cannot join (ET/WT isolation)', async ({ browser }) => {
  const t = await startTeacher(browser);
  const bad = await joinStudent(browser, t.room, { ...AVI, pin: '9999' });
  const wt = await joinStudent(browser, t.room, { id: 'wes', name: 'Wes', pin: '3333', classId: 'wt' }, 'et');        // WT student pointing at the ET room
  const wt2 = await joinStudent(browser, t.room, { id: 'wes', name: 'Wes', pin: '3333', classId: 'wt' });
  const none = await joinStudent(browser, t.room, { id: '', name: 'Nobody', pin: '', classId: '' });
  await t.page.waitForTimeout(8000);
  expect(await roster(t.page)).not.toContain('admitted');
  expect(backend.log.filter(l => l.action === 'joinIssue').some(l => l.status === 401)).toBe(true);
  expect(backend.log.filter(l => l.action === 'joinIssue').some(l => l.status === 403)).toBe(true);
  for (const s of [bad, wt, wt2, none]) await s.context.close();
  await t.context.close();
});

test('screen sharing still reaches an admitted student', async ({ browser }) => {
  const t = await startTeacher(browser);
  const s = await joinStudent(browser, t.room, AVI);
  await expect.poll(() => roster(t.page), { timeout: 25000 }).toContain('Avi Synthetic — admitted');
  await expect(t.page.locator('#shareScreen')).toBeEnabled({ timeout: 10000 });
  await t.page.evaluate(() => document.getElementById('shareScreen').click());
  await expect.poll(() => s.page.evaluate(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0)), { timeout: 30000 }).toBe(true);
  await s.context.close(); await t.context.close();
});

test('reconnecting asks for a fresh ticket; a removed student cannot rejoin and is dropped by the minute check', async ({ browser }) => {
  const t = await startTeacher(browser);
  let s = await joinStudent(browser, t.room, AVI);
  await expect.poll(() => roster(t.page), { timeout: 25000 }).toContain('Avi Synthetic — admitted');
  const issuedBefore = backend.log.filter(l => l.action === 'joinIssue').length;
  await s.page.reload();                                                    // new connection id
  await expect.poll(() => backend.log.filter(l => l.action === 'joinIssue').length, { timeout: 20000 }).toBeGreaterThan(issuedBefore);
  await expect.poll(() => t.page.locator('#roster .roster-row').count(), { timeout: 25000 }).toBe(1); // the old connection is replaced, not duplicated
  expect(await roster(t.page)).toContain('Avi Synthetic — admitted');
  // revoke: the class removes the student; the teacher page's minute check disconnects them
  backend.rows.get('b3Games/workspaces/b3-2026/classes/et').members.avi.active = false;
  backend.rows.set('b3Games/workspaces/b3-2026/classes/et/members/avi', { active: false });
  await expect.poll(() => roster(t.page), { timeout: 90000, intervals: [2000] }).not.toContain('Avi Synthetic');
  await s.page.reload();
  await s.page.waitForTimeout(6000);
  expect(await roster(t.page)).not.toContain('Avi Synthetic');
  await s.context.close(); await t.context.close();
});
