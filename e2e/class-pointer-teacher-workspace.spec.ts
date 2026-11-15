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
const STUB_EMPTY = ['site-settings.js', 'dashboard-session.js', 'firebase-config.js', 'guest-mode.js'];

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
  // The old dock is gone (#770): the yellow Students button on the drawing toolbar opens the panel in full screen.
  await page.locator('#fttAnnotate [data-action="students"]').click();
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
  await page.mouse.move(h.x - 100, h.y + 90, { steps: 8 });
  await page.mouse.up();
  const moved = (await drawer.boundingBox())!;
  await shot(page, 'drawer-moved');
  expect(moved.x).toBeLessThan(before.x - 80);
  expect(moved.y).toBeGreaterThan(before.y + 50);

  expect(Math.round(moved.width)).toBe(Math.round(before.width));
  // Inline sizes (the drawer's own layout code) must still win over the compact stylesheet.
  await drawer.evaluate((el: HTMLElement) => { el.style.width = '420px'; el.style.height = '300px'; });
  expect(Math.round((await drawer.boundingBox())!.width)).toBe(420);

  // Permission rows still work inside the moved panel and leaving full screen restores the normal layout.
  await expect(drawer.getByText('Pointer Test Student One').first()).toBeVisible();
  await page.locator('#fttAnnotate [data-action="more"]').click();
  await page.locator('#fttAnnotate .fa-fly').getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.locator('#stage')).not.toHaveClass(/lesson-fullscreen/);
  const restored = await page.locator('.cp-permissions-sidebar').evaluate((el: HTMLElement) => ['left', 'top', 'width', 'height'].map(k => el.style.getPropertyValue(k)).join(''));
  expect(restored).toBe('');
  expect(errors).toEqual([]);
  await context.close();
});

test('full screen: the drawing toolbar is the only toolbar and its Lesson menu opens clear choices', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await enterFullScreen(page);
  // The old dock and its left rail are gone (#770).
  await expect(page.locator('.teacher-dock, #studentDock, #fullscreenTeacherToolbar')).toHaveCount(0);
  await expect(page.locator('#teacherDock')).toBeHidden();
  const bar = page.locator('#fttAnnotate .fa-bar');
  await expect(bar).toBeVisible();
  // The toolbar has its own strip: the lesson starts to the right of it.
  const barBox = (await bar.boundingBox())!;
  await expect.poll(async () => (await page.locator('#stage').boundingBox())!.x).toBeGreaterThanOrEqual(barBox.x + barBox.width);
  const lesson = bar.locator('[data-action="lesson"]');
  await expect(lesson).toContainText('Lesson');
  await lesson.click();
  const menu = page.locator('#fttAnnotate .fa-fly.fa-list');
  await expect(menu).toBeVisible();
  await shot(page, 'lesson-menu');
  const rows = menu.locator('button');
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
  for (const row of await rows.all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(38);
  await menu.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).ClassPointerPdf.isOpen())).toBe(true);
  // Live in full screen: the toolbar shows the red Stop, and the pen draws with the lesson's own tool.
  await expect(bar.locator('[data-action="stop"]')).toBeVisible();
  // Nothing from the page behind lies on top of the full-screen lesson: where the tabs and the red Stop sit on the page, the lesson is in front.
  expect(await page.evaluate(() => ['.cp-workspace-tabs', '#cpStopBtn'].map(sel => {
    const r = document.querySelector(sel)!.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.width > 0 && !!top && !!top.closest('#stage') && !top.closest('.cp-tabs-row');
  }))).toEqual([true, true]);
  await expect(bar.getByRole('button', { name: /^Pen:/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (document.getElementById('teacherTool') as HTMLSelectElement).value)).toBe('pen');
  await bar.locator('[data-action="stop"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).ClassPointerPdf.isOpen())).toBe(false);
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
// The drawing toolbar opens in its own strip on the left shortly after a lesson starts (#770): the lesson moves
// right and gets a little narrower, and the whiteboard opens on the pen. Positions measured before that are stale,
// so wait until the strip is there, the pen is chosen and the lesson has stopped moving.
async function whiteboardSettled(page: Page) {
  await expect(page.locator('body')).toHaveClass(/cp-tool-gutter/);
  await expect.poll(() => page.evaluate(() => (document.getElementById('teacherTool') as HTMLSelectElement).value)).toBe('pen');
  const bar = (await page.locator('#fttAnnotate .fa-bar').boundingBox())!;
  let last = '';
  await expect.poll(async () => {
    const box = (await page.locator('#pdfContent').boundingBox())!, now = JSON.stringify(box), still = now === last && box.x >= bar.x + bar.width;
    last = now; return still;
  }, { intervals: [200] }).toBe(true);
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
async function pasteWords(page: Page, text: string) {
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => [{ types: ['text/plain'], getType: async () => new Blob([value], { type: 'text/plain' }) }] } });
  }, text);
  await page.getByRole('button', { name: '📋 Paste', exact: true }).click();
}
// The teacher's own controls on this page: the "Shapes ▾" menu in the tool bar above the lesson.
// Works with the Shapes menu on the teacher tool bar, and with the single drawing toolbar (#821) once that is merged.
const NEW_TOOLBAR_SHAPE: Record<string, string> = { line: 'Line', 'pen-arrow': 'Arrow', rectangle: 'Rectangle', ellipse: 'Circle', triangle: 'Triangle' };
async function choosePenShape(page: Page, label: string, tool: string) {
  const menu = page.locator('#teacherDock').getByRole('button', { name: 'Shapes ▾' });
  if (await menu.count()) {
    await menu.click();
    await page.locator('#tbPenShapes').getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('#tbPenShapes')).toBeHidden();
  } else if (tool === 'text') {
    await page.locator('#fttAnnotate button[data-tool="text"]').click();
  } else {
    await page.locator('#fttAnnotate button[data-tool="shape"]').click();
    await page.locator(`#fttAnnotate .fa-fly button[title="${NEW_TOOLBAR_SHAPE[tool]}"]`).click();
  }
  await expect(page.locator('#teacherTool')).toHaveValue(tool);
}
// The lesson can move sideways a moment after a whiteboard opens (the drawing toolbar takes its place), so measure it once it is still.
async function settledContentBox(page: Page) {
  let last = '';
  await expect.poll(async () => { const now = JSON.stringify(await page.locator('#pdfContent').boundingBox()), still = now === last; last = now; return still; }, { intervals: [250] }).toBe(true);
  return (await page.locator('#pdfContent').boundingBox())!;
}

test('teacher pastes editable text onto the shared whiteboard and can edit it', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await page.evaluate(() => (document.getElementById('openWhiteboard') as HTMLButtonElement).click());
  await expect(page.locator('#pdfContent iframe.lesson-webpage')).toHaveCount(1);
  await pasteWords(page, 'Read this lesson');
  const mark = page.locator('#pdfInk text[data-text-mark]').filter({ hasText: 'Read this lesson' });
  await expect(mark).toBeVisible();
  await page.getByRole('button', { name: '✏ Edit latest text' }).click();
  await page.locator('#pdfTextEditInput').fill('Updated lesson note');
  await page.getByRole('button', { name: 'Save text' }).click();
  await expect(page.locator('#pdfInk text[data-text-mark]')).toHaveCount(1);
  await expect(page.locator('#pdfInk text[data-text-mark]')).toHaveText('Updated lesson note');
  expect(await page.evaluate(() => (window as any).ClassPointerBridge.highlights().some((s: any) => s.tool === 'text' && s.text === 'Updated lesson note'))).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test('teacher whiteboard draws solid pen shapes and adds/edits Hebrew multiline text', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await page.evaluate(() => (document.getElementById('openWhiteboard') as HTMLButtonElement).click());
  await expect(page.locator('#pdfContent iframe.lesson-webpage')).toHaveCount(1);
  // A newly opened whiteboard opens the drawing toolbar on the Pen by itself within half a second, and a shape
  // chosen before that is put back to Pen. Wait for the toolbar, as a teacher would see it, before choosing a shape.
  await expect(page.locator('#fttAnnotate .fa-tool[aria-pressed="true"]')).toBeVisible();
  await expect(page.locator('#fttAnnotate .fa-tool[aria-pressed="true"]')).toContainText('Pen');
  await expect(page.locator('#teacherTool')).toHaveValue('pen');
  const content = await settledContentBox(page);
  const shapes: Array<[string, string, string]> = [['line', 'line', '━ Straight line'], ['pen-arrow', 'g', '➜ Pen arrow'], ['rectangle', 'rect', '▭ Rectangle'], ['ellipse', 'ellipse', '◯ Circle / oval'], ['triangle', 'polygon', '△ Triangle']];
  for (let i = 0; i < shapes.length; i++) {
    const [name, tag, label] = shapes[i];
    await choosePenShape(page, label, name);
    const x = content.x + 80 + i * 110, y = content.y + 100;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 65, y + 45, { steps: 4 }); await page.mouse.up();
    const mark = page.locator(`#pdfInk [data-stroke-tool="${name}"]`);
    await expect(mark).toHaveCount(1);
    expect(await mark.evaluate((el: SVGElement) => el.tagName.toLowerCase())).toBe(tag);
    if (name === 'pen-arrow') await expect(mark.locator(':scope > line, :scope > path')).toHaveCount(2);
    expect(await page.evaluate((expected) => (window as any).ClassPointerBridge.highlights().some((s: any) => s.tool === expected), name)).toBe(true);
  }
  // The picture "Copy board" makes shows the shapes too.
  const copied = await page.evaluate(async () => {
    const blob = await (window as any).ClassPointerPdf.exportPng(), bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let nonWhite = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i] < 240 || rgba[i + 1] < 240 || rgba[i + 2] < 240) nonWhite++;
    return { width: canvas.width, height: canvas.height, nonWhite };
  });
  expect(copied.nonWhite, JSON.stringify(copied)).toBeGreaterThan(100);

  await choosePenShape(page, 'T Text box', 'text');
  await page.mouse.click(content.x + content.width * 0.68, content.y + content.height * 0.55);
  await expect(page.locator('#pdfTextEditDialog')).toBeVisible();
  await page.locator('#pdfTextEditInput').fill('שלום עולם\nשורה שניה');
  await page.getByRole('button', { name: 'Save text' }).click();
  const textMarks = page.locator('#pdfInk text[data-text-mark]');
  await expect(textMarks).toHaveCount(2);
  await expect(textMarks.nth(0)).toHaveText('שלום עולם');
  await expect(textMarks.nth(0)).toHaveAttribute('direction', 'rtl');
  await expect(textMarks.nth(1)).toHaveText('שורה שניה');

  await page.getByRole('button', { name: '✏ Edit latest text' }).click();
  await page.locator('#pdfTextEditInput').fill('תיקון ראשון\nתיקון שני');
  await page.getByRole('button', { name: 'Save text' }).click();
  await expect(page.locator('#pdfInk text[data-text-mark]')).toHaveCount(3);
  await expect(page.locator('#pdfInk text[data-text-mark]').nth(1)).toHaveText('תיקון ראשון');
  await expect(page.locator('#pdfInk text[data-text-mark]').nth(2)).toHaveText('תיקון שני');
  expect(errors).toEqual([]);
  await context.close();
});

test('teacher pastes a screenshot onto the shared whiteboard, moves, resizes and annotates it', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await page.evaluate(() => (document.getElementById('openWhiteboard') as HTMLButtonElement).click());
  await expect.poll(() => page.evaluate(() => (window as any).ClassPointerPdf.isOpen())).toBe(true);
  await expect(page.locator('#pdfContent iframe.lesson-webpage')).toHaveCount(1);
  expect(Math.min(...await boardPixel(page, 0.5, 0.5))).toBeGreaterThan(245);
  await whiteboardSettled(page);

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
  await page.locator('#cpStopBtn').click();
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
  await whiteboardSettled(page);
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
  await expect(page.locator('#cpStopBtn')).toBeVisible();
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
  const stop = page.locator('#cpStopBtn');
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

// ---------- Two-way sharing: the teacher points and draws on a student's shared screen ----------
async function addPresenceStudent(page: Page, studentId: string, name: string) {
  await page.evaluate(({ studentId, name }) => {
    (window as any).__sent = (window as any).__sent || [];
    const connection = { open: true, peer: 'synthetic-presence-' + studentId, send: (m: any) => (window as any).__sent.push({ to: studentId, ...JSON.parse(JSON.stringify(m)) }), close() {} };
    (window as any).ClassPointerBridge.presence().set('presence:' + studentId, { id: 'presence:' + studentId, presence: true, admitted: true, studentId, name, activity: 'Shorashim', connection, connectedAt: Date.now() });
  }, { studentId, name });
}
const sentOf = (page: Page, type: string) => page.evaluate(t => ((window as any).__sent || []).filter((m: any) => m.type === t), type);
const shareAs = (studentId: string, studentName: string) => (route: any) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, studentId, studentName }) });

test('teacher points and draws on an enlarged student screen; only that student receives the marks', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  await context.route(SHARE_API, shareAs('pt1', 'Pointer Test Student One'));
  const page = await context.newPage(); const errors = await openTeacher(page);
  await addPresenceStudent(page, 'pt1', 'Pointer Test Student One');
  await addPresenceStudent(page, 'pt2', 'Pointer Test Student Two');
  await fakeScreenCall(page, 'a'.repeat(64));
  const tile = page.locator('#activityScreenTray .cp-activity-screen').first();
  // Small tiles have no drawing tools; the shared drawing toolbar opens by itself once the screen is enlarged.
  const tools = page.locator('#fttAnnotate .fa-bar');
  await expect(tools).toBeHidden();
  await tile.locator('video').click();
  await expect(tools).toBeVisible();
  // It starts on Hand: nothing is sent until the teacher picks a tool.
  await expect(tools.getByRole('button', { name: /^Hand:/ })).toHaveAttribute('aria-pressed', 'true');
  // Point: the student gets the moving pointer.
  await tools.getByRole('button', { name: /^Pointer:/ }).click();
  const ink = tile.locator('canvas.cp-screen-ink'); const box = (await ink.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await expect.poll(async () => (await sentOf(page, 'board-screen-live')).some((m: any) => m.point && Math.abs(m.point.x - 0.25) < 0.02)).toBe(true);
  // Pen: a finished line goes to Student One, never to Student Two.
  await tools.getByRole('button', { name: /^Pen:/ }).click();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await sentOf(page, 'board-screen-marks')).at(-1)?.strokes?.length).toBe(1);
  const stroke = (await sentOf(page, 'board-screen-marks')).at(-1).strokes[0];
  expect(stroke.tool).toBe('pen'); expect(stroke.points.length).toBeGreaterThan(2);
  expect(await page.evaluate(() => (window as any).__sent.every((m: any) => m.to === 'pt1'))).toBe(true);
  await shot(page, 'teacher-draws-on-student-screen');
  await tools.getByRole('button', { name: /Undo my last change/ }).click();
  await expect.poll(async () => (await sentOf(page, 'board-screen-marks')).at(-1)?.strokes?.length).toBe(0);
  // Drawing on the student's screen never placed the teacher's own lesson pointer.
  expect(await page.locator('#pointerLayer [data-person="teacher"]').count()).toBe(0);
  await page.getByRole('button', { name: '◀ Back to gallery' }).click();
  await expect(tools).toBeHidden();
  // When the student stops sharing, his screen is told to clear the marks.
  const before = (await sentOf(page, 'board-screen-marks')).length;
  await page.evaluate(() => (window as any).__calls[0].close());
  await expect(page.locator('#activityScreenTray .cp-activity-screen')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect((await sentOf(page, 'board-screen-marks')).length).toBeGreaterThanOrEqual(before);
  await context.close();
});

test('the Student screens gallery offers the same Point and Pen tools on a screen opened large', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  await context.route(SHARE_API, shareAs('pt1', 'Pointer Test Student One'));
  const page = await context.newPage(); const errors = await openTeacher(page);
  await addPresenceStudent(page, 'pt1', 'Pointer Test Student One');
  await fakeScreenCall(page, 'a'.repeat(64));
  await expect(page.locator('#studentBoards')).toBeEnabled();
  await page.getByRole('button', { name: 'Student screens' }).click();
  const grid = page.locator('#boardsView .board-tile');
  await expect(grid).toHaveCount(1);
  await grid.first().click();
  const tools = page.locator('#fttAnnotate .fa-bar');
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: /^Pen:/ }).click();
  const ink = page.locator('#boardsView .board-screen-large canvas.cp-screen-ink'); const box = (await ink.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await sentOf(page, 'board-screen-marks')).at(-1)?.strokes?.length).toBe(1);
  await shot(page, 'gallery-draws-on-student-screen');
  await tools.getByRole('button', { name: /Erase all my marks here/ }).click();
  await expect.poll(async () => (await sentOf(page, 'board-screen-marks')).at(-1)?.strokes?.length).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('a student sees the teacher’s pointer and drawing on top of his activity, and it clears when told', async ({ browser }) => {
  const s = await studentActivity(browser, () => ({ status: 200, body: { ok: true, token: 'synthetic-token' } }));
  await expect.poll(() => s.page.evaluate(() => typeof (window as any).ClassPointerBoards?.fromTeacher), { timeout: 15000 }).toBe('function');
  // This harness has no teacher to connect to: wait until that attempt has ended (which resets the class connection).
  await expect.poll(() => s.calls.includes('joinIssue'), { timeout: 15000 }).toBe(true); await s.page.waitForTimeout(300);
  const line = { id: 't1-a', tool: 'pen', color: '#ef4444', size: 0.004, points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] };
  await s.page.evaluate(line => {
    const B = (window as any).ClassPointerBoards;
    // Anything malformed is ignored.
    B.fromTeacher({ type: 'board-screen-marks', strokes: [{ id: 'evil', tool: 'pen', color: 'red', size: 9, points: [{ x: 5, y: 5 }] }] });
    B.fromTeacher({ type: 'board-screen-marks', strokes: [line] });
    B.fromTeacher({ type: 'board-screen-live', point: { x: 0.5, y: 0.3 }, draft: null });
  }, line);
  const layer = s.page.locator('.cp-my-screen-ink');
  await expect(layer).toBeVisible();
  await expect(layer.locator('[role="status"]')).toHaveText(/Your teacher is showing you something/);
  // The red line is painted across the middle of the screen, and the layer never blocks the activity.
  const red = await s.page.evaluate(() => {
    const c = document.querySelector('.cp-my-screen-ink canvas') as HTMLCanvasElement; const ctx = c.getContext('2d')!;
    const sx = c.width / innerWidth, sy = c.height / innerHeight, border = Math.max(0, (outerWidth - innerWidth) / 2);
    const ox = (screenX || 0) + border, oy = (screenY || 0) + Math.max(0, outerHeight - innerHeight - border);
    const px = ctx.getImageData(Math.round((0.5 * screen.width - ox) * sx), Math.round((0.5 * screen.height - oy) * sy), 1, 1).data;
    return [px[0], px[1], px[2], px[3]];
  });
  expect(red[0]).toBeGreaterThan(200); expect(red[3]).toBeGreaterThan(200);
  expect(await layer.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await shot(s.page, 'student-sees-teacher-marks');
  await s.page.evaluate(() => (window as any).ClassPointerBoards.clearScreenMarks());
  await expect(layer).toBeHidden();
  await s.context.close();
});

test('a first-time teacher can open a short guide from the top bar', async ({ browser }) => {
  const context = await browser.newContext(); await wire(context);
  const page = await context.newPage(); const errors = await openTeacher(page);
  await page.getByRole('button', { name: '❓ Help' }).click();
  const guide = page.getByRole('dialog', { name: 'How Class Pointer works' });
  await expect(guide).toBeVisible();
  await expect(guide.locator('.cp-guide-steps li')).toHaveCount(5);
  await expect(guide).toContainText('Point or draw on a student’s screen');
  await shot(page, 'first-time-guide');
  await guide.getByRole('button', { name: 'Got it' }).click();
  await expect(guide).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('classPointerGuideSeen'))).toBe('1');
  expect(errors).toEqual([]);
  await context.close();
});
