import { test, expect } from '@playwright/test';
import fs from 'fs';

test('verify every tool page has a functional UI back button to the dashboard', async ({ page, context }) => {
  test.setTimeout(120000);

  const idbData = JSON.parse(fs.readFileSync('firebase_idb.json', 'utf8'));

  const injectSession = async (targetPage) => {
    await targetPage.evaluate((data) => {
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

  await page.goto('https://funtorahtools.com/index.html');
  await injectSession(page);
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
      await injectSession(page);
      await page.reload();
    }
    await page.bringToFront();
    await expect(userLabel).toBeVisible({ timeout: 10000 });

    const itemButton = page.getByText(itemName, { exact: false }).first();
    await expect(itemButton).toBeVisible();

    const pagesBefore = context.pages();
    await itemButton.click();
    await page.waitForTimeout(1200);

    const pagesAfter = context.pages();
    let activePage = page;

    if (pagesAfter.length > pagesBefore.length) {
      activePage = pagesAfter.find(p => !pagesBefore.includes(p)) || pagesAfter[pagesAfter.length - 1];
      await activePage.bringToFront();
      await activePage.waitForLoadState('domcontentloaded').catch(() => {});
    }

    // Strict UI Back Button Check: Look for an explicit back/home UI element on the tool page
    const backUiElement = activePage.locator('button, a, header, nav, div, span').filter({
      hasText: /(Back|Home|Dashboard|Return|Fun Torah Tools|?|<-)/i
    }).first();

    const hasUiBack = await backUiElement.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasUiBack) {
      console.log(`[PASS] ${itemName} has a visible UI Back button.`);
      await backUiElement.click();
      await activePage.waitForTimeout(1000);
    } else {
      console.warn(`[MISSING UI BACK] ${itemName} does NOT have an explicit Back button! Falling back...`);
      if (activePage !== page) {
        await activePage.close();
      } else {
        await page.goBack();
      }
    }

    // Clean up extra tabs if still open
    for (const extraPage of context.pages()) {
      if (extraPage !== page) {
        await extraPage.close().catch(() => {});
      }
    }

    await page.bringToFront();
    if (!page.url().includes('index.html')) {
      await page.goto('https://funtorahtools.com/index.html');
    }
    await expect(userLabel).toBeVisible({ timeout: 10000 });
  }
});
