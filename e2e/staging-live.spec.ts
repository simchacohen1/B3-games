import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://fun-torah-tools-staging.web.app';
const CREDENTIALS_PATH = path.resolve(__dirname, '../staging/test-credentials.local.json');
const credentials = fs.existsSync(CREDENTIALS_PATH)
  ? JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'))
  : null;
const forbiddenHosts = [
  'b3-games.firebaseapp.com',
  'b3-games-default-rtdb.firebaseio.com',
  'b3-games.firebasestorage.app',
  'us-central1-b3-games.cloudfunctions.net',
  'posuk-scorer.onrender.com',
  'nigrisync.onrender.com'
];

function account(role: string) {
  const row = credentials?.adultAccounts?.find((item: any) => item.role === role);
  if (!row) throw new Error('Missing local staging account: ' + role);
  return row;
}

function watchForProductionRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', request => {
    if (forbiddenHosts.some(host => request.url().toLowerCase().includes(host))) requests.push(request.url());
  });
  return requests;
}

async function signInAsTeacher(page: Page, role: string) {
  const user = account(role);
  const prompts = [user.email, user.password];
  page.on('dialog', async dialog => {
    if (dialog.type() === 'prompt') await dialog.accept(prompts.shift() || '');
    else {
      console.log('STAGING_TEACHER_DIALOG ' + dialog.message());
      await dialog.accept();
    }
  });
  page.on('pageerror', error => console.log('STAGING_TEACHER_PAGE_ERROR ' + error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('STAGING_TEACHER_CONSOLE_ERROR ' + message.text()); });
  await page.goto(SITE + '/?adminPage=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#signInButton')).toBeVisible();
  console.log('STAGING_TEACHER_BOOT ' + JSON.stringify(await page.evaluate(() => ({ staging: (window as any).B3_STAGING_MODE, settings: typeof (window as any).B3SiteSettings, ready: Boolean((window as any).B3_STAGING_READY) }))));
  await page.locator('#signInButton').click();
  await expect(page.locator('#adminStatus')).toContainText(role === 'owner' ? 'Owner access' : 'Managing only your assigned class', { timeout: 20000 });
}

test.describe('live isolated staging site', () => {
  test.skip(!credentials, 'Provision staging fixtures before running live staging tests.');

  test('student sign-in, Weekly Quiz, Chazara, and Shorashim', async ({ page }) => {
    test.setTimeout(60000);
    const productionRequests = watchForProductionRequests(page);
    const user = credentials.studentAccounts.find((item: any) => item.classId === 'TEST-ALEF');
    if (!user) throw new Error('Missing fictional Alef student credentials.');

    const fullStart = Date.now();
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.b3-staging-notice')).toBeVisible();
    await expect(page.locator('#studentSignInBtn')).toBeVisible({ timeout: 15000 });
    const loginStarted = Date.now();
    const functionCalls: number[] = [];
    page.on('request', request => {
      if (!request.url().includes('/funTorahStudentAuth')) return;
      const started = Date.now();
      request.response().then(() => functionCalls.push(Date.now() - started)).catch(() => {});
    });
    await page.locator('#studentNameInput').fill(user.name);
    await page.locator('#classPinInput').fill(user.passcode);
    await page.locator('#studentSignInBtn').click();
    try {
      await expect(page.locator('#studentBar')).toBeVisible({ timeout: 25000 });
    } catch (error) {
      console.log('STAGING_STUDENT_LOGIN_MESSAGE ' + await page.locator('#loginMsg').textContent());
      throw error;
    }
    const loginMs = Date.now() - loginStarted;
    console.log('STAGING_SIGN_IN_METRICS ' + JSON.stringify({
      pageReadyMs: loginStarted - fullStart,
      submitToDashboardMs: loginMs,
      pageToDashboardMs: Date.now() - fullStart,
      studentAuthFunctionCallsMs: functionCalls
    }));
    expect(productionRequests).toEqual([]);

    await page.goto(SITE + '/weekly-quiz/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#quizTitle')).toHaveText('Fictional Test Class Alef Quiz', { timeout: 20000 });
    await expect(page.locator('#questionText')).toContainText('fictional staging quiz');
    const choices = page.locator('button.choice:not([disabled])');
    if (await choices.count()) {
      await choices.first().click();
      await page.locator('#submitBtn').click();
      await expect(page.locator('#completeCard')).toBeVisible({ timeout: 15000 });
    }

    await page.goto(SITE + '/chazara/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Chazara Chart/i })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#studentNameTop')).toContainText(user.name);
    await expect(page.locator('.record-bar').first()).toBeHidden();

    await page.goto(SITE + '/shorashim/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Shorashim Learning Lab/i })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#signedInStudentName')).toContainText(user.name);
    await expect(page.locator('#shorashimRecordBtn')).toBeHidden();
    expect(productionRequests).toEqual([]);
  });

  test('owner, teachers, and principal receive only their assigned class access', async ({ browser }) => {
    test.setTimeout(90000);
    const cases = [
      { role: 'owner', own: 'TEST-ALEF', other: 'TEST-BEIS', expected: true },
      { role: 'teacher', own: 'TEST-ALEF', other: 'TEST-BEIS', expected: false },
      { role: 'teacher', own: 'TEST-BEIS', other: 'TEST-ALEF', expected: false },
      { role: 'principal', own: 'CUSTOM-PRINCIPAL', other: 'TEST-ALEF', expected: false }
    ];
    for (const item of cases) {
      const page = await browser.newPage();
      const productionRequests = watchForProductionRequests(page);
      await signInAsTeacher(page, item.role);
      const access = await page.evaluate(async ({ own, other }) => {
        const db = (window as any).firebase.database();
        async function read(classId: string) {
          try {
            const snapshot = await db.ref('b3Games/workspaces/b3-2026/classes/' + classId).once('value');
            return { allowed: true, name: snapshot.val()?.name || '' };
          } catch (error: any) {
            return { allowed: false, code: error?.code || '' };
          }
        }
        return { own: await read(own), other: await read(other) };
      }, { own: item.own, other: item.other });
      expect(access.own.allowed).toBe(true);
      expect(access.other.allowed).toBe(item.expected);
      expect(productionRequests).toEqual([]);
      await page.close();
    }
  });
});
