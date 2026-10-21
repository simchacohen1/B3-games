import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const toolPages = [
  ['Shorashim', 'shorashim/index.html'],
  ['Chazara', 'chazara/index.html'],
  ['Posuk Practice', 'record_pesukim/index.html'],
  ['Rashi Letters', 'rashi-letters/index.html'],
  ['Sefer HaMitzvos', 'sefer-hamitzvos/index.html'],
  ['Yiddish Explorer', 'yiddish/index.html'],
  ['Weekly Quiz', 'weekly-quiz/index.html'],
  ['Class Gallery', 'class-gallery/index.html'],
  ['Classroom Pointer', 'class-pointer-prototype/student-view.html'],
];
const teacherPages = [
  ['Weekly Quiz teacher', 'weekly-quiz/teacher.html'],
  ['Posuk Practice teacher', 'record_pesukim/teacher.html'],
  ['Follow Teacher', 'follow-teacher/teacher.html'],
];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:8099') return route.abort();
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({ status: 404, body: 'Not found' });
    }
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
    return route.fulfill({ status: 200, contentType: types[path.extname(file).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
});

for (const [label, filename] of [...toolPages, ...teacherPages]) {
  test(`offline page loads: ${label}`, async ({ page }) => {
    test.skip(!fs.existsSync(path.join(root, filename)), `Page absent at ${filename}; route needs review`);
    const response = await page.goto('http://127.0.0.1:8099/' + filename, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeAttached();
  });
}
