import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const pages = ['index.html', 'student.html', 'teacher.html'];

/**
 * Synthetic, offline smoke tests: render repository HTML, not the live website.
 * Local scripts/styles/images are served from the repository when available;
 * ALL other requests are blocked, including Firebase and live APIs.
 */
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== 'http://127.0.0.1:8099') {
      return route.abort();
    }
    const requested = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
    const absolute = path.resolve(root, requested);
    if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      return route.fulfill({ status: 404, body: 'Not found' });
    }
    const ext = path.extname(absolute).toLowerCase();
    const types: Record<string, string> = {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
      '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    };
    return route.fulfill({ status: 200, contentType: types[ext] || 'application/octet-stream', body: fs.readFileSync(absolute) });
  });
});

for (const file of pages) {
  test(`offline repository smoke: ${file}`, async ({ page }) => {
    test.skip(!fs.existsSync(path.join(root, file)), `Repository does not contain ${file}`);
    await page.goto('/' + file, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeAttached();
    expect(await page.locator('body').innerText()).not.toBe('');
  });
}
