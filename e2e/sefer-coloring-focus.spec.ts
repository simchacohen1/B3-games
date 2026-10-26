import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// Owner-approved coloring pictures (sefer-hamitzvos/coloring-v2), October 25-31 2026.
const APPROVED_ART_SHA256: Record<string, string> = {
  '500': '886be649f32896fe51cabf40e8da30719d4db469e5c9301c2f5e9cf9f3afab81',
  '501': 'c204988c31471c0d254db01dfdea69913be1d80bcad77e862b33de1ec122ea6f',
  '502': 'd834c4b7164f225654eaccf3caa17e5959ef9404228bd954adb70e33a4cfa4dd',
  '503': '8e7c1509b8bc392c560f002fa1369ddf4f7108dd7428ddb5dfde4546434cb5d5',
};

test('Sefer pictures keep correctly aligned fill after rapid date navigation (synthetic browser)', async ({ page }) => {
  test.setTimeout(120000);
  const root = process.cwd();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('b3Games_studentId', 'synthetic-sefer-playwright');
    sessionStorage.setItem('b3Games_studentClass', 'et');
    (window as any).B3SiteSettings = {
      onAuthStateChanged: (callback: Function) => callback({}, true, { authorized: true, role: 'teacher' })
    };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.gstatic.com' ||
        url.pathname.endsWith('/game-gate.js') ||
        url.pathname.endsWith('/firebase-config.js') ||
        url.pathname.endsWith('/gallery-share.js') ||
        url.pathname.includes('/word-bank/') ||
        url.pathname.includes('/class-pointer-prototype/')) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return;
    }
    if (url.hostname !== 'sefer.local.test') {
      await route.abort();
      return;
    }
    const requested = decodeURIComponent(url.pathname).replace(/^\//, '');
    const filename = path.resolve(root, requested || 'sefer-hamitzvos/index.html');
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    const type = filename.endsWith('.png') ? 'image/png'
      : filename.endsWith('.html') ? 'text/html'
      : filename.endsWith('.js') ? 'application/javascript'
      : 'text/plain';
    await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(filename) });
  });
  const servedArt = new Map<string, string>();
  page.on('response', async response => {
    const match = new URL(response.url()).pathname.match(/\/coloring-v2\/(\d+)\.png$/);
    if (match) servedArt.set(match[1], crypto.createHash('sha256').update(await response.body()).digest('hex'));
  });
  await page.goto('https://sefer.local.test/sefer-hamitzvos/index.html');
  await page.waitForFunction(() => typeof regionMask !== 'undefined' && !!regionMask && !paintLoading, { timeout: 30000 });
  const firstCard = await page.locator('#card').inputValue();
  // Today's picture must be the owner-approved artwork, byte for byte. When a new
  // week's art is approved, add its SHA-256 here.
  const todayArt = firstCard.padStart(3, '0');
  expect(APPROVED_ART_SHA256[todayArt], `today's card ${firstCard} has no approved artwork registered`).toBeTruthy();
  await expect(page.locator('#outline')).toHaveAttribute('src', new RegExp(`coloring-v2/${todayArt}\\.png(?:\\?|$)`));
  await expect.poll(() => page.locator('#outline').evaluate(
    (img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
  )).toBe(true);
  await expect.poll(() => servedArt.get(todayArt)).toBe(APPROVED_ART_SHA256[todayArt]);
  const first = await page.evaluate(() => {
    const labels = regionMask.labels as Uint32Array;
    const counts = new Map<number, number>();
    for (const id of labels) if (id) counts.set(id, (counts.get(id) || 0) + 1);
    const chosen = [...counts].filter(([,count]) => count >= 100 && count <= 20000).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if (!chosen) throw new Error('No test coloring region available');
    const i = labels.findIndex(id => id === chosen);
    return { x: i % cv.width, y: Math.floor(i / cv.width), card: num };
  });
  await page.locator('#fill').click();
  await page.locator('#paint').evaluate((canvas, point) => {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 4, pointerType: 'mouse',
      clientX: rect.left + (point.x + 0.5) * rect.width / canvas.width,
      clientY: rect.top + (point.y + 0.5) * rect.height / canvas.height,
    }));
  }, first);
  await expect(page.locator('#notice')).toContainText('Section filled');
  for (let i=0; i<6; i++) await page.locator('#yesterday').click();
  await page.locator('#today').click();
  await page.waitForFunction((card) => !!regionMask && !paintLoading && num === Number(card) &&
    regionMask.width === cv.width && regionMask.height === cv.height, firstCard, { timeout: 30000 });
  const restored = await page.evaluate(({x,y}) => {
    const c = document.getElementById('fillPaint') as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(x,y,1,1).data];
  }, first);
  expect(restored).toEqual([255,204,50,255]);
  expect(pageErrors).toEqual([]);
});
