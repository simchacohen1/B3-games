import { test, expect, type Page } from '@playwright/test';
import { loadCredentials, signInStudent, signInAdult, watchPage, STAGING_PROJECT } from './staging-common';

// Posuk Practice word-by-word grading, end to end on staging (issue #749).
// Fictional student records and sends a posuk; fictional teacher marks words
// (tap word = read wrong, T = translation wrong, tap again = undo) and saves;
// the student then sees the marked words. Earlier submissions must not change.
//
// Run by hand only (tag @posukwords is not part of the scheduled @smoke/@auth runs):
//   FTT_STAGING_CREDENTIALS_FILE=<path to staging/test-credentials.local.json>
//   POSUK_WORDS_SITE=<staging live site or the pasuk-word-grading preview link>
//   npx playwright test -c playwright.staging.config.ts --grep @posukwords

const LIVE = 'https://fun-torah-tools-staging.web.app';
const SITE = (process.env.POSUK_WORDS_SITE || LIVE).replace(/\/$/, '');
if (!/^https:\/\/(?:fun-torah-tools-staging\.web\.app|fun-torah-tools-staging--pasuk-word-grading-[a-z0-9]+\.web\.app)$/.test(SITE)) {
  throw new Error('POSUK_WORDS_SITE must be the staging live site or the pasuk-word-grading preview channel.');
}

// A fake microphone, so the recording step needs no real device.
test.use({ launchOptions: {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
} });

// On a preview link only: the staging sign-in functions (student sign-in, teacher
// claim) answer browsers only from the main staging address. The test relays those
// two calls itself so the real pages can sign in from the preview link. Everything
// else (recording upload, submit, grade, reads) goes straight from the page.
async function relaySignInCalls(page: Page) {
  if (SITE === LIVE) return;
  await page.route(/cloudfunctions\.net\/(funTorahStudentAuth|funTorahTeacherClaim)|funtorah(studentauth|teacherclaim)-[a-z0-9-]+\.a\.run\.app/i, async route => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': SITE,
      'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'content-type,authorization',
      'access-control-allow-methods': 'POST,OPTIONS', vary: 'Origin',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const response = await route.fetch({ headers: { ...request.headers(), origin: LIVE } });
    return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
}

const credentials = loadCredentials();
const split = (text: string) => String(text || '').trim().split(/\s+/).filter(Boolean);

async function studentSubmissions(page: Page) {
  return page.evaluate(async project => {
    const w = window as any;
    if (w.firebase.apps[0].options.projectId !== project) throw new Error('Not the staging project.');
    const claims = (await w.firebase.auth().currentUser.getIdTokenResult()).claims;
    const sid = claims.b3StudentId;
    const snap = await w.firebase.database().ref('posukPractice/submissions/' + sid).once('value');
    return { sid, subs: (snap.val() || {}) as Record<string, any> };
  }, STAGING_PROJECT);
}

test('teacher marks words on a posuk recording and the student sees them @posukwords', async ({ browser }, testInfo) => {
  test.setTimeout(240000);
  test.skip(!credentials, 'NOT VERIFIED: staging credentials are not configured.');
  const student = credentials!.studentAccounts.find(row => row.classId === 'TEST-ALEF');
  const teacher = credentials!.adultAccounts.find(row => row.role === 'teacher' && row.classId === 'TEST-ALEF');
  if (!student || !teacher) throw new Error('Fictional TEST-ALEF teacher and student credentials are required.');

  // ---- Teacher signs in first and makes sure the fictional class has pesukim open ----
  const teacherContext = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const teacherPage = await teacherContext.newPage();
  const teacherWatch = await watchPage(teacherPage);
  await relaySignInCalls(teacherPage);
  teacherPage.on('dialog', dialog => dialog.accept());
  await signInAdult(teacherPage, teacher, SITE);
  const LIMIT_PATH = 'b3Games/workspaces/b3-2026/classes/TEST-ALEF/posukPracticeLimit';
  const originalLimit = await teacherPage.evaluate(async path => {
    const w = window as any;
    const db = w.firebase.database(), before = (await db.ref(path).once('value')).val();
    // Same record the teacher page saves from "Choose what students may practice".
    if (!before || before.closed || !before.endPerek) await db.ref(path).set({ startSefer: 'Bereishis', startPerek: 1, startPosuk: 1,
      endSefer: 'Bereishis', endPerek: 3, endPosuk: 24, updatedAt: w.firebase.database.ServerValue.TIMESTAMP });
    return before;
  }, LIMIT_PATH);
  const restoreLimit = () => teacherPage.evaluate(async ({ path, value }) => {
    const ref = (window as any).firebase.database().ref(path);
    if (value === null) await ref.remove(); else await ref.set(value);
  }, { path: LIMIT_PATH, value: originalLimit });

  try {
  // ---- Student: record one posuk and send it to the teacher ----
  const studentContext = await browser.newContext({ permissions: ['microphone'] });
  const studentPage = await studentContext.newPage();
  const studentWatch = await watchPage(studentPage);
  await relaySignInCalls(studentPage);
  studentPage.on('dialog', dialog => dialog.accept());
  // The staging build of the student page has "Send to my teacher" switched off
  // (its service address is blank on staging). For this test only, the page is
  // served with that one line pointing at the STAGING grading function.
  await studentPage.route(/\/record_pesukim\/student\.html(\?.*)?$/, async route => {
    const response = await route.fetch();
    const html = await response.text();
    const patched = html.replace(/(const STUDENT_REWARDS_AUTO_AWARD_URL = )[^;]*?\? '' : ("https:\/\/us-central1-fun-torah-tools-staging\.cloudfunctions\.net\/studentRewardsAutoAward");/, '$1$2;');
    if (patched === html) throw new Error('Could not switch on Send to teacher for the staging test.');
    return route.fulfill({ response, body: patched });
  });
  await signInStudent(studentPage, student, SITE);

  // Pick from the pesukim the teacher has opened for this class, trying a few
  // until one is free (not waiting for a grade and not gold-locked).
  let words: string[] = [], ref = '';
  await studentPage.goto(`${SITE}/record_pesukim/student.html`, { waitUntil: 'domcontentloaded' });
  const optionValues = (id: string) => studentPage.locator(`#${id} option`).evaluateAll(list =>
    list.filter(o => (o as HTMLOptionElement).value && !(o as HTMLOptionElement).disabled).map(o => (o as HTMLOptionElement).value));
  await studentPage.waitForFunction('practiceScopeReady === true && !!classPracticeLimit', null, { timeout: 45000 });
  await expect.poll(async () => (await optionValues('perekSelect')).length, { timeout: 45000 }).toBeGreaterThan(0);
  for (let tries = 0; tries < 10 && !ref; tries++) {
    const perakim = await optionValues('perekSelect');
    const perek = perakim[Math.floor(Math.random() * perakim.length)];
    await studentPage.locator('#perekSelect').selectOption(perek);
    await expect.poll(async () => (await optionValues('posukSelect')).length, { timeout: 30000 }).toBeGreaterThan(0);
    const pesukim = await optionValues('posukSelect');
    const posuk = pesukim[Math.floor(Math.random() * pesukim.length)];
    await studentPage.locator('#posukSelect').selectOption(posuk);
    await expect(studentPage.locator('#combinedRecordBtn')).toBeVisible({ timeout: 45000 });
    await studentPage.waitForFunction('typeof currentPosukText === "string" && currentPosukText.length > 0 && !!currentPosukKey', null, { timeout: 45000 });
    await studentPage.waitForTimeout(2500); // review status loads after the posuk
    words = split(await studentPage.evaluate('currentPosukText') as string);
    const open = await studentPage.locator('#combinedRecordBtn').isEnabled();
    if (open && words.length >= 5) ref = `${perek}:${posuk}`;
  }
  expect(ref, 'found a posuk this student may record').not.toBe('');

  const before = await studentSubmissions(studentPage);
  const beforeIds = Object.keys(before.subs);

  await studentPage.locator('#combinedRecordBtn').click();
  await expect(studentPage.locator('#combinedRecordBtn')).toHaveClass(/recording/, { timeout: 20000 });
  await studentPage.waitForTimeout(3500);
  await studentPage.locator('#combinedRecordBtn').click();
  await expect(studentPage.locator('#combinedSubmitBtn')).toBeVisible({ timeout: 15000 });
  await studentPage.locator('#combinedSubmitBtn').click();
  await expect(studentPage.locator('#combinedMsg')).toContainText('Sent to your teacher', { timeout: 60000 });

  const afterSubmit = await studentSubmissions(studentPage);
  const newIds = Object.keys(afterSubmit.subs).filter(id => !beforeIds.includes(id));
  expect(newIds, 'exactly one new submission').toHaveLength(1);
  const submissionId = newIds[0];
  expect(afterSubmit.subs[submissionId].status).toBe('pending');

  // ---- Teacher: open To Grade, mark words, save ----
  await teacherPage.goto(`${SITE}/record_pesukim/teacher.html?class=TEST-ALEF`, { waitUntil: 'domcontentloaded' });
  await expect(teacherPage.locator('#gradeTabBtn')).toBeVisible({ timeout: 45000 });
  await teacherPage.locator('#gradeTabBtn').click();
  await expect(teacherPage.locator('.grade-card').first()).toBeVisible({ timeout: 45000 });

  // Newest pending recording is last (oldest first).
  const card = teacherPage.locator('.grade-card').last();
  await expect(card.locator('h3')).toContainText(student.name);
  const wordButtons = card.locator('.grade-word'), tButtons = card.locator('.grade-t');
  await expect(wordButtons).toHaveCount(words.length);
  await expect(tButtons).toHaveCount(words.length);
  expect(await wordButtons.allTextContents()).toEqual(words); // every word, in posuk order, nikud intact

  // Right to left: the first word sits to the right of the second.
  expect(await card.locator('.grade-hebrew').evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
  const first = await wordButtons.nth(0).boundingBox(), second = await wordButtons.nth(1).boundingBox();
  if (first && second && Math.abs(first.y - second.y) < 5) expect(first.x).toBeGreaterThan(second.x);

  const pressed = (locator: any) => expect(locator).toHaveAttribute('aria-pressed', 'true');
  const clear = (locator: any) => expect(locator).toHaveAttribute('aria-pressed', 'false');
  // Word 1: read wrong AND translation wrong (independent switches).
  await wordButtons.nth(1).click(); await pressed(wordButtons.nth(1)); await clear(tButtons.nth(1));
  await tButtons.nth(1).click(); await pressed(tButtons.nth(1)); await pressed(wordButtons.nth(1));
  // Word 2: read wrong only.
  await wordButtons.nth(2).click(); await pressed(wordButtons.nth(2));
  // Word 3: translation wrong only.
  await tButtons.nth(3).click(); await pressed(tButtons.nth(3)); await clear(wordButtons.nth(3));
  // Word 0 and word 4's T: marked by accident, then tapped again to undo.
  await wordButtons.nth(0).click(); await pressed(wordButtons.nth(0));
  await wordButtons.nth(0).click(); await clear(wordButtons.nth(0));
  await tButtons.nth(4).click(); await pressed(tButtons.nth(4));
  await tButtons.nth(4).click(); await clear(tButtons.nth(4));
  await expect(card.locator('[data-field="mistakes"]')).toHaveValue('4');
  await teacherPage.screenshot({ path: testInfo.outputPath('teacher-marked.png'), fullPage: false });

  await card.locator('[data-choice="retry"]').click();
  await card.locator('[data-field="note"]').fill('Staging test of word marks');
  const gradeRequest = teacherPage.waitForRequest(request => request.method() === 'POST' && /studentRewardsAutoAward|studentrewardsautoaward/i.test(request.url()));
  await card.locator('[data-save]').click();
  const sent = JSON.parse((await gradeRequest).postData() || '{}');
  expect(sent.action).toBe('posuk-grade');
  expect(sent.submissionId).toBe(submissionId);
  expect(sent.wordMarks).toEqual({ 1: 'bothWrong', 2: 'readWrongTransOk', 3: 'readOkTransWrong' });
  await expect(card.locator('[data-field="msg"]')).toContainText('Saved', { timeout: 45000 });
  // Recently graded shows the marks as chips.
  await expect(teacherPage.locator('.graded-row .wm-chip').first()).toBeVisible({ timeout: 30000 });
  await teacherPage.screenshot({ path: testInfo.outputPath('teacher-recently-graded.png'), fullPage: true });

  // ---- Student: sees which words were marked ----
  await studentPage.reload({ waitUntil: 'domcontentloaded' });
  await studentPage.waitForFunction('practiceScopeReady === true && !!classPracticeLimit', null, { timeout: 45000 });
  const [perekValue, posukValue] = ref.split(':');
  await studentPage.locator('#perekSelect').selectOption(perekValue);
  await expect.poll(async () => (await optionValues('posukSelect')).includes(posukValue), { timeout: 30000 }).toBe(true);
  await studentPage.locator('#posukSelect').selectOption(posukValue);
  const feedback = studentPage.locator('#combinedHistory .wm-fb').first();
  await expect(feedback).toBeVisible({ timeout: 60000 });
  expect(await feedback.locator('.wm-fb-posuk').evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
  const shown = feedback.locator('.wm-fb-word');
  await expect(shown).toHaveCount(words.length);
  await expect(shown.nth(1)).toHaveClass(/wm-fb-both/);
  await expect(shown.nth(2)).toHaveClass(/wm-fb-read/);
  await expect(shown.nth(3)).toHaveClass(/wm-fb-trans/);
  for (const n of [0, 4]) await expect(shown.nth(n)).not.toHaveClass(/wm-fb-(read|trans|both|other)/);
  await expect(feedback.locator('.wm-fb-title')).toContainText('2 words read wrong · 2 words translated wrong');
  await feedback.scrollIntoViewIfNeeded();
  await studentPage.screenshot({ path: testInfo.outputPath('student-feedback.png'), fullPage: false });

  // ---- Saved record, and nothing earlier was changed ----
  const after = await studentSubmissions(studentPage);
  const saved = after.subs[submissionId];
  expect(saved.status).toBe('retry');
  expect(saved.mistakes).toBe(4);
  expect(saved.wordMarks).toEqual([
    { i: 1, word: words[1], mark: 'bothWrong' },
    { i: 2, word: words[2], mark: 'readWrongTransOk' },
    { i: 3, word: words[3], mark: 'readOkTransWrong' },
  ]);
  expect(saved.audioStoragePath).toBe(afterSubmit.subs[submissionId].audioStoragePath);
  for (const id of beforeIds) expect(after.subs[id], 'earlier submission ' + id + ' unchanged').toEqual(before.subs[id]);

  expect(studentWatch.productionRequests).toEqual([]);
  expect(teacherWatch.productionRequests).toEqual([]);
  } finally {
    // Put the fictional class's practice window back exactly as it was.
    await teacherPage.goto(`${SITE}/?adminPage=1`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await teacherPage.waitForFunction(() => !!(window as any).firebase?.auth?.().currentUser, null, { timeout: 30000 }).catch(() => {});
    await restoreLimit().catch(error => console.warn('Could not restore the practice window', String(error).slice(0, 200)));
    await teacherContext.close();
  }
});
