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
    await set(ref(db, `b3Quiz/classes/${CLASS_ID}/settings/activeLaunchByClass/${CLASS_ID}`), 'quiz_one');
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
    await expect.poll(async()=> (await readFixture(`b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}/toolGrants`))?.[tool]).toBe(true);
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

  const teacherUid=await page.evaluate(()=>window.firebase.auth().currentUser.uid);
  const claimedTeacher=await readFixture(`b3Games/workspaces/${WORKSPACE}/teachers/${teacherUid}`);
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
    await expect(adminFrame.locator('#managedStudentName')).toHaveValue('');
    await expect(adminFrame.locator('#classManagementStatus')).toContainText('Student created in this class.');
  }
  const enrolled=await readFixture(`b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}/members`);
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
  await expect(page.locator('#quizTitle')).toHaveText('Fictional Pilot Quiz',{timeout:15000});
  await expect(page.getByText('Which choice is correct?')).toBeVisible();
  const ariId=Object.entries(enrolled).find(([,row]:[string,any])=>row.name==='Ari Example')?.[0];
  expect(ariId).toBeTruthy();
  async function readFixture(path:string){let value:any;await env.withSecurityRulesDisabled(async c=>{value=(await get(ref(c.database(),path))).val();});return value;}
  const quizRoot=`b3Quiz/classes/${CLASS_ID}`;
  await page.getByRole('button', { name: /B\. Choice B/ }).click();
  await page.locator('#submitBtn').click();
  await expect.poll(async()=> (await readFixture(`${quizRoot}/responses/quiz_one/${ariId}/0`))?.choiceIndex).toBe(1);
  await page.reload();
  await expect(page.locator('#progressText')).toHaveText('1 of 2 answered');
  await expect(page.locator('#choices .choice.selected')).toBeDisabled();
  await page.locator('#questionNav').getByRole('button',{name:'2',exact:true}).click();
  await page.getByRole('button',{name:/B\. Two/}).click();
  await page.locator('#submitBtn').click();
  await expect.poll(async()=> (await readFixture(`${quizRoot}/completions/quiz_one/${ariId}`))?.pct).toBe(100);
  await page.reload();
  await expect(page.locator('#completeCard')).toBeVisible();
  await expect(page.locator('#completeScore')).toContainText('100%');
  await expect(page.locator('#pastQuizList')).toContainText('Fictional Pilot Quiz');
  await page.getByRole('link',{name:/Fun Torah Tools/}).first().click();
  await expect(page.locator('#studentNameLabel')).toHaveText('Ari Example');

  // A second real learning page saves a completed letter step, then reloads it.
  await page.locator('a[href*="rashi-letters/student.html"]').click();
  await expect(page.locator('#modeGate')).toBeVisible();
  await page.getByRole('button',{name:/Step 6:/}).click();
  for(let i=0;i<3;i++){
    const choices=page.locator('#choicesRow .choice-btn');
    await expect(choices.first()).toBeEnabled();
    const target=(await page.locator('#rashiLetter').innerText()).trim();
    await page.locator('#choicesRow').getByRole('button',{name:target,exact:true}).click();
    if(i<2)await expect(page.locator('#sessionStars')).toContainText('★ '+(i+1));
  }
  await expect.poll(async()=> (await readFixture(`rashiLetters/progress/${ariId}`))?.currentPhase).toBe('word');
  await page.reload();
  await expect(page.locator('#modeGate')).toBeVisible();
  await page.getByRole('button',{name:/Step 6:/}).click();
  await expect(page.locator('#phasePill')).toHaveText('Word');
  await page.getByRole('link',{name:/Fun Torah Tools/}).first().click();
  await expect(page.locator('#studentNameLabel')).toHaveText('Ari Example');
  const claims=await page.evaluate(async()=> (await window.firebase.auth().currentUser.getIdTokenResult()).claims);
  expect(claims.b3StudentId).toBe(ariId);expect(claims.b3ClassId).toBe(CLASS_ID);
  expect(claims.b3StudentRole).toBe('student');
  expect(await readFixture(`b3Games/workspaces/${WORKSPACE}/classes/et/members`)).toEqual({synthetic_et:{name:'Synthetic ET Student',active:true}});
  expect(await readFixture(`b3Games/workspaces/${WORKSPACE}/classes/wt/members`)).toEqual({synthetic_wt:{name:'Synthetic WT Student',active:true}});
  await studentContext.close();
  expect(failedFirebase).toEqual([]);
  expect(pageErrors).toEqual([]);
});


// Keep failure evidence readable in CI even when artifact downloads are unavailable.
test.afterEach(async({browser},info)=>{
  if(info.status===info.expectedStatus)return;
  for(const context of browser.contexts())for(const page of context.pages()){
    console.log('SYNTHETIC PAGE',page.url(),(await page.locator('body').innerText().catch(()=>'' )).slice(0,5000));
  }
});
