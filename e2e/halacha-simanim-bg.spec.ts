import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';

// Real Halacha page served locally: sign-in gate stubbed, Firebase blocked, nothing leaves the test machine.
// Covers the Siman Beis / Gimmel classroom lessons (same design as Siman Aleph) and the Oct 22 blank-lesson bug.
// Tiny local web server: browsers refuse to read picture pixels (needed for coloring) from file:// pages.
const root = process.cwd();
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };
let server: http.Server;
let pageUrl = '';
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  pageUrl = 'http://127.0.0.1:' + (server.address() as any).port + '/halacha/index.html';
});
test.afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
const BEIS = ['s2a', 's2b', 's2c', 's2d'];
const GIMMEL = ['s3a', 's3b', 's3c', 's3d', 's3e', 's3f', 's3g', 's3h'];

async function open(page: any, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('b3Games_studentId', 'test_student');
    sessionStorage.setItem('b3Games_studentClass', 'et');
  });
  await page.route('**/game-gate.js*', (route: any) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/gstatic\.com|firebaseio\.com|googleapis\.com|cloudfunctions\.net/, (route: any) => route.abort());
  await page.goto(pageUrl + query);
  await page.waitForFunction(() => document.querySelector('button.simanCard'));
  await page.waitForTimeout(3500); // let the (blocked) class-access lookup finish before unlocking for the test
  // These are page-level 'let/const' values, so they can only be reached by running code inside the page.
  await page.evaluate("HALACHA_MAX_SIMAN='ו';refreshHubLocks()");
  return errors;
}
const openSiman = (page: any, letter: string) => page.evaluate(`openSiman('${letter}')`);
const showLesson = (page: any, id: string) => page.evaluate(`show('${id}')`);

test('every Beis and Gimmel lesson is visible, has a ready picture and at least 3 highlighted words per seif', async ({ page }) => {
  const errors = await open(page);
  for (const id of [...BEIS, ...GIMMEL]) {
    await showLesson(page, id);
    const section = page.locator(`#${id}`);
    await expect(section).toBeVisible();
    const cards = section.locator('.ha-classroom');
    expect(await cards.count(), `${id} has classrooms`).toBeGreaterThan(0);
    for (let i = 0; i < (await cards.count()); i++) {
      const card = cards.nth(i);
      await expect(card.locator('canvas[data-ready="true"]')).toHaveCount(1, { timeout: 10000 });
      expect(await card.locator('.ha-keyword').count(), `${id} card ${i + 1} highlighted words`).toBeGreaterThanOrEqual(3);
      expect(await card.locator('.ha-hebrew').innerText()).toMatch(/[֐-׿]{3}/);
      expect(((await card.locator('.ha-summary').innerText()) || '').length).toBeGreaterThan(30);
    }
  }
  expect(errors).toEqual([]);
});

test('picture is on the left and the Hebrew text on the right', async ({ page }) => {
  await open(page);
  await showLesson(page, 's2a');
  const art = await page.locator('#s2a .ha-classroom').first().locator('.ha-art').boundingBox();
  const text = await page.locator('#s2a .ha-classroom').first().locator('.ha-halachacard').boundingBox();
  expect(art!.x).toBeLessThan(text!.x);
});

test('Show more text expands and collapses the Hebrew', async ({ page }) => {
  await open(page);
  await showLesson(page, 's2b');
  const card = page.locator('#s2b .ha-classroom').first();
  const toggle = card.locator('.ha-text-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.ha-hebrew')).toHaveClass(/expanded/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('Back and Next walk through every seif, across lessons, and stop at the ends', async ({ page }) => {
  await open(page);
  await openSiman(page, 'ב');
  const active = () => page.evaluate("document.querySelector('.section.on').id");
  expect(await active()).toBe('s2a');
  await expect(page.locator('#s2a .ha-classroom').first().locator('.ha-prev')).toBeDisabled();
  // s2a has two seifim, so Next from the second card must go to the next lesson (s2b).
  await page.locator('#s2a .ha-classroom').nth(0).locator('.ha-next').click();
  expect(await active()).toBe('s2a');
  await page.locator('#s2a .ha-classroom').nth(1).locator('.ha-next').click();
  expect(await active()).toBe('s2b');
  await page.locator('#s2b .ha-classroom').first().locator('.ha-prev').click();
  expect(await active()).toBe('s2a');
  // last seif of Siman Beis has no Next
  await showLesson(page, 's2d');
  await expect(page.locator('#s2d .ha-classroom').last().locator('.ha-next')).toBeDisabled();
});

test('vocabulary: clicking a word shows its meaning and Practice offers choices', async ({ page }) => {
  await open(page);
  await showLesson(page, 's3d');
  const card = page.locator('#s3d .ha-classroom').first();
  await card.locator('.ha-keyword').first().click();
  expect((await card.locator('.ha-worden').innerText()).length).toBeGreaterThan(1);
  await card.locator('.ha-practice').click();
  await expect(card.locator('.ha-answers button')).toHaveCount(3);
});

test('coloring: fill, undo, redo; saved; survives a reload; other lessons unaffected', async ({ page }) => {
  await open(page);
  await showLesson(page, 's3a');
  const card = page.locator('#s3a .ha-classroom').first();
  const canvas = card.locator('canvas');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  // pick the first clearly white pixel away from outlines, in canvas coordinates
  const spot = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const { width: w, height: h } = c;
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let y = Math.floor(h * 0.6); y < h - 6; y += 7) for (let x = 6; x < w - 6; x += 7) {
      let white = true;
      for (let dy = -3; dy <= 3 && white; dy++) for (let dx = -3; dx <= 3; dx++) { const k = ((y + dy) * w + x + dx) * 4; if (d[k] < 240 || d[k + 1] < 240 || d[k + 2] < 240) { white = false; break; } }
      if (white) return { x, y };
    }
    return null;
  });
  expect(spot).not.toBeNull();
  const box = (await canvas.boundingBox())!;
  const cw = await canvas.evaluate((c: HTMLCanvasElement) => c.width), ch = await canvas.evaluate((c: HTMLCanvasElement) => c.height);
  const clickAt = { x: (spot!.x / cw) * box.width, y: (spot!.y / ch) * box.height };
  const key = 'halacha_picture_siman_bg_v1_s3a_1';
  const saved = () => page.evaluate(`(S['${key}']||[]).length`);
  const pixel = () => canvas.evaluate((c: HTMLCanvasElement, s: any) => Array.from(c.getContext('2d')!.getImageData(s.x, s.y, 1, 1).data), spot);
  expect((await pixel())[0]).toBeGreaterThan(235);
  await canvas.click({ position: clickAt });
  expect(await saved()).toBe(1);
  const colored = await pixel();
  expect(colored[0] > 200 && colored[1] < 120).toBe(true); // default red
  const fillShare = await canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120) red++;
    return red / (c.width * c.height);
  });
  expect(fillShare).toBeGreaterThan(0.001);
  expect(fillShare).toBeLessThan(0.6); // a fill never floods the whole picture
  await card.locator('.ha-undo').click();
  expect(await saved()).toBe(0);
  expect((await pixel())[0]).toBeGreaterThan(235);
  await card.locator('.ha-redo').click();
  expect(await saved()).toBe(1);
  // other lesson untouched
  expect(await page.evaluate("(S['halacha_picture_siman_bg_v1_s3b_1']||[]).length")).toBe(0);
  // reload: the colored section comes back
  await page.reload();
  await page.waitForFunction(() => document.querySelector('button.simanCard'));
  await page.waitForTimeout(3500);
  await page.evaluate("HALACHA_MAX_SIMAN='ו';refreshHubLocks()");
  await showLesson(page, 's3a');
  const after = page.locator('#s3a .ha-classroom').first().locator('canvas');
  await expect(after).toHaveAttribute('data-ready', 'true');
  expect(await saved()).toBe(1);
  const again = await after.evaluate((c: HTMLCanvasElement, s: any) => Array.from(c.getContext('2d')!.getImageData(s.x, s.y, 1, 1).data), spot);
  expect(again[0] > 200 && again[1] < 120).toBe(true);
});

test('teacher notes appear above the first seif in teacher mode only', async ({ page }) => {
  await open(page, '?teacher=1');
  await showLesson(page, 's2a');
  const notes = page.locator('#s2a .ha-teachernotes').first();
  await expect(notes).toBeVisible();
  const notesBox = (await notes.boundingBox())!, mastBox = (await page.locator('#s2a .ha-mast').first().boundingBox())!;
  expect(notesBox.y).toBeLessThan(mastBox.y);
});

test('tablet layout: no sideways scrolling in Beis and Gimmel lessons', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page);
  for (const id of ['s2a', 's2c', 's3b', 's3h']) {
    await showLesson(page, id);
    const overflow = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth');
    expect(overflow as number, `${id} sideways overflow`).toBeLessThanOrEqual(1);
  }
});

test('the duplicate "clean clothes" tab is hidden from Siman Beis', async ({ page }) => {
  await open(page);
  await openSiman(page, 'ב');
  await expect(page.locator('#tabs button[data-id="s2extra"]')).toBeHidden();
  await expect(page.locator('#tabs button[data-id="s2a"]')).toBeVisible();
});

test('highlighted words and word buttons never include commas or periods', async ({ page }) => {
  await open(page);
  for (const id of ['s2a', 's2b', 's2c', 's3a', 's3d']) {
    await showLesson(page, id);
    const texts: string[] = await page.locator(`#${id} .ha-keyword, #${id} .ha-wordchips button`).allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t, `${id}: "${t}"`).not.toMatch(/[,.;:!?()]/);
  }
});

test('the left sliver of the neighbouring panel is trimmed from the small pictures', async ({ page }) => {
  await open(page);
  await showLesson(page, 's2b');
  const canvas = page.locator('#s2b .ha-classroom').first().locator('canvas');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  // the first columns of the picture must not be the dark outline of another panel's text
  const darkShare = await canvas.evaluate((c: HTMLCanvasElement) => {
    const w = Math.max(6, Math.floor(c.width * 0.03)), d = c.getContext('2d')!.getImageData(0, 0, w, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
    return dark / (w * c.height);
  });
  expect(darkShare).toBeLessThan(0.25);
});

test('Full text window: whole seif visible in a big window with no scrolling, closes with Esc and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  // longest seifim in Beis, Gimmel and the longest Aleph lesson
  for (const [id, cardIndex] of [['s2c', 0], ['s3b', 0], ['e', 0]] as [string, number][]) {
    await showLesson(page, id);
    const card = page.locator(`#${id} .ha-classroom`).nth(cardIndex);
    const button = card.locator('.ha-fulltext-btn');
    await expect(button).toBeVisible();
    const original = (await card.locator('.ha-hebrew').innerText()).replace(/\s+/g, '');
    await button.click();
    const dialog = page.locator('.ha-ft-dialog');
    await expect(dialog).toBeVisible();
    const shown = (await dialog.locator('.ha-ft-body').innerText()).replace(/\s+/g, '');
    expect(shown, `${id}: the window shows the entire seif`).toBe(original);
    const sizes = await dialog.locator('.ha-ft-body').evaluate((el: HTMLElement) => ({ scroll: el.scrollHeight, client: el.clientHeight, font: parseFloat(getComputedStyle(el).fontSize) }));
    expect(sizes.scroll, `${id}: no scrolling needed`).toBeLessThanOrEqual(sizes.client + 1);
    expect(sizes.font, `${id}: text stays readable`).toBeGreaterThanOrEqual(16);
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThan(1280 * 0.85);
    expect(box.height).toBeGreaterThan(800 * 0.85);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  }
});

test('Full text window: highlighted words show their meaning and the window has a Close button', async ({ page }) => {
  await open(page);
  await showLesson(page, 's3d');
  const card = page.locator('#s3d .ha-classroom').first();
  await card.locator('.ha-fulltext-btn').click();
  const dialog = page.locator('.ha-ft-dialog');
  await dialog.locator('.ha-ft-word').first().click();
  expect(((await dialog.locator('.ha-ft-foot').innerText()) || '').length).toBeGreaterThan(5);
  await dialog.getByRole('button', { name: /Close/ }).click();
  await expect(dialog).toBeHidden();
});
