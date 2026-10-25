import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
  await page.goto('https://sefer.local.test/sefer-hamitzvos/index.html');
  // Base artwork and approved replacement artwork both use valid coloring paths.
  await expect(page.locator('#outline')).toHaveAttribute('src', /coloring(?:-v2)?\/\d+\.png$/);
  await expect.poll(() => page.locator('#outline').evaluate(
    (img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
  )).toBe(true);
  await page.waitForFunction(() => typeof regionMask !== 'undefined' && !!regionMask && !paintLoading, { timeout: 30000 });
  const firstCard = await page.locator('#card').inputValue();
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
