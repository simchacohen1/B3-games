import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Real-browser check of object-aware coloring on the actual page (synthetic student, no real data).
const shots = process.env.FTT_SHOTS || '';

async function openSefer(page: Page) {
  const root = process.cwd();
  await page.addInitScript(() => {
    sessionStorage.setItem('b3Games_studentId', 'synthetic-sefer-objects');
    sessionStorage.setItem('b3Games_studentClass', 'et');
    (window as any).B3SiteSettings = {
      onAuthStateChanged: (callback: Function) => callback({}, true, { authorized: true, role: 'teacher' })
    };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.gstatic.com' || url.pathname.endsWith('/game-gate.js') ||
        url.pathname.endsWith('/firebase-config.js') || url.pathname.endsWith('/gallery-share.js') ||
        url.pathname.includes('/word-bank/') || url.pathname.includes('/class-pointer-prototype/')) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return;
    }
    if (url.hostname !== 'sefer.local.test') { await route.abort(); return; }
    const requested = decodeURIComponent(url.pathname).replace(/^\//, '');
    const filename = path.resolve(root, requested || 'sefer-hamitzvos/index.html');
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      await route.fulfill({ status: 404, body: '' }); return;
    }
    const type = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.html') ? 'text/html'
      : filename.endsWith('.js') ? 'application/javascript' : 'text/plain';
    await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(filename) });
  });
  await page.goto('https://sefer.local.test/sefer-hamitzvos/index.html');
  await page.waitForFunction(() => typeof regionMask !== 'undefined' && !!regionMask && !paintLoading, { timeout: 60000 });
}

async function loadCard(page: Page, card: number) {
  await page.evaluate(n => (window as any).load(n), card);
  await page.waitForFunction(n => num === n && !!regionMask && !paintLoading && !!regionMask.object, card, { timeout: 60000 });
}

// Click a native-picture pixel with the real mouse (page coordinates, any zoom).
async function tap(page: Page, x: number, y: number) {
  const box = await page.evaluate(([px, py]) => {
    const c = document.getElementById('paint') as HTMLCanvasElement;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + (px + 0.5) * r.width / c.width, y: r.top + (py + 0.5) * r.height / c.height };
  }, [x, y]);
  await page.mouse.click(box.x, box.y);
}
// Same click, delivered as a pointer event on the canvas (steady across browsers when many clicks run in a row).
async function tapEvent(page: Page, x: number, y: number) {
  await page.locator('#paint').evaluate((canvas, p) => {
    const r = canvas.getBoundingClientRect(), c = canvas as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'mouse', clientX: r.left + (p.x + 0.5) * r.width / c.width, clientY: r.top + (p.y + 0.5) * r.height / c.height }));
  }, { x, y });
}
const pixel = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => {
  const c = document.getElementById('fillPaint') as HTMLCanvasElement;
  return [...c.getContext('2d')!.getImageData(px, py, 1, 1).data];
}, [x, y]);

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1 });

test('one click fills the whole pants (all strips between fold lines) and nothing around it', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openSefer(page); await loadCard(page, 475);
  await page.locator('#fill').click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  const strips: [number, number][] = [[205, 800], [380, 800], [266, 914], [270, 795]];
  await tap(page, ...strips[0]);
  await expect(page.locator('#notice')).toContainText('Section filled');
  for (const s of strips) expect(await pixel(page, ...s), `strip ${s}`).toEqual([25, 118, 210, 255]);
  for (const s of [[1018, 861], [1162, 848], [160, 1010], [305, 800], [345, 522], [345, 640]] as [number, number][])
    expect((await pixel(page, ...s))[3], `neighbour ${s} stays empty`).toBe(0);
  expect(await page.evaluate(() => strokes.at(-1).objectVersion)).toBe(2);
  if (shots) await page.locator('.art').screenshot({ path: path.join(shots, '1-pants-one-click-475.png') });
  expect(errors).toEqual([]);
});

test('hands, sleeves, faces, shirts, shoes and belts: each curated object fills whole with no leak', async ({ page }) => {
  test.setTimeout(600000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openSefer(page);
  let checked = 0;
  for (const card of [475, 478, 479, 480]) {
    await loadCard(page, card);
    await page.locator('#fill').click();
    const groups: { name: string; join: [number, number][] }[] = await page.evaluate(c => (window as any).FTT_SEFER_REGION_GROUPS[c], card);
    expect(groups.length).toBeGreaterThanOrEqual(9);
    for (const g of groups) {
      await page.evaluate(() => { strokes = []; (window as any).rebuildFillLayer(); });
      await tapEvent(page, ...g.join[0]);
      // The fill finishes a moment after the tap (slower in Firefox/WebKit), so wait until something is colored.
      await page.waitForFunction(() => {
        const f = document.getElementById('fillPaint') as HTMLCanvasElement;
        const d = f.getContext('2d')!.getImageData(0, 0, f.width, f.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
        return false;
      }, null, { timeout: 30000 });
      const r = await page.evaluate(group => {
        const o = regionMask.object, w = o.width, id = o.labels[Math.floor(group.join[0][1]) * w + Math.floor(group.join[0][0])];
        const fill = (document.getElementById('fillPaint') as HTMLCanvasElement), px = fill.getContext('2d')!.getImageData(0, 0, fill.width, fill.height).data;
        let colored = 0, wrong = 0;
        for (let i = 0; i < o.labels.length; i++) if (px[i * 4 + 3]) { colored++; if (o.labels[i] !== id) wrong++; }
        const expected = (window as any).FTTMitzvahFill.regionFromObjects(o, group.join[0][0], group.join[0][1]).pixels.length;
        const pieces = group.join.map((p: number[]) => px[(Math.floor(p[1]) * w + Math.floor(p[0])) * 4 + 3]);
        return { colored, wrong, expected, pieces, share: colored / o.labels.length };
      }, g);
      expect(r.wrong, `${card} ${g.name}: no pixel outside the object`).toBe(0);
      expect(r.colored, `${card} ${g.name}: whole object`).toBe(r.expected);
      expect(r.pieces.every((a: number) => a === 255), `${card} ${g.name}: every named piece colored`).toBe(true);
      expect(r.share, `${card} ${g.name} is not page-sized`).toBeLessThan(0.06);
      checked++;
    }
  }
  console.log('objects checked in the browser:', checked);
  expect(errors).toEqual([]);
});

test('colored pictures with detail: screenshots of pants, hands, faces, shoes', async ({ page }) => {
  test.setTimeout(300000);
  await openSefer(page);
  const palette = ['Red', 'Orange', 'Blue', 'Green', 'Purple', 'Pink', 'Brown', 'Yellow', 'Teal', 'Sky Blue'];
  for (const card of [475, 478, 479, 480]) {
    await loadCard(page, card); await page.locator('#fill').click();
    await page.evaluate(() => { strokes = []; (window as any).rebuildFillLayer(); });
    const groups: { name: string; join: [number, number][] }[] = await page.evaluate(c => (window as any).FTT_SEFER_REGION_GROUPS[c], card);
    let i = 0;
    for (const g of groups) {
      await page.getByRole('button', { name: palette[i++ % palette.length], exact: true }).click();
      await tapEvent(page, ...g.join[0]);
    }
    if (shots) await page.locator('.art').screenshot({ path: path.join(shots, `2-all-objects-colored-${card}.png`) });
  }
});

test('navigating through many detailed pictures stays responsive and aligned', async ({ page }) => {
  test.setTimeout(300000);
  await openSefer(page);
  await page.evaluate(() => {
    (window as any).__long = [];
    new PerformanceObserver(list => { for (const e of list.getEntries()) (window as any).__long.push(e.duration); }).observe({ entryTypes: ['longtask'] });
  });
  const started = Date.now();
  for (const card of [475, 476, 477, 478, 479, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 480, 475]) {
    await loadCard(page, card);
    const sizes = await page.evaluate(() => {
      const c = document.getElementById('paint') as HTMLCanvasElement, f = document.getElementById('fillPaint') as HTMLCanvasElement, o = document.getElementById('outline') as HTMLImageElement;
      return [c.width === f.width, c.height === f.height, c.width === o.naturalWidth, c.height === o.naturalHeight];
    });
    expect(sizes, `card ${card} layers aligned`).toEqual([true, true, true, true]);
  }
  const total = Date.now() - started;
  const long: number[] = await page.evaluate(() => (window as any).__long);
  console.log(`27 picture loads in ${total} ms; longest main-thread block ${Math.max(0, ...long).toFixed(0)} ms; blocks over 200 ms: ${long.filter(d => d > 200).length}`);
  expect(Math.max(0, ...long)).toBeLessThan(1500);
  // Rapid clicking Next 12 times ends on exactly one aligned picture.
  await page.evaluate(() => { for (let i = 0; i < 12; i++) (window as any).load(480 + (i % 3)); });
  await page.waitForFunction(() => !!regionMask && !paintLoading && num === 482, null, { timeout: 60000 });
  expect(await page.evaluate(() => strokes.length)).toBe(0);
});

test('line art stays above the paint, and undo/redo works through real buttons', async ({ page }) => {
  test.setTimeout(180000);
  await openSefer(page); await loadCard(page, 478);
  const order = await page.evaluate(() => {
    const z = (id: string) => Number(getComputedStyle(document.getElementById(id)!).zIndex);
    return { fill: z('fillPaint'), brush: z('paint'), art: z('outline'), blend: getComputedStyle(document.getElementById('outline')!).mixBlendMode };
  });
  expect(order.art).toBeGreaterThan(order.brush); expect(order.brush).toBeGreaterThan(order.fill); expect(order.blend).toBe('multiply');
  await page.locator('#fill').click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  await tap(page, 1100, 850);
  const colored = () => page.evaluate(() => { const c = document.getElementById('fillPaint') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  const one = await colored(); expect(one).toBeGreaterThan(30000);
  await page.getByRole('button', { name: 'Green', exact: true }).click();
  await tap(page, 1100, 850);
  expect(await colored()).toBe(one);   // repeated coloring replaces, never grows
  await page.locator('#undo').click(); expect(await pixel(page, 1100, 850)).toEqual([229, 57, 53, 255]);
  await page.locator('#undo').click(); expect(await colored()).toBe(0);
  await page.locator('#redo').click(); expect(await colored()).toBe(one);
  await page.locator('#redo').click(); expect(await pixel(page, 1100, 850)).toEqual([67, 160, 71, 255]);
  if (shots) await page.locator('.art').screenshot({ path: path.join(shots, '3-undo-redo-478.png') });
});

test('Bigger picture button enlarges the picture, coloring still works, and it can shrink back', async ({ page }) => {
  test.setTimeout(120000);
  await openSefer(page); await loadCard(page, 499);
  const width = () => page.evaluate(() => document.getElementById('paint')!.getBoundingClientRect().width);
  const small = await width();
  await page.locator('#zoom').click();
  const big = await width();
  expect(big).toBeGreaterThan(small * 1.25);
  await page.locator('#fill').click();
  const seed = await page.evaluate(() => { const L = regionMask.object.labels as Uint32Array, c = new Map<number, number>(); for (const l of L) if (l) c.set(l, (c.get(l) || 0) + 1); const id = [...c].filter(([, n]) => n > 5000 && n < 40000)[0][0]; const W = cv.width, H = L.length / W; let best = L.indexOf(id); for (let i = 0; i < L.length; i++) { if (L[i] !== id) continue; const x = i % W, y = Math.floor(i / W); let inside = x > 4 && y > 4 && x < W - 5 && y < H - 5; for (let dy = -4; inside && dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (L[(y + dy) * W + x + dx] !== id) { inside = false; break; } if (inside) { best = i; break; } } return [best % W, Math.floor(best / W)]; });
  await tapEvent(page, seed[0], seed[1]);
  await expect(page.locator('#notice')).toContainText('Section filled');
  if (shots) await page.screenshot({ path: path.join(shots, '4-bigger-picture-499.png') });
  await page.locator('#zoom').click();
  expect(await width()).toBeLessThan(big);
});
