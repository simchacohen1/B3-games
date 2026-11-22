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
// Open the "Reading with Mic" page from the menu tile; row 0 is Mission 1 (zayin).
async function openHub(page: Page) {
  await page.locator('.mic-tile').click();
  await expect(page.locator('#recordHub')).toBeVisible();
}
const hubRow = (page: Page, i = 0) => page.locator('#recordHub .rr-menu-row').nth(i);
const fresh = (): Server => ({ sections: {}, submits: [], failNext: 0 });

test('menu has a Reading with Mic tile; it opens a page with every section to record from', async ({ page }) => {
  await openStudentPage(page, fresh());
  await expect(page.locator('.mic-tile')).toContainText('Reading with Mic');
  await openHub(page);
  const rows = page.locator('#recordHub .rr-menu-row');
  await expect(rows).toHaveCount(12);                                  // 9 missions + 2/3/4-letter words, all open
  await expect(rows.first()).toContainText('Mission 1 (ז) words');
  await expect(rows.first()).toContainText('Not recorded yet');
  await expect(rows.nth(11)).toContainText('4-letter words');
  await expect(rows.first().getByRole('button', { name: /Record/ })).toBeVisible();
  await page.locator('#recordHub').getByRole('button', { name: /Menu/ }).click();
  await expect(page.locator('#modeGate')).toBeVisible();
  await expect(page.locator('#recordHub')).toBeHidden();
});

test('a section can be chosen from the page even before finishing its mission, and Back returns to the page', async ({ page }) => {
  await openStudentPage(page, fresh(), { currentUnitIndex: 0, currentPhase: 'letter' });
  await openHub(page);
  await hubRow(page, 4).getByRole('button', { name: /Record/ }).click();   // Mission 5
  await expect(page.locator('#recordScreen')).toContainText('Mission 5');
  await expect(page.locator('#recordScreen .rr-word')).toHaveCount(8);
  await page.locator('#recordScreen').getByRole('button', { name: /All readings/ }).click();
  await expect(page.locator('#recordHub')).toBeVisible();
});

test('record, stop, play, rerecord and submit; then it waits for the teacher', async ({ page, browserName }) => {
  const server = fresh();
  await openStudentPage(page, server);
  await openHub(page);
  await hubRow(page).getByRole('button', { name: /Record/ }).click();
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
  await openHub(page);
  await hubRow(page).getByRole('button', { name: /Record/ }).click();
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
  await openHub(page);
  await expect(hubRow(page)).toContainText('Waiting for Teacher Approval');
  await hubRow(page).getByRole('button', { name: 'View' }).click();
  await expect(page.locator('#recordScreen .rr-banner')).toContainText('⏳ Waiting for Teacher Approval');
  await expect(page.locator('#recordScreen').getByRole('button', { name: /🎤 Record Reading/ })).toHaveCount(0);

  server.sections.zayin = { status: 'approved', points: 2 };
  await page.reload(); await expect(page.locator('#modeGate')).toBeVisible();
  await openHub(page);
  await expect(hubRow(page)).toContainText('✅ Approved! +2 Points');

  server.sections.zayin = { status: 'rejected' };
  await page.reload(); await expect(page.locator('#modeGate')).toBeVisible();
  await openHub(page);
  await expect(hubRow(page)).toContainText('try again');
  await hubRow(page).getByRole('button', { name: /Record/ }).click();
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
test('teacher taps letters that were not recognized: auto-saves, points by 5 parts, legacy bulk approve and letter scores', async ({ page }) => {
  const calls: any[] = [];
  await serveRepo(page);
  const text = ['אבגד', 'הוזח', 'טיכל', 'מנסע', 'עפצק'];   // 20 letters = 5 parts of 4
  let pending: any[] = [
    { id: 'rashi_kid1_zayin_a1', v2: true, studentId: 'kid1', studentName: 'Test Kid One', className: 'B3 ET', classId: 'et', sectionId: 'zayin',
      sectionLabel: 'Mission 1 (ז) words', words: text, attempt: 1, createdAt: 1790000000000, durationMs: 9000, amount: 2, audioUrl: 'https://signed.example/a.webm', letterReview: null },
    { id: 'rashi_kid1_bet_a2', v2: true, studentId: 'kid1', studentName: 'Test Kid One', className: 'B3 ET', classId: 'et', sectionId: 'bet',
      sectionLabel: 'Mission 2 (בּ / ב) words', words: text, attempt: 1, createdAt: 1790000100000, durationMs: 7000, amount: 2, audioUrl: 'https://signed.example/b.webm', letterReview: null },
    { id: 'rashi_kid1_samech_a1', studentId: 'kid1', studentName: 'Test Kid One', className: 'B3 ET', classId: 'et', sectionId: 'samech',
      sectionLabel: 'Mission 8 (ס) words', words: ['סֵפֶר'], attempt: 1, createdAt: 1789000000000, durationMs: 5000, amount: 2, audioUrl: 'https://signed.example/s.webm', letterReview: null }];
  const recent: any[] = [{ id: 'rashi_kid1_alef_a1', v2: true, studentId: 'kid1', studentName: 'Test Kid One', className: 'B3 ET', classId: 'et', sectionId: 'alef',
    sectionLabel: 'Mission 4 (א) words', words: text, attempt: 1, createdAt: 1789000000000, gradedAt: 1789000500000, durationMs: 5000, amount: 2, audioUrl: 'https://signed.example/c.webm',
    letterReview: { total: 20, missed: [0, 1], missedCount: 2, partsClean: [false, true, true, true, true], points: 4 } }];
  await page.route(API, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}'); calls.push(body);
    const ok = (extra: any) => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, ...extra }) });
    if (body.action === 'rashi-list-pending') return ok({ requests: pending, recent });
    if (body.action === 'rashi-letter-marks') return ok({ points: 3, paidTotal: 3, parts: 3, priorPoints: 0, canRerecord: true, partsClean: [false, true, true, true, false], missedCount: body.missed.length, total: 20, pct: 90 });
    if (body.action === 'rashi-letter-stats') {
      const letters: any = { 'א': { seen: 4, missed: 1 }, 'ב': { seen: 4, missed: 0 }, 'ג': { seen: 2, missed: 2 } };
      return ok({ students: { kid1: { letters, readings: 2 } } });
    }
    if (body.action === 'rashi-approve') { pending = pending.filter(r => r.id !== body.requestId); return ok({ status: 'approved', actualAmount: 2 }); }
    return ok({});
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
  await page.goto(SITE + '/rashi-letters/teacher.html?class=et&tab=recordings');
  const items = page.locator('#recList .rec-item');
  await expect(items).toHaveCount(4);                                   // 3 waiting + 1 recently graded
  const first = items.first();
  await expect(first).toContainText('Test Kid One');
  await expect(first).toContainText('B3 ET');
  const card = page.locator('.rec-item[data-id="rashi_kid1_zayin_a1"]');
  await expect(card.locator('audio')).toHaveAttribute('src', 'https://signed.example/a.webm');
  // No grade boxes, no number row, no word taps, no Approve / Try Again buttons.
  await expect(page.locator('.rashi-grade, .rashi-feedback, [data-pts], .gw-word')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /Try Again/ })).toHaveCount(0);
  await expect(page.locator('#recCount')).toHaveText('(3)');
  // The text is large with every LETTER tappable (20 letters), all correct by default.
  await expect(card.locator('.lt')).toHaveCount(20);
  await expect(card.locator('.lt.bad')).toHaveCount(0);
  await expect(card.locator('[data-field="score"]')).toContainText('5/5 points');
  await expect(card.locator('[data-field="score"]')).toContainText('20/20 letters correct');
  // Tapping marks a letter as not recognized, tapping again undoes it. Nothing is sent yet and no popup appears.
  let dialogs = 0; page.on('dialog', () => { dialogs++; });
  await card.locator('.lt').nth(0).click();
  await card.locator('.lt').nth(19).click();
  await card.locator('.lt').nth(5).click();
  await card.locator('.lt').nth(5).click();                              // undone
  await expect(card.locator('.lt.bad')).toHaveCount(2);
  await expect(card.locator('[data-field="score"]')).toContainText('3/5 points');
  await expect(card.locator('[data-field="score"]')).toContainText('18/20 letters correct');
  expect(calls.filter(c => c.action === 'rashi-letter-marks')).toHaveLength(0);
  // Saved ONCE a few seconds after the last tap, with the missed letter numbers.
  await expect.poll(() => calls.filter(c => c.action === 'rashi-letter-marks').length, { timeout: 9000 }).toBe(1);
  expect(calls.find(c => c.action === 'rashi-letter-marks')).toMatchObject({ requestId: 'rashi_kid1_zayin_a1', missed: [0, 19] });
  await expect(card.locator('[data-field="msg"]')).toContainText('3 of 5 parts perfect');
  await expect(card.locator('[data-done]')).toBeHidden();
  // A perfect reading: no taps, press Done.
  const perfect = page.locator('.rec-item[data-id="rashi_kid1_bet_a2"]');
  await perfect.locator('[data-done]').click();
  await expect.poll(() => calls.filter(c => c.action === 'rashi-letter-marks').length, { timeout: 5000 }).toBe(2);
  expect(calls.filter(c => c.action === 'rashi-letter-marks')[1]).toMatchObject({ requestId: 'rashi_kid1_bet_a2', missed: [] });
  // A recently graded reading shows its saved marks and can be changed freely.
  const old = page.locator('.rec-item[data-id="rashi_kid1_alef_a1"]');
  await expect(old.locator('.lt.bad')).toHaveCount(2);
  await expect(old.locator('[data-field="score"]')).toContainText('4/5 points');
  await old.locator('.lt').nth(0).click();
  await expect.poll(() => calls.filter(c => c.action === 'rashi-letter-marks').length, { timeout: 9000 }).toBe(3);
  expect(calls.filter(c => c.action === 'rashi-letter-marks')[2]).toMatchObject({ requestId: 'rashi_kid1_alef_a1', missed: [1] });
  expect(dialogs).toBe(0);
  // Delete removes a bad recording (after one confirmation) and calls the server once.
  page.once('dialog', d => d.accept());
  await perfect.locator('[data-delete]').click();
  await expect.poll(() => calls.filter(c => c.action === 'rashi-delete').length, { timeout: 5000 }).toBe(1);
  expect(calls.find(c => c.action === 'rashi-delete')).toMatchObject({ requestId: 'rashi_kid1_bet_a2' });
  // Each boy's letter scores are shown (27 letter columns).
  await expect(page.locator('#letterHolder th.lh')).toHaveCount(27);
  await expect(page.locator('#letterHolder tbody tr')).toHaveCount(1);
  await expect(page.locator('#letterHolder tbody tr').first()).toContainText('Test Kid One');
  await expect(page.locator('#letterHolder td[title^="א"]')).toHaveText('75%');
  await expect(page.locator('#letterHolder td[title^="ג"]')).toHaveText('0%');
  // Approve All Legacy Readings still approves only the older recording (no letter data).
  page.removeAllListeners('dialog'); page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: /Approve All Legacy Readings \(1\)/ }).click();
  await expect.poll(() => calls.filter(c => c.action === 'rashi-approve').length, { timeout: 6000 }).toBe(1);
  expect(calls.find(c => c.action === 'rashi-approve').requestId).toBe('rashi_kid1_samech_a1');
});


test('Vayeira browsing displays all 36 approved source Rashis with individual recording buttons', async ({ page }) => {
  await openStudentPage(page, fresh());
  await page.locator('.vayeira-reading-tile').click();
  const hub=page.locator('#recordHub');
  await expect(hub).toContainText('Parshas Vayeira');
  const data=JSON.parse(fs.readFileSync(path.resolve(ROOT,'rashi-letters/data/vayeira-rashi.json'),'utf8'));
  const select=hub.getByLabel('Choose perek');
  const pereks=[...new Set(data.passages.map((p:any)=>p.perek))];
  const seen:string[]=[];
  for(const perek of pereks){
    await select.selectOption(String(perek));
    const items=data.passages.filter((p:any)=>p.perek===perek);
    const rows=hub.locator('.rr-menu-row');
    await expect(rows).toHaveCount(items.length);
    for(let i=0;i<items.length;i++){
      await expect(rows.nth(i)).toContainText('Pasuk '+items[i].pasuk);
      seen.push(items[i].id);
    }
  }
  expect(seen).toHaveLength(36);
  expect(new Set(seen).size).toBe(36);
  await select.selectOption(String(data.passages[0].perek));
  await hub.locator('.rr-menu-row').first().getByRole('button',{name:/Record Reading/}).click();
  const screen=page.locator('#recordScreen');
  await expect(screen).toBeVisible();
  await expect(screen.locator('.rr-passage')).toContainText(data.passages[0].text);
  await expect(screen.getByRole('button',{name:/Record Reading/})).toBeVisible();
  await screen.getByRole('button',{name:/All readings/}).click();
  await expect(hub).toBeVisible();
});
