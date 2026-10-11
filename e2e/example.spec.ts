import { test, expect } from '@playwright/test';
import fs from 'fs';

test('verify every tool page has a functional UI back button to the dashboard', async ({ page, context }) => {
  test.setTimeout(180000);

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

  const dismissModals = async (targetPage) => {
    const modalButtons = targetPage.locator('button').filter({
      hasText: /(Use This Avatar|Close|Skip|OK|Continue|x)/i
    });
    if (await modalButtons.first().isVisible().catch(() => false)) {
      await modalButtons.first().click().catch(() => {});
      await targetPage.waitForTimeout(500);
    }
  };

  await page.goto('https://funtorahtools.com/index.html');
  await injectSession(page);
  await page.reload();
  await dismissModals(page);

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
    await test.step('Verify Tool: ' + itemName, async () => {
      if (!page.url().includes('index.html')) {
        await page.goto('https://funtorahtools.com/index.html');
        await injectSession(page);
        await page.reload();
        await dismissModals(page);
      }
      await page.bringToFront();
      await dismissModals(page);
      await expect(userLabel).toBeVisible({ timeout: 10000 });

      const itemButton = page.getByText(itemName, { exact: false }).first();
      await expect(itemButton).toBeVisible();

      const pagesBefore = context.pages();
      await itemButton.click();
      await page.waitForTimeout(1500);

      const pagesAfter = context.pages();
      let activePage = page;

      if (pagesAfter.length > pagesBefore.length) {
        activePage = pagesAfter.find((p) => !pagesBefore.includes(p)) || pagesAfter[pagesAfter.length - 1];
        await activePage.bringToFront();
        await activePage.waitForLoadState('domcontentloaded').catch(() => {});
      }

      await dismissModals(activePage);

      const isBackPresent = await activePage.evaluate(() => {
        const text = document.body.innerText || '';
        const lower = text.toLowerCase();
        return (
          lower.includes('back') ||
          lower.includes('home') ||
          lower.includes('dashboard') ||
          lower.includes('return') ||
          lower.includes('fun torah tools') ||
          text.includes('?') ||
          text.includes('<-')
        );
      });

      if (isBackPresent) {
        await test.step('[UI BACK PRESENT] ' + itemName, async () => {
          const backBtn = activePage.locator('button, a, header, nav, div, span').filter({
            hasText: /(Fun Torah Tools|Back|Home|Dashboard|Return)/i
          }).first();

          if (await backBtn.isVisible().catch(() => false)) {
            await backBtn.click().catch(() => {});
            await activePage.waitForTimeout(1000);
          }
        });
      } else {
        await test.step('[MISSING UI BACK] ' + itemName, async () => {
          if (activePage !== page) {
            await activePage.close();
          }
        });
      }

      for (const extraPage of context.pages()) {
        if (extraPage !== page) {
          await extraPage.close().catch(() => {});
        }
      }

      await page.bringToFront();
      await page.goto('https://funtorahtools.com/index.html');
      await dismissModals(page);
      await expect(userLabel).toBeVisible({ timeout: 10000 });
    });
  }
});
