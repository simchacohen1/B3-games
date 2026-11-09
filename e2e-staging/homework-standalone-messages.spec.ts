import { test, expect, type Page } from '@playwright/test';
import { HOMEWORK_SITE, loadCredentials, watchPage, expectStagingIsolation, signInStudent, signInAdult } from './staging-common';

// Issue #621: standalone "Message your teacher" / "Messages from students" threads,
// the recording indicator, and voice notes that send on their own (no typing, no hand-in).
// Chromium's fake microphone plays a tone, so real recordings are made without a person.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

const credentials = loadCredentials();
const NOT_CONFIGURED = 'NOT VERIFIED: FTT_STAGING_CREDENTIALS_JSON secret is not configured';

// Records a voice note in one conversation box and checks the indicator the whole way.
async function recordVoiceNote(page: Page, box: ReturnType<Page['locator']>, seconds = 3) {
  const panel = box.locator('.conversation-recording');
  await expect(panel).toBeHidden();
  await box.getByRole('button', { name: '🎙 Record voice note' }).click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.rec-dot')).toBeVisible();
  await expect(panel.locator('.rec-time')).toHaveText(/^00:00 · 00:15 left$/);
  await page.waitForTimeout(seconds * 1000 + 300);
  // The timer runs: elapsed has moved on from 00:00 and the time left has dropped below 15 seconds.
  await expect(panel.locator('.rec-time')).toHaveText(/^00:0[1-9] · 00:(0\d|1[0-4]) left$/);
  await expect(box.getByRole('button', { name: '■ Stop & send' })).toBeVisible();
  await box.getByRole('button', { name: '■ Stop & send' }).click();
  await expect(box.locator('.conversation-feedback')).toHaveText('Voice note sent.', { timeout: 20000 });
  await expect(box.locator('.conversation-recording')).toBeHidden();
}

test('fictional student and teacher use standalone messages with a recording indicator @homework-ui', async ({ browser }, testInfo) => {
  // ---- student page, mocked server ----
  const studentPage = await browser.newPage();
  const studentWatch = await watchPage(studentPage);
  const studentCalls: any[] = [];
  const studentThread: any[] = [{ id: 't0', role: 'teacher', text: 'Welcome back!', voice: false, createdAt: Date.now() - 60000, unread: true }];
  await studentPage.addInitScript(() => {
    sessionStorage.setItem('b3Games_studentId', 'fixture-student');
    sessionStorage.setItem('b3Games_studentName', 'Maya Levin');
    sessionStorage.setItem('b3Games_classPin', 'fixture-pin');
    sessionStorage.setItem('b3Games_studentClass', 'TEST-ALEF');
  });
  await studentPage.route('**/homeworkPortal', async route => {
    const body = route.request().postDataJSON();
    studentCalls.push(body);
    let result: any = { ok: true };
    if (body.action === 'studentList') result = { ok: true, name: 'Maya Levin', assignments: [], openCount: 0, general: { messages: studentThread } };
    if (body.action === 'markRead') studentThread.forEach(m => { m.unread = false; });
    if (body.action === 'comment') {
      const message = { id: 's' + studentThread.length, role: 'student', text: body.text || '', voice: !!body.voiceDataURL, createdAt: Date.now() };
      studentThread.push(message);
      result = { ok: true, message };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await studentPage.goto(HOMEWORK_SITE + '/assignment-center/student.html', { waitUntil: 'domcontentloaded' });
  await expectStagingIsolation(studentPage);
  const panel = studentPage.locator('#generalMessages');
  await expect(panel).toContainText('Messages with your teacher');
  // There is no homework at all, yet the student can still reach the teacher.
  await expect(studentPage.locator('#list')).toContainText('No homework for you right now');
  await panel.getByRole('button', { name: /1 new message from your teacher/ }).click();
  await expect(panel).toContainText('Welcome back!');
  await expect.poll(() => studentCalls.some(c => c.action === 'markRead' && !('assignmentId' in c))).toBe(true);

  await recordVoiceNote(studentPage, panel);
  const voice = studentCalls.find(c => c.action === 'comment');
  expect(voice).toBeTruthy();
  expect('assignmentId' in voice, 'standalone note has no assignment').toBe(false);
  expect('text' in voice, 'no typing needed').toBe(false);
  expect(voice.voiceDataURL).toMatch(/^data:audio\/(webm|ogg|mp4)/);
  expect(Buffer.from(voice.voiceDataURL.split(',')[1], 'base64').length).toBeLessThan(100000);
  expect(studentCalls.some(c => c.action === 'submit'), 'nothing was handed in').toBe(false);
  // The panel stays open after the page refreshes, showing the sent note.
  await expect(panel.locator('.conversation-message.mine')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: '▶ Play voice note' })).toBeVisible();
  await panel.locator('textarea').fill('Text works too.');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await expect(panel).toContainText('Text works too.');
  await studentPage.setViewportSize({ width: 375, height: 800 });
  expect(await studentPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await studentPage.screenshot({ path: testInfo.outputPath('homework-student-standalone.png'), fullPage: true });
  expect(studentWatch.productionRequests).toEqual([]);
  expect(studentWatch.pageErrors).toEqual([]);
  await studentPage.close();

  // ---- teacher page, mocked server and Firebase auth ----
  const teacherPage = await browser.newPage();
  const teacherWatch = await watchPage(teacherPage);
  const teacherCalls: any[] = [];
  const threads: any = {
    maya: [{ id: 'v1', role: 'student', text: '', voice: true, createdAt: Date.now() - 5000, unread: true }],
    noam: [],
  };
  await teacherPage.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
  await teacherPage.addInitScript(() => {
    const user = { uid: 'fictional-ui-teacher', email: 'teacher.ui@fictional-staging.test', getIdToken: async () => 'fixture-only-not-a-firebase-token' };
    const authInstance = { currentUser: user, onAuthStateChanged(cb: (u: typeof user) => void) { setTimeout(() => cb(user), 0); return () => undefined; },
      signOut: async () => undefined, signInWithPopup: async () => undefined };
    const authFactory: any = () => authInstance;
    authFactory.GoogleAuthProvider = function GoogleAuthProvider() {};
    const apps: any[] = [];
    (window as any).firebase = { apps, initializeApp(options: any) { apps.push({ options }); }, auth: authFactory,
      database() { return { ref: () => ({ once: async () => ({ val: () => null, exists: () => false }) }) }; } };
  });
  await teacherPage.route('**/homeworkPortal', async route => {
    const body = route.request().postDataJSON();
    teacherCalls.push(body);
    let result: any = { ok: true };
    if (body.action === 'authorizedClasses') result = { ok: true, classes: [{ id: 'TEST-ALEF', name: 'Fictional Test Class Alef' }] };
    if (body.action === 'teacherList') result = { ok: true, students: { noam: { name: 'Noam Cohen' }, maya: { name: 'Maya Levin' } }, assignments: [], messages: threads };
    if (body.action === 'voiceRead') result = { ok: true, voiceDataURL: voice.voiceDataURL };
    if (body.action === 'markRead') (threads[body.studentId] || []).forEach((m: any) => { m.unread = false; });
    if (body.action === 'comment') {
      const message = { id: 'r' + Date.now(), role: 'teacher', text: body.text || '', voice: !!body.voiceDataURL, createdAt: Date.now() };
      threads[body.studentId].push(message);
      result = { ok: true, message };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await teacherPage.goto(HOMEWORK_SITE + '/assignment-center/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
  await expectStagingIsolation(teacherPage);
  const open = teacherPage.getByRole('button', { name: /Messages from students/ });
  await expect(open).toBeVisible();
  await expect(teacherPage.locator('#messagesCount')).toHaveText('1');
  // Before the screen opens nothing is marked read: the student with a new message comes first.
  await expect(teacherPage.locator('#messagesStudent')).toHaveValue('maya');
  await expect(teacherPage.locator('#messagesStudent option').first()).toHaveText('Maya Levin · 💬 1 new');
  expect(teacherCalls.some(c => c.action === 'markRead')).toBe(false);
  await open.click();
  const box = teacherPage.locator('#messagesBox');
  // Opening the thread marks it read; the label and badge clear.
  await expect(teacherPage.locator('#messagesStudent option').first()).toHaveText('Maya Levin · 1 message');
  await expect(teacherPage.locator('#messagesCount')).toBeHidden();
  await expect(box).toContainText('Messages with Maya Levin');
  await expect.poll(() => teacherCalls.some(c => c.action === 'markRead' && c.studentId === 'maya' && !('assignmentId' in c))).toBe(true);
  await box.getByRole('button', { name: '▶ Play voice note' }).click();
  await expect(box.locator('audio')).toHaveCount(1);
  expect(teacherCalls.find(c => c.action === 'voiceRead')).toMatchObject({ studentId: 'maya', messageId: 'v1' });
  await box.locator('textarea').fill('Thanks Maya, I heard you.');
  await box.getByRole('button', { name: 'Send message' }).click();
  await expect(box).toContainText('Thanks Maya, I heard you.');
  const reply = teacherCalls.find(c => c.action === 'comment');
  expect(reply).toMatchObject({ classId: 'TEST-ALEF', studentId: 'maya', text: 'Thanks Maya, I heard you.' });
  expect('assignmentId' in reply).toBe(false);
  await recordVoiceNote(teacherPage, box, 2);
  expect(teacherCalls.filter(c => c.action === 'comment').at(-1)).toMatchObject({ studentId: 'maya' });
  // Pick another student.
  await teacherPage.locator('#messagesStudent').selectOption('noam');
  await expect(box).toContainText('No messages with Noam Cohen yet.');
  await teacherPage.screenshot({ path: testInfo.outputPath('homework-teacher-standalone.png'), fullPage: true });
  expect(teacherWatch.productionRequests).toEqual([]);
  expect(teacherWatch.pageErrors).toEqual([]);
  await teacherPage.close();
});

test('fictional student sends a standalone voice note and the teacher replies @auth @homework', async ({ browser }, testInfo) => {
  test.skip(!credentials, NOT_CONFIGURED);
  const adult = credentials!.adultAccounts.find(row => row.role === 'teacher' && row.classId === 'TEST-ALEF');
  const student = credentials!.studentAccounts.find(row => row.classId === 'TEST-ALEF');
  if (!adult || !student) throw new Error('Fictional TEST-ALEF teacher and student credentials are required.');
  const studentContext = await browser.newContext({ permissions: ['microphone'] });
  const teacherContext = await browser.newContext({ permissions: ['microphone'] });
  const studentPage = await studentContext.newPage();
  const teacherPage = await teacherContext.newPage();
  const studentWatch = await watchPage(studentPage);
  const teacherWatch = await watchPage(teacherPage);
  const stamp = 'Fictional standalone note ' + Date.now();
  try {
    await signInStudent(studentPage, student, HOMEWORK_SITE);
    await studentPage.goto(HOMEWORK_SITE + '/assignment-center/student.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(studentPage);
    const panel = studentPage.locator('#generalMessages');
    await expect(panel).toBeVisible({ timeout: 30000 });
    await panel.locator('.conversation-toggle').click();
    // Voice only: no typing, no assignment, no hand-in.
    await recordVoiceNote(studentPage, panel);
    await panel.locator('textarea').fill(stamp);
    await panel.getByRole('button', { name: 'Send message' }).click();
    await expect(panel).toContainText(stamp);
    await studentPage.screenshot({ path: testInfo.outputPath('homework-student-standalone-real.png'), fullPage: true });

    await signInAdult(teacherPage, adult, HOMEWORK_SITE);
    await teacherPage.goto(HOMEWORK_SITE + '/assignment-center/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(teacherPage);
    await expect(teacherPage.locator('#app')).toBeVisible({ timeout: 45000 });
    await teacherPage.getByRole('button', { name: /Messages from students/ }).click();
    const studentId = await studentPage.evaluate(() => sessionStorage.getItem('b3Games_studentId') || '');
    await teacherPage.locator('#messagesStudent').selectOption(studentId);
    const box = teacherPage.locator('#messagesBox');
    await expect(box).toContainText(stamp);
    const play = box.getByRole('button', { name: '▶ Play voice note' }).last();
    await play.click();
    await expect(box.locator('audio').last()).toHaveAttribute('src', /^data:audio\//, { timeout: 20000 });
    await box.locator('textarea').fill('Reply to ' + stamp);
    await box.getByRole('button', { name: 'Send message' }).click();
    await expect(box).toContainText('Reply to ' + stamp);
    await recordVoiceNote(teacherPage, box, 2);
    await teacherPage.screenshot({ path: testInfo.outputPath('homework-teacher-standalone-real.png'), fullPage: true });

    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(panel.locator('.conversation-toggle')).toContainText(/new message/);
    await panel.locator('.conversation-toggle').click();
    await expect(panel).toContainText('Reply to ' + stamp);
    await expect(panel.locator('.conversation-message.theirs.unread').first()).toBeVisible();
  } finally {
    expect(studentWatch.productionRequests).toEqual([]);
    expect(teacherWatch.productionRequests).toEqual([]);
    await studentContext.close();
    await teacherContext.close();
  }
});
