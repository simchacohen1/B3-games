import { test, expect } from '@playwright/test';
import fs from 'fs';

test('click and verify all dashboard icons', async ({ page }) => {
  const idbData = JSON.parse(fs.readFileSync('firebase_idb.json', 'utf8'));

  // 1. Load domain and inject IndexedDB session
  await page.goto('https://funtorahtools.com/index.html');
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
  await page.reload();

  // 2. Cycle through all icons on the dashboard
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
    const itemButton = page.getByText(itemName, { exact: false }).first();
    await expect(itemButton).toBeVisible();
    await itemButton.click();
    await page.waitForTimeout(800);
    await page.goto('https://funtorahtools.com/index.html');
    await expect(page.getByText('Simcha Cohen')).toBeVisible();
  }
});
