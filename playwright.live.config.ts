import { defineConfig, devices } from '@playwright/test';

// Live account/network checks are intentionally separate from isolated CI tests.
// Assertions still execute here; missing authentication is a failure, not a skip.
export default defineConfig({
  testDir: './live-tests',
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: './test-results/live',
  use: {
    ...devices['Desktop Chrome'],
    storageState: process.env.FTT_TEACHER_STORAGE_STATE,
    launchOptions: process.env.FTT_TEST_CHROMIUM
      ? { executablePath: process.env.FTT_TEST_CHROMIUM }
      : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
