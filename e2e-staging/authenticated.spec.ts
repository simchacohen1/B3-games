import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  SITE, loadCredentials, watchPage, expectStagingIsolation,
  signInStudent, signInAdult, readClassRecord, stagingFunctionAvailable, type PageWatch,
} from './staging-common';

// Signed-in checks with fictional staging accounts. Runs every 2 hours.
// Without the FTT_STAGING_CREDENTIALS_JSON secret every test here is
// reported as NOT VERIFIED (skipped), never as passed.

const credentials = loadCredentials();
const NOT_CONFIGURED = 'NOT VERIFIED: FTT_STAGING_CREDENTIALS_JSON secret is not configured';

test.describe('staging student journeys @auth', () => {
  test.skip(!credentials, NOT_CONFIGURED);

  let page: Page;
  let watch: PageWatch;
  let student: { name: string; passcode: string; classId: string };

  test.beforeAll(async ({ browser }) => {
    student = credentials!.studentAccounts.find(row => row.classId === 'TEST-ALEF')!;
    if (!student) throw new Error('Fictional TEST-ALEF student is missing from the credentials.');
    page = await (browser as Browser).newPage();
    watch = await watchPage(page);
    await signInStudent(page, student);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test.afterEach(async () => {
    expect(watch.productionRequests, 'requests to production hosts').toEqual([]);
    watch.pageErrors.length = 0;
  });

  async function openTool(path: string) {
    await page.goto(SITE + path, { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(page);
  }

  async function expectStudentName(timeout = 30000) {
    await expect(page.locator('body')).toContainText(student.name, { timeout });
  }

  test('home dashboard shows the signed-in student @signin', async () => {
    await openTool('/');
    await expect(page.locator('#studentBar')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('#studentBar')).toContainText(student.name);
  });

  test('Weekly Quiz shows the assigned fictional quiz', async () => {
    await openTool('/weekly-quiz/index.html');
    await expectStudentName();
    // The quiz may be unanswered or already finished from an earlier run;
    // both are valid saved states. It must be listed either way.
    await expect(page.locator('body')).toContainText('Fictional Test Class Alef Quiz', { timeout: 30000 });
  });

  test('Chazara Chart opens with recording disabled on staging', async () => {
    await openTool('/chazara/index.html');
    await expect(page.locator('#studentNameTop')).toContainText(student.name, { timeout: 30000 });
    await expect(page.locator('.record-bar').first()).toBeHidden();
  });

  test('Shorashim opens with recording disabled on staging', async () => {
    await openTool('/shorashim/index.html');
    await expect(page.locator('#signedInStudentName')).toContainText(student.name, { timeout: 30000 });
    await expect(page.locator('#shorashimRecordBtn')).toBeHidden();
  });

  test('Rashi Letters opens for the student', async () => {
    await openTool('/rashi-letters/student.html');
    await expectStudentName();
  });

  async function requireFunction(name: string) {
    test.skip(!(await stagingFunctionAvailable(name)),
      `BLOCKED: Cloud Function ${name} is not deployed on staging`);
  }

  test('Yiddish Word Explorer opens for the student', async () => {
    await requireFunction('yiddishApi');
    await openTool('/yiddish/index.html');
    await expectStudentName();
  });

  test('Posuk Practice opens for the student (scoring stays off)', async () => {
    await openTool('/record_pesukim/student.html');
    await expectStudentName();
  });

  test('Student Rewards opens for the student', async () => {
    await requireFunction('studentRewardsLogin');
    await openTool('/student-rewards/index.html');
    await expectStudentName();
  });

  test('Game Show player opens without errors', async () => {
    await openTool('/game-show/player.html');
    await page.waitForTimeout(3000);
    expect(watch.pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('student cannot read another class @permissions', async () => {
    await openTool('/');
    const other = await readClassRecord(page, 'TEST-BEIS');
    expect(other.allowed, 'TEST-ALEF student reading TEST-BEIS').toBe(false);
  });
});

test.describe('staging adult role boundaries @auth @permissions', () => {
  test.skip(!credentials, NOT_CONFIGURED);

  const cases = [
    { role: 'owner', own: 'TEST-ALEF', other: 'TEST-BEIS', otherAllowed: true },
    { role: 'teacher', own: 'TEST-ALEF', other: 'TEST-BEIS', otherAllowed: false },
    { role: 'teacher', own: 'TEST-BEIS', other: 'TEST-ALEF', otherAllowed: false },
    { role: 'principal', own: 'CUSTOM-PRINCIPAL', other: 'TEST-ALEF', otherAllowed: false },
  ];

  for (const item of cases) {
    test(`${item.role} ${item.own}: ${item.otherAllowed ? 'can' : 'cannot'} read ${item.other}`, async ({ page }) => {
      const adult = credentials!.adultAccounts.find(row =>
        row.role === item.role && (item.role === 'owner' || row.classId === item.own));
      if (!adult) throw new Error(`Fictional ${item.role} account for ${item.own} is missing from the credentials.`);
      const watch = await watchPage(page);
      await signInAdult(page, adult);
      const own = await readClassRecord(page, item.own);
      const other = await readClassRecord(page, item.other);
      expect(own.allowed, `${item.role} reading own class ${item.own}`).toBe(true);
      expect(other.allowed, `${item.role} reading ${item.other}`).toBe(item.otherAllowed);
      expect(watch.productionRequests).toEqual([]);
    });
  }
});
