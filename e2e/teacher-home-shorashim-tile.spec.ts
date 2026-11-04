import { test, expect } from '@playwright/test';
import http from 'node:http';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, set } from 'firebase/database';
import { PROJECT, WORKSPACE, CLASS_ID, DB_PORT, fictionalOwnerRules, serveSyntheticSite, closeSyntheticSite, configureBrowser } from './helpers/synthetic-firebase';

// Issue 410: every tile on a NON-owner teacher's home must open the teacher's own class
// without a second sign-in and without an "owner only" or "open from your teacher center" block.
test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Run with the demo Firebase Auth/Database/Functions emulators.');
test.setTimeout(480_000);
let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
let server: http.Server;
let origin: string;

const BAD = /not authorized|owner account|from your teacher|open (this tool|weekly quiz) from your|failed to fetch|could not open|not valid|not enabled|not assigned|choose an assigned|sign in again|only the owner|owner only|this class link/i;
// Student Rewards needs the live studentRewardsTeacher function (not in the emulator); Davening has no per-class page yet (issue 410).
const NOT_TESTABLE_HERE = /Student Rewards|Daily Points|Davening/;

test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, database: { host: '127.0.0.1', port: DB_PORT, rules: fictionalOwnerRules() } });
  await env.clearDatabase();
  ({ server, origin } = await serveSyntheticSite());
});
test.afterAll(async () => { await env?.cleanup(); await closeSyntheticSite(server); });

test('non-owner teacher opens Shorashim without a second sign-in', async ({ page, browser }) => {
  const errors: string[] = [], failed: string[] = [];
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await configureBrowser(ownerPage, errors, failed, 'owner');
  await ownerPage.goto(`${origin}/owner-admin.html`);
  await ownerPage.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(ownerPage.locator('#ownerArea')).toBeVisible();
  await ownerPage.locator('#className').fill('Pilot Room Alpha');
  await ownerPage.locator('#addClass').click();
  await expect(ownerPage.locator('#classes')).toContainText('Pilot Room Alpha');
  await ownerPage.locator('#teacherEmail').fill('teacher@example.test');
  await ownerPage.locator('#teacherName').fill('Fictional Teacher');
  await ownerPage.locator('#addTeacher').click();
  await expect(ownerPage.locator('#teachers')).toContainText('Fictional Teacher');
  await ownerPage.locator('#teacherSelect').selectOption('teacher_example_test');
  await ownerPage.locator('#classSelect').selectOption(CLASS_ID);
  await ownerPage.locator('#assign').click();
  await expect(ownerPage.locator('#assignments')).toContainText('Pilot Room Alpha');
  await ownerContext.close();
  const tools = ['shorashim'];
  await env.withSecurityRulesDisabled(async c => {
    for (const t of tools) await set(ref(c.database(), `b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}/toolGrants/${t}`), true);
  });

  await configureBrowser(page, errors, failed);
  // The synthetic site has no vendored Functions SDK; serve an empty one so pages that load it still render.
  await page.context().route('**/firebase-functions-compat.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(`${origin}/teacher-home.html?signin=1`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('#classes .class-card h2')).toHaveText(['Pilot Room Alpha'],{timeout:60000});

  const href = await page.evaluate(() => (document.querySelector('#classes a[data-game-id="shorashim"]') as HTMLAnchorElement | null)?.getAttribute('href') || '');
  expect(href, 'Shorashim tile carries the class').toContain(`class=${CLASS_ID}`);
  expect(href, 'no stale cache label').not.toContain('20260917');
  // Open it the way a real click does: same browser, already signed in as the teacher.
  const p = await page.context().newPage();
  await p.goto(`${origin}/${href}`);
  await expect(p.locator('#teacherApp')).toBeVisible({ timeout: 30000 });
  await expect(p.locator('#teacherGate')).toBeHidden();
  await expect(p.locator('.topbar h1')).toContainText('Pilot Room Alpha');
  // The old address the owner saw (no ?class=) must not loop on sign-in either.
  const old = await page.context().newPage();
  await old.goto(`${origin}/shorashim/teacher.html?v=20260917-correct-dashboard`);
  await expect(old.locator('#teacherApp')).toBeVisible({ timeout: 30000 });
  expect(old.url()).toContain(`class=${CLASS_ID}`);
});
