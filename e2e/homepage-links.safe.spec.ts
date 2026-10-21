import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const homepage = path.join(root, 'index.html');

test('homepage local links point to existing files', async ({ page }) => {
  test.skip(!fs.existsSync(homepage), 'Homepage not present');
  const html = fs.readFileSync(homepage, 'utf8');
  const hrefs = [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const missing: string[] = [];
  for (const href of hrefs) {
    if (/^(https?:|mailto:|tel:|javascript:|#|\/\/|data:)/i.test(href)) continue;
    const pathname = href.split(/[?#]/)[0];
    if (!pathname || /\$\{|\{\{/.test(pathname)) continue;
    const absolute = path.resolve(root, pathname.replace(/^\/+/, ''));
    if (!absolute.startsWith(root + path.sep) && absolute !== root) continue;
    if (!fs.existsSync(absolute) && !fs.existsSync(path.join(absolute, 'index.html'))) missing.push(href);
  }
  expect(missing, 'Missing local link targets').toEqual([]);
});

test('homepage has a readable document title', async ({ page }) => {
  test.skip(!fs.existsSync(homepage), 'Homepage not present');
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:8099') return route.abort();
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      return route.fulfill({ status: 404, body: 'Not found' });
    }
    const ext = path.extname(absolute);
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(absolute) });
  });
  await page.goto('http://127.0.0.1:8099/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/\S+/);
});
