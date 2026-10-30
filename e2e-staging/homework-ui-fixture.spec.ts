import { test, expect } from '@playwright/test';
import { HOMEWORK_SITE, watchPage, expectStagingIsolation } from './staging-common';

// A read-only browser fixture for teacher UI coverage when the staging Google
// teacher account is unavailable. Firebase auth and homework responses are
// mocked in this browser context; no staging student data is read or changed.
const fixtureTeacher = {
  uid: 'fictional-ui-teacher',
  email: 'teacher.ui@fictional-staging.test',
  getIdToken: async () => 'fixture-only-not-a-firebase-token',
};

const fixtureStudents = {
  maya: { name: 'Maya Levin', status: 'assigned', late: true, answer: '', feedback: '' },
  noam: { name: 'Noam Cohen', status: 'in_progress', late: true, answer: 'I practiced twice.', feedback: '' },
  aviva: { name: 'Aviva Gold', status: 'submitted', late: false, answer: 'I practiced five minutes.', feedback: '' },
  eli: { name: 'Eli Weiss', status: 'approved', late: false, answer: 'I finished the practice.', feedback: 'Great work!' },
};

const fixtureAssignments = [{
  id: 'fixture-homework-1',
  type: 'shorashim',
  title: 'Fictional Shorashim practice',
  details: 'Practice the assigned roots for five minutes.',
  assignedAt: Date.now() - 86400000 * 4,
  dueAt: Date.now() - 86400000,
  publicationState: 'published',
  counts: { assigned: 1, in_progress: 1, submitted: 1, approved: 1, returned: 0, missing: 2 },
  students: fixtureStudents,
}];

test('main staging landing links teachers to Homework @homework-ui', async ({ page }, testInfo) => {
  const watch = await watchPage(page);
  await page.goto(HOMEWORK_SITE + '/', { waitUntil: 'domcontentloaded' });
  const link = page.locator('#homeworkCenterCard');
  await expect(link).toHaveAttribute('href', 'assignment-center/teacher.html');
  await expect(link).toContainText('Homework & Assignments');
  // Reveal the sign-in-only section for this synthetic visual snapshot; no auth
  // state or Firebase data is changed by this fixture.
  await page.locator('#teacherToolsSection').evaluate(section => section.classList.remove('hidden'));
  await expect(link).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('homework-main-teacher-entry.png'), fullPage: true });
  expect(watch.productionRequests).toEqual([]);
});

test('fictional teacher sees distinct workload states and simple screens @homework-ui', async ({ page }, testInfo) => {
  const watch = await watchPage(page);
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.abort());
  await page.addInitScript(() => {
    const user = {
      uid: 'fictional-ui-teacher',
      email: 'teacher.ui@fictional-staging.test',
      getIdToken: async () => 'fixture-only-not-a-firebase-token',
    };
    const authInstance = {
      currentUser: user,
      onAuthStateChanged(callback: (value: typeof user) => void) {
        setTimeout(() => callback(user), 0);
        return () => undefined;
      },
      signOut: async () => undefined,
      signInWithPopup: async () => undefined,
    };
    const authFactory: any = () => authInstance;
    authFactory.GoogleAuthProvider = function GoogleAuthProvider() {};
    const apps: any[] = [];
    const dbRef = () => ({
      once: async () => ({ val: () => null, exists: () => false }),
      set: async () => { throw new Error('The read-only Homework UI fixture blocks database writes.'); },
      update: async () => { throw new Error('The read-only Homework UI fixture blocks database writes.'); },
    });
    (window as any).firebase = {
      apps,
      initializeApp(options: any) { apps.push({ options }); },
      auth: authFactory,
      database() { return { ref: dbRef }; },
    };
  });
  await page.route('**/homeworkPortal', async route => {
    const request = route.request().postDataJSON();
    const result = request.action === 'authorizedClasses'
      ? { ok: true, classes: [{ id: 'TEST-ALEF', name: 'Fictional Test Class Alef' }] }
      : { ok: true, students: fixtureStudents, assignments: fixtureAssignments };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });

  await page.goto(HOMEWORK_SITE + '/assignment-center/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
  await expectStagingIsolation(page);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#cls')).toHaveValue('TEST-ALEF');
  await page.screenshot({ path: testInfo.outputPath('homework-teacher-home.png'), fullPage: true });

  await expect(page.getByRole('button', { name: /Create Homework/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Check Homework/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /My Assignments/ })).toBeVisible();

  await page.getByRole('button', { name: /Preview Student View/ }).click();
  await expect(page.locator('#screenPreview')).toContainText('Fictional sample');
  await expect(page.locator('#fakeStudent button')).toHaveCount(2);
  await expect(page.locator('#fakeStudent button').first()).toBeDisabled();
  await expect(page.locator('#fakeStudent button').nth(1)).toBeDisabled();
  await page.locator('#screenPreview .backHome').click();

  await page.getByRole('button', { name: /Create Homework/ }).click();
  await page.locator('#title').fill('Fictional guided assignment');
  await page.getByRole('button', { name: /Next: choose students/ }).click();
  await expect(page.locator('#step2')).toBeVisible();
  await page.getByRole('button', { name: /Next: dates & preview/ }).click();
  await expect(page.locator('#createPreview')).toContainText('Fictional guided assignment');
  await page.locator('#screenCreate .backHome').click();

  await page.getByRole('button', { name: /Check Homework/ }).click();
  await expect(page.locator('#reviewList')).toContainText('Aviva Gold');
  await expect(page.locator('#reviewList')).toContainText('I practiced five minutes.');
  await expect(page.getByRole('button', { name: 'Approve work by Aviva Gold' })).toBeVisible();
  await page.locator('#screenCheck .backHome').click();

  await page.getByRole('button', { name: /My Assignments/ }).click();
  const summary = page.locator('#summary');
  for (const label of ['Not started', 'Submitted', 'Completed', 'Missing', 'Overdue']) {
    await expect(summary).toContainText(label);
  }
  await expect(summary.locator('.summary-tile').filter({ hasText: 'Missing' }).locator('strong')).toHaveText('1');
  await expect(summary.locator('.summary-tile').filter({ hasText: 'Overdue' }).locator('strong')).toHaveText('2');
  await page.locator('#list details summary').first().click();
  await expect(page.locator('#list')).toContainText('Maya Levin · Not started · Missing · Overdue');
  await expect(page.locator('#list')).toContainText('Noam Cohen · In progress · Overdue');
  await expect(page.locator('#list')).toContainText('Aviva Gold · Submitted');
  await expect(page.locator('#list')).toContainText('Eli Weiss · Completed ✓');
  await page.screenshot({ path: testInfo.outputPath('homework-teacher-assignments.png'), fullPage: true });

  expect(watch.productionRequests).toEqual([]);
  expect(watch.pageErrors).toEqual([]);
});
