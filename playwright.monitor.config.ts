import { defineConfig, devices } from '@playwright/test';

/**
 * Daily reliability checks against the LIVE website (not a local copy).
 * Separate from playwright.config.ts so the normal PR tests are unchanged.
 *
 *   npx playwright test --config playwright.monitor.config.ts
 *
 * SITE_URL can point at another copy of the site (default: funtorahtools.com).
 */
export default defineConfig({
  testDir: './e2e-monitor',
  outputDir: './monitor-results',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 2,
  forbidOnly: !!process.env.CI,
  // One retry hides a single slow network blip; a real outage still fails.
  retries: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'monitor-report', open: 'never' }],
    ['json', { outputFile: 'monitor-report/results.json' }],
  ],
  use: {
    baseURL: (process.env.SITE_URL || 'https://funtorahtools.com').replace(/\/?$/, '/'),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // Students often use Chromebooks/tablets: one phone-size pass on the home page.
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
});
