import { test, expect, type Page, type Browser } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, set, get, update } from 'firebase/database';
import { PROJECT, WORKSPACE, CLASS_ID, DB_PORT, fictionalOwnerRules, serveSyntheticSite, closeSyntheticSite, configureBrowser } from './helpers/synthetic-firebase';

// Issue #376: a teacher gives one boy several retakes at once and none replaces
// another. Runs only on the demo emulators (never hosted Firebase), with
// fictional students, through the real weeklyQuizStudent function code.
test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Run with the demo Firebase Auth/Database/Functions emulators.');
test.setTimeout(240_000);

const ROOT = `b3Quiz/classes/${CLASS_ID}`;
const ARI = 'ari_example', BINA = 'bina_example';
let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
let server: http.Server;
let origin: string;

const quiz = (title: string) => ({ title, skillType: 'comprehension', questions: [
  { q: `${title}: pick Right`, choices: ['Wrong', 'Right'], correctIndex: 1 },
  { q: `${title}: pick Yes`, choices: ['No', 'Yes'], correctIndex: 1 }
] });
async function readFixture(path: string) { let value: any; await env.withSecurityRulesDisabled(async c => { value = (await get(ref(c.database(), path))).val(); }); return value; }
async function writeFixture(path: string, value: unknown) { await env.withSecurityRulesDisabled(async c => set(ref(c.database(), path), value)); }
async function updateFixture(updates: Record<string, unknown>) { await env.withSecurityRulesDisabled(async c => update(ref(c.database()), updates)); }

async function seed() {
  await env.clearDatabase();
  const now = Date.now();
  const members: Record<string, unknown> = {};
  for (const [id, name, passcode] of [[ARI, 'Ari Example', 'pilot-7101'], [BINA, 'Bina Example', 'pilot-7202']]) {
    members[id] = { name, active: true };
    await writeFixture(`b3Games/students/${id}`, {
      profile: { id, name, active: true, classId: CLASS_ID },
      memberships: { [`${WORKSPACE}_${CLASS_ID}`]: { workspaceId: WORKSPACE, classId: CLASS_ID, active: true } }
    });
    await writeFixture(`b3Private/passcodes/${id}`, { passcode, chosenPinVersion: 1, updatedAt: now });
  }
  await writeFixture(`b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}`, { name: 'Pilot Room Alpha', active: true, toolGrants: { 'weekly-quiz': true }, members });
  // Three different class quizzes, already ended. Ari scored 0 on each.
  for (const [i, name] of ['A', 'B', 'C'].entries()) {
    const id = `${now - 3000 + i}_${CLASS_ID}_quiz_${name.toLowerCase()}`;
    await writeFixture(`${ROOT}/launches/${id}`, { quizId: '', classId: CLASS_ID, started: false, endedAt: now - 1000, showScore: true, mode: 'test', deliveryType: 'live', createdAt: now - 3000 + i, activeQuestion: 0, questionStates: {}, attemptGroupId: id, attemptNumber: 1, retakeOf: '', quizSnapshot: quiz(`Quiz ${name}`) });
    await writeFixture(`${ROOT}/completions/${id}/${ARI}`, { completedAt: now - 2000, correct: 0, total: 2, pct: 0 });
    await writeFixture(`${ROOT}/responses/${id}/${ARI}`, { 0: { choiceIndex: 0, correct: false }, 1: { choiceIndex: 0, correct: false } });
  }
  // A live class quiz is running at the same time; Bina sees only this one.
  await writeFixture(`${ROOT}/launches/live_class_quiz`, { classId: CLASS_ID, deliveryType: 'live', started: true, mode: 'test', showScore: true, createdAt: now - 500, questionStates: {}, quizSnapshot: quiz('Live Class Quiz') });
  await writeFixture(`${ROOT}/settings/activeLaunchByClass/${CLASS_ID}`, 'live_class_quiz');
}

async function studentPage(browser: Browser, name: string, passcode: string, errors: string[], failed: string[], query = '') {
  const context = await browser.newContext();
  const page = await context.newPage();
  await configureBrowser(page, errors, failed);
  await page.goto(`${origin}/index.html`);
  await page.locator('#studentNameInput').fill(name);
  await page.locator('#classPinInput').fill(passcode);
  await page.locator('#studentSignInBtn').click();
  await expect(page.locator('#studentNameLabel')).toHaveText(name, { timeout: 20000 });
  await page.goto(`${origin}/weekly-quiz/index.html${query}`);
  await expect(page.locator('#studentNameLabel')).toHaveText(name, { timeout: 20000 });
  return page;
}
const rows = (page: Page) => page.locator('#assignedList .assigned-row');
const row = (page: Page, title: string) => rows(page).filter({ hasText: title });
async function answerAll(page: Page, title: string) {
  await expect(page.locator('#quizTitle')).toHaveText(title);
  for (const choice of [/B\. Right/, /B\. Yes/]) {
    await page.getByRole('button', { name: choice }).click();
    await page.locator('#submitBtn').click();
    if (choice.source.includes('Right')) {
      await expect(page.locator('#progressText')).toHaveText('1 of 2 answered');
      await page.locator('#questionNav').getByRole('button', { name: '2', exact: true }).click();
    }
  }
}

test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, database: { host: '127.0.0.1', port: DB_PORT, rules: fictionalOwnerRules() } });
  await seed();
  ({ server, origin } = await serveSyntheticSite());
});
test.afterAll(async () => { await env?.cleanup(); await closeSyntheticSite(server); });

test('teacher assigns three retakes to one boy; each stays open until he finishes it', async ({ browser }) => {
  const errors: string[] = [], failed: string[] = [];

  // ---- Teacher (fictional owner account) gives Ari three retakes from Results ----
  const teacherContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  await configureBrowser(teacher, errors, failed, 'owner');
  // The PDF report library is not needed here and the test makes no internet requests.
  await teacher.route('https://cdn.jsdelivr.net/npm/jspdf@*/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  teacher.on('dialog', dialog => dialog.type() === 'prompt' ? dialog.accept(dialog.defaultValue()) : dialog.accept());
  await teacher.goto(`${origin}/weekly-quiz/teacher.html?class=${CLASS_ID}`);
  // The Teacher Tools gate asks for sign-in first and opens the tool as soon as the owner is confirmed.
  await teacher.locator('#b3-teacher-gate').getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(teacher.locator('#mainContent')).toBeVisible({ timeout: 20000 });
  await teacher.locator('summary', { hasText: 'Reports' }).click();
  await teacher.locator('#tabResults').click();
  for (const name of ['A', 'B', 'C']) {
    await teacher.locator('#launchHistory .launch-item').filter({ hasText: `Quiz ${name}` }).click();
    await expect(teacher.locator('#resultsQuizTitle')).toHaveText(`Quiz ${name}`);
    await teacher.locator('#resultsTable tr').filter({ hasText: 'Ari Example' }).getByRole('button', { name: 'Retake', exact: true }).click();
    await expect.poll(async () => Object.keys(await readFixture(`${ROOT}/settings/studentAssignments/${ARI}`) || {}).length).toBe(['A', 'B', 'C'].indexOf(name) + 1);
  }
  const queue = await readFixture(`${ROOT}/settings/studentAssignments/${ARI}`);
  const retakeIds = Object.keys(queue);
  expect(retakeIds).toHaveLength(3);
  const launches = await readFixture(`${ROOT}/launches`);
  const idFor = (name: string) => retakeIds.find(id => launches[id].quizSnapshot.title === `Quiz ${name}`)!;
  expect(retakeIds.map(id => launches[id].targetStudents)).toEqual([{ [ARI]: true }, { [ARI]: true }, { [ARI]: true }]);
  // The teacher sees all three as assigned and unfinished.
  await expect(teacher.locator('#pendingAssignments .pending-assignment')).toHaveCount(3);

  // ---- Ari sees all three retakes plus the live class quiz ----
  const ari = await studentPage(browser, 'Ari Example', 'pilot-7101', errors, failed);
  await expect(rows(ari)).toHaveCount(4, { timeout: 20000 });
  for (const name of ['A', 'B', 'C']) await expect(row(ari, `Quiz ${name}`)).toContainText('Not started');
  await expect(row(ari, 'Live Class Quiz')).toContainText('Class test');

  // He chooses B himself and finishes it.
  await row(ari, 'Quiz B').getByRole('button').click();
  await answerAll(ari, 'Quiz B');
  await expect(ari.locator('#completeCard')).toBeVisible();
  await expect(ari.locator('#completeScore')).toContainText('100%');
  await expect.poll(async () => (await readFixture(`${ROOT}/completions/${idFor('B')}/${ARI}`))?.pct).toBe(100);
  // B is finished; A and C are still open. The page stays on B (no jump to another quiz).
  await expect(row(ari, 'Quiz B')).toContainText('Finished');
  await expect(row(ari, 'Quiz A')).toContainText('Not started');
  await expect(row(ari, 'Quiz C')).toContainText('Not started');
  await expect(ari.locator('#completeCard')).toBeVisible();
  // Old scores and the new retake score are both in his history.
  await expect(ari.locator('#pastQuizList')).toContainText('Retake 2');
  expect((await readFixture(`${ROOT}/completions`))).toMatchObject({ [idFor('B')]: { [ARI]: { pct: 100 } } });
  for (const id of Object.keys(launches).filter(id => id.includes('_quiz_') && !retakeIds.includes(id))) expect((await readFixture(`${ROOT}/completions/${id}/${ARI}`)).pct).toBe(0);

  // Start A, answer one question, then reload: A is in progress and opens again, never finished B.
  await row(ari, 'Quiz A').getByRole('button').click();
  await expect(ari.locator('#quizTitle')).toHaveText('Quiz A');
  await ari.getByRole('button', { name: /B\. Right/ }).click();
  await ari.locator('#submitBtn').click();
  await expect(ari.locator('#progressText')).toHaveText('1 of 2 answered');
  await ari.reload();
  await expect(rows(ari)).toHaveCount(4, { timeout: 20000 });
  await expect(row(ari, 'Quiz A')).toContainText('In progress');
  await expect(ari.locator('#completeCard')).toBeHidden();
  await expect(ari.locator('#quizCard')).toBeVisible();

  // ---- Teacher revokes C; A is untouched and his answers stay ----
  await teacher.locator('#pendingAssignments .pending-assignment').filter({ hasText: 'Quiz C' }).getByRole('button', { name: 'Revoke' }).click();
  await expect.poll(async () => Object.keys(await readFixture(`${ROOT}/settings/studentAssignments/${ARI}`) || {}).sort()).toEqual([idFor('A'), idFor('B')].sort());
  expect(await readFixture(`${ROOT}/launches/${idFor('C')}/revokedStudents/${ARI}`)).toBeTruthy();
  await expect(teacher.locator('#pendingAssignments .pending-assignment')).toHaveCount(2);
  await expect(row(ari, 'Quiz C')).toHaveCount(0, { timeout: 15000 });
  await expect(row(ari, 'Quiz A')).toContainText('In progress');
  expect((await readFixture(`${ROOT}/responses/${idFor('A')}/${ARI}/0`)).choiceIndex).toBe(1);

  // A direct link to the revoked retake is refused; a direct link to A still works.
  // (Same tab: the student's sign-in lives in this tab's session.)
  await ari.goto(`${origin}/weekly-quiz/index.html?launch=${encodeURIComponent(idFor('C'))}`);
  await expect(ari.locator('#quizErrorCard')).toBeVisible({ timeout: 20000 });
  await expect(ari.locator('#quizCard')).toBeHidden();
  await ari.goto(`${origin}/weekly-quiz/index.html?launch=${encodeURIComponent(idFor('A'))}`);
  await expect(ari.locator('#quizTitle')).toHaveText('Quiz A', { timeout: 20000 });
  await expect(ari.locator('#progressText')).toHaveText('1 of 2 answered');
  await ari.goto(`${origin}/weekly-quiz/index.html`);
  await expect(rows(ari)).toHaveCount(3, { timeout: 20000 });
  await expect(ari.locator('#quizTitle')).toHaveText('Quiz A');

  // ---- Legacy single pointer from before this change still works ----
  await writeFixture(`${ROOT}/launches/legacy_makeup`, { classId: CLASS_ID, started: true, mode: 'test', deliveryType: 'makeup', targetStudents: { [ARI]: true }, createdAt: Date.now(), showScore: true, questionStates: {}, quizSnapshot: quiz('Old Make-up') });
  await writeFixture(`${ROOT}/settings/studentActiveLaunch/${ARI}`, 'legacy_makeup');
  await expect(row(ari, 'Old Make-up')).toContainText('Not started', { timeout: 15000 });
  await expect(row(ari, 'Quiz A')).toContainText('In progress');
  // He stays on A, the quiz he was working on.
  await expect(ari.locator('#quizTitle')).toHaveText('Quiz A');

  // ---- Bina (same class) sees none of Ari's quizzes ----
  const bina = await studentPage(browser, 'Bina Example', 'pilot-7202', errors, failed);
  await expect(rows(bina)).toHaveCount(1, { timeout: 20000 });
  await expect(row(bina, 'Live Class Quiz')).toBeVisible();
  await bina.goto(`${origin}/weekly-quiz/index.html?launch=${encodeURIComponent(idFor('A'))}`);
  await expect(bina.locator('#quizErrorCard')).toBeVisible({ timeout: 20000 });
  await expect(bina.locator('#quizErrorCard')).not.toContainText('Quiz A');

  // ---- After he finishes everything, nothing reopens by itself ----
  await expect(ari.locator('#quizTitle')).toHaveText('Quiz A');
  await ari.locator('#questionNav').getByRole('button', { name: '2', exact: true }).click();
  await ari.getByRole('button', { name: /B\. Yes/ }).click();
  await ari.locator('#submitBtn').click();
  await expect(ari.locator('#completeCard')).toBeVisible();
  await updateFixture({ [`${ROOT}/settings/activeLaunchByClass/${CLASS_ID}`]: null, [`${ROOT}/settings/studentActiveLaunch/${ARI}`]: null });
  await ari.reload();
  await expect(rows(ari)).toHaveCount(2, { timeout: 20000 });
  await expect(rows(ari).filter({ hasText: 'Finished' })).toHaveCount(2);
  await expect(ari.locator('#noQuizCard')).toContainText('You finished all your assigned quizzes');
  await expect(ari.locator('#quizCard')).toBeHidden();
  await expect(ari.locator('#completeCard')).toBeHidden();

  expect(failed.filter(f => !f.includes('favicon') && !f.startsWith('403 /weeklyQuizStudent'))).toEqual([]);
  expect(errors.filter(e => !/favicon|Failed to load resource|403|not assigned/i.test(e))).toEqual([]);
  // ---- Teacher: "One student's marks only". Quiz B given again to the whole class
  // (he has not opened the new copy) is still one row with his finished 100%. ----
  await writeFixture(`${ROOT}/launches/${Date.now()}_${CLASS_ID}_quiz_b_again`, { quizId: '', classId: CLASS_ID, started: true, mode: 'test', deliveryType: 'live', showScore: true, createdAt: Date.now(), questionStates: {}, quizSnapshot: quiz('Quiz B') });
  await teacher.locator('#resultsStudentFilter').selectOption(ARI);
  const marks = teacher.locator('#resultsTable tbody tr');
  await expect(marks.filter({ hasText: 'Quiz B' })).toHaveCount(1);
  await expect(marks.filter({ hasText: 'Quiz B' })).toContainText('100%');
  await expect(marks.filter({ hasText: 'Quiz B' })).toContainText('Given 3 times');
  await expect(marks.filter({ hasText: 'Quiz A' })).toHaveCount(1);
  await expect(marks.filter({ hasText: 'Quiz A' })).toContainText('100%');

  // ---- Teacher: all students x all quizzes table ----
  await teacher.locator('#resultsStudentFilter').selectOption('__all_table__');
  await expect(teacher.locator('#resultsQuizTitle')).toHaveText('All students — every quiz');
  const header = teacher.locator('#resultsTable thead th');
  await expect(header).toHaveText([/Quiz/, /Ari Example/, /Bina Example/]);
  const table = teacher.locator('#resultsTable tbody tr');
  // Quiz B (given 3 times) is one row: Ari's finished retake 100%, Bina never did it.
  const quizB = table.filter({ hasText: 'Quiz B' });
  await expect(quizB).toHaveCount(1);
  await expect(quizB.locator('td').nth(1)).toContainText('100%');
  await expect(quizB.locator('td').nth(2)).toContainText('—');
  await expect(table.filter({ hasText: 'Total (finished quizzes)' })).toHaveCount(1);
  // Download CSV: every quiz, one column per boy, totals at the bottom.
  const [download] = await Promise.all([teacher.waitForEvent('download'), teacher.locator('#allTableCsvBtn').click()]);
  const csv = fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
  const csvLines = csv.split('\r\n');
  expect(csvLines[0]).toBe('Quiz,Class,First given,Times given,Ari Example,Bina Example');
  expect(csvLines.find(line => line.startsWith('Quiz B,'))).toMatch(/,3,100%,not started$/);
  expect(csvLines.some(line => line.startsWith('Average (finished quizzes),'))).toBe(true);
  // A single-class page has no class picker to show.
  await expect(teacher.locator('#tableClassFilter')).toBeHidden();
  // Full screen fills the window; Escape goes back.
  await teacher.locator('#tableFullscreenBtn').click();
  await expect(teacher.locator('#resultsCard')).toHaveClass(/table-fullscreen/);
  const box = await teacher.locator('#resultsCard').boundingBox();
  const viewport = teacher.viewportSize()!;
  expect(Math.round(box!.width)).toBe(viewport.width);
  expect(Math.round(box!.height)).toBe(viewport.height);
  await expect(teacher.locator('#tableFullscreenBtn')).toHaveText(/Exit full screen/);
  await teacher.keyboard.press('Escape');
  await expect(teacher.locator('#resultsCard')).not.toHaveClass(/table-fullscreen/);
  // Clicking a boy's name opens his own marks.
  await header.filter({ hasText: 'Ari Example' }).getByRole('link').click();
  await expect(teacher.locator('#resultsQuizTitle')).toHaveText('Ari Example — his quizzes');

  // Stop the pages' background polling before the emulators shut down.
  for (const context of [ari.context(), bina.context(), teacherContext]) {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
