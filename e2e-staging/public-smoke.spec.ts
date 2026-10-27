import { test, expect } from '@playwright/test';
import { SITE, TOOL_PAGES, watchPage, expectStagingIsolation } from './staging-common';

// Anonymous checks: no credentials needed. Runs every 30 minutes.
// A green result here says nothing about signed-in student or teacher flows.

test.describe('staging public smoke @smoke', () => {
  for (const tool of TOOL_PAGES) {
    test(`${tool.name} loads on staging without production calls @isolation`, async ({ page }) => {
      const watch = watchPage(page);
      const response = await page.goto(SITE + tool.path, { waitUntil: 'load', timeout: 45000 });
      expect(response?.status(), 'HTTP status').toBe(200);
      await expectStagingIsolation(page);
      // Give late scripts (Firebase, polling) a moment to make their first calls.
      await page.waitForTimeout(2500);
      expect(watch.pageErrors, 'uncaught page errors').toEqual([]);
      expect(watch.productionRequests, 'requests to production hosts').toEqual([]);
    });
  }

  test('home page shows the student sign-in form @signin', async ({ page }) => {
    const watch = watchPage(page);
    await page.goto(SITE + '/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#studentNameInput')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#classPinInput')).toHaveAttribute('type', 'password');
    await expect(page.locator('#studentSignInBtn')).toBeVisible();
    expect(watch.productionRequests).toEqual([]);
  });

  test('anonymous visitors cannot read private staging data @permissions', async ({ page }) => {
    await page.goto(SITE + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as any).firebase?.database, null, { timeout: 30000 });
    const results = await page.evaluate(async () => {
      const db = (window as any).firebase.database();
      const paths = [
        'b3Games/students',
        'b3Games/workspaces/b3-2026/classes',
        'b3Private',
      ];
      const out: Record<string, string> = {};
      for (const path of paths) {
        try {
          await db.ref(path).once('value');
          out[path] = 'READABLE';
        } catch (error: any) {
          out[path] = String(error?.code || error?.message || 'denied');
        }
      }
      return out;
    });
    for (const [path, outcome] of Object.entries(results)) {
      expect(outcome, `anonymous read of ${path}`).not.toBe('READABLE');
    }
  });
});
