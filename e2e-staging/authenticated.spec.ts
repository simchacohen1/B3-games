import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import {
  SITE, HOMEWORK_SITE, loadCredentials, watchPage, expectStagingIsolation,
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

test('fictional teacher publishes homework for a fictional student @auth @homework', async ({ browser }, testInfo) => {
  test.skip(!credentials, NOT_CONFIGURED);
  const adult = credentials!.adultAccounts.find(row => row.role === 'teacher' && row.classId === 'TEST-ALEF');
  const student = credentials!.studentAccounts.find(row => row.classId === 'TEST-ALEF');
  if (!adult || !student) throw new Error('Fictional TEST-ALEF teacher and student credentials are required.');

  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  const studentPage = await studentContext.newPage();
  const teacherWatch = await watchPage(teacherPage);
  const studentWatch = await watchPage(studentPage);
  const title = 'Fictional Homework Preview ' + Date.now();
  let created = false;
  let archived = false;
  let teacherCard: Locator | null = null;
  let assignmentId = '';

  const localDate = (daysFromNow: number) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  };

  try {
    await signInAdult(teacherPage, adult, HOMEWORK_SITE);
    const teacherProvider = await teacherPage.evaluate(() => {
      const user = (window as any).firebase.auth().currentUser;
      return { emailVerified: !!user?.emailVerified, providers: (user?.providerData || []).map((row: any) => row.providerId) };
    });
    test.skip(!teacherProvider.emailVerified || !teacherProvider.providers.includes('google.com'),
      'BLOCKED: Homework teacher actions require a verified Google provider; the available fictional TEST-ALEF credential is email/password only.');
    await teacherPage.goto(HOMEWORK_SITE + '/assignment-center/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(teacherPage);
    await expect(teacherPage.locator('#app')).toBeVisible({ timeout: 45000 });
    await expect(teacherPage.locator('#cls')).toHaveValue('TEST-ALEF');
    await teacherPage.screenshot({ path: testInfo.outputPath('homework-teacher.png'), fullPage: true });
    await expect(teacherPage.getByRole('button', { name: /Create Homework/ })).toBeVisible();
    await expect(teacherPage.getByRole('button', { name: /Check Homework/ })).toBeVisible();
    await expect(teacherPage.getByRole('button', { name: /My Assignments/ })).toBeVisible();
    await teacherPage.getByRole('button', { name: /Preview Student View/ }).click();
    await expect(teacherPage.locator('#screenPreview')).toContainText('Fictional sample');
    await expect(teacherPage.locator('#screenPreview button')).toHaveCount(2);
    await expect(teacherPage.locator('#screenPreview button').first()).toBeDisabled();
    await teacherPage.locator('#screenPreview .backHome').click();
    await teacherPage.getByRole('button', { name: /Create Homework/ }).click();
    await teacherPage.locator('#type').selectOption('shorashim');
    await teacherPage.locator('#title').fill(title);
    await teacherPage.locator('#details').fill('Fictional staging assignment for automated acceptance testing.');
    await teacherPage.getByRole('button', { name: /Next: Choose students/ }).click();
    await expect(teacherPage.locator('#createStep2')).toBeVisible();
    await teacherPage.getByRole('button', { name: /Next: Check homework/ }).click();
    await expect(teacherPage.locator('#createStep3')).toBeVisible();
    await teacherPage.locator('.optional-settings > summary').click();
    await teacherPage.locator('#assigned').fill(localDate(0));
    await teacherPage.locator('#due').fill(localDate(1));
    await teacherPage.locator('#target').fill('5');
    await teacherPage.locator('#targetUnit').selectOption('minutes');
    await expect(teacherPage.locator('#createPreview')).toContainText(title);
    await teacherPage.getByRole('button', { name: 'Save Draft' }).click();
    await expect(teacherPage.locator('#formMsg')).toContainText('Draft saved.');
    created = true;
    teacherCard = teacherPage.locator('#list .card').filter({ hasText: title });
    assignmentId = await teacherCard.getAttribute('data-assignment-id') || '';
    expect(assignmentId).not.toBe('');
    await expect(teacherCard).toContainText('Draft — students cannot see this');

    await signInStudent(studentPage, student, HOMEWORK_SITE);
    await studentPage.goto(HOMEWORK_SITE + '/assignment-center/student.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(studentPage);
    await expect(studentPage.locator('#list')).not.toContainText(title);

    await teacherCard.getByRole('button', { name: 'Publish to Students' }).click();
    await expect(teacherCard).toContainText('Published');
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(studentPage);
    let studentCard = studentPage.locator('#list .card').filter({ hasText: title });
    await expect(studentCard).toContainText('Ready to start');
    await expect(studentPage.getByRole('tab', { name: /To Do/ })).toBeVisible();
    await expect(studentPage.getByRole('tab', { name: /Handed In/ })).toBeVisible();
    await expect(studentPage.getByRole('tab', { name: /Finished/ })).toBeVisible();
    await studentPage.screenshot({ path: testInfo.outputPath('homework-student.png'), fullPage: true });

    const [activityPage] = await Promise.all([
      studentPage.waitForEvent('popup'),
      studentCard.getByRole('link', { name: 'Start Activity' }).click()
    ]);
    await expect(activityPage).toHaveURL(/\/shorashim\/index\.html$/);
    await activityPage.close();
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    studentCard = studentPage.locator('#list .card').filter({ hasText: title });
    await expect(studentCard).toContainText('Not started');

    await studentCard.locator(':scope > textarea').fill('Fictional student practiced five minutes.');
    await studentCard.getByRole('button', { name: 'Hand In Homework' }).click();
    await expect(studentCard).toContainText('Handed in');
    await studentPage.getByRole('tab', { name: /Handed In/ }).click();
    studentCard = studentPage.locator('#section-handed .card').filter({ hasText: title });
    await studentCard.locator('.home-conversation textarea').fill('Could you check my answer?');
    await studentCard.getByRole('button', { name: 'Send message' }).click();
    await expect(studentCard).toContainText('Could you check my answer?');

    const studentVoice = await studentPage.evaluate(async assignmentId => {
      const audio = 'data:audio/webm;base64,GkXfo0AgQoaBAUL3gQFCw==';
      const body = { action: 'comment', assignmentId, voiceDataURL: audio,
        studentId: sessionStorage.getItem('b3Games_studentId'), studentName: sessionStorage.getItem('b3Games_studentName'),
        pin: sessionStorage.getItem('b3Games_classPin'), classId: sessionStorage.getItem('b3Games_studentClass') };
      const response = await fetch('https://us-central1-fun-torah-tools-staging.cloudfunctions.net/homeworkPortal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { ok: response.ok, data: await response.json(), audio };
    }, assignmentId);
    expect(studentVoice.ok, JSON.stringify(studentVoice.data)).toBe(true);
    expect(studentVoice.data.message.voice).toBe(true);

    await teacherPage.reload({ waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(teacherPage);
    await teacherPage.getByRole('button', { name: /Check Homework/ }).click();
    teacherCard = teacherPage.locator('#reviewList .card').filter({ hasText: title });
    await expect(teacherCard).toContainText(student.name);
    await expect(teacherCard).toContainText('Could you check my answer?');
    await expect(teacherCard.getByRole('button', { name: /Listen to voice note/ })).toBeVisible();
    await teacherCard.locator('.home-conversation textarea').fill('Yes—please add one more example.');
    await teacherCard.getByRole('button', { name: 'Send message' }).click();
    await expect(teacherCard).toContainText('Yes—please add one more example.');
    const signedInStudentId = await studentPage.evaluate(() => sessionStorage.getItem('b3Games_studentId') || '');
    const teacherVoice = await teacherPage.evaluate(async ({ assignmentId, studentId }) => {
      const audio = 'data:audio/webm;base64,GkXfo0AgQoaBAUL3gQFCw==';
      const token = await firebase.auth().currentUser.getIdToken();
      const response = await fetch('https://us-central1-fun-torah-tools-staging.cloudfunctions.net/homeworkPortal', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ action: 'comment', classId: 'TEST-ALEF', assignmentId, studentId, voiceDataURL: audio }) });
      return { ok: response.ok, data: await response.json(), audio };
    }, { assignmentId, studentId: signedInStudentId });
    expect(teacherVoice.ok, JSON.stringify(teacherVoice.data)).toBe(true);
    const studentVoiceRead = await studentPage.evaluate(async ({ assignmentId, messageId }) => {
      const response = await fetch('https://us-central1-fun-torah-tools-staging.cloudfunctions.net/homeworkPortal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'voiceRead', assignmentId, messageId,
          studentId: sessionStorage.getItem('b3Games_studentId'), studentName: sessionStorage.getItem('b3Games_studentName'),
          pin: sessionStorage.getItem('b3Games_classPin'), classId: sessionStorage.getItem('b3Games_studentClass') }) });
      return { ok: response.ok, data: await response.json() };
    }, { assignmentId, messageId: teacherVoice.data.message.id });
    expect(studentVoiceRead.ok, JSON.stringify(studentVoiceRead.data)).toBe(true);
    expect(studentVoiceRead.data.voiceDataURL).toBe(teacherVoice.audio);
    await teacherCard.getByLabel('Feedback for the student').fill('Please add one more example.');
    await teacherCard.getByRole('button', { name: 'Return for Corrections' }).click();
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    studentCard = studentPage.locator('#section-todo .card').filter({ hasText: title });
    await expect(studentCard).toContainText('Please add one more example.');
    await studentCard.locator('textarea').fill('Fictional student practiced five minutes and added one more example.');
    await studentCard.getByRole('button', { name: 'Fix and Hand In Again' }).click();
    await teacherPage.reload({ waitUntil: 'domcontentloaded' });
    await teacherPage.getByRole('button', { name: /Check Homework/ }).click();
    teacherCard = teacherPage.locator('#reviewList .card').filter({ hasText: title });
    await expect(teacherCard).toContainText(student.name);
    await teacherCard.getByRole('button', { name: 'Approve work by ' + student.name }).click();
    await expect(teacherCard).toContainText('Completed');

    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    studentCard = studentPage.locator('#list .card').filter({ hasText: title });
    await expect(studentCard).toContainText('Finished');

    await teacherPage.getByRole('button', { name: /My Assignments/ }).click();
    teacherCard = teacherPage.locator('#list .card').filter({ hasText: title });
    teacherPage.once('dialog', dialog => dialog.accept());
    await teacherCard.getByRole('button', { name: 'Archive' }).click();
    await expect(teacherCard).toContainText('Archived');
    archived = true;
  } finally {
    if (created && !archived) {
      try {
        if (!teacherCard) teacherCard = teacherPage.locator('#list .card').filter({ hasText: title });
        await teacherPage.reload({ waitUntil: 'domcontentloaded' });
        await teacherPage.getByRole('button', { name: /My Assignments/ }).click();
        teacherCard = teacherPage.locator('#list .card').filter({ hasText: title });
        teacherPage.once('dialog', dialog => dialog.accept());
        await teacherCard.getByRole('button', { name: 'Archive' }).click({ timeout: 5000 });
      } catch (_) { /* Preserve the original test failure; staging data is fictional and scoped to TEST-ALEF. */ }
    }
    expect(teacherWatch.productionRequests).toEqual([]);
    expect(studentWatch.productionRequests).toEqual([]);
    await teacherContext.close();
    await studentContext.close();
  }
});

test('fictional TEST-ALEF student sees To Do, Handed In, and Finished @auth @homework', async ({ browser }, testInfo) => {
  test.skip(!credentials, NOT_CONFIGURED);
  const student = credentials!.studentAccounts.find(row => row.classId === 'TEST-ALEF');
  if (!student) throw new Error('A fictional TEST-ALEF student credential is required.');
  const context = await browser.newContext();
  const page = await context.newPage();
  const watch = await watchPage(page);
  try {
    await signInStudent(page, student, HOMEWORK_SITE);
    await page.goto(HOMEWORK_SITE + '/assignment-center/student.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(page);
    await expect(page.locator('#list')).toContainText('Hi, ' + student.name, { timeout: 30000 });
    await expect(page.getByRole('tab', { name: /To Do/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Handed In/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Finished/ })).toBeVisible();
    await page.getByRole('tab', { name: /Handed In/ }).click();
    await expect(page.locator('#section-handed')).toBeVisible();
    await page.getByRole('tab', { name: /Finished/ }).click();
    await expect(page.locator('#section-finished')).toBeVisible();
    await page.getByRole('tab', { name: /To Do/ }).click();
    await page.screenshot({ path: testInfo.outputPath('homework-student.png'), fullPage: true });
    expect(watch.productionRequests).toEqual([]);
    expect(watch.pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
