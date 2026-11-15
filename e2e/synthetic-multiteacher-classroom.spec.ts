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
    await set(ref(db, 'posukPractice/translationChunks/Vayeira_18_1'), {
      levels: [{ chunks: [{ hebrew: 'וַיֵּרָ֤א אֵלָיו֙', english: ['appeared to him'], posukNum: 1 }] }]
    });
    await set(ref(db, 'posukPractice/generatedQuestions/Vayeira_18_1_phrases_v7'), {
      items: [{ question: 'What happened to Abraham?', expectedAnswer: 'Hashem appeared to him.',
        answerHebrewPhrases: ['וַיֵּרָ֤א אֵלָיו֙'], answerWordSets: [[0, 1]] }]
    });
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
  // Every class and teacher belongs to a school (#631, #666).
  await ownerPage.locator('#schoolName').fill('Fictional Pilot School');
  await ownerPage.locator('#addSchool').click();
  await expect(ownerPage.locator('#schools')).toContainText('Fictional Pilot School');
  await ownerPage.locator('#schools').getByRole('button',{name:'Fictional Pilot School'}).click();
  await ownerPage.locator('#oaNav').getByRole('button',{name:'Classes'}).click();
  await ownerPage.locator('#className').fill('Pilot Room Alpha');
  await ownerPage.locator('#addClass').click();
  await expect(ownerPage.locator('#classes')).toContainText('Pilot Room Alpha');
  await writeFixture(`b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}/posukPracticeLimit`, {
    startSefer: 'Bereishis', startPerek: 18, startPosuk: 1,
    endSefer: 'Bereishis', endPerek: 18, endPosuk: 1
  });
  await ownerPage.locator('#oaNav').getByRole('button',{name:'Teachers'}).click();
  await ownerPage.locator('#teacherEmail').fill('teacher@example.test');
  await ownerPage.locator('#teacherName').fill('Fictional Teacher');
  await ownerPage.locator('#addTeacher').click();
  await expect(ownerPage.locator('#teachers')).toContainText('Fictional Teacher');
  await ownerPage.locator('#oaNav').getByRole('button',{name:'Classes'}).click();
  await ownerPage.locator('#classes').getByRole('button',{name:'Pilot Room Alpha'}).click();
  await ownerPage.locator('#teacherSelect').selectOption('teacher_example_test');
  await ownerPage.locator('#assign').click();
  await expect(ownerPage.locator('#assignments')).toContainText('Fictional Teacher');
  for(const tool of ['weekly-quiz','rashi-letters','posuk-practice-scroll','chazara','shorashim']) {
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
  async function writeFixture(path:string,value:unknown){await env.withSecurityRulesDisabled(async c=>set(ref(c.database(),path),value));}
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
  // A finished quiz never reopens by itself (issue #376); he opens it from his list.
  const finishedRow=page.locator('#assignedList .assigned-row').filter({hasText:'Fictional Pilot Quiz'});
  await expect(finishedRow).toContainText('Finished');
  await expect(page.locator('#completeCard')).toBeHidden();
  await finishedRow.getByRole('button',{name:'Review'}).click();
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
  // Synthetic microphone input and deterministic grader responses keep the
  // journey local. Auth, application interactions, rules, uploads, and
  // progress writes still use the real Firebase emulators and application.
  await page.addInitScript(() => {
    class SyntheticMediaRecorder {
      state = 'inactive'; mimeType = 'audio/webm'; ondataavailable: any = null; onstart: any = null; onstop: any = null;
      listeners = new Map<string, Function[]>();
      static isTypeSupported() { return true; }
      addEventListener(type: string, listener: Function) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
      start() { this.state = 'recording'; this.onstart?.(); }
      stop() {
        if (this.state !== 'recording') return;
        this.state = 'inactive';
        this.ondataavailable?.({data: new Blob([new Uint8Array(4096)], {type: this.mimeType})});
        this.onstop?.();
        for (const listener of this.listeners.get('stop') || []) listener();
      }
    }
    class SyntheticAudioContext {
      startedAt = Date.now();
      createMediaStreamSource() { return {connect() {}}; }
      createAnalyser() {
        const start = this.startedAt;
        return {fftSize: 256, frequencyBinCount: 128, connect() {},
          getByteTimeDomainData(data: Uint8Array) {
            const elapsed = Date.now() - start, speaking = elapsed > 500 && elapsed < 1500;
            for (let i = 0; i < data.length; i++) data[i] = speaking && i % 2 ? 158 : speaking ? 98 : 128;
          }, getByteFrequencyData(data: Uint8Array) { data.fill(0); }};
      }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {
      getUserMedia: async () => ({getTracks: () => [{stop() {}}], getAudioTracks: () => []})
    }});
    (window as any).MediaRecorder = SyntheticMediaRecorder;
    (window as any).AudioContext = SyntheticAudioContext;
  });
  const syntheticJson = (body: unknown) => ({status: 200, contentType: 'application/json', body: JSON.stringify(body),
    headers: {'access-control-allow-origin': new URL(origin).origin, 'access-control-allow-headers': 'authorization,content-type'}});
  await page.route('https://posuk-scorer.onrender.com/**', route =>
    route.fulfill(syntheticJson({score: 100, transcription: 'וַיֵּרָ֤א אֵלָיו֙', words: []})));
  await page.route('https://us-central1-b3-games.cloudfunctions.net/gradeTranslationChunk', route =>
    route.fulfill(syntheticJson({verdict: 'correct', feedback: 'Good translation.', transcript: 'appeared to him'})));
  await page.route('https://us-central1-b3-games.cloudfunctions.net/gradeQuestionAnswer', route =>
    route.fulfill(syntheticJson({verdict: 'correct', feedback: 'You found the right words!', gradingVersion: 'semantic-v1'})));
  await page.route('https://us-central1-b3-games.cloudfunctions.net/studentRewardsAutoAward', route =>
    /"action":"posuk-submit"/.test(route.request().postData() || '') ? route.fallback() : route.fulfill(syntheticJson({ok: true, awarded: false})));
  // The server checks the recording in the production bucket name; send the
  // student's real upload to that bucket in the Storage emulator.
  await page.route(/\/v0\/b\/synthetic\.invalid\/o.*_combined_/, route =>
    route.continue({url: route.request().url().replace('/b/synthetic.invalid/', '/b/b3-games.firebasestorage.app/')}));
  // Listen asks the speech service to read the instructions; answer with a tiny real sound.
  const spokenTexts: string[] = [];
  const wav = Buffer.alloc(44 + 800); wav.write('RIFF', 0); wav.writeUInt32LE(36 + 800, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(800, 40); wav.fill(128, 44);
  await page.route('https://us-central1-b3-games.cloudfunctions.net/synthesizeSpeech', route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    spokenTexts.push(String(JSON.parse(route.request().postData() || '{}').text || ''));
    return route.fulfill(syntheticJson({audioContent: wav.toString('base64')}));
  });
  await page.addInitScript(() => {
    const english = Array(30).fill(''); english[0] = 'And the Lord appeared to him by the oaks of Mamre.';
    const kehot = Array(30).fill(''); kehot[0] = english[0];
    localStorage.setItem('posukPractice_translation_v1_18', JSON.stringify(english));
    localStorage.setItem('posukPractice_kehot_translation_v1_18', JSON.stringify(kehot));
  });
  const posukClassReads: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith(`http://127.0.0.1:${DB_PORT}/`) && request.url().includes('/classes/')) posukClassReads.push(request.url());
  });
  await page.goto(`${origin}/record_pesukim/student.html?sefer=Bereishis&perek=18&posuk=1`);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#posukText')).toContainText('אֵלָיו');
  // Posuk Practice (#694): one combined Read & Translate step, one microphone.
  await expect(page.locator('#combinedPanel')).toBeVisible();
  for (const gone of ['.task-tabs', '#readingPanel', '#translationPanel', '#comprehensionPanel']) await expect(page.locator(gone)).toBeHidden();
  // #732: the subtitle, the yellow instruction box and the mic caption are gone.
  for (const removed of ['#toolSubtitle', '#combinedPanel .instruction-card', '#combinedInstructionBtn', '#combinedPanel .record-caption']) await expect(page.locator(removed)).toHaveCount(0);
  await expect(page.locator('#combinedPanel h3')).toContainText('Read & Translate');
  await expect(page.locator('#combinedRecordBtn')).toBeVisible();
  const attemptsPath = `posukPractice/attempts/${ariId}/Vayeira_18_1`;
  const rewardBalancePath = `studentRewards/students/${ariId}/rewardBalance`;
  await writeFixture(`studentRewards/students/${ariId}`, {name: 'Ari Example', rewardBalance: 3});
  await page.locator('#combinedRecordBtn').click();
  await expect(page.locator('#combinedStatus')).toContainText('Recording', {timeout: 10000});
  // The full posuk stays on screen, unblurred, for the whole recording.
  await expect(page.locator('#posukText')).toBeVisible();
  expect(await page.locator('.recording-ready-blur').count()).toBe(0);
  expect(await page.locator('#posukText').evaluate(el => getComputedStyle(el).filter)).toBe('none');
  await page.waitForTimeout(1800);
  await expect(page.locator('#combinedStatus')).toContainText('Recording');
  await page.locator('#combinedRecordBtn').click();
  await expect(page.locator('#combinedStatus')).toContainText('Recorded');
  await expect(page.locator('#combinedAudioPlayback')).toBeVisible();
  expect(await page.locator('#combinedAudioPlayback').getAttribute('src')).toMatch(/^blob:/);
  // Record again throws the recording away; a second recording can then be sent.
  await page.locator('#combinedDeleteBtn').click();
  await expect(page.locator('#combinedSubmitBtn')).toBeHidden();
  await page.locator('#combinedRecordBtn').click();
  await expect(page.locator('#combinedStatus')).toContainText('Recording', {timeout: 10000});
  await page.waitForTimeout(1800);
  await page.locator('#combinedRecordBtn').click();
  await expect(page.locator('#combinedSubmitBtn')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#combinedSubmitBtn').click();
  await expect(page.locator('#combinedMsg')).toContainText('Sent to your teacher', {timeout: 30000});
  const reviewPath = `posukPractice/reviews/${ariId}/Vayeira_18_1`;
  await expect.poll(async()=>(await readFixture(reviewPath))?.status, {timeout: 20000}).toBe('pending');
  const savedAttempt: any = Object.values(await readFixture(attemptsPath) || {}).find((row: any) => row.combinedAudioStoragePath);
  expect(savedAttempt.combinedAudioStoragePath).toContain(`posukPractice/${ariId}/Vayeira_18_1_combined_`);
  expect(await readFixture(rewardBalancePath)).toBe(-2); // 3 − 5: the charge may go below zero
  // Locked until the teacher grades it, also after a reload.
  await expect(page.locator('#combinedStateBox')).toContainText('You sent this to your teacher');
  await expect(page.locator('#combinedRecordStage')).toBeHidden();
  await page.reload();
  await expect(page.locator('#combinedStateBox')).toContainText('You sent this to your teacher');
  await expect(page.locator('#combinedRecordStage')).toBeHidden();
  // The student cannot grade or re-open their own posuk.
  const selfWrite = await page.evaluate(async path => { try { await (window as any).firebase.database().ref(path).update({status: 'gold'}); return 'written'; } catch (e) { return 'denied'; } }, reviewPath);
  expect(selfWrite).toBe('denied');
  await page.goto(`${origin}/record_pesukim/progress.html`);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.review-group').filter({hasText: 'Waiting for your teacher'}).locator('.review-tile')).toContainText('18:1');

  // The teacher hears it in To Grade and marks it gold standard.
  const posukTeacherContext=await browser.newContext(),posukTeacherPage=await posukTeacherContext.newPage();
  await configureBrowser(posukTeacherPage,pageErrors,failedFirebase);
  await posukTeacherPage.goto(`${origin}/teacher-home.html?signin=1`);
  await posukTeacherPage.getByRole('button',{name:'Sign in with Google'}).click();
  await expect(posukTeacherPage.locator('#classes .class-card h2')).toHaveText(['Pilot Room Alpha']);
  const posukTeacherReads:string[]=[];
  posukTeacherPage.on('request',request=>{ if(request.url().startsWith(`http://127.0.0.1:${DB_PORT}/`))posukTeacherReads.push(request.url()); });
  await posukTeacherPage.goto(`${origin}/record_pesukim/teacher.html?class=${CLASS_ID}`);
  const gradeCard=posukTeacherPage.locator('.grade-card').filter({hasText:'Ari Example'});
  await expect(gradeCard).toBeVisible({timeout:20000});
  await expect(gradeCard).toContainText('Posuk 1');
  await expect(gradeCard.locator('.grade-hebrew')).toContainText('אֵלָיו');
  await expect(gradeCard.locator('audio')).toHaveCount(1);
  await expect(posukTeacherPage.locator('#gradeTabCount')).toHaveText('1');
  await gradeCard.locator('[data-choice="gold"]').click();
  await gradeCard.locator('[data-field="mistakes"]').fill('1');
  await gradeCard.locator('[data-field="bonus"]').fill('2');
  await gradeCard.locator('[data-field="note"]').fill('Beautiful reading');
  await expect(gradeCard.locator('[data-field="points"]')).toHaveText('= 11 points');
  await gradeCard.locator('[data-save]').click();
  await expect.poll(async()=>(await readFixture(reviewPath))?.status, {timeout: 20000}).toBe('gold');
  expect(await readFixture(rewardBalancePath)).toBe(9); // −2 + (10 − 1 mistake + 2 bonus)
  await expect(posukTeacherPage.locator('.graded-row').filter({hasText:'Ari Example'})).toContainText('Gold standard',{timeout:15000});
  await expect(posukTeacherPage.locator('.grade-card')).toHaveCount(0);
  expect(posukTeacherReads.some(url=>url.includes('/classes/et/')||url.includes('/classes/wt/'))).toBe(false);
  await posukTeacherContext.close();

  // The student sees the grade, the bonus notice and the one-month lock.
  await page.goto(`${origin}/record_pesukim/student.html?sefer=Bereishis&perek=18&posuk=1`);
  await expect(page.locator('#combinedStateBox')).toContainText('Gold standard');
  await expect(page.locator('#combinedRecordStage')).toBeHidden();
  await expect(page.locator('#bonusNotices')).toContainText('2 bonus points');
  await page.goto(`${origin}/record_pesukim/progress.html`);
  await expect(page.locator('.review-group').filter({hasText: 'Gold standard'}).locator('.review-tile')).toContainText('18:1');
  await expect(page.locator('.review-group').filter({hasText: 'Waiting for your teacher'}).locator('.review-tile')).toHaveCount(0);
  // Understand questions live in the separate Chumash חידון tile (?mode=quiz).
  await page.goto(`${origin}/record_pesukim/student.html?sefer=Bereishis&perek=18&posuk=1&mode=quiz`);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#readingPanel')).toBeHidden();
  await expect(page.locator('#combinedPanel')).toBeHidden();
  await expect(page.locator('#questionText')).toContainText('What happened to Abraham?');
  await page.locator('#questionWordChoices .word-choice').nth(0).click();
  await page.locator('#questionWordChoices .word-choice').nth(1).click();
  await page.locator('#checkWordSelectionBtn').click();
  await expect(page.locator('#comprehensionResult')).toContainText('Got it!', {timeout: 15000});
  await expect.poll(async()=>Object.values(await readFixture(attemptsPath) || {}).some((row: any)=>row.questionResults?.[0]?.verdict==='correct'), {timeout: 30000}).toBe(true);
  expect(posukClassReads.some(url => url.includes('/classes/et/') || url.includes('/classes/wt/'))).toBe(false);
  await expect(page.locator('#comprehensionCheck')).not.toHaveClass(/hidden/);
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  // The teacher's gold standard grade above is what unlocks this posuk in
  // Chazara (#694); there are no computer reading or translation scores.
  // Chazara keeps its own class-attributed review and recording history.
  await page.goto(`${origin}/chazara/index.html`);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#studentNameTop')).toHaveText('Ari Example');
  await expect(page.locator('.pasuk:not(:disabled)').first()).toBeVisible();
  await page.locator('.pasuk:not(:disabled)').first().click();
  await expect(page.locator('#confirmBox')).toBeVisible();
  await page.locator('#confirmYes').click();
  const chazaraRoot=`posukPractice/chazara/students/${ariId}`;
  await expect.poll(async()=>Number((await readFixture(`${chazaraRoot}/reviews/18_1`))?.count),{timeout:20000}).toBe(1);
  const recordButton=page.locator('.record-bar[data-key="18_1"]');
  await expect(recordButton).toBeEnabled();
  await recordButton.click();
  await expect(recordButton).toContainText('Stop');
  await page.waitForTimeout(5200);
  await recordButton.click();
  await expect.poll(async()=>{
    const events=await readFixture(`posukPractice/chazara/events/${ariId}`);
    return Object.values(events||{}).some((event:any)=>event.recorded===true&&event.reviewApplied===true&&event.workspaceClassId===CLASS_ID);
  },{timeout:45000}).toBe(true);
  await expect.poll(async()=>Number((await readFixture(`${chazaraRoot}/reviews/18_1`))?.count),{timeout:20000}).toBe(2);
  await page.reload();
  await expect(page.locator('#total')).toHaveText('2');
  await expect(page.locator('#recordingsList')).toContainText('Awaiting approval');
  await writeFixture(`posukPractice/shorashimLearning/classes/${CLASS_ID}/catalog`,{
    shorashim:[{id:'nightly-vayeira',perek:18,front:'appeared',hebrew:'וַיֵּרָא',english:'appeared',art:['👀'],hidden:false}],
    prefix:[],suffix:[]
  });
  await writeFixture(`posukPractice/shorashimLearning/classes/${CLASS_ID}/settings`,{studentSiteOpen:true,minReviewMs:500});
  await writeFixture(`posukPractice/shorashimLearning/classes/${CLASS_ID}/students/${ariId}`,{
    name:'Ari Example',cards:{'shorashim:nightly-vayeira':{itemKey:'shorashim:nightly-vayeira',itemType:'shorashim',itemId:'nightly-vayeira',createdAt:1,learnedAt:2,design:{}}},
    sessions:[],activeSession:null,totalActiveSeconds:0,gamesPlayed:0,gameBests:{match:{}}
  });
  await page.goto(`${origin}/shorashim/index.html`);
  await expect(page.locator('#signedInStudentName')).toHaveText('Ari Example');
  await expect(page.locator('#appShell')).toBeVisible();
  await page.getByRole('button',{name:/Learn New Shorashim/}).click();
  await expect(page.locator('[data-learning-perek="perek:18"] .perek-progress')).toContainText('1 of 1 learned');
  await page.locator('[data-learning-perek="perek:18"]').click();
  await expect(page.locator('#editorContent')).toBeVisible();
  await page.reload();
  await expect(page.locator('#signedInStudentName')).toHaveText('Ari Example');
  await page.getByRole('button',{name:/Learn New Shorashim/}).click();
  await expect(page.locator('[data-learning-perek="perek:18"] .perek-progress')).toContainText('1 of 1 learned');
  expect(await readFixture(`posukPractice/shorashimLearning/students/${ariId}`)).toBeNull();
  const chazaraTeacherContext=await browser.newContext(),chazaraTeacherPage=await chazaraTeacherContext.newPage();
  await configureBrowser(chazaraTeacherPage,pageErrors,failedFirebase);
  await chazaraTeacherPage.goto(`${origin}/teacher-home.html?signin=1`);
  await chazaraTeacherPage.getByRole('button',{name:'Sign in with Google'}).click();
  await expect(chazaraTeacherPage.locator('#classes .class-card h2')).toHaveText(['Pilot Room Alpha']);
  const chazaraTeacherReads:string[]=[];
  chazaraTeacherPage.on('request',request=>{
    if(request.url().startsWith(`http://127.0.0.1:${DB_PORT}/`))chazaraTeacherReads.push(request.url());
  });
  await chazaraTeacherPage.goto(`${origin}/chazara/teacher.html?class=${CLASS_ID}`);
  await expect(chazaraTeacherPage.locator('#teacherApp')).toBeVisible();
  await expect(chazaraTeacherPage.locator('#scopeLabel')).toContainText('Pilot Room Alpha');
  await chazaraTeacherPage.getByRole('button', { name: 'Show Full Dashboard' }).click();
  await expect(chazaraTeacherPage.locator('#rows')).toContainText('Ari Example');
  await expect(chazaraTeacherPage.locator('#rows')).not.toContainText('Synthetic ET');
  await expect(chazaraTeacherPage.locator('#rows')).not.toContainText('Synthetic WT');
  await expect.poll(async()=>chazaraTeacherPage.locator('#nt').innerText()).toContain('2');
  expect(chazaraTeacherReads.some(url=>url.includes('/classes/et/')||url.includes('/classes/wt/'))).toBe(false);
  expect(await readFixture(`posukPractice/chazara/events/${ariId}`)).not.toBeNull();
  expect(posukClassReads.some(url=>url.includes('/classes/et/')||url.includes('/classes/wt/'))).toBe(false);
  await chazaraTeacherPage.goto(`${origin}/shorashim/index.html?class=${CLASS_ID}`);
  await expect(chazaraTeacherPage.locator('#signedInStudentName')).toHaveText('Teacher Preview');
  await chazaraTeacherPage.getByRole('button',{name:/Learn New Shorashim/}).click();
  await expect(chazaraTeacherPage.locator('[data-learning-perek="perek:18"] .perek-progress')).toContainText('0 of 1 learned');
  await chazaraTeacherContext.close();
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
