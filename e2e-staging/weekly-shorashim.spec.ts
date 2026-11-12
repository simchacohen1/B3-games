import { test, expect, type Browser, type Page } from '@playwright/test';
import { SITE, loadCredentials, watchPage, expectStagingIsolation, signInStudent, signInAdult, type PageWatch } from './staging-common';

// Weekly Shorashim (staging only, issue #788), with the fictional staging accounts.
// HIGH RISK area: student data + database rules. Besides the normal journey this
// checks, on the live staging database, that a student cannot reach another
// student's progress and a teacher cannot reach another class.
// Without credentials every test is reported as NOT VERIFIED (skipped).

const credentials = loadCredentials();
const NOT_CONFIGURED = 'NOT VERIFIED: staging credentials are not configured';
const CLASS = 'b3Games/workspaces/b3-2026/classes/';

type Attempt = { ok: boolean; value?: unknown; code?: string };
async function dbRead(page: Page, path: string): Promise<Attempt> {
  return page.evaluate(async p => {
    try { return { ok: true, value: (await (window as any).firebase.database().ref(p).once('value')).val() }; }
    catch (error: any) { return { ok: false, code: String(error?.code || error?.message || '') }; }
  }, path);
}
async function dbWrite(page: Page, path: string, value: unknown): Promise<Attempt> {
  return page.evaluate(async ({ p, v }) => {
    try { await (window as any).firebase.database().ref(p).set(v); return { ok: true }; }
    catch (error: any) { return { ok: false, code: String(error?.code || error?.message || '') }; }
  }, { p: path, v: value });
}
const denied = (attempt: Attempt) => { expect(attempt.ok, JSON.stringify(attempt)).toBe(false); expect(attempt.code).toMatch(/permission/i); };
const record = () => ({ bestScore: 1, timesPlayed: 1, lastPlayed: Date.now() });

test.describe.serial('Weekly Shorashim on staging @auth', () => {
  test.skip(!credentials, NOT_CONFIGURED);

  let studentPage: Page, teacherPage: Page;
  let studentWatch: PageWatch, teacherWatch: PageWatch;
  let studentId = '';
  const student = () => credentials!.studentAccounts.find(row => row.name === 'Test Student A1')!;
  const classmate = 'test_student_alef2';
  const otherClassStudent = 'test_student_beis';

  test.afterAll(async () => { await studentPage?.close(); await teacherPage?.close(); });

  test('teacher sets the class to B3, week 3 (held)', async ({ browser }) => {
    const teacher = credentials!.adultAccounts.find(row => row.role === 'teacher' && row.classId === 'TEST-ALEF')!;
    teacherPage = await (await (browser as Browser).newContext()).newPage();
    teacherWatch = await watchPage(teacherPage);
    await signInAdult(teacherPage, teacher);
    await teacherPage.goto(SITE + '/weekly-shorashim/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(teacherPage);
    await expect(teacherPage.locator('#body')).toBeVisible({ timeout: 45000 });
    await teacherPage.locator('#grade').selectOption('B3');
    await teacherPage.locator('#saveGrade').click();
    await expect(teacherPage.locator('#gradeSaved')).toContainText('Saved', { timeout: 20000 });
    await teacherPage.locator('#week').fill('3');
    await teacherPage.locator('#held').check();
    await teacherPage.locator('#saveWeek').click();
    await expect(teacherPage.locator('#weekSaved')).toContainText('week 3 and held', { timeout: 20000 });
    await expect(teacherPage.locator('#status')).toContainText('B3, week 3 (held)');
    expect(teacherWatch.productionRequests).toEqual([]);
  });

  test('student sees his class\'s grade and week; future weeks are locked', async ({ browser }) => {
    studentPage = await (await (browser as Browser).newContext()).newPage();
    studentWatch = await watchPage(studentPage);
    await signInStudent(studentPage, student());
    await studentPage.goto(SITE + '/weekly-shorashim/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(studentPage);
    await expect(studentPage.locator('#wsCard')).toBeVisible({ timeout: 45000 });
    await expect(studentPage.locator('#wsGradeChip')).toHaveText('B3');
    await expect(studentPage.locator('.ws-week.current')).toHaveText('3');
    await expect(studentPage.locator('.ws-week')).toHaveCount(30);
    await expect(studentPage.locator('.ws-week.locked')).toHaveCount(27);
    await expect(studentPage.locator('.ws-week.locked').first()).toBeDisabled();
    await expect(studentPage.locator('#wsGradeTitle')).toHaveText('Your Grade — Week 3');
    // B3 sees the grade 2 and grade 3 words of week 3 only.
    const expected = await studentPage.evaluate(() => (window as any).WeeklyShorashimData.WEEKS[2].words.filter((w: any) => w.grade <= 3).length);
    await expect(studentPage.locator('.ws-word')).toHaveCount(expected);
    await studentPage.locator('#wsModeCumulative').click();
    await expect(studentPage.locator('#wsRange')).toHaveText('Weeks 1–3');
    const cumulative = await studentPage.locator('.ws-word').count();
    expect(cumulative).toBeGreaterThan(expected);
    await studentPage.locator('#wsModeSingle').click();
    await expect(studentPage.locator('.ws-game')).toHaveCount(7);
    await expect(studentPage.locator('#wsSaveNote')).toContainText('saved for your teacher');
    studentId = await studentPage.evaluate(async () => (await (window as any).firebase.auth().currentUser.getIdTokenResult()).claims.b3StudentId);
    expect(studentId).toBeTruthy();
  });

  test('student plays Practice Quiz and Flashcards; scores are saved', async () => {
    await studentPage.locator('[data-game="quiz"]').click();
    for (let i = 0; i < 20; i++) {
      if (await studentPage.locator('.ws-title', { hasText: 'Quiz Complete!' }).count()) break;
      const hebrew = await studentPage.locator('.ws-question-card').textContent();
      const answer = await studentPage.evaluate(h => (window as any).WeeklyShorashimData.WEEKS[2].words.find((w: any) => w.hebrew === h).english, hebrew);
      // Miss the first word on purpose so a missed word reaches the teacher page.
      const choice = i === 0
        ? studentPage.locator('.ws-choice:not([data-choice="' + answer.replace(/"/g, '\\"') + '"])').first()
        : studentPage.locator('.ws-choice[data-choice="' + answer.replace(/"/g, '\\"') + '"]');
      await choice.click();
      await studentPage.waitForTimeout(1000);
    }
    await expect(studentPage.locator('.ws-save-line')).toContainText('Score saved for your teacher', { timeout: 20000 });
    await studentPage.locator('.ws-btn-outline').click();
    await expect(studentPage.locator('[data-game="quiz"] .b')).toContainText('Best');

    await studentPage.locator('[data-game="flashcards"]').click();
    while (await studentPage.locator('.ws-flashcard').count()) {
      await studentPage.locator('.ws-flashcard').click();
      await studentPage.locator('.ws-flash-gotit').click();
    }
    await expect(studentPage.locator('.ws-save-line')).toContainText('Score saved for your teacher', { timeout: 20000 });
    await studentPage.locator('.ws-btn-outline').click();

    const mine = await dbRead(studentPage, CLASS + 'TEST-ALEF/weeklyShorashim/progress/' + studentId + '/3');
    expect(mine.ok).toBe(true);
    const saved = mine.value as any;
    expect(saved.quiz.timesPlayed).toBeGreaterThanOrEqual(1);
    expect(saved.quiz.lastPlayed).toBeGreaterThan(Date.now() - 600000);
    expect(Object.keys(saved.quiz.wordsMissed || {}).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(saved.quiz.wordsCorrect || {}).length).toBeGreaterThanOrEqual(1);
    expect(saved.flashcards.bestScore).toBeGreaterThanOrEqual(1);
    expect(studentWatch.productionRequests).toEqual([]);
    expect(studentWatch.pageErrors).toEqual([]);
  });

  test('HIGH RISK: a student cannot read or write another student\'s data, or change settings', async () => {
    const alef = CLASS + 'TEST-ALEF/', beis = CLASS + 'TEST-BEIS/';
    denied(await dbRead(studentPage, alef + 'weeklyShorashim/progress/' + classmate));
    denied(await dbRead(studentPage, alef + 'weeklyShorashim/progress'));
    denied(await dbRead(studentPage, beis + 'weeklyShorashim/progress/' + otherClassStudent));
    denied(await dbRead(studentPage, beis + 'weeklyShorashimGrade'));
    denied(await dbWrite(studentPage, alef + 'weeklyShorashim/progress/' + classmate + '/3/quiz', record()));
    denied(await dbWrite(studentPage, beis + 'weeklyShorashim/progress/' + otherClassStudent + '/3/quiz', record()));
    denied(await dbWrite(studentPage, beis + 'weeklyShorashim/progress/' + studentId + '/3/quiz', record()));
    denied(await dbWrite(studentPage, alef + 'weeklyShorashimGrade', 'B6'));
    denied(await dbWrite(studentPage, alef + 'weeklyShorashim/currentWeek', { week: 30, setAt: Date.now(), held: true }));
    denied(await dbWrite(studentPage, alef + 'weeklyShorashim/progress/' + studentId + '/3/quiz', null));
  });

  test('teacher page shows the student\'s scores and missed words', async () => {
    await teacherPage.locator('#refresh').click();
    const row = teacherPage.locator('#rows tr', { hasText: 'Test Student A1' });
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.locator('td.score')).toHaveCount(2);
    await expect(teacherPage.locator('#headRow th')).toHaveCount(10);
    await expect(teacherPage.locator('#missed .w').first()).toBeVisible();
    await expect(teacherPage.locator('#rows tr', { hasText: 'Test Student A2' })).toContainText('Has not played week 3 yet');
  });

  test('HIGH RISK: a teacher cannot read another class or write student progress', async () => {
    const alef = CLASS + 'TEST-ALEF/', beis = CLASS + 'TEST-BEIS/';
    expect((await dbRead(teacherPage, alef + 'weeklyShorashim/progress')).ok).toBe(true);
    denied(await dbRead(teacherPage, beis + 'weeklyShorashim/progress'));
    denied(await dbRead(teacherPage, beis + 'weeklyShorashim/progress/' + otherClassStudent));
    denied(await dbRead(teacherPage, beis + 'weeklyShorashimGrade'));
    denied(await dbRead(teacherPage, beis + 'weeklyShorashim/currentWeek'));
    denied(await dbWrite(teacherPage, beis + 'weeklyShorashimGrade', 'B6'));
    denied(await dbWrite(teacherPage, alef + 'weeklyShorashim/progress/' + studentId + '/3/quiz', { bestScore: 100, timesPlayed: 99, lastPlayed: Date.now() }));
  });

  test('teacher changes the grade to B4 and releases the hold; the student page follows', async () => {
    await teacherPage.locator('#grade').selectOption('B4');
    await teacherPage.locator('#saveGrade').click();
    await expect(teacherPage.locator('#gradeSaved')).toContainText('B4 word list', { timeout: 20000 });
    await teacherPage.locator('#week').fill('5');
    await teacherPage.locator('#held').uncheck();
    await teacherPage.locator('#saveWeek').click();
    await expect(teacherPage.locator('#weekSaved')).toContainText('week 5.', { timeout: 20000 });

    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(studentPage.locator('#wsCard')).toBeVisible({ timeout: 45000 });
    await expect(studentPage.locator('#wsGradeChip')).toHaveText('B4');
    await expect(studentPage.locator('.ws-week.current')).toHaveText('5');
    const expected = await studentPage.evaluate(() => (window as any).WeeklyShorashimData.WEEKS[4].words.filter((w: any) => w.grade <= 4).length);
    await expect(studentPage.locator('.ws-word')).toHaveCount(expected);

    // Leave the fictional class on B3 for the next run.
    await teacherPage.locator('#grade').selectOption('B3');
    await teacherPage.locator('#saveGrade').click();
    await expect(teacherPage.locator('#gradeSaved')).toContainText('B3 word list', { timeout: 20000 });
    expect(teacherWatch.productionRequests).toEqual([]);
  });
});
