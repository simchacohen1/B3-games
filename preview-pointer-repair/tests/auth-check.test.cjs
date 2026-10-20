const { test, expect } = require('@playwright/test');

test('verify logged in dashboard', async ({ page }) => {
  // Navigate to main dashboard
  await page.goto('https://funtorahtools.com/index.html');

  // Verify logged in user name
  await expect(page.getByText('Simcha Cohen')).toBeVisible();
});