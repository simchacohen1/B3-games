import { test as base, expect } from '@playwright/test';
import fs from 'fs';

export const test = base.extend({
  page: async ({ page }, use) => {
    const idbData = JSON.parse(fs.readFileSync('firebase_idb.json', 'utf8'));

    // 1. Go to site
    await page.goto('https://funtorahtools.com/index.html');

    // 2. Inject IndexedDB session
    await page.evaluate((data) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('firebaseLocalStorageDb', 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.createObjectStore('firebaseLocalStorage', { keyPath: 'fkey' });
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction('firebaseLocalStorage', 'readwrite');
          const store = tx.objectStore('firebaseLocalStorage');
          data.forEach((item) => store.put(item));
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, idbData);

    // 3. Reload to restore session
    await page.reload();

    // 4. Run the actual test
    await use(page);
  },
});

export { expect };
