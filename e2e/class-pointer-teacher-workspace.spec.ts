import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Real Classroom Pointer teacher page with synthetic, local-only services:
// no Firebase, no real students, no network. A stand-in PeerJS object opens the
// classroom immediately so the teacher workspace can be exercised in CI.
const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://pointer-ui.test';
const SHARE_API = 'https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth';
const STUDENT_API = 'https://us-central1-b3-games.cloudfunctions.net/funTorahStudentAuth';
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
// Classroom Pointer is used in Chrome/Edge; the native resize corner and screen capture are Chromium behaviour.
test.skip(({ browserName }) => browserName !== 'chromium', 'Classroom Pointer teacher workspace runs in Chrome/Edge');

const shot = async (page: Page, name: string) => { if (process.env.POINTER_SHOTS) await page.screenshot({ path: path.join(process.env.POINTER_SHOTS, name + '.png') }); };
const STUB_EMPTY = ['teacher-tool-gate.js', 'site-settings.js', 'dashboard-session.js', 'firebase-config.js', 'guest-mode.js'];

async function wire(context: BrowserContext, opts: { student?: any; session?: any; realSession?: boolean } = {}) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === BASE) {
      const p = decodeURIComponent(url.pathname);
      if (p === '/activity-test.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><main>Synthetic activity</main><script defer src="/class-pointer-prototype/activity-share.js"></script></body></html>' });
      if (STUB_EMPTY.some(n => p.endsWith('/' + n)) && !(opts.realSession && p.endsWith('/dashboard-session.js'))) return route.fulfill({ contentType: 'text/javascript', body: '' });
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    }
    if (url.hostname === 'www.gstatic.com') return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (url.href.startsWith(SHARE_API) || url.href.startsWith(STUDENT_API)) return route.fallback();
    return route.abort();
  });
  await context.addInitScript(({ student, session, realSession }) => {
    // Stand-in PeerJS: opens at once, never contacts a signaling server.
    class FakePeer {
      id: string; handlers: Record<string, Function[]> = {}; open = false; destroyed = false; disconnected = false;
      constructor(id?: string) { this.id = typeof id === 'string' ? id : 'class-pointer-' + crypto.randomUUID(); setTimeout(() => { this.open = true; this.emit('open', this.id); }, 20); }
      on(e: string, f: Function) { (this.handlers[e] ||= []).push(f); return this; }
      once(e: string, f: Function) { const w = (...a: any[]) => { this.off(e, w); f(...a); }; return this.on(e, w); }
      off(e: string, f: Function) { this.handlers[e] = (this.handlers[e] || []).filter(x => x !== f); return this; }
      emit(e: string, ...a: any[]) { (this.handlers[e] || []).slice().forEach(f => f(...a)); }
      destroy() { this.destroyed = true; this.emit('close'); }
      disconnect() {} reconnect() {}
      connect() { return null; } call() { return null; }
    }
    Object.defineProperty(window, 'Peer', { configurable: true, get: () => FakePeer, set: () => {} });
    const noop = () => {};
    const ref = (p: string): any => ({
      child: (c: string) => ref(p + '/' + c), set: async () => {}, update: async () => {}, remove: async () => {}, off: noop,
      once: async () => ({ val: () => (/\/classes\/pointer_test$/.test(p) ? { name: 'Pointer Test', active: true, toolGrants: { 'class-pointer': true }, members: {} } : null) }), onDisconnect: () => ({ remove: async () => {}, set: async () => {}, cancel: async () => {} }),
      on: (_e: string, cb: Function) => { if (session && p.includes('/classPointerSessions')) { (window as any).__sessionCallback = cb; setTimeout(() => cb({ val: () => ({ [session.roomId]: session }) }), 0); } },
    });
    // One shared sign-in per browser profile, like Firebase: tests can switch it to simulate another tab signing in.
    const authListeners: Function[] = [];
    const auth = { currentUser: { uid: 'synthetic-teacher', getIdToken: async () => 'synthetic-teacher' } as any, onAuthStateChanged: (cb: Function) => { authListeners.push(cb); cb(auth.currentUser); return noop; } };
    (window as any).__switchAccount = (uid: string | null) => { auth.currentUser = uid ? { uid, getIdToken: async () => uid } : null; authListeners.forEach(cb => cb(auth.currentUser)); };
    (window as any).__writes = [];
    const writeLog = (op: string, p: string, v?: any) => (window as any).__writes.push({ op, p, v, uid: auth.currentUser?.uid || null });
    (window as any).firebase = { apps: [{}], initializeApp: noop, auth: () => auth, database: Object.assign(() => ({ ref: (p: string) => { const r = ref(p); return { ...r, child: (c: string) => (window as any).firebase.database().ref(p + '/' + c), set: async (v: any) => writeLog('set', p, v), update: async (v: any) => writeLog('update', p, v), remove: async () => writeLog('remove', p) }; } }), { ServerValue: { TIMESTAMP: 0 } }), storage: () => ({ ref }) };
    (window as any).B3_FIREBASE_CONFIG = {}; (window as any).B3_APP_CONTEXT = { workspaceId: 'b3-2026' };
    (window as any).B3SiteSettings = { onAuthStateChanged: realSession ? (cb: Function) => setTimeout(() => cb({ uid: 'synthetic-teacher' }, true, { authorized: true, role: 'teacher', classIds: ['pointer_test'] }), 0) : noop,
      signInWithGoogle: async () => { (window as any).__switchAccount('synthetic-teacher'); } };
    (window as any).FunTorahStudentClass = { resolve: async () => ({ workspaceId: 'b3-2026', classId: 'pointer_test' }) };
    if (!student && !realSession) {
      (window as any).ClassPointerDashboard = {
        ready: Promise.resolve({}),
        students: async () => [{ id: 'pt1', name: 'Pointer Test Student One' }, { id: 'pt2', name: 'Pointer Test Student Two' }],
        updateActivityPermissions: async () => {}, publish: async () => {}, requestScreenSharing: async () => {},
        requestStudentDestination: async () => {}, setStudentScreenSharing: async () => {}, end: async () => {},
      };
    } else if (student) {
      sessionStorage.setItem('b3Games_studentId', student.id); sessionStorage.setItem('b3Games_classPin', student.pin);
      (window as any).__displayMediaCalls = 0;
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
        (window as any).__displayMediaCalls++;
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
        const stream = canvas.captureStream(5); const track = stream.getVideoTracks()[0];
        const settings = track.getSettings.bind(track); (track as any).getSettings = () => ({ ...settings(), displaySurface: 'monitor' });
        return stream;
      } });
    }
  }, { student: opts.student || null, session: opts.session || null, realSession: !!opts.realSession });
}

async function openTeacher(page: Page) {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(BASE + '/class-pointer-prototype/classroom.html?dashboard=teacher&class=pointer_test');
  await expect.poll(() => page.evaluate(() => (document.getElementById('joinLink') as HTMLInputElement | null)?.value || ''), { timeout: 20000 }).toContain('room=');
  return errors;
}
async function enterFullScreen(page: Page) {
  await page.evaluate(() => (document.getElementById('fullScreenLesson') as HTMLButtonElement).click());
  await expect(page.locator('#stage')).toHaveClass(/lesson-fullscreen/);
}

// Commit 58095c86 ("Compact Students panel") replaced the large resizable drawer with a compact
// 300px popover (resize:none). It must still float over the lesson and be draggable by its heading.
test('full-screen Students panel is a compact popover that can be dragged by its heading', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await enterFullScreen(page);
  await page.locator('#tbStudentsBtn').click();
  const drawer = page.locator('#stage .cp-permissions-sidebar.cp-drawer-overlay.cp-overlay-open');
  await expect(drawer).toBeVisible();
  const before = (await drawer.boundingBox())!;
  expect(Math.round(before.width)).toBe(300);
  expect(before.height).toBeGreaterThanOrEqual(150);
  expect(await drawer.evaluate((el: HTMLElement) => getComputedStyle(el).resize)).toBe('none');

  const head = drawer.locator('.cp-drawer-head');
  const h = (await head.boundingBox())!;
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 260, h.y + 90, { steps: 8 });
  await page.mouse.up();
  const moved = (await drawer.boundingBox())!;
  await shot(page, 'drawer-moved');
  expect(moved.x).toBeGreaterThan(before.x + 200);
  expect(moved.y).toBeGreaterThan(before.y + 50);

  expect(Math.round(moved.width)).toBe(Math.round(before.width));
  // Inline sizes (the drawer's own layout code) must still win over the compact stylesheet.
  await drawer.evaluate((el: HTMLElement) => { el.style.width = '420px'; el.style.height = '300px'; });
  expect(Math.round((await drawer.boundingBox())!.width)).toBe(420);

  // Permission rows still work inside the moved panel and leaving full screen restores the normal layout.
  await expect(drawer.getByText('Pointer Test Student One').first()).toBeVisible();
  await page.evaluate(() => (document.getElementById('tbFullscreen') as HTMLButtonElement).click());
  await expect(page.locator('#stage')).not.toHaveClass(/lesson-fullscreen/);
  const restored = await page.locator('.cp-permissions-sidebar').evaluate((el: HTMLElement) => ['left', 'top', 'width', 'height'].map(k => el.style.getPropertyValue(k)).join(''));
  expect(restored).toBe('');
  expect(errors).toEqual([]);
  await context.close();
});

test('full-screen Present controls are large, labelled and open clear choices', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await enterFullScreen(page);
  const present = page.locator('#stage .teacher-dock [data-menu="tbShareMenu"]');
  await expect(present).toBeVisible();
  const box = (await present.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  const docked = await page.locator('#teacherDock').evaluate(el => el.classList.contains('dock-left'));
  if (docked) expect(await present.evaluate(el => getComputedStyle(el, '::after').content)).toContain('Present');
  else expect(await present.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(15);
  await present.click();
  const menu = page.locator('#tbShareMenu');
  await expect(menu).toBeVisible();
  await shot(page, 'present-menu');
  const rows = menu.locator('button[data-source]');
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
  for (const row of await rows.all()) {
    if (!(await row.isVisible())) continue;
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    expect(await row.evaluate(el => getComputedStyle(el, '::before').content)).not.toBe('none');
  }
  await menu.getByRole('button', { name: 'Show a whiteboard' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).ClassPointerPdf.isOpen())).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

async function inkCount(page: Page) { return page.locator('#pdfInk path').count(); }
async function boardPixel(page: Page, fx: number, fy: number) {
  return page.evaluate(async ({ fx, fy }) => {
    const frame = document.querySelector('#pdfContent iframe.lesson-webpage') as HTMLIFrameElement;
    const img = frame.contentDocument!.querySelector('img') as HTMLImageElement;
    if (!img.complete) await new Promise(r => { img.onload = r; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
    return [...x.getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data].slice(0, 3);
  }, { fx, fy });
}
async function pasteRedPicture(page: Page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 200;
    const x = c.getContext('2d')!; x.fillStyle = '#e11d48'; x.fillRect(0, 0, 400, 200);
    const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
}

test('teacher pastes a screenshot onto the shared whiteboard, moves, resizes and annotates it', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await page.evaluate(() => (document.getElementById('openWhiteboard') as HTMLButtonElement).click());
  await expect.poll(() => page.evaluate(() => (window as any).ClassPointerPdf.isOpen())).toBe(true);
  await expect(page.locator('#pdfContent iframe.lesson-webpage')).toHaveCount(1);
  expect(Math.min(...await boardPixel(page, 0.5, 0.5))).toBeGreaterThan(245);

  // An existing pen mark must survive adding pictures.
  const content = (await page.locator('#pdfContent').boundingBox())!;
  await page.mouse.move(content.x + 40, content.y + 40); await page.mouse.down();
  await page.mouse.move(content.x + 160, content.y + 60, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => inkCount(page)).toBeGreaterThan(0);
  const marks = await inkCount(page);

  await pasteRedPicture(page);
  const picture = page.locator('#pdfContent .board-picture-edit');
  await expect(picture).toBeVisible();
  await expect(page.getByRole('button', { name: '✓ Show to class' })).toBeVisible();
  const p0 = (await picture.boundingBox())!;

  // Move.
  await page.mouse.move(p0.x + p0.width / 2, p0.y + p0.height / 2); await page.mouse.down();
  await page.mouse.move(p0.x + p0.width / 2 - 150, p0.y + p0.height / 2 + 40, { steps: 8 }); await page.mouse.up();
  const p1 = (await picture.boundingBox())!;
  expect(p1.x).toBeLessThan(p0.x - 120);
  // Resize from the bottom-right corner; the picture keeps its shape.
  const se = (await picture.locator('.board-picture-handle.se').boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2); await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2 + 100, se.y + se.height / 2 + 100, { steps: 8 }); await page.mouse.up();
  const p2 = (await picture.boundingBox())!;
  await shot(page, 'paste-editing');
  expect(p2.width).toBeGreaterThan(p1.width + 60);
  expect(Math.abs(p2.width / p2.height - p1.width / p1.height)).toBeLessThan(0.05);

  // Students only receive it once the teacher places it.
  expect(Math.min(...await boardPixel(page, (p2.x + p2.width / 2 - content.x) / content.width, (p2.y + p2.height / 2 - content.y) / content.height))).toBeGreaterThan(245);
  await page.getByRole('button', { name: '✓ Show to class' }).click();
  await expect(picture).toHaveCount(0);
  await expect.poll(async () => {
    const box = (await page.locator('#pdfContent').boundingBox())!;
    const [r, g, b] = await boardPixel(page, (p2.x + p2.width / 2 - box.x) / box.width, (p2.y + p2.height / 2 - box.y) / box.height);
    return r > 180 && g < 90 && b < 120;
  }).toBe(true);
  expect(await inkCount(page)).toBe(marks);

  // Annotate on top of the picture with the pen.
  await page.mouse.move(p2.x + 10, p2.y + 10); await page.mouse.down();
  await page.mouse.move(p2.x + p2.width - 10, p2.y + p2.height - 10, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => inkCount(page)).toBeGreaterThan(marks);
  await shot(page, 'paste-annotated');

  // Placed pictures can be moved again later.
  await page.getByRole('button', { name: '🖼 Move pictures' }).click();
  await expect(picture).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(picture).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).ClassPointerPdf.boardPictureCount())).toBe(1);

  // Closing the whiteboard discards its pictures.
  await page.getByRole('button', { name: /Close whiteboard/ }).click();
  expect(await page.evaluate(() => (window as any).ClassPointerPdf.boardPictureCount())).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('pasting outside the whiteboard does not add pictures', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await pasteRedPicture(page);
  await expect(page.locator('.board-picture-edit')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

// ---- Student starts sharing once the teacher has enabled screen sharing (no separate request) ----
async function studentActivity(browser: any, issue: (body: any) => { status: number; body: any }) {
  const room = 'class-pointer-' + '1234abcd-1234-4abc-8abc-1234567890ab';
  const session = { roomId: room, createdAt: Date.now(), teacherUid: 'synthetic-teacher', studentScreenSharing: true };
  const context = await browser.newContext(); const calls: string[] = [];
  await wire(context, { student: { id: 'pointer_test_student_1', pin: 'synthetic' }, session });
  await context.route(STUDENT_API, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true }) }));
  await context.route(SHARE_API, route => {
    const body = JSON.parse(route.request().postData() || '{}'); calls.push(body.action);
    const result = body.action === 'issue' ? issue(body) : { status: 403, body: { ok: false, error: 'There is no active student activity request.' } };
    return route.fulfill({ status: result.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result.body) });
  });
  const page = await context.newPage();
  await page.goto(BASE + '/activity-test.html');
  return { context, page, calls };
}

test('a permitted student can start sharing himself once the teacher enables screen sharing', async ({ browser }) => {
  const s = await studentActivity(browser, () => ({ status: 200, body: { ok: true, token: 'synthetic-token' } }));
  const share = s.page.locator('#fttActivityScreenShare button', { hasText: 'Share My Screen' });
  await expect(share).toBeVisible({ timeout: 15000 });
  await expect(s.page.getByRole('dialog', { name: 'Teacher screen sharing request' })).toBeHidden();
  // His own permission is checked first; the sharing service now in use answers "no request" and the
  // button still appears (the service refuses a turned-off student when he shares).
  expect(s.calls).toContain('permissions');
  await share.click();
  await expect.poll(() => s.page.evaluate(() => (window as any).__displayMediaCalls)).toBe(1);
  await expect.poll(() => s.calls.includes('issue')).toBe(true);
  await s.context.close();
});

test('a student the teacher turned off is refused by the sharing service and the button disappears', async ({ browser }) => {
  const s = await studentActivity(browser, () => ({ status: 403, body: { ok: false, error: 'Your teacher has turned off your screen sharing.' } }));
  const share = s.page.locator('#fttActivityScreenShare button', { hasText: 'Share My Screen' });
  await expect(share).toBeVisible({ timeout: 15000 });
  await share.click();
  await expect(share).toBeHidden();
  await expect(s.page.locator('#fttActivityScreenShare [role="status"]')).toHaveText(/turned off your screen sharing/);
  await s.context.close();
});

// ---------- Live-testing fixes ----------
async function fakeScreenCall(page: Page, token: string) {
  return page.evaluate(async (token) => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = token[0] === 'a' ? '#16a34a' : '#dc2626'; ctx.fillRect(0, 0, 640, 360);
    const stream = canvas.captureStream(5); const listeners: Record<string, Function> = {};
    const call: any = { metadata: { kind: 'activity-screen', token }, closed: false, on: (e: string, f: Function) => { listeners[e] = f; },
      answer() { setTimeout(() => listeners.stream?.(stream), 10); }, close() { if (this.closed) return; this.closed = true; listeners.close?.(); } };
    (window as any).__calls = [...((window as any).__calls || []), call];
    await (window as any).ClassPointerActivityShares.incomingCall(call);
    return (window as any).__calls.length - 1;
  }, token);
}
test('one student sharing from two tabs gets one tile; a tile enlarges and returns to the gallery without disconnecting', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  // Server verification: the token decides the student (a… = Avi, b… = Benny).
  await context.route(SHARE_API, route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const avi = String(body.token)[0] === 'a';
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, studentId: avi ? 'pt1' : 'pt2', studentName: avi ? 'Pointer Test Student One' : 'Pointer Test Student Two' }) });
  });
  const page = await context.newPage(); const errors = await openTeacher(page);
  const first = await fakeScreenCall(page, 'a'.repeat(64)), second = await fakeScreenCall(page, 'a'.repeat(63) + 'b');
  await fakeScreenCall(page, 'b'.repeat(64));
  const tiles = page.locator('#activityScreenTray .cp-activity-screen');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0).locator('strong')).toHaveText('Pointer Test Student One · Live screen');
  await expect(tiles.nth(1).locator('strong')).toHaveText('Pointer Test Student Two · Live screen');
  // His second tab stops sharing: his tile stays, showing the tab that is still sharing.
  await page.evaluate((i) => (window as any).__calls[i].close(), second);
  await expect(tiles).toHaveCount(2);
  await expect.poll(() => tiles.nth(0).locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640);
  expect(await page.evaluate((i) => (window as any).__calls[i].closed, first)).toBe(false);
  // Click the screen: it fills most of the lesson area, keeping its shape.
  await tiles.nth(0).locator('video').click();
  const stage = (await page.locator('#stage').boundingBox())!, big = (await tiles.nth(0).locator('video').boundingBox())!;
  expect(big.width * big.height).toBeGreaterThan(stage.width * stage.height * 0.6);
  expect(await tiles.nth(0).locator('video').evaluate((v: HTMLVideoElement) => getComputedStyle(v).objectFit)).toBe('contain');
  await expect(tiles.nth(1)).toBeHidden();
  await shot(page, 'screen-enlarged');
  await page.getByRole('button', { name: '◀ Back to gallery' }).click();
  await expect(tiles.nth(1)).toBeVisible();
  expect((await tiles.nth(0).locator('video').boundingBox())!.width).toBeLessThan(big.width / 2);
  // Nothing was disconnected by enlarging or going back.
  expect(await page.evaluate(() => (window as any).__calls.filter((c: any) => c.closed).length)).toBe(1);
  expect(errors).toEqual([]);
  await context.close();
});

test('a changed teacher sign-in is detected, nothing is written under the wrong account, and signing in again resumes', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context, { realSession: true });
  const page = await context.newPage(); const errors = await openTeacher(page);
  await expect.poll(() => page.evaluate(() => (window as any).__writes.some((w: any) => w.op === 'set' && /classPointerSessions/.test(w.p)))).toBe(true);
  await page.evaluate(()=> (document.getElementById('openWhiteboard') as HTMLButtonElement).click());
  await expect.poll(()=>page.evaluate(()=>!!(window as any).ClassPointerPdf.presentationStream()?.active)).toBe(true);
  await page.evaluate(()=>{(window as any).__logoutStream=(window as any).ClassPointerPdf.presentationStream()});
  // Another tab of the same browser signs in a student: this tab's shared sign-in changes.
  await page.evaluate(() => (window as any).__switchAccount('student-pt1'));
  const banner = page.locator('#cpTeacherSignInBanner');
  await expect(banner).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__logoutStream.getVideoTracks()[0].readyState)).toBe('ended');
  await expect(page.locator('#shareScreen')).toBeDisabled();
  await expect(banner).toContainText('Sign in again as the teacher');
  const before = await page.evaluate(() => (window as any).__writes.length);
  const result = await page.evaluate(() => (window as any).ClassPointerDashboard.setStudentScreenSharing(true).then(() => 'written', (e: Error) => e.message));
  expect(result).toContain('Sign in again as the teacher');
  expect(await page.evaluate(() => (window as any).__writes.length)).toBe(before);
  expect(await page.evaluate(() => (window as any).__writes.filter((w: any) => w.uid !== 'synthetic-teacher').length)).toBe(0);
  await shot(page, 'teacher-signin-banner');
  // Sign in again as the same teacher: the banner goes away and changes work again.
  await banner.getByRole('button', { name: 'Sign in again as teacher' }).click();
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => (window as any).ClassPointerDashboard.setStudentScreenSharing(true).then(() => 'written', (e: Error) => e.message))).toBe('written');
  expect(errors).toEqual([]);
  await context.close();
});

test('the Share button disappears for a student as soon as the teacher turns him off', async ({ browser }) => {
  const room = 'class-pointer-' + '1234abcd-1234-4abc-8abc-1234567890ab';
  let denied = false;
  const session = { roomId: room, createdAt: Date.now(), teacherUid: 'synthetic-teacher', studentScreenSharing: true, permissionRevision: 1 };
  const context = await browser.newContext();
  await wire(context, { student: { id: 'pt1', pin: 'synthetic' }, session });
  await context.route(STUDENT_API, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true }) }));
  await context.route(SHARE_API, route => {
    const body = JSON.parse(route.request().postData() || '{}');
    // Updated sharing service: answers a student's own permission once sharing is enabled.
    const result = body.action === 'permissions' ? { ok: true, screenSharingDenied: denied } : { ok: false, error: 'not in this test' };
    return route.fulfill({ status: result.ok ? 200 : 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result) });
  });
  const page = await context.newPage();
  await page.goto(BASE + '/activity-test.html');
  const share = page.locator('#fttActivityScreenShare button', { hasText: 'Share My Screen' });
  await expect(share).toBeVisible({ timeout: 15000 });
  denied = true;
  await page.evaluate((s) => (window as any).__sessionCallback({ val: () => ({ [s.roomId]: { ...s, permissionRevision: 2 } }) }), session);
  await expect(share).toBeHidden();
  expect(await page.evaluate(() => (window as any).__displayMediaCalls)).toBe(0);
  await context.close();
});

test('My Screen whiteboard supplies live frames with published pictures and pen while switching modes preserves board work', async ({ browser }) => {
  const context=await browser.newContext();await wire(context);const page=await context.newPage();const errors=await openTeacher(page);
  await page.evaluate(()=> (document.getElementById('openWhiteboard') as HTMLButtonElement).click());
  await expect.poll(()=>page.evaluate(()=>!!(window as any).ClassPointerPdf.presentationStream()?.active)).toBe(true);
  await page.evaluate(async()=>{const video=document.createElement('video');video.id='testPresentation';video.muted=true;video.srcObject=(window as any).ClassPointerPdf.presentationStream();document.body.append(video);await video.play()});
  await expect.poll(()=>page.locator('#testPresentation').evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBeGreaterThan(0);
  await pasteRedPicture(page);await page.getByRole('button',{name:'✓ Show to class'}).click();
  // Sample every pixel from the actual video, rather than only inspecting source canvas state.
  await expect.poll(()=>page.locator('#testPresentation').evaluate((v:HTMLVideoElement)=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d')!;ctx.drawImage(v,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]<90&&pixels[i+2]<120)red++;return red})).toBeGreaterThan(100);
  const box=(await page.locator('#pdfContent').boundingBox())!;await page.mouse.move(box.x+40,box.y+40);await page.mouse.down();await page.mouse.move(box.x+180,box.y+70,{steps:8});await page.mouse.up();await expect.poll(()=>inkCount(page)).toBeGreaterThan(0);const marks=await inkCount(page);
  await page.getByRole('button',{name:'Student screens',exact:true}).click();await page.getByRole('button',{name:'My screen',exact:true}).click();
  expect(await inkCount(page)).toBe(marks);expect(await page.evaluate(()=>(window as any).ClassPointerPdf.boardPictureCount())).toBe(1);
  await page.evaluate(()=>{(window as any).__testBoardStream=(window as any).ClassPointerPdf.presentationStream();(window as any).ClassPointerPdf.close(true)});
  expect(await page.evaluate(()=>(window as any).__testBoardStream.getVideoTracks()[0].readyState)).toBe('ended');expect(errors).toEqual([]);await context.close();
});

test('Follow Teacher launch opens the shared whiteboard automatically without capture or another window', async ({browser})=>{
  const context=await browser.newContext();await wire(context);
  await context.addInitScript(()=>{
    (window as any).__captureCalls=0;
    navigator.mediaDevices.getDisplayMedia=async()=>{(window as any).__captureCalls++;throw Error('Capture requires a teacher click')};
  });
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/class-pointer-prototype/classroom.html?dashboard=teacher&class=pointer_test&followTeacherWhiteboard=1');
  await expect(page.locator('#pdfView')).toBeVisible({timeout:20000});
  await expect(page.getByRole('button',{name:/Close whiteboard/})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__captureCalls)).toBe(0);
  expect(context.pages()).toHaveLength(1);expect(errors).toEqual([]);
  await context.close();
});

test('embedded Follow Teacher workspace keeps the parent-selected class authoritative',async({browser})=>{
  const context=await browser.newContext();await wire(context,{realSession:true});
  await context.route(BASE+'/follow-frame-test.html',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><iframe id="followFrame" title="Teacher workspace" allow="display-capture" style="width:100%;height:900px" src="/class-pointer-prototype/classroom.html?dashboard=teacher&class=pointer_test&followTeacherWhiteboard=1"></iframe>'}));
  const page=await context.newPage();await page.goto(BASE+'/follow-frame-test.html');
  const frame=page.frameLocator('#followFrame');
  await expect(frame.locator('#pointerClassChoice')).toBeDisabled();
  await expect(frame.locator('#pointerClassChoice')).toHaveValue('pointer_test');
  await expect(frame.locator('#pdfView')).toBeVisible({timeout:20000});
  expect(context.pages()).toHaveLength(1);await context.close();
});

test('Stop sharing stays on the Live bar on every tab and ends the share from one click or Chrome\'s own bar', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  await context.addInitScript(() => {
    (window as any).__tracks = [];
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
      const stream = canvas.captureStream(5); const track = stream.getVideoTracks()[0];
      const settings = track.getSettings.bind(track); (track as any).getSettings = () => ({ ...settings(), displaySurface: 'monitor' });
      (window as any).__tracks.push(track);
      return stream;
    } });
  });
  const page = await context.newPage(); const errors = await openTeacher(page);
  const stop = page.locator('.cp-live-wrap > .cp-stop-btn');
  const stopScreen = page.locator('#stopScreen');
  const share = async () => { await page.evaluate(() => (document.getElementById('shareScreen') as HTMLButtonElement).click()); await expect(stopScreen).toBeEnabled(); };
  const tab = (name: string) => page.getByRole('button', { name, exact: true }).click();

  await share();
  await expect(stop).toBeVisible(); await expect(stop).toContainText('Stop sharing my screen');
  expect(await stop.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(220, 38, 38)');
  await shot(page, 'stop-my-screen');
  for (const name of ['Student screens', 'Student whiteboards']) {
    await tab(name);
    await expect(stop).toBeVisible(); await expect(page.locator('.cp-live-wrap')).toBeVisible();
    await shot(page, 'stop-' + name.replace(/\s/g, '-'));
  }
  await tab('My screen');

  // One click on Stop ends the share from any tab.
  await tab('Student whiteboards');
  await stop.click();
  await expect(stopScreen).toBeDisabled(); await expect(stop).toBeHidden();
  await tab('My screen');
  await expect(page.locator('#placeholder')).not.toHaveAttribute('hidden'); await expect(page.locator('#cpSourcePicker')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);

  // Chrome's own "Stop sharing" bar fires 'ended' on the captured track.
  await share(); await expect(stop).toBeVisible();
  await page.evaluate(() => (window as any).__tracks.at(-1).dispatchEvent(new Event('ended')));
  await expect(stopScreen).toBeDisabled(); await expect(stop).toBeHidden();
  await expect(page.locator('#placeholder')).not.toHaveAttribute('hidden'); await expect(page.locator('#cpSourcePicker')).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
