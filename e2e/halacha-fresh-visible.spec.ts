import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Real Halacha page, opened from disk with the sign-in gate stubbed and Firebase blocked.
// Guards against the Oct 22 bug where a Sefer-style CSS rule hid the new Siman Beis/Gimmel lessons (blank page).
const pageUrl = pathToFileURL(path.resolve(process.cwd(), 'halacha/index.html')).href;

async function openStudentHalacha(page: any) {
  await page.addInitScript(() => {
    sessionStorage.setItem('b3Games_studentId', 'test_student');
    sessionStorage.setItem('b3Games_studentClass', 'et');
  });
  await page.route('**/game-gate.js*', (route: any) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/gstatic\.com|firebaseio\.com|googleapis\.com|cloudfunctions\.net/, (route: any) => route.abort());
  await page.goto(pageUrl);
  await page.waitForFunction(() => typeof (window as any).refreshHubLocks === 'function' && document.querySelector('button.simanCard'));
  await page.waitForTimeout(3500); // let the (blocked) class-access lookup finish before unlocking for the test
  // HALACHA_MAX_SIMAN is a page-level 'let', so it can only be set by running code inside the page.
  await page.evaluate("HALACHA_MAX_SIMAN='ו';refreshHubLocks()");
}

for (const [siman, firstTab] of [['ב', 's2a'], ['ג', 's3a']]) {
  test(`Siman ${siman}: the first lesson is visible (not blank) with Hebrew text and a picture`, async ({ page }) => {
    await openStudentHalacha(page);
    await page.locator('button.simanCard', { hasText: 'סימן ' + siman }).first().click();
    const root = page.locator(`#${firstTab} .fresh-siman-root`);
    await expect(root).toBeVisible();
    await expect(root.locator('.fresh-source').first()).toBeVisible();
    await expect(root.locator('.fresh-art img').first()).toBeVisible();
    const hebrew = await root.locator('.fresh-source').first().innerText();
    expect(hebrew.length).toBeGreaterThan(40);
  });
}

test('every Siman Beis and Gimmel lesson shows its content when its tab is opened', async ({ page }) => {
  await openStudentHalacha(page);
  const ids: string[] = await page.evaluate("lessons.filter(l => ['ב','ג'].includes(simanOfLesson(l))).map(l => l.id)");
  expect(ids.length).toBeGreaterThanOrEqual(13);
  for (const id of ids) {
    await page.evaluate("show('" + id + "')");
    const section = page.locator(`#${id}`);
    await expect(section).toBeVisible();
    const box = await section.boundingBox();
    expect(box && box.height, `lesson ${id} must not be blank`).toBeGreaterThan(300);
  }
});
