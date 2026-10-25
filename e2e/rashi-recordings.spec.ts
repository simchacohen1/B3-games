import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// Serve the checkout from an https test origin instead of file://. Firefox and WebKit do not let
// page.route() stub sub-resources of file:// pages (so the real game-gate.js lock overlay loaded),
// and an https origin is a secure context, so navigator.mediaDevices exists in every browser.
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://rashi-recordings.test';
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
async function serveRepo(page: Page) {
  await page.route(SITE + '/**', route => {
    const file = path.resolve(ROOT, decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, ''));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
}

// Rashi Letters "Record Reading": runs the real student.html and recordings.js
// with a pretend microphone, pretend server and a made-up student. No real
// students, no Firebase, no live site.
const API = '**/studentRewardsAutoAward**';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

type Server = { sections: Record<string, any>; submits: any[]; failNext: number; };

async function openStudentPage(page: Page, server: Server, progress: any = { currentUnitIndex: 1, currentPhase: 'letter' }) {
  await serveRepo(page);   // registered first so the stubs below take precedence
  await page.route(API, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    if (url.searchParams.get('rashi') === 'submit') {
      if (server.failNext > 0) { server.failNext--; return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: 'Server is busy.' }) }); }
      const section = url.searchParams.get('section')!;
      server.submits.push({ section, size: (req.postDataBuffer() || Buffer.alloc(0)).length, words: url.searchParams.get('words'), type: req.headers()['content-type'] });
      if (server.sections[section] && server.sections[section].status !== 'rejected')
        return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, alreadySubmitted: true, status: server.sections[section].status }) });
      server.sections[section] = { status: 'pending' };
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'pending' }) });
    }
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, sections: server.sections }) });
  });
  // Everything that would reach the real internet is replaced.
  await page.route(/gstatic\.com|googleapis\.com\/css|fonts\.g/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/game-gate.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/gallery-share.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/activity-share.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.addInitScript((prog) => {
    const w = window as any;
    sessionStorage.setItem('b3Games_studentId', 'test-kid');
    sessionStorage.setItem('b3Games_studentName', 'Test Kid');
    const data: any = { 'b3Games/students/test-kid/profile': { name: 'Test Kid', active: true }, 'rashiLetters/progress/test-kid': prog, 'b3Games/siteSettings': {} };
    const ref = (p: string) => ({ once: async () => ({ val: () => data[p] ?? null }), set: async () => {}, update: async () => {}, on() {}, off() {}, remove: async () => {} });
    const db: any = { ref };
    w.firebase = { initializeApp() {}, database: Object.assign(() => db, { ServerValue: { TIMESTAMP: 1 } }), auth: () => ({ currentUser: { getIdToken: async () => 'test-token' } }), apps: [{}] };
    w.B3GameGateAuthReady = Promise.resolve();
    w.B3SiteSettings = { onAuthStateChanged: (cb: any) => cb(null, false, null), getActingStudent: () => null };
    // pretend microphone + recorder
    const fakeGetUserMedia = async () => ({ getTracks: () => [{ stop() {} }] }) as any;
    // Always replace navigator.mediaDevices itself: Playwright's WebKit on Windows has none, and on
    // Linux WebKit assigning getUserMedia onto the real object does not take effect.
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: fakeGetUserMedia } });
    class FakeRecorder {
      static isTypeSupported() { return true; }
      mimeType = 'audio/webm'; state = 'inactive'; ondataavailable: any; onstop: any;
      constructor(public stream: any, public opts: any) {}
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable && this.ondataavailable({ data: new Blob([new Uint8Array(6000)], { type: 'audio/webm' }) }); this.onstop && this.onstop(); }
    }
    w.MediaRecorder = FakeRecorder;
    w.Audio = class { onended: any; play() { return Promise.resolve(); } pause() {} } as any;
    w.confirm = () => true;
    // Note the size of every Blob body the page sends (Playwright's WebKit cannot read Blob request bodies).
    w.__sentBlobSizes = [];
    const realFetch = w.fetch.bind(w);
    w.fetch = (input: any, init?: any) => { if (init && init.body instanceof Blob) w.__sentBlobSizes.push(init.body.size); return realFetch(input, init); };
  }, progress);
  await page.goto(SITE + '/rashi-letters/student.html');
  await expect(page.locator('#modeGate')).toBeVisible({ timeout: 15000 });
}
const fresh = (): Server => ({ sections: {}, submits: [], failNext: 0 });

test('menu lists finished sections with a Record Reading button and no status yet', async ({ page }) => {
  await openStudentPage(page, fresh());
  const row = page.locator('#recMenu .rr-menu-row');
  await expect(row).toHaveCount(1);                                    // only Mission 1 is finished
  await expect(row).toContainText('Mission 1 (ז) words');
  await expect(row).toContainText('Not recorded yet');
  await expect(row.getByRole('button', { name: /Record Reading/ })).toBeVisible();
});

test('record, stop, play, rerecord and submit; then it waits for the teacher', async ({ page, browserName }) => {
  const server = fresh();
  await openStudentPage(page, server);
  await page.locator('#recMenu').getByRole('button', { name: /Record Reading/ }).click();
  const screen = page.locator('#recordScreen');
  await expect(screen).toBeVisible();
  await expect(screen.locator('.rr-word')).toHaveCount(8);              // the section's eight Rashi words
  expect(await screen.locator('.rr-word').first().evaluate(e => getComputedStyle(e).fontFamily)).toContain('Mekorot Rashi');
  await expect(screen.getByRole('button', { name: /Submit/ })).toHaveCount(0);   // nothing to submit yet
  await screen.getByRole('button', { name: /🎤 Record Reading/ }).click();
  await expect(screen.getByRole('button', { name: /Stop/ })).toBeVisible();
  await page.waitForTimeout(2200);
  await screen.getByRole('button', { name: /Stop/ }).click();
  await expect(screen.getByRole('button', { name: /Play/ })).toBeVisible();
  await screen.getByRole('button', { name: /Play/ }).click();
  await expect(screen.getByRole('button', { name: /Pause/ })).toBeVisible();
  await screen.getByRole('button', { name: /Rerecord/ }).click();
  await expect(screen.getByRole('button', { name: /🎤 Record Reading/ })).toBeVisible();
  await screen.getByRole('button', { name: /🎤 Record Reading/ }).click();
  await page.waitForTimeout(2200);
  await screen.getByRole('button', { name: /Stop/ }).click();
  await screen.getByRole('button', { name: /Submit/ }).dblclick();      // double tap sends once
  await expect(screen.locator('.rr-banner')).toContainText('⏳ Waiting for Teacher Approval');
  expect(server.submits).toHaveLength(1);
  expect(server.submits[0].section).toBe('zayin');
  expect(await page.evaluate(() => (window as any).__sentBlobSizes)).toEqual([6000]);   // the whole recording was sent once
  if (browserName !== 'webkit') expect(server.submits[0].size).toBeGreaterThan(1000);   // and it arrived at the server
  expect(server.submits[0].type).toBe('audio/webm');
  expect(decodeURIComponent(server.submits[0].words)).toContain('זֶה');
  await expect(screen.getByRole('button', { name: /Record Reading|Submit/ })).toHaveCount(0);   // nothing more to do
});

test('a failed send keeps the recording so he can press Submit again', async ({ page }) => {
  const server = fresh(); server.failNext = 1;
  await openStudentPage(page, server);
  await page.locator('#recMenu').getByRole('button', { name: /Record Reading/ }).click();
  const screen = page.locator('#recordScreen');
  await screen.getByRole('button', { name: /🎤 Record Reading/ }).click();
  await page.waitForTimeout(2200);
  await screen.getByRole('button', { name: /Stop/ }).click();
  await screen.getByRole('button', { name: /Submit/ }).click();
  await expect(screen.locator('.rr-msg')).toContainText('Your recording is still saved here');
  await expect(screen.getByRole('button', { name: /Play/ })).toBeVisible();      // recording kept
  await screen.getByRole('button', { name: /Submit/ }).click();
  await expect(screen.locator('.rr-banner')).toContainText('Waiting for Teacher Approval');
  expect(server.submits).toHaveLength(1);
});

test('status survives a refresh: pending, approved (+2) and rejected (new attempt allowed)', async ({ page }) => {
  const server = fresh(); server.sections = { zayin: { status: 'pending' } };
  await openStudentPage(page, server);
  await expect(page.locator('#recMenu .rr-menu-row')).toContainText('Waiting for Teacher Approval');
  await page.locator('#recMenu').getByRole('button', { name: 'View' }).click();
  await expect(page.locator('#recordScreen .rr-banner')).toContainText('⏳ Waiting for Teacher Approval');
  await expect(page.locator('#recordScreen').getByRole('button', { name: /🎤 Record Reading/ })).toHaveCount(0);

  server.sections.zayin = { status: 'approved', points: 2 };
  await page.reload(); await expect(page.locator('#modeGate')).toBeVisible();
  await expect(page.locator('#recMenu .rr-menu-row')).toContainText('✅ Approved! +2 Points');

  server.sections.zayin = { status: 'rejected' };
  await page.reload(); await expect(page.locator('#modeGate')).toBeVisible();
  await page.locator('#recMenu').getByRole('button', { name: /Record Reading/ }).click();
  await expect(page.locator('#recordScreen .rr-banner')).toContainText('try again');
  await expect(page.locator('#recordScreen').getByRole('button', { name: /🎤 Record Reading/ })).toBeVisible();
});

test('finishing a mission\'s word step ends with the recording activity, then continues', async ({ page }) => {
  const server = fresh();
  await openStudentPage(page, server, { currentUnitIndex: 0, currentPhase: 'word' });
  await page.evaluate(() => {
    unitIndex = 0; guidedIndex = 0; phase = 'word'; mode = 'continue'; streak = 2; attemptsThisStep = 2;
    document.getElementById('modeGate')!.style.display = 'none'; document.getElementById('app')!.style.display = 'block';
    renderQuestion();
  });
  const target = await page.evaluate(() => currentTarget as string);
  await page.locator('#choicesRow .choice-btn', { hasText: new RegExp('^' + target + '$') }).click();
  const screen = page.locator('#recordScreen');
  await expect(screen).toBeVisible({ timeout: 6000 });
  await expect(screen).toContainText('Mission 1 (ז) words');
  await expect(screen.locator('.rr-word')).toHaveCount(8);
  await expect(page.locator('#app')).toBeHidden();
  await screen.getByRole('button', { name: /Skip for now/ }).click();    // skipping never blocks progress
  await expect(screen).toBeHidden();
  expect(server.submits).toHaveLength(0);
});

test('a section that is already sent is not offered again at its end', async ({ page }) => {
  const server = fresh(); server.sections = { zayin: { status: 'approved' } };
  await openStudentPage(page, server, { currentUnitIndex: 0, currentPhase: 'word' });
  await page.evaluate(() => {
    unitIndex = 0; guidedIndex = 0; phase = 'word'; mode = 'continue'; streak = 2; attemptsThisStep = 2;
    document.getElementById('modeGate')!.style.display = 'none'; document.getElementById('app')!.style.display = 'block';
    renderQuestion();
  });
  const target = await page.evaluate(() => currentTarget as string);
  await page.locator('#choicesRow .choice-btn', { hasText: new RegExp('^' + target + '$') }).click();
  await page.waitForTimeout(2500);
  await expect(page.locator('#recordScreen')).toBeHidden();
});

test('existing lessons still run: letter question renders and answers', async ({ page }) => {
  await openStudentPage(page, fresh(), { currentUnitIndex: 0, currentPhase: 'letter' });
  await page.evaluate(() => { (window as any).selectPracticeLetter('zayin', document.createElement('button')); });
  await page.locator('#startPracticeBtn').click();
  await expect(page.locator('#rashiLetter')).not.toBeEmpty();
  await expect(page.locator('#choicesRow .choice-btn')).toHaveCount(4);
  await expect(page.locator('#recordScreen')).toBeHidden();
});

// ---------- Teacher: Rashi Letters Recordings panel ----------
test('teacher panel shows student, class, section, audio, and approve / try again send one call each', async ({ page }) => {
  const calls: any[] = [];
  await serveRepo(page);
  let pending = [{ id: 'rashi_kid1_zayin_a1', studentId: 'kid1', studentName: 'Test Kid One', className: 'B3 ET', classId: 'et', sectionId: 'zayin',
    sectionLabel: 'Mission 1 (ז) words', words: ['זֶה', 'זָר'], attempt: 1, createdAt: 1790000000000, durationMs: 9000, amount: 2, audioUrl: 'https://signed.example/a.webm' },
    { id: 'rashi_kid1_bet_a2', studentId: 'kid1', studentName: 'Test Kid One', className: 'B3 ET', classId: 'et', sectionId: 'bet',
      sectionLabel: 'Mission 2 (בּ / ב) words', words: ['בַּיִת'], attempt: 2, createdAt: 1790000100000, durationMs: 7000, amount: 2, audioUrl: 'https://signed.example/b.webm' }];
  await page.route(API, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}'); calls.push(body);
    if (body.action === 'rashi-list-pending') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, requests: pending }) });
    pending = pending.filter(r => r.id !== body.requestId);
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, status: body.action === 'rashi-approve' ? 'approved' : 'rejected', actualAmount: 2 }) });
  });
  await page.route(/gstatic\.com|googleapis\.com\/css|fonts\.g/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/site-settings.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/back-nav.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/guest-mode.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => {
    const w = window as any;
    const data: any = { 'b3Games/workspaces/b3-2026/classes/et': { active: true, name: 'B3 ET', toolGrants: { 'rashi-letters': true }, members: { kid1: { name: 'Test Kid One', active: true } } },
      'b3Games/workspaces/b3-2026/classes/wt': { active: true, name: 'B3 WT', toolGrants: { 'rashi-letters': true }, members: {} },
      'b3Games/students/kid1/profile': { name: 'Test Kid One', active: true } };
    const ref = (p: string) => ({ once: async () => ({ val: () => data[p] ?? null }), set: async () => {} });
    w.firebase = { apps: [{}], initializeApp() {}, database: () => ({ ref }), auth: () => ({ currentUser: { getIdToken: async () => 't' } }) };
    w.B3SiteSettings = { onAuthStateChanged: (cb: any) => setTimeout(() => cb({ uid: 'o' }, true, { authorized: true, role: 'admin' }), 0), signInWithGoogle() {} };
  });
  await page.goto(SITE + '/rashi-letters/teacher.html?tab=recordings');
  const items = page.locator('.rec-item');
  await expect(items).toHaveCount(2);
  const first = items.first();
  await expect(first).toContainText('Test Kid One');
  await expect(first).toContainText('B3 ET');
  await expect(first).toContainText('Mission 1 (ז) words');
  await expect(first.locator('audio')).toHaveAttribute('src', 'https://signed.example/a.webm');
  await expect(first.getByRole('button', { name: '✅ Approve (+2 Points)' })).toBeVisible();
  await expect(first.getByRole('button', { name: '🔄 Try Again' })).toBeVisible();
  await expect(page.locator('#recCount')).toHaveText('(2)');
  await first.getByRole('button', { name: /Approve/ }).dblclick();                   // double click = one approval
  await expect(items).toHaveCount(1, { timeout: 5000 });
  expect(calls.filter(c => c.action === 'rashi-approve')).toHaveLength(1);
  expect(calls.find(c => c.action === 'rashi-approve').requestId).toBe('rashi_kid1_zayin_a1');
  await items.first().getByRole('button', { name: /Try Again/ }).click();
  await expect(page.locator('.rec-item')).toHaveCount(0, { timeout: 5000 });
  expect(calls.filter(c => c.action === 'rashi-reject')).toHaveLength(1);
  await expect(page.locator('#recList')).toContainText('No Rashi recordings are waiting');
});
