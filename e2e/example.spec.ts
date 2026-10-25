import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://funtorahtools.com';
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.txt': 'text/plain'
};

test('verify every tool page can navigate back to the dashboard', async ({ page, context }) => {
  // One journey through ten real tool pages (each loads Firebase); give it room on slower CI runners.
  test.setTimeout(120000);
  // Serve the site's own origin from this checkout, so CI checks the code under review rather than
  // whatever is currently deployed. Firebase and other third-party requests are untouched.
  await context.route(SITE + '/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, !rel || rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
    }
    await route.fulfill({
      status: 200,
      contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      body: fs.readFileSync(file)
    });
  });

  // Guest Mode is intentionally closed Mon-Thu 8:45 AM-6 PM Eastern (guest-mode.js), so pin the
  // page clock to a Sunday afternoon; timers still run normally.
  await page.clock.setFixedTime(new Date('2026-10-25T16:00:00-04:00'));
  // The "Explore as Guest" button was removed from sign-in (commit 924ce854), but Guest Mode itself
  // (guest-mode.js, flag sessionStorage b3Games_guest) still drives the read-only dashboard preview.
  // Start the session the same way enterGuest() did, without signing in or using any credentials.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('b3Games_guest', '1');
      sessionStorage.setItem('b3GuestTourDone', '1');
    } catch (e) {}
  });

  const HOME = SITE + '/index.html';
  // Tool pages are often <tool>/index.html too, so compare the whole path, not the file name.
  const isHome = (url: string | URL) => ['/', '/index.html'].includes(new URL(String(url)).pathname);

  await page.goto(HOME);
  await expect(page.locator('#studentNameLabel')).toHaveText('Guest', { timeout: 30000 });

  const dashboardItems = [
    'Posuk Practice Scroll',
    'Chazara Chart',
    'Shorashim',
    'Rashi Letters',
    'Yiddish',
    'Halacha',
    'Gematria',
    'Class Gallery',
    'Student Rewards',
    'Teacher Tools'
  ];

  for (const itemName of dashboardItems) {
    if (!isHome(page.url())) {
      await page.goto(HOME);
      await expect(page.locator('#studentNameLabel')).toHaveText('Guest', { timeout: 30000 });
    }
    await page.bringToFront();

    const itemButton = page.getByText(itemName, { exact: false }).first();
    await expect(itemButton).toBeVisible({ timeout: 10000 });

    const pagesBefore = context.pages();
    await itemButton.click();
    // Some items open a tool (same tab or new tab); guest-locked items only show a "Sign in" popup.
    await page.waitForURL(url => !isHome(url), { timeout: 3000 }).catch(() => {});

    const pagesAfter = context.pages();

    if (pagesAfter.length > pagesBefore.length) {
      const newTab = pagesAfter.find(p => !pagesBefore.includes(p)) || pagesAfter[pagesAfter.length - 1];
      await newTab.waitForLoadState('domcontentloaded').catch(() => {});
      await newTab.close();
      await page.bringToFront();
    } else if (!isHome(page.url())) {
      // A tool opened in this tab: it must offer a visible way back that lands on the dashboard.
      const backUiElement = page.locator('a, button').filter({
        hasText: /Fun Torah Tools|Back|Dashboard/i
      }).filter({ visible: true }).first();
      await expect(backUiElement, `${itemName} (${page.url()}) has a visible back control`).toBeVisible({ timeout: 10000 });
      await backUiElement.click();
      await expect.poll(() => isHome(page.url()), { message: `${itemName} back control returns to the dashboard` }).toBe(true);
    }
  }
});
