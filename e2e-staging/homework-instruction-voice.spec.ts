import { test, expect, type Page } from '@playwright/test';
import { HOMEWORK_SITE, loadCredentials, watchPage, expectStagingIsolation, signInStudent, signInAdult } from './staging-common';

// Issue #629: a teacher records spoken instructions on an assignment; students press play to hear them.
// Chromium's fake microphone plays a tone, so real recordings are made without a person.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  permissions: ['microphone'],
});

const credentials = loadCredentials();
const NOT_CONFIGURED = 'NOT VERIFIED: FTT_STAGING_CREDENTIALS_JSON secret is not configured';

async function recordInstructions(page: Page, seconds = 2) {
  const field = page.locator('#voiceField');
  await field.getByRole('button', { name: /Record (instructions|again)/ }).click();
  const panel = field.locator('.conversation-recording');
  await expect(panel.locator('.rec-dot')).toBeVisible();
  await expect(panel.locator('.rec-time')).toHaveText(/^00:00 · 00:15 left$/);
  await page.waitForTimeout(seconds * 1000 + 300);
  await expect(panel.locator('.rec-time')).toHaveText(/^00:0[1-9] · 00:(0\d|1[0-4]) left$/);
  await field.getByRole('button', { name: '■ Stop recording' }).click();
  await expect(page.locator('#voiceMsg')).toHaveText('Recorded. Press Save to keep it.', { timeout: 20000 });
  await expect(field.locator('audio')).toHaveCount(1);
}

// Counts every time an instructions clip starts playing on the page.
async function countPlays(page: Page) {
  await page.addInitScript(() => {
    (window as any).instructionPlays = 0;
    const Original = window.Audio;
    (window as any).Audio = function () { const a = new Original(); a.addEventListener('play', () => { (window as any).instructionPlays++; }); return a; };
  });
}

function fakeTeacherAuth(page: Page) {
  return page.addInitScript(() => {
    const user = { uid: 'fictional-ui-teacher', email: 'teacher.ui@fictional-staging.test', getIdToken: async () => 'fixture-only-not-a-firebase-token' };
    const authInstance = { currentUser: user, onAuthStateChanged(cb: (u: typeof user) => void) { setTimeout(() => cb(user), 0); return () => undefined; },
      signOut: async () => undefined, signInWithPopup: async () => undefined };
    const authFactory: any = () => authInstance;
    authFactory.GoogleAuthProvider = function GoogleAuthProvider() {};
    const apps: any[] = [];
    (window as any).firebase = { apps, initializeApp(options: any) { apps.push({ options }); }, auth: authFactory,
      database() { return { ref: () => ({ once: async () => ({ val: () => null, exists: () => false }) }) }; } };
  });
}

test('teacher records instructions; another teacher\'s assignment cannot be changed; old servers hide it @homework-ui', async ({ browser }, testInfo) => {
  const page = await browser.newPage();
  const watch = await watchPage(page);
  const calls: any[] = [];
  let features: any = { instructionVoice: true };
  const assignments: any[] = [
    { id: 'other1', type: 'other', label: 'homework', title: 'Co-teacher assignment', details: 'Read page 3.', assignedAt: Date.now() - 86400000, dueAt: null,
      targetAmount: null, targetUnit: '', publicationState: 'published', createdAt: Date.now() - 86400000, instructionVoice: true, ownedByMe: false, students: {} },
  ];
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
  await fakeTeacherAuth(page);
  await page.route('**/homeworkPortal', async route => {
    const body = route.request().postDataJSON();
    calls.push(body);
    let result: any = { ok: true };
    if (body.action === 'authorizedClasses') result = { ok: true, classes: [{ id: 'TEST-ALEF', name: 'Fictional Test Class Alef' }] };
    if (body.action === 'teacherList') result = { ok: true, students: { maya: { name: 'Maya Levin' } }, assignments, messages: { maya: [] }, ...(features ? { features } : {}) };
    if (body.action === 'create') {
      assignments.unshift({ id: 'mine1', type: body.type, label: 'homework', title: body.title, details: body.details, assignedAt: Date.now(), dueAt: null,
        targetAmount: null, targetUnit: '', publicationState: 'draft', createdAt: Date.now(), instructionVoice: !!body.voiceDataURL, ownedByMe: true, students: {} });
      result = { ok: true, id: 'mine1' };
    }
    if (body.action === 'publish') assignments.find(a => a.id === body.assignmentId).publicationState = 'published';
    if (body.action === 'edit') {
      const a = assignments.find(row => row.id === body.assignmentId);
      if (body.removeVoice) a.instructionVoice = false;
      if (body.voiceDataURL) a.instructionVoice = true;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto(HOMEWORK_SITE + '/assignment-center/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
  await expectStagingIsolation(page);
  await expect(page.locator('#app')).toBeVisible({ timeout: 30000 });

  // Create with a recording.
  await page.locator('#openCreate').click();
  await expect(page.locator('#voiceField')).toBeVisible();
  await expect(page.locator('#voiceField')).toContainText('Record instructions (optional)');
  await page.locator('#title').fill('Listen to the instructions');
  await page.locator('#details').fill('Practice the words.');
  await recordInstructions(page);
  await page.locator('#nextAudience').click();
  await page.locator('#nextReview').click();
  await expect(page.locator('#previewVoice')).toBeVisible();
  await page.locator('#publishNow').click();
  await expect(page.locator('#listNotice')).toContainText('Published', { timeout: 20000 });
  const create = calls.find(c => c.action === 'create');
  expect(create.voiceDataURL).toMatch(/^data:audio\/(webm|ogg|mp4);base64,/);
  expect(Buffer.from(create.voiceDataURL.split(',')[1], 'base64').length).toBeLessThan(100000);

  // Own assignment: edit shows the recording, and it can be removed.
  await page.getByText('Listen to the instructions').first().click();
  await expect(page.locator('#oneAssignment .instruction-play')).toHaveText('🔊 Play recorded instructions');
  await page.locator('#oneAssignment').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#voiceField')).toContainText('This assignment has recorded instructions.');
  await page.locator('#voiceField').getByRole('button', { name: 'Remove recording' }).click();
  await page.locator('#nextAudience').click();
  await page.locator('#nextReview').click();
  await page.locator('#save').click();
  await expect(page.locator('#listNotice')).toContainText('Changes saved.', { timeout: 20000 });
  expect(calls.filter(c => c.action === 'edit').at(-1)).toMatchObject({ assignmentId: 'mine1', removeVoice: true });

  // Another teacher's assignment: can listen, cannot record or remove.
  // Saving returns to Reports.
  await page.getByRole('button', { name: 'Open report for Co-teacher assignment' }).click();
  await page.locator('#oneAssignment').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#voiceField')).toContainText('Only the teacher who created this assignment can add or change its recorded instructions.');
  await expect(page.locator('#voiceField').getByRole('button', { name: /Record/ })).toHaveCount(0);
  await expect(page.locator('#voiceField').getByRole('button', { name: 'Remove recording' })).toHaveCount(0);
  await page.locator('#nextAudience').click();
  await page.locator('#nextReview').click();
  await page.locator('#save').click();
  await expect(page.locator('#listNotice')).toContainText('Changes saved.', { timeout: 20000 });
  const otherEdit = calls.filter(c => c.action === 'edit').at(-1);
  expect(otherEdit.assignmentId).toBe('other1');
  expect('voiceDataURL' in otherEdit || 'removeVoice' in otherEdit, 'a plain edit sends no voice change').toBe(false);
  await page.screenshot({ path: testInfo.outputPath('homework-teacher-instructions.png'), fullPage: true });

  // A server without the feature (live before its Functions deploy) hides the field.
  features = null;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toBeVisible({ timeout: 30000 });
  await page.locator('#openCreate').click();
  await expect(page.locator('#voiceField')).toBeHidden();
  expect(watch.productionRequests).toEqual([]);
  expect(watch.pageErrors).toEqual([]);
  await page.close();
});

test('student sees a play button only when the assignment has recorded instructions @homework-ui', async ({ browser }, testInfo) => {
  const page = await browser.newPage();
  const watch = await watchPage(page);
  const calls: any[] = [];
  await countPlays(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('b3Games_studentId', 'fixture-student');
    sessionStorage.setItem('b3Games_studentName', 'Maya Levin');
    sessionStorage.setItem('b3Games_classPin', 'fixture-pin');
    sessionStorage.setItem('b3Games_studentClass', 'TEST-ALEF');
  });
  // A real, short recording made by the page itself with the fake microphone.
  await page.route('**/homeworkPortal', async route => {
    const body = route.request().postDataJSON();
    calls.push(body);
    const row = (id: string, title: string, voice: boolean) => ({ id, type: 'other', title, details: 'Say each word.', assignedAt: Date.now(), dueAt: null,
      targetAmount: null, targetUnit: '', status: 'assigned', late: false, draft: '', progress: 0, answer: '', submittedAt: null, feedback: '', stars: null,
      updatedAt: null, instructionVoice: voice, messages: [] });
    let result: any = { ok: true };
    if (body.action === 'studentList') result = { ok: true, name: 'Maya Levin', assignments: [row('v1', 'With a recording', true), row('t1', 'Text only', false)], openCount: 2, general: { messages: [] } };
    if (body.action === 'instructionVoiceRead') result = { ok: true, voiceDataURL: await page.evaluate(() => (window as any).clip) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto(HOMEWORK_SITE + '/assignment-center/student.html', { waitUntil: 'domcontentloaded' });
  await expectStagingIsolation(page);
  await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream), chunks: Blob[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    await new Promise(resolve => { rec.onstop = resolve; rec.start(); setTimeout(() => rec.stop(), 1200); });
    stream.getTracks().forEach(t => t.stop());
    (window as any).clip = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(new Blob(chunks, { type: 'audio/webm' })); });
  });
  const withVoice = page.locator('article', { hasText: 'With a recording' });
  const textOnly = page.locator('article', { hasText: 'Text only' });
  await expect(withVoice.locator('.instruction-play')).toHaveText('🔊 Listen to the instructions');
  await expect(textOnly.locator('.instruction-play')).toHaveCount(0);
  await expect(textOnly).toContainText('Say each word.');
  const play = withVoice.locator('.instruction-play');
  for (let i = 1; i <= 3; i++) {
    await play.click();
    await expect.poll(() => page.evaluate(() => (window as any).instructionPlays)).toBe(i);
    await expect(play).toHaveText('🔁 Listen again', { timeout: 10000 });
  }
  expect(calls.filter(c => c.action === 'instructionVoiceRead')).toHaveLength(1);
  expect(calls.find(c => c.action === 'instructionVoiceRead')).toMatchObject({ assignmentId: 'v1' });
  expect(calls.some(c => c.action === 'submit' || c.action === 'save'), 'listening hands nothing in').toBe(false);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('homework-student-instructions.png'), fullPage: true });
  expect(watch.productionRequests).toEqual([]);
  expect(watch.pageErrors).toEqual([]);
  await page.close();
});

test('fictional teacher records instructions and the student replays them @auth @homework', async ({ browser }, testInfo) => {
  test.skip(!credentials, NOT_CONFIGURED);
  const adult = credentials!.adultAccounts.find(row => row.role === 'teacher' && row.classId === 'TEST-ALEF');
  const student = credentials!.studentAccounts.find(row => row.classId === 'TEST-ALEF');
  if (!adult || !student) throw new Error('Fictional TEST-ALEF teacher and student credentials are required.');
  const teacherContext = await browser.newContext({ permissions: ['microphone'] });
  const studentContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  const studentPage = await studentContext.newPage();
  const teacherWatch = await watchPage(teacherPage);
  const studentWatch = await watchPage(studentPage);
  const stamp = 'Fictional recorded instructions ' + Date.now();
  let published = false;
  try {
    await signInAdult(teacherPage, adult, HOMEWORK_SITE);
    await teacherPage.goto(HOMEWORK_SITE + '/assignment-center/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(teacherPage);
    await expect(teacherPage.locator('#app')).toBeVisible({ timeout: 45000 });
    await teacherPage.locator('#openCreate').click();
    await teacherPage.locator('#title').fill(stamp);
    await teacherPage.locator('#details').fill('Fictional test: listen, then practice.');
    await recordInstructions(teacherPage, 3);
    await teacherPage.locator('#nextAudience').click();
    await teacherPage.locator('#nextReview').click();
    await teacherPage.locator('#publishNow').click();
    await expect(teacherPage.locator('#listNotice')).toContainText('Published', { timeout: 30000 });
    published = true;
    // The teacher can play it back from the assignment page.
    await teacherPage.getByText(stamp).first().click();
    await expect(teacherPage.locator('#oneAssignment .instruction-play')).toBeVisible();
    await teacherPage.screenshot({ path: testInfo.outputPath('homework-teacher-instructions-real.png'), fullPage: true });

    await countPlays(studentPage);
    await signInStudent(studentPage, student, HOMEWORK_SITE);
    await studentPage.goto(HOMEWORK_SITE + '/assignment-center/student.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(studentPage);
    const card = studentPage.locator('article', { hasText: stamp });
    await expect(card).toBeVisible({ timeout: 30000 });
    const play = card.locator('.instruction-play');
    await expect(play).toHaveText('🔊 Listen to the instructions');
    for (let i = 1; i <= 2; i++) {
      await play.click();
      await expect.poll(() => studentPage.evaluate(() => (window as any).instructionPlays), { timeout: 20000 }).toBe(i);
      await expect(play).toHaveText('🔁 Listen again', { timeout: 20000 });
    }
    await expect(card.locator('.instruction-status')).toHaveText('');
    await studentPage.screenshot({ path: testInfo.outputPath('homework-student-instructions-real.png'), fullPage: true });
  } finally {
    // Archive the fictional test assignment so it does not pile up for the test student.
    if (published) {
      teacherPage.once('dialog', dialog => dialog.accept());
      await teacherPage.locator('#oneAssignment').getByRole('button', { name: 'Archive' }).click().catch(() => undefined);
    }
    expect(teacherWatch.productionRequests).toEqual([]);
    expect(studentWatch.productionRequests).toEqual([]);
    await teacherContext.close();
    await studentContext.close();
  }
});
