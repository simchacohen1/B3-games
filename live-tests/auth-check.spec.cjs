const { test, expect } = require('@playwright/test');

test('verify logged in dashboard', async ({ page }) => {
  const name = process.env.FTT_TEACHER_DISPLAY_NAME;
  expect(name, 'Set FTT_TEACHER_DISPLAY_NAME for a dedicated test teacher').toBeTruthy();
  // Navigate to main dashboard
  await page.goto('https://funtorahtools.com/index.html');

  // Verify logged in user name
  await expect(page.getByText(name, { exact: true })).toBeVisible();
});
