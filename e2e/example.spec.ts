import { test, expect } from '@playwright/test';

// The old "Explore as Guest" button was removed (Oct 15), so a signed-out visitor can no longer
// open the tool dashboard. This now checks what a signed-out visitor can actually see.
test('signed-out home page shows the student sign-in form and passcode box', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('https://funtorahtools.com/index.html');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByText('Student Sign In').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByPlaceholder(/name/i).first().or(page.getByLabel(/name/i).first())).toBeVisible();
  await expect(page.getByText('Passcode').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
