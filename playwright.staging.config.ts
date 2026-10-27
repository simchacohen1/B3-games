import { defineConfig, devices } from '@playwright/test';

// Unattended checks against the isolated staging site (issue #390).
// Kept separate from playwright.config.ts so the normal PR suite never
// calls the network, and these checks never run against local files.
export default defineConfig({
  testDir: './e2e-staging',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry absorbs a single network blip without opening an issue.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90000,
  reporter: [
    ['line'],
    ['json', { outputFile: 'staging-results/results.json' }],
  ],
  outputDir: 'staging-results/evidence',
  use: {
    // Traces and videos would record typed passcodes, so they stay off.
    // Failure screenshots show the passcode box only as dots.
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
        },
      },
    },
  ],
});
