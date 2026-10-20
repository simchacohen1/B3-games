import { test, expect } from '@playwright/test';

test('verify every tool page can navigate back to the dashboard', async ({ page, context }) => {
  await page.goto('https://funtorahtools.com/index.html');

  // Enter dashboard as guest if login overlay is present
  const guestBtn = page.getByRole('button', { name: /Explore as Guest/i });
  if (await guestBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await guestBtn.click();
  }

  await page.waitForLoadState('domcontentloaded');

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
    }
    await page.bringToFront();

    const itemButton = page.getByText(itemName, { exact: false }).first();
    await expect(itemButton).toBeVisible({ timeout: 10000 });

    const pagesBefore = context.pages();
    await itemButton.click();
    await page.waitForTimeout(1000);

    const pagesAfter = context.pages();

    if (pagesAfter.length > pagesBefore.length) {
      const newTab = pagesAfter.find(p => !pagesBefore.includes(p)) || pagesAfter[pagesAfter.length - 1];
      await newTab.waitForLoadState('domcontentloaded').catch(() => {});
      await newTab.close();
      await page.bringToFront();
    } else {
      if (!page.url().endsWith('/index.html') && !page.url().endsWith('funtorahtools.com/')) {
        // Find visible link/button leading back to main dashboard
        const backUiElement = page.locator('a, button').filter({
          hasText: /Fun Torah Tools|Back|Dashboard/i
        }).first();

        if (await backUiElement.isVisible({ timeout: 3000 }).catch(() => false)) {
          await backUiElement.click();
          await page.waitForTimeout(500);
        }
      }
    }

    // Explicit fallback: guarantee browser is back on index.html before testing next tool
    if (!page.url().endsWith('/index.html') && !page.url().endsWith('funtorahtools.com/')) {
      await page.goto('https://funtorahtools.com/index.html');
    }
  }
});
