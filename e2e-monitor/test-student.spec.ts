import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openHomeSignedOut, watchForProblems } from './helpers';

// Signs in as a FICTIONAL TEST STUDENT in the separate "Testing" class
// (never a real boy) and opens tools from the map without answering anything.
//
// OFF until the owner adds two GitHub secrets for that test-only account:
//   FTT_TEST_STUDENT_NAME, FTT_TEST_STUDENT_PASSCODE
//
// The read-only guard (fixtures.ts) stops every database write and server
// call except the sign-in check itself. That check adds one count to the
// private sign-in rate limit for GitHub's computer, as any sign-in does.
//
// This repository is public, so the passcode must never appear in the report:
// it is put in the box without a recorded "fill" step, and traces are off.

const NAME = process.env.FTT_TEST_STUDENT_NAME || '';
const PASSCODE = process.env.FTT_TEST_STUDENT_PASSCODE || '';

// Traces record every step; keep them off for this file (see above).
test.use({ trace: 'off' });

// Tools opened from the map. These load without calling server functions.
const TOOLS = ['chazara', 'shorashim', 'rashi-letters', 'gematria'];

async function wipePasscodeBox(page: Page) {
  await page.locator('#classPinInput').evaluate((box: HTMLInputElement) => { box.value = ''; }).catch(() => {});
}

/** Signs in from the home page form; the tool map must open. */
async function signIn(page: Page) {
  await page.locator('#studentNameInput').fill(NAME);
  // Type the passcode and press the button in one step, so no failing
  // Playwright action can capture the page while the box holds it.
  await page.evaluate(value => {
    const box = document.getElementById('classPinInput') as HTMLInputElement;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    (document.getElementById('studentSignInBtn') as HTMLButtonElement).click();
  }, PASSCODE);
  // Wait without asserting, empty the box, and only then check: failure
  // files include a text copy of the page.
  const games = page.locator('#gamesArea');
  await games.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => !/Checking|Opening/.test(document.getElementById('loginMsg')?.textContent || ''), null, { timeout: 30_000 }).catch(() => {});
  await wipePasscodeBox(page);
  // On failure the screenshot shows the sign-in message under the button.
  await expect(games, 'the tool map should open after sign-in').toBeVisible({ timeout: 1_000 });
}

test.describe('Test student account', () => {
  test.skip(!NAME || !PASSCODE, 'No test student secrets set; signed-in checks are off.');
  // One sign-in per run.
  test.describe.configure({ retries: 0 });
  test.afterEach(async ({ page }) => wipePasscodeBox(page));

  test('signs in, opens tools, switches student, and signs in again', async ({ page, baseURL }) => {
    // Sign-in plus four tools, each allowed up to a minute on a slow day.
    test.setTimeout(300_000);
    const problems = watchForProblems(page, new URL(baseURL!).origin);
    await openHomeSignedOut(page);
    const games = page.locator('#gamesArea');
    await signIn(page);
    await expect(page.locator('#studentNameLabel')).not.toBeEmpty();
    await expect(page.locator('#loginCard')).toBeHidden();

    // Open tools from the map the way a student does, then come back.
    const opened: string[] = [];
    for (const id of TOOLS) {
      await test.step(`open ${id}`, async () => {
        const card = page.locator(`a.game-card[data-game-id="${id}"]`);
        if (!(await card.isVisible())) {
          test.info().annotations.push({ type: 'note', description: `${id} is hidden or locked for the test class` });
          return;
        }
        await card.click();
        await page.waitForLoadState('load');
        await page.waitForTimeout(6_000);
        // A signed-in student must not be sent back to the sign-in page.
        const path = new URL(page.url()).pathname;
        expect(['/', '/index.html'], `${id} should stay open for a signed-in student`).not.toContain(path);
        // Pages keep a hidden "please sign in" panel; only a visible one is a problem.
        await expect(page.getByText(/sign in on Fun Torah Tools|Please sign in again/i).filter({ visible: true })).toHaveCount(0);
        opened.push(id);
        await page.goto('./');
        await expect(games).toBeVisible({ timeout: 60_000 });
      });
    }
    expect(opened.length, 'at least one tool should be open for the test class').toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Switch student' }).click();
    await expect(page.locator('#studentNameInput')).toBeVisible({ timeout: 30_000 });
    await expect(games).toBeHidden();
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
