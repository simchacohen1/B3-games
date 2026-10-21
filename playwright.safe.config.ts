import { defineConfig, devices } from '@playwright/test';

/**
 * Explicitly isolated Playwright entry point.
 * Only *.safe.spec.ts files are discoverable; no server, production credentials,
 * storage state, Firebase project or global setup is configured.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.safe.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 15000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-safe', open: 'never' }]],
  outputDir: 'test-results-safe',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:8099',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-safe', use: { ...devices['Desktop Chrome'] } }],
});
