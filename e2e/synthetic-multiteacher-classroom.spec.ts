import { test, expect } from '@playwright/test';
import http from 'node:http';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, set, get } from 'firebase/database';
import { PROJECT, WORKSPACE, CLASS_ID, DB_PORT, fictionalOwnerRules, serveSyntheticSite, closeSyntheticSite, configureBrowser } from './helpers/synthetic-firebase';

// The ordinary cross-browser workflow does not run emulators. The migration
// workflow explicitly runs this suite under emulators:exec (never hosted Firebase).
test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Run with the demo Firebase Auth/Database/Functions emulators.');
test.setTimeout(120_000);
let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
let server: http.Server;
let origin: string;

async function seedSyntheticClassroom() {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db, `b3Quiz/classes/${CLASS_ID}/launches/quiz_one`), {
      classId: CLASS_ID, started: true, mode: 'test', showScore: true,
      quizSnapshot: { title: 'Fictional Pilot Quiz', questions: [{ q: 'Which choice is correct?', choices: ['Choice A', 'Choice B'], correctIndex: 1 }, { q: 'Which number is two?', choices: ['One', 'Two'], correctIndex: 1 }] }
    });
    await set(ref(db, `b3Games/workspaces/${WORKSPACE}/classes/et`), { name: 'Synthetic ET preservation check', active: true, members: { synthetic_et: { name: 'Synthetic ET Student', active: true } } });
    await set(ref(db, `b3Games/workspaces/${WORKSPACE}/classes/wt`), { name: 'Synthetic WT preservation check', active: true, members: { synthetic_wt: { name: 'Synthetic WT Student', active: true } } });
  });
}

test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, database: {
    host: '127.0.0.1', port: DB_PORT, rules: fictionalOwnerRules()
  } });
  await seedSyntheticClassroom();
  ({server,origin} = await serveSyntheticSite());
});

test.afterAll(async () => {
  await env?.cleanup();
  await closeSyntheticSite(server);
});

test('new teacher claims one assigned class, enrolls three students, and a student completes a quiz that survives reload', async ({ page, browser }) => {
  const pageErrors: string[] = [];
  const failedFirebase: string[] = [];
  const ownerContext=await browser.newContext();
  const ownerPage=await ownerContext.newPage();
  await configureBrowser(ownerPage,pageErrors,failedFirebase,'owner');
  await ownerPage.goto(`${origin}/owner-admin.html`);
  await ownerPage.getByRole('button',{name:'Sign in with Google'}).click();
  await expect(ownerPage.locator('#ownerArea')).toBeVisible();
  await ownerPage.locator('#className').fill('Pilot Room Alpha');
  await ownerPage.locator('#addClass').click();
  await expect(ownerPage.locator('#classes')).toContainText('Pilot Room Alpha');
  await ownerPage.locator('#teacherEmail').fill('teacher@example.test');
  await ownerPage.locator('#teacherName').fill('Fictional Teacher');
  await ownerPage.locator('#addTeacher').click();
  await expect(ownerPage.locator('#teachers')).toContainText('Fictional Teacher');
  await ownerPage.locator('#teacherSelect').selectOption('teacher_example_test');
  await ownerPage.locator('#classSelect').selectOption(CLASS_ID);
  await ownerPage.locator('#assign').click();
  await expect(ownerPage.locator('#assignments')).toContainText('Pilot Room Alpha');
  await ownerPage.locator('#toolClassSelect').selectOption(CLASS_ID);
  for(const tool of ['weekly-quiz','rashi-letters']) {
    await ownerPage.locator(`[data-tool="${tool}"]`).check();
    await expect(ownerPage.locator('#status')).toContainText('Saved');
  }
  await ownerContext.close();
  await configureBrowser(page, pageErrors, failedFirebase);
  const teacherClassReads: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith(`http://127.0.0.1:${DB_PORT}/`)) teacherClassReads.push(request.url());
  });

  await page.goto(`${origin}/teacher-home.html?signin=1`);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('#classes .class-card h2')).toHaveText(['Pilot Room Alpha']);

  const claimedTeacher = await env.withSecurityRulesDisabled(async context =>
    (await get(ref(context.database(), `b3Games/workspaces/${WORKSPACE}/teachers/${(await page.evaluate(() => window.firebase.auth().currentUser.uid))}`))).val()
  );
  expect(claimedTeacher?.classIds).toEqual({ [CLASS_ID]: true });
  expect(teacherClassReads.some(url => url.includes('/classes/et/') || url.includes('/classes/wt/'))).toBe(false);
  await expect(page.locator('#classes .class-card h2')).not.toContainText('Synthetic ET preservation check');
  await expect(page.locator('#classes .class-card h2')).not.toContainText('Synthetic WT preservation check');

  await page.getByRole('link', { name: 'Manage Class' }).click();
  const adminFrame = page.frameLocator('#adminFrame');
  await expect(adminFrame.locator('#manageClassSelect')).toBeVisible();
  await adminFrame.locator('#showAddStudentButton').click();
  const syntheticStudents = [
    ['Ari Example', 'pilot-4101'], ['Bina Example', 'pilot-5202'], ['Carmi Example', 'pilot-6303']
  ];
  for (const [name, passcode] of syntheticStudents) {
    await adminFrame.locator('#managedStudentName').fill(name);
    await adminFrame.locator('#managedStudentPasscode').fill(passcode);
    await adminFrame.locator('#createManagedStudentButton').click();
    await expect(adminFrame.locator('#classManagementStatus')).toContainText('Student created in this class.');
  }
  const enrolled = await env.withSecurityRulesDisabled(async context =>
    (await get(ref(context.database(), `b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}/members`))).val()
  );
  expect(Object.values(enrolled || {}).map((row: any) => row.name).sort()).toEqual(syntheticStudents.map(row => row[0]).sort());

  // Keep student authentication in a separate tab/profile, with no remembered teacher.
  const studentContext=await browser.newContext();
  page=await studentContext.newPage();
  await configureBrowser(page,pageErrors,failedFirebase);
  await page.goto(`${origin}/index.html`);
  await page.locator('#studentNameInput').fill('Ari Example');
  await page.locator('#classPinInput').fill('pilot-4101');
  await page.locator('#studentSignInBtn').click();
  await expect(page.locator('#studentNameLabel')).toHaveText('Ari Example');
  await expect(page.getByRole('link', { name: /Weekly Quiz/i })).toBeVisible();
  await page.getByRole('link', { name: /Weekly Quiz/i }).click();
  await expect(page.getByText('Fictional Pilot Quiz')).toBeVisible();
  await expect(page.getByText('Which choice is correct?')).toBeVisible();
  await page.getByRole('button', { name: /B\. Choice B/ }).click();
  await page.getByRole('button', { name: /submit/i }).click();
  await expect(page.getByText(/completed|100%|correct/i).first()).toBeVisible();

  const studentIds = Object.entries(enrolled || {}).map(([id, row]: [string, any]) => [id, row.name]);
  const ariId = studentIds.find(([, name]) => name === 'Ari Example')?.[0];
  expect(ariId).toBeTruthy();
  const completion = await env.withSecurityRulesDisabled(async context =>
    (await get(ref(context.database(), `b3Quiz/classes/${CLASS_ID}/completions/quiz_one/${ariId}`))).val()
  );
  expect(completion).toBeTruthy();

  await page.reload();
  await expect(page.getByText(/completed|100%|correct/i).first()).toBeVisible();
  expect(failedFirebase).toEqual([]);
  expect(pageErrors).toEqual([]);
});

