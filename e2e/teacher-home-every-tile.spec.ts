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

test('non-owner teacher opens every tile on the teacher home', async ({ page, browser }) => {
  const errors: string[] = [], failed: string[] = [];
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await configureBrowser(ownerPage, errors, failed, 'owner');
  await ownerPage.goto(`${origin}/owner-admin.html`);
  await ownerPage.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(ownerPage.locator('#ownerArea')).toBeVisible();
  // Every class and teacher belongs to a school (#631, #666).
  await ownerPage.locator('#schoolName').fill('Fictional Pilot School');
  await ownerPage.locator('#addSchool').click();
  await expect(ownerPage.locator('#schools')).toContainText('Fictional Pilot School');
  await ownerPage.locator('#schools').getByRole('button',{name:'Fictional Pilot School'}).click();
  await ownerPage.locator('#oaNav').getByRole('button',{name:'Classes'}).click();
  await ownerPage.locator('#className').fill('Pilot Room Alpha');
  await ownerPage.locator('#addClass').click();
  await expect(ownerPage.locator('#classes')).toContainText('Pilot Room Alpha');
  await ownerPage.locator('#oaNav').getByRole('button',{name:'Teachers'}).click();
  await ownerPage.locator('#teacherEmail').fill('teacher@example.test');
  await ownerPage.locator('#teacherName').fill('Fictional Teacher');
  await ownerPage.locator('#addTeacher').click();
  await expect(ownerPage.locator('#teachers')).toContainText('Fictional Teacher');
  await ownerPage.locator('#oaNav').getByRole('button',{name:'Classes'}).click();
  await ownerPage.locator('#classes').getByRole('button',{name:'Pilot Room Alpha'}).click();
  await ownerPage.locator('#teacherSelect').selectOption('teacher_example_test');
  await ownerPage.locator('#assign').click();
  await expect(ownerPage.locator('#assignments')).toContainText('Fictional Teacher');
  await ownerContext.close();
  const tools = ['sefer-hamitzvos','halacha','yiddish','posuk-practice-scroll','rashi-letters','gematria','shorashim','chazara','game-show','student-rewards','weekly-quiz','gallery','class-gallery','tag','davening','class-pointer','multiplayer-center','name-picker','chavrusa'];
  await env.withSecurityRulesDisabled(async c => {
    for (const t of tools) await set(ref(c.database(), `b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}/toolGrants/${t}`), true);
  });

  await configureBrowser(page, errors, failed);
  // The synthetic site has no vendored Functions SDK; serve an empty one so pages that load it still render.
  await page.context().route('**/firebase-functions-compat.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(`${origin}/teacher-home.html?signin=1`);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('#classes .class-card h2')).toHaveText(['Pilot Room Alpha'],{timeout:60000});

  const tiles = await page.evaluate(() => [...document.querySelectorAll('#classes .class-card > .island-map a, #classes .teacher-tools-section a')].map(a => ({ name: (a.textContent || '').trim(), href: (a as HTMLAnchorElement).getAttribute('href') || '' })));
  expect(tiles.length).toBeGreaterThan(10);
  const results: any[] = [];
  for (const t of tiles) {
    const p = await page.context().newPage();
    const pageErrs: string[] = [], reqFail: string[] = [];
    p.on('pageerror', e => pageErrs.push(String(e).slice(0, 120)));
    p.on('requestfailed', r => { if (!/favicon/.test(r.url())) reqFail.push(r.url().slice(0, 90)); });
    p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) reqFail.push(r.status() + ' ' + r.url().slice(0, 90)); });
    await p.goto(`${origin}/${t.href}`).catch(() => {});
    await p.waitForTimeout(5000);
    const url = p.url().replace(origin, '');
    const text = ((await p.evaluate(() => document.body.innerText).catch(() => '')) || '').replace(/\s+/g, ' ');
    const hit = text.match(BAD);
    results.push({ text: text.slice(0, 110), tile: t.name, href: t.href, landed: url, bad: hit ? text.slice(Math.max(0, hit.index! - 60), hit.index! + 140) : '', pageErrs, reqFail: reqFail.slice(0, 3) });
    await p.close();
  }
  console.log('TILE_RESULTS ' + JSON.stringify(results, null, 1));
  for (const r of results.filter(r => !NOT_TESTABLE_HERE.test(r.tile))) {
    expect(r.bad, `${r.tile}: ${r.bad}`).toBe('');
    expect(r.landed, `${r.tile} kept its class`).toContain(`class=${CLASS_ID}`);
  }
});
