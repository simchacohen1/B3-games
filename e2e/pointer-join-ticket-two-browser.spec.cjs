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
const STUDENT_API = 'https://us-central1-b3-games.cloudfunctions.net/funTorahStudentAuth';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = 9319;
const STUB_EMPTY = ['teacher-tool-gate.js', 'site-settings.js', 'dashboard-session.js', 'firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js', 'firebase-storage-compat.js'];

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
  return { rows, post, log, publishSession(room, classId = 'et', teacherUid = 'teacher-et') { rows.set('b3Games/workspaces/b3-2026/classes/' + classId + '/classPointerSessions/' + room, { roomId: room, createdAt: Date.now(), teacherUid }); }, publishActivityRequest(room, shareRequestAt = Date.now(), classId = 'et', teacherUid = 'teacher-et') { const session = { roomId: room, createdAt: Date.now(), teacherUid, studentScreenSharing: true, shareRequest: { at: shareRequestAt } }; rows.set('b3Games/workspaces/b3-2026/classes/' + classId + '/classPointerSessions/' + room, session); return session; } };
}

test.beforeAll(async () => {
  test.skip(!process.env.PEER_MODULE, 'set PEER_MODULE to an installed `peer` package folder to run the real-browser test');
  const { PeerServer } = require(process.env.PEER_MODULE);
  if (!process.env.PEER_EXTERNAL) peerServer = PeerServer({ port: PORT, path: '/', allow_discovery: false });
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
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main id="stage"></main>' + firebaseTags + '<script src="/class-pointer-prototype/vendor/peerjs-1.5.5.min.js"></script><script defer src="/class-pointer-prototype/activity-share.js"></script></body></html>' });
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
    let RealPeer; Object.defineProperty(window, 'Peer', { configurable: true, get() { return RealPeer && function (id, opts) { return new RealPeer(id, { host: 'localhost', port, secure: false, ...(opts || {}) }); }; }, set(v) { RealPeer = v; } });
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
  }, { port: PORT, token, student, extra, session, realFirebase });
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

test('activity-page screen sharing reaches the teacher over real PeerJS and restarts cleanly', async ({ browser }) => {
  const t = await startTeacher(browser);
  let session = backend.publishActivityRequest(t.room);
  const sessionUrl = 'http://127.0.0.1:9009/b3Games/workspaces/b3-2026/classes/et/classPointerSessions/' + encodeURIComponent(t.room) + '.json?ns=demo-pointer-test';
  const writeSession = async value => {
    const response = await fetch(sessionUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    expect(response.ok, 'Firebase RTDB emulator session write').toBe(true);
  };
  await writeSession(session);
  const context = await browser.newContext();
  await wire(context, { student: AVI, extra: 'canvas', session, realFirebase: true });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('activity pageerror:', e.message));
  await page.goto(BASE + '/activity-test.html');
  await expect(page.getByRole('dialog', { name: 'Teacher screen sharing request' })).toBeVisible({ timeout: 20000 });

  for (let cycle = 0; cycle < 3; cycle++) {
    if (cycle > 0) {
      session = backend.publishActivityRequest(t.room, Date.now() + cycle);
      await writeSession(session);
      await expect(page.getByRole('dialog', { name: 'Teacher screen sharing request' })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Share My Screen' }).click();
    await expect.poll(() => t.page.locator('#activityScreenTray video').count(), { timeout: 30000 }).toBe(1);
    await expect.poll(() => t.page.locator('#activityScreenTray video').evaluate(v => v.videoWidth), { timeout: 15000 }).toBe(320);
    const firstPixel = await t.page.locator('#activityScreenTray video').evaluate(v => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; });
    await expect.poll(() => t.page.locator('#activityScreenTray video').evaluate(v => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; }), { timeout: 8000 }).not.toEqual(firstPixel);
    expect(backend.log.filter(l => l.action === 'verify' && l.status === 200).length).toBe(cycle + 1);
    if (cycle === 2) await t.page.evaluate(() => window.ClassPointerActivityShares.closeAll());
    else await page.locator('#fttActivityScreenShare button').first().click();
    await expect.poll(() => t.page.locator('#activityScreenTray video').count()).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__captureStreams.at(-1).getVideoTracks()[0].readyState)).toBe('ended');
  }
  expect(backend.log.filter(l => l.action === 'permissions' && l.status === 200)).toHaveLength(3);
  expect(backend.log.filter(l => l.action === 'issue' && l.status === 200)).toHaveLength(3);
  expect(backend.log.filter(l => l.status === 403), 'no Firebase authorization 403 responses').toHaveLength(0);
  await context.close(); await t.context.close();
});

// ---------- Live-testing fixes: one tile per student, background connection, quiet reconnects ----------
const rosterList = page => page.evaluate(() => window.ClassPointerRoster.list());
async function activityTab(context, label) {
  const page = await context.newPage();
  page.on('pageerror', e => console.log(label + ' pageerror:', e.message));
  await page.goto(BASE + '/activity-test.html');
  return page;
}
function enableSharing(room) {
  const session = { roomId: room, createdAt: Date.now(), teacherUid: 'teacher-et', studentScreenSharing: true };
  backend.rows.set('b3Games/workspaces/b3-2026/classes/et/classPointerSessions/' + room, session);
  return session;
}

test('a boy signed in on two tabs is listed once, shares into one tile, and closing one tab keeps the other', async ({ browser }) => {
  const t = await startTeacher(browser);
  const session = enableSharing(t.room);
  const context = await browser.newContext();
  await wire(context, { student: AVI, extra: 'canvas', session });
  const tabA = await activityTab(context, 'tabA'), tabB = await activityTab(context, 'tabB');
  // Both tabs connect in the background; the teacher lists him once, as joined.
  await expect.poll(async () => (await rosterList(t.page)).filter(r => r.studentId === 'avi').length, { timeout: 30000 }).toBe(1);
  expect((await rosterList(t.page)).find(r => r.studentId === 'avi')).toMatchObject({ admitted: true, presence: true, name: 'Avi Synthetic' });
  // Share from both tabs: still one tile, under his verified name.
  for (const tab of [tabA, tabB]) {
    const share = tab.locator('#fttActivityScreenShare button', { hasText: 'Share My Screen' });
    await expect(share).toBeVisible({ timeout: 20000 });
    await share.click();
    await expect.poll(() => tab.evaluate(() => document.querySelector('#fttActivityScreenShare button').textContent), { timeout: 30000 }).toContain('Stop Sharing');
  }
  await expect.poll(() => t.page.locator('#activityScreenTray .cp-activity-screen').count(), { timeout: 20000 }).toBe(1);
  await expect(t.page.locator('#activityScreenTray .cp-activity-screen strong')).toHaveText('Avi Synthetic · Live screen');
  await expect.poll(() => t.page.locator('#activityScreenTray video').evaluate(v => v.videoWidth), { timeout: 15000 }).toBe(320);
  // Tab B closes: his tile stays (tab A is still sharing) and he stays joined.
  await tabB.close();
  await t.page.waitForTimeout(4000);
  expect(await t.page.locator('#activityScreenTray .cp-activity-screen').count()).toBe(1);
  await expect.poll(() => t.page.locator('#activityScreenTray video').evaluate(v => v.videoWidth), { timeout: 15000 }).toBe(320);
  expect((await rosterList(t.page)).filter(r => r.studentId === 'avi').length).toBe(1);
  // Enlarge the real incoming video, then go back to the gallery without disconnecting.
  await t.page.locator('#activityScreenTray video').click();
  const stageBox = await t.page.locator('#stage').boundingBox(), big = await t.page.locator('#activityScreenTray video').boundingBox();
  expect(big.width * big.height).toBeGreaterThan(stageBox.width * stageBox.height * 0.5);
  await t.page.getByRole('button', { name: '◀ Back to gallery' }).click();
  const small = await t.page.locator('#activityScreenTray video').boundingBox();
  expect(small.width).toBeLessThan(big.width / 2);
  await expect.poll(() => t.page.locator('#activityScreenTray video').evaluate(v => v.videoWidth)).toBe(320);
  expect(await tabA.evaluate(() => document.querySelector('#fttActivityScreenShare button').textContent)).toContain('Stop Sharing');
  await context.close(); await t.context.close();
});

test('lesson page joins with no Join button, reconnects after an interruption, and a second tab is not called a removal', async ({ browser }) => {
  const t = await startTeacher(browser);
  const s = await joinStudent(browser, t.room, AVI);
  await expect.poll(() => roster(t.page), { timeout: 25000 }).toContain('Avi Synthetic — admitted');
  await expect(s.page.locator('#joinForm')).toBeHidden();
  await expect(s.page.locator('#joinClass')).toBeHidden();
  // The teacher side drops the connection (network blip): the student reconnects on his own.
  await t.page.evaluate(() => { for (const c of Object.values(window.__peerConnections || {})) c.close(); });
  await t.page.evaluate(() => window.ClassPointerBridge.members().forEach(m => m.connection.close()));
  await expect.poll(() => roster(t.page), { timeout: 30000 }).toContain('Avi Synthetic — admitted');
  await expect(s.page.locator('#error')).toBeHidden();
  // Same boy opens the lesson in a second tab: the first tab is told quietly, never "removed".
  const second = await s.context.newPage();
  await second.addInitScript(({ room, student }) => sessionStorage.setItem('classPointerDashboardJoin', JSON.stringify({ room, name: student.name, studentId: student.id, classId: student.classId, at: Date.now() })), { room: t.room, student: AVI });
  await second.goto(BASE + '/class-pointer-prototype/classroom.html?dashboard=student&room=' + encodeURIComponent(t.room));
  await expect.poll(() => s.page.locator('#connectionStatus').textContent(), { timeout: 30000 }).toContain('open in another tab');
  expect(await s.page.locator('#error').evaluate(e => e.hidden ? '' : e.textContent)).not.toContain('removed');
  await expect.poll(() => t.page.evaluate(() => window.ClassPointerRoster.list().filter(r => r.studentId === 'avi').length)).toBe(1);
  await second.close(); await s.context.close(); await t.context.close();
});

test('only a deliberate removal shows the removal message, it is not bypassed, and Allow back restores him', async ({ browser }) => {
  const t = await startTeacher(browser);
  const s = await joinStudent(browser, t.room, AVI);
  await expect.poll(() => roster(t.page), { timeout: 25000 }).toContain('Avi Synthetic — admitted');
  await t.page.evaluate(() => { const m = window.ClassPointerRoster.list().find(r => r.studentId === 'avi'); window.ClassPointerRoster.remove(m.id); });
  await expect(s.page.locator('#error')).toHaveText('Your teacher removed you from the class.', { timeout: 15000 });
  // Reloading or a background connection from an activity does not get him back in.
  await s.page.reload();
  await s.page.waitForTimeout(5000);
  expect(await roster(t.page)).not.toContain('Avi Synthetic');
  const context = await browser.newContext();
  await wire(context, { student: AVI, session: enableSharing(t.room) });
  const tab = await activityTab(context, 'removed-activity');
  await tab.waitForTimeout(8000);
  expect((await rosterList(t.page)).some(r => r.studentId === 'avi')).toBe(false);
  expect(await t.page.evaluate(() => window.ClassPointerRoster.removedIds())).toEqual(['avi']);
  // The teacher allows him back: his next connection is accepted.
  await t.page.evaluate(() => window.ClassPointerRoster.allowBack('avi'));
  const again = await joinStudent(browser, t.room, AVI);
  await expect.poll(() => roster(t.page), { timeout: 25000 }).toContain('Avi Synthetic — admitted');
  await again.context.close(); await context.close(); await s.context.close(); await t.context.close();
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
