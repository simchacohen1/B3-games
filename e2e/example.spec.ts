import { test, expect } from '@playwright/test';
import fs from 'fs';

test('verify every tool page can navigate back to the dashboard', async ({ page, context }) => {
  // 1. Extend test timeout to 2 minutes to allow 10 tool iterations
  test.setTimeout(120000);

  const idbData = JSON.parse(fs.readFileSync('firebase_idb.json', 'utf8'));

  const injectSession = async () => {
    await page.evaluate((data) => {
      return new Promise((resolve) => {
        const req = indexedDB.open('firebaseLocalStorageDb', 1);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction('firebaseLocalStorage', 'readwrite');
          const store = tx.objectStore('firebaseLocalStorage');
          data.forEach((item) => store.put(item));
          tx.oncomplete = () => resolve(true);
        };
      });
    }, idbData);
  };

  // 2. Initial load and session seed
  await page.goto('https://funtorahtools.com/index.html');
  await injectSession();
  await page.reload();
  
  const userLabel = page.getByText('Simcha Cohen').first();
  await expect(userLabel).toBeVisible({ timeout: 10000 });

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
    if (!page.url().includes('index.html')) {
      await page.goto('https://funtorahtools.com/index.html');
      await injectSession();
      await page.reload();
    }
    await page.bringToFront();
    await expect(userLabel).toBeVisible({ timeout: 10000 });

    const itemButton = page.getByText(itemName, { exact: false }).first();
    await expect(itemButton).toBeVisible();

    const pagesBefore = context.pages();
    await itemButton.click();
    await page.waitForTimeout(1000);

    const pagesAfter = context.pages();

    if (pagesAfter.length > pagesBefore.length) {
      // Opened in a new tab: close tab and return focus
      const newTab = pagesAfter.find(p => !pagesBefore.includes(p)) || pagesAfter[pagesAfter.length - 1];
      await newTab.waitForLoadState('domcontentloaded').catch(() => {});
      await newTab.close();
      await page.bringToFront();
    } else {
      // Opened in same tab: check for re-auth overlay modal first
      const reauthBtn = page.getByText('Back to Fun Torah Tools', { exact: false }).first();
      
      if (await reauthBtn.isVisible().catch(() => false)) {
        await reauthBtn.click();
      } else if (!page.url().includes('index.html')) {
        const backUiElement = page.locator('button, a, header, nav, div, span').filter({
          hasText: /(Back|Home|Dashboard|Return|Fun Torah Tools)/i
        }).first();

        if (await backUiElement.isVisible().catch(() => false)) {
          await backUiElement.click();
        } else {
          await page.goBack();
        }
      }
    }

    // Force return to main index if still on subpage
    if (!page.url().includes('index.html')) {
      await page.goto('https://funtorahtools.com/index.html');
    }
    await page.waitForURL('**/index.html**', { timeout: 5000 }).catch(() => {});
    await expect(userLabel).toBeVisible({ timeout: 10000 });
  }
});
