'use strict';
// Signed-in check of the Davening Chazzan feature (issue #799) on the STAGING
// preview channel, using only the fictional staging accounts.
//
//   ET page -> fictional class TEST-ALEF (teacher Alef, students A1 and A3)
//   WT page -> fictional class TEST-BEIS (teacher Beis, student B1)
//
// Usage (credentials are read from the local-only file, never printed):
//   $env:FTT_STAGING_CREDENTIALS_FILE = '<path>\test-credentials.local.json'
//   $env:FTT_DAVENING_PREVIEW = 'https://fun-torah-tools-staging--davening-799-<id>.web.app'
//   node e2e-staging/davening-chazzan-preview.cjs
//
// Students cannot use the homepage sign-in form on a preview link (the sign-in
// function only answers the live staging address), so this script asks that
// same function for the student's sign-in token and hands it to the page.

const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const PROJECT = 'fun-torah-tools-staging';
const FUNCTIONS = `https://us-central1-${PROJECT}.cloudfunctions.net`;
const SITE = String(process.env.FTT_DAVENING_PREVIEW || '').replace(/\/$/, '');
if (!/^https:\/\/fun-torah-tools-staging--davening-799-[a-z0-9]+\.web\.app$/.test(SITE)) {
  throw new Error('Set FTT_DAVENING_PREVIEW to the davening-799 staging preview link.');
}
const credentials = JSON.parse(fs.readFileSync(process.env.FTT_STAGING_CREDENTIALS_FILE, 'utf8'));
const studentAccount = name => credentials.studentAccounts.find(row => row.name === name)
  || assert.fail('Missing fictional student ' + name);
const teacherAccount = classId => credentials.adultAccounts.find(row => row.role === 'teacher' && row.classId === classId)
  || assert.fail('Missing fictional teacher for ' + classId);

const results = [];
async function step(name, run) {
  try { await run(); results.push(['PASS', name]); console.log('PASS  ' + name); }
  catch (error) { results.push(['FAIL', name]); console.log('FAIL  ' + name + '\n      ' + String(error.message).split('\n')[0]); throw error; }
}

// The page's own Firebase app, with whoever is signed in (waits for sign-in state to load).
const SESSION = `(async () => {
  const fb = window.firebase;
  if (!fb.apps.length) fb.initializeApp(window.B3_FIREBASE_CONFIG);
  const auth = fb.auth();
  const user = auth.currentUser || await new Promise(resolve => { const off = auth.onAuthStateChanged(u => { off(); resolve(u); }); });
  return { auth, user };
})()`;

async function open(browser, page) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  tab.on('request', request => {
    if (/b3-games|funtorahtools\.com|simchacohen1\.github\.io/.test(new URL(request.url()).hostname)) {
      console.log('WARNING production request from the staging preview: ' + new URL(request.url()).hostname);
      process.exitCode = 1;
    }
  });
  await tab.goto(`${SITE}/davening_student_app_${page}/index.html`, { waitUntil: 'load' });
  await tab.waitForFunction(() => window.firebase?.auth && window.B3_FIREBASE_CONFIG
    && document.querySelector('.davening-feature-panel'), null, { timeout: 45000 });
  return tab;
}

async function signInTeacher(tab, classId) {
  const { email, password } = teacherAccount(classId);
  await tab.evaluate(async ([session, e, p]) => { await (await eval(session)).auth.signInWithEmailAndPassword(e, p); },
    [SESSION, email, password]);
}

async function signInStudent(tab, name) {
  const account = studentAccount(name);
  const response = await fetch(`${FUNCTIONS}/funTorahStudentAuth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', name: account.name, pin: account.passcode, classId: account.classId })
  });
  const body = await response.json();
  assert.equal(response.ok, true, 'student sign-in refused: ' + body.error);
  await tab.evaluate(async ([session, token]) => { await (await eval(session)).auth.signInWithCustomToken(token); },
    [SESSION, body.customToken]);
  return body.id;
}

// Calls the endpoint as whoever is signed in on that tab.
const call = (tab, body) => tab.evaluate(async ([session, url, payload]) => {
  const token = await (await eval(session)).user.getIdToken();
  const response = await fetch(url, { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: await response.json() };
}, [SESSION, `${FUNCTIONS}/daveningChazzan`, body]);

const panel = tab => tab.locator('.davening-feature-panel').first();
const panelButton = (tab, text) => panel(tab).getByRole('button', { name: text, exact: false });
const rate = tab => tab.evaluate(() => document.getElementById('audio').playbackRate);
const paused = tab => tab.evaluate(() => document.getElementById('audio').paused);
const speedButtons = tab => panel(tab).getByRole('button', { name: /^1\.\d×$/ }).count();
async function until(read, expected, label, timeout = 20000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (value === expected) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail(`${label}: expected ${expected}, last saw ${value}`);
}

// Admin read of the fictional student's Rewards balance (staging project only).
function rewardBalance(b3StudentId) {
  const raw = execFileSync(process.platform === 'win32' ? 'firebase.cmd' : 'firebase',
    ['database:get', '/studentRewards/students', '--project', PROJECT],
    { encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  const students = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) || 'null') || {};
  return Object.values(students).filter(row => row?.b3StudentId === b3StudentId && row.active !== false)
    .reduce((total, row) => total + Number(row.rewardBalance || 0), 0);
}

async function endAnySession(tab, page) {
  const current = (await call(tab, { action: 'read', classId: page })).body.session;
  if (current && current.phase !== 'ended') {
    await call(tab, { action: 'finish', classId: page, sessionId: current.id });
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failed = false;
  try {
    const teacherEt = await open(browser, 'et'), a1 = await open(browser, 'et'), a2 = await open(browser, 'et');
    const teacherWt = await open(browser, 'wt'), b1 = await open(browser, 'wt');
    await signInTeacher(teacherEt, 'TEST-ALEF');
    await signInTeacher(teacherWt, 'TEST-BEIS');
    const a1Id = await signInStudent(a1, 'Test Student A1');
    await signInStudent(a2, 'Test Student A3');
    await signInStudent(b1, 'Test Student B1');
    await endAnySession(teacherEt, 'et');
    await endAnySession(teacherWt, 'wt');
    for (const tab of [teacherEt, a1, a2, teacherWt, b1]) await tab.reload({ waitUntil: 'load' });
    const balanceAtStart = rewardBalance(a1Id);
    let etSession;

    await step('1. Student requests the Chazzan role and the teacher sees the request', async () => {
      await panelButton(teacherEt, 'Open Chazzan sign-up').click({ timeout: 30000 });
      await a1.locator('.chazzan-spin-wheel').click({ timeout: 30000 });
      await panel(a1).getByText(/is yours!|Your section is assigned/).waitFor({ timeout: 20000 });
      // The teacher's list refreshes by itself and shows who asked.
      await panel(teacherEt).locator('li', { hasText: 'Test Student A1' }).first().waitFor({ timeout: 20000 });
      etSession = (await call(teacherEt, { action: 'read', classId: 'et' })).body.session;
      assert.equal(Object.values(etSession.parts).filter(part => part.name === 'Test Student A1').length, 1);
    });

    await step('2. Teacher selects the Chazzan and that student gets speed controls', async () => {
      // The teacher picks A1 for the first part, the one about to be played.
      const first = panel(teacherEt).locator('li').first();
      await first.locator('select').selectOption({ label: 'Test Student A1' }, { timeout: 20000 });
      await first.getByRole('button', { name: 'Save' }).click();
      await until(async () => (await call(teacherEt, { action: 'read', classId: 'et' })).body.session.parts['part-1'].name,
        'Test Student A1', 'teacher selection saved');
      await until(async () => /Test Student A1/.test(await panel(teacherEt).locator('li').first().evaluate(row => row.firstChild.textContent)),
        true, 'teacher list shows the selected Chazzan');
      await panelButton(teacherEt, 'Start davening').click();
      await panel(a1).getByText('Speed changes left: 2').waitFor({ timeout: 20000 });
      assert.equal(await speedButtons(a1), 8);
      await panel(a1).getByText('Current chazzan: Test Student A1').waitFor({ timeout: 10000 });
    });

    await step('3. Other students do not get speed controls and cannot change the speed', async () => {
      await panel(a2).getByText('Current chazzan: Test Student A1').waitFor({ timeout: 20000 });
      assert.equal(await speedButtons(a2), 0);
      const before = (await call(teacherEt, { action: 'read', classId: 'et' })).body.session.playback.speed;
      const forged = await call(a2, { action: 'speed', classId: 'et', sessionId: etSession.id, partId: 'part-1',
        speed: 1.8, requestId: 'forged-speed-a2' });
      assert.equal(forged.status, 409);
      assert.match(forged.body.error, /Only the assigned chazzan/);
      // A student may not use teacher actions either, nor reach the other class.
      assert.equal((await call(a2, { action: 'playback', classId: 'et', sessionId: etSession.id, partId: 'part-1',
        position: 0, speed: 2, playing: true })).status, 403);
      assert.equal((await call(a2, { action: 'award', classId: 'et', sessionId: etSession.id, partId: 'part-1',
        requestId: 'forged-award-a2' })).status, 403);
      assert.equal((await call(b1, { action: 'speed', classId: 'et', sessionId: etSession.id, partId: 'part-1',
        speed: 1.8, requestId: 'forged-speed-b1' })).status, 403);
      assert.equal((await call(teacherEt, { action: 'read', classId: 'et' })).body.session.playback.speed, before);
    });

    await step('4. The Chazzan changes the speed for the whole class', async () => {
      await panelButton(a1, '1.5×').click();
      await panel(a1).getByText('Speed changes left: 1').waitFor({ timeout: 15000 });
      await until(() => rate(teacherEt), 1.5, 'teacher audio speed');
      await until(() => rate(a2), 1.5, 'other student audio speed');
      // Out-of-range speeds are refused by the server even for the Chazzan.
      const tooFast = await call(a1, { action: 'speed', classId: 'et', sessionId: etSession.id, partId: 'part-1',
        speed: 3, requestId: 'too-fast-a1' });
      assert.equal(tooFast.status, 409);
    });

    await step('5. The teacher keeps overall control (speed, play and pause)', async () => {
      await teacherEt.locator('#speed').selectOption('1.2');
      await until(() => rate(a1), 1.2, 'chazzan audio follows the teacher speed');
      await until(() => rate(a2), 1.2, 'other student audio follows the teacher speed');
      await teacherEt.locator('#playBtn').click();
      await until(() => paused(a2), false, 'student audio plays when the teacher plays');
      await teacherEt.locator('#playBtn').click();
      await until(() => paused(a2), true, 'student audio pauses when the teacher pauses');
      // The teacher can also take the Chazzan role away mid-session.
      assert.equal(await a2.locator('#playBtn').isDisabled(), true);
    });

    await step('6. ET and WT sessions are independent', async () => {
      assert.equal((await call(teacherWt, { action: 'read', classId: 'wt' })).body.session?.phase ?? 'ended', 'ended');
      assert.equal(await panel(b1).getByText('Test Student A1').count(), 0);
      // Each teacher is refused on the other class's page.
      assert.equal((await call(teacherWt, { action: 'read', classId: 'et' })).status, 403);
      assert.equal((await call(teacherEt, { action: 'read', classId: 'wt' })).status, 403);
      await panelButton(teacherWt, 'Open Chazzan sign-up').click({ timeout: 30000 });
      await b1.locator('.chazzan-spin-wheel').click({ timeout: 30000 });
      await panel(teacherWt).locator('li', { hasText: 'Test Student B1' }).first().waitFor({ timeout: 20000 });
      const wt = (await call(teacherWt, { action: 'read', classId: 'wt' })).body.session;
      const et = (await call(teacherEt, { action: 'read', classId: 'et' })).body.session;
      assert.notEqual(wt.id, et.id);
      assert.equal(wt.phase, 'signup');
      assert.equal(et.phase, 'active');
      assert.equal(Object.values(et.parts).some(part => part.name === 'Test Student B1'), false);
      assert.equal(Object.values(wt.parts).some(part => part.name === 'Test Student A1'), false);
      assert.equal(et.playback.speed, 1.2);
    });

    await step('7. Ending the session cleans up; no point was given automatically', async () => {
      await panelButton(teacherEt, 'Finish davening session').click();
      await until(() => speedButtons(a1), 0, 'chazzan speed controls are removed');
      await until(() => paused(a1), true, 'student audio stops');
      const ended = (await call(teacherEt, { action: 'read', classId: 'et' })).body.session;
      assert.equal(ended.phase, 'ended');
      assert.equal(ended.playback, null);
      const late = await call(a1, { action: 'speed', classId: 'et', sessionId: ended.id, partId: 'part-1',
        speed: 1.4, requestId: 'late-speed-a1' });
      assert.equal(late.status, 409);
      assert.equal(Object.values(ended.parts).some(part => part.awarded), false);
      assert.equal(rewardBalance(a1Id), balanceAtStart);
    });

    await step('8. Teacher awards one point by hand and it is recorded once', async () => {
      const award = panelButton(teacherEt, 'Award 1 Rewards point');
      await award.first().waitFor({ timeout: 20000 });
      assert.equal(await award.count(), 1, 'exactly one award button, for the completed part');
      await award.click();
      await panelButton(teacherEt, '1 point awarded').waitFor({ timeout: 30000 });
      assert.equal(rewardBalance(a1Id), balanceAtStart + 1);
      // Asking again does not add a second point.
      const again = await call(teacherEt, { action: 'award', classId: 'et', sessionId: etSession.id, partId: 'part-1',
        requestId: 'repeat-award' });
      assert.equal(again.status, 200);
      assert.equal(rewardBalance(a1Id), balanceAtStart + 1);
    });

    await step('9. A new session starts clean and the WT session is closed', async () => {
      await panelButton(teacherWt, 'Finish davening session').click();
      await until(async () => (await call(teacherWt, { action: 'read', classId: 'wt' })).body.session.phase, 'ended', 'WT session ended');
      await panelButton(teacherEt, 'Open Chazzan sign-up').click({ timeout: 20000 });
      await until(async () => (await call(teacherEt, { action: 'read', classId: 'et' })).body.session.phase, 'signup', 'new ET session opened');
      const fresh = (await call(teacherEt, { action: 'read', classId: 'et' })).body.session;
      assert.notEqual(fresh.id, etSession.id);
      assert.equal(Object.values(fresh.parts).some(part => part.name || part.awarded || part.changes), false);
      await call(teacherEt, { action: 'finish', classId: 'et', sessionId: fresh.id });
    });
  } catch (error) {
    failed = true;
    if (!results.some(([state]) => state === 'FAIL')) console.log('SETUP FAILED  ' + String(error.message).split('\n')[0]);
  } finally {
    await browser.close();
  }
  console.log(`\n${results.filter(([state]) => state === 'PASS').length} passed, ${results.filter(([state]) => state === 'FAIL').length} failed`);
  process.exit(failed ? 1 : 0);
})();
