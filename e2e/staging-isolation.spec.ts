import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test.use({ video: 'off' });

const config = {
  apiKey: 'synthetic-staging-key',
  authDomain: 'fun-torah-tools-staging.firebaseapp.com',
  databaseURL: 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com',
  projectId: 'fun-torah-tools-staging',
  storageBucket: 'fun-torah-tools-staging.firebasestorage.app',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:synthetic'
};
const guardSource = fs.readFileSync(path.resolve(__dirname, '../staging/staging-config.js'), 'utf8');

function guardScript(firebaseConfig: typeof config) {
  return 'window.B3_STAGING_FIREBASE_CONFIG = ' + JSON.stringify(firebaseConfig) +
    '; try { (0, eval)(' + JSON.stringify(guardSource) + '); } catch (_) {}';
}

test.describe('staging production isolation', () => {
  test('initializes only with the staging Firebase config and blocks production requests', async ({ page }) => {
    await page.goto('about:blank');
    await page.evaluate(guardScript(config));
    const result = await page.evaluate(async () => {
      let blocked = '';
      try { await fetch('https://us-central1-b3-games.cloudfunctions.net/privateMediaUrl'); }
      catch (error) { blocked = String(error); }
      return {
        ready: (window as any).B3_STAGING_READY === true,
        blocked: blocked.includes('Blocked a request to a production'),
        marked: (window as any).__B3_STAGING_BLOCKED__ === true
      };
    });
    expect(result).toEqual({ ready: true, blocked: true, marked: true });
  });

  test('refuses to start when the supplied Firebase project is production', async ({ page }) => {
    await page.goto('about:blank');
    await page.evaluate(guardScript({ ...config, projectId: 'b3-games' }));
    expect(await page.evaluate(() => (window as any).__B3_STAGING_BLOCKED__ === true)).toBe(true);
    expect(await page.evaluate(() => (window as any).B3_STAGING_READY === true)).toBe(false);
  });
});
