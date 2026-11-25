import { test, expect, type Page } from '@playwright/test';
import { loadCredentials, signInAdult } from './staging-common';

// Teacher-recorded translation for Posuk Practice (feature test on a staging preview channel).
// Run: FTT_POSUK_SITE=<channel url> FTT_STAGING_CREDENTIALS_FILE=<file> playwright test -c playwright.staging.config.ts posuk-translation
const SITE = (process.env.FTT_POSUK_SITE || '').replace(/\/$/, '');
const credentials = loadCredentials();
test.skip(!SITE || !credentials, 'NOT VERIFIED: FTT_POSUK_SITE and credentials are required');
test.use({
  permissions: ['microphone'],
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

// The staging student-sign-in function only allows the main staging origin (CORS), so on a preview channel
// the test relays that one call from Node and adds the CORS headers. The app and function are untouched.
async function signInStudent(page: Page, st: { name: string; passcode: string; classId?: string }, site: string) {
  const origin = new URL(site).origin;
  await page.route('**/funTorahStudentAuth*', async route => {
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch({ headers: { ...route.request().headers(), origin: 'https://fun-torah-tools-staging.web.app' } });
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
  await page.goto(site + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('#studentNameInput').fill(st.name);
  await page.locator('#classPinInput').fill(st.passcode);
  await page.locator('#studentSignInBtn').click();
  // Students in more than one class choose which one to enter.
  const label = CLASS_LABEL[st.classId || ''];
  const choice = label ? page.getByRole('button', { name: label }) : null;
  if (choice) { try { await choice.click({ timeout: 15000 }); } catch (_e) { /* single-class student */ } }
  await expect(page.locator('#studentBar')).toBeVisible({ timeout: 45000 });
}

const CLASS_LABEL: Record<string, string> = { 'TEST-ALEF': 'Test Class Alef', 'TEST-BEIS': 'Test Class Beis', 'CUSTOM-PRINCIPAL': 'Principal Test Class' };
const KEY1 = 'Bereishis_1_1';
const KEY2 = 'Bereishis_1_2';
const path = (classId: string, key: string) => 'posukPractice/translationAudio/' + classId + '/' + key;
const readAs = (page: Page, p: string) => page.evaluate(async p => {
  try { const s = await (window as any).firebase.database().ref(p).once('value'); return { ok: true, has: s.exists() }; }
  catch (e: any) { return { ok: false, code: String(e?.code || e?.message) }; }
}, p);
const writeAs = (page: Page, p: string) => page.evaluate(async p => {
  try { await (window as any).firebase.database().ref(p).set({ audio: 'data:audio/webm;base64,AAAA', mime: 'audio/webm', updatedAt: Date.now() }); return { ok: true }; }
  catch (e: any) { return { ok: false, code: String(e?.code || e?.message) }; }
}, p);

test.describe.serial('posuk translation recording', () => {
  const adult = (email: string) => credentials!.adultAccounts.find(a => a.email === email)!;
  const student = (name: string) => credentials!.studentAccounts.find(s => s.name === name)!;

  test('teacher records, plays back, re-records, deletes', async ({ browser }) => {
    const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
    await signInAdult(page, adult('teacher.alef@funtorahtools-staging.test'), SITE);
    await page.goto(SITE + '/record_pesukim/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#translationsTabBtn')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#mainContent')).toContainText(/Recordings to mark|No recordings|Nothing/i, { timeout: 60000 });
    await page.locator('#translationsTabBtn').click();
    await page.locator('#trPerek').selectOption('Bereishis|1');
    const row1 = page.locator('.tr-row[data-posuk="1"]');
    await expect(row1).toBeVisible({ timeout: 30000 });
    // start clean in case an earlier run left one behind
    if (await row1.locator('button[data-role="delete"]').count()) {
      page.once('dialog', d => d.accept());
      await row1.locator('button[data-role="delete"]').click();
    }
    await row1.locator('button[data-role="record"]').click();
    await expect(row1.locator('button[data-role="stop"]')).toBeVisible();
    await page.waitForTimeout(2500);
    await row1.locator('button[data-role="stop"]').click();
    await expect(row1.locator('audio')).toBeVisible({ timeout: 20000 });
    expect(await row1.locator('audio').getAttribute('src')).toMatch(/^data:audio\//);
    await expect(row1.locator('button[data-role="rerecord"]')).toBeVisible();
    await expect(row1.locator('button[data-role="delete"]')).toBeVisible();
    // saved in the database for this class
    expect(await readAs(page, path('TEST-ALEF', KEY1))).toEqual({ ok: true, has: true });
    // posuk 2 untouched → still just a Record button
    await expect(page.locator('.tr-row[data-posuk="2"] button[data-role="record"]')).toBeVisible();
    // re-record replaces it
    const before = await row1.locator('audio').getAttribute('src');
    await row1.locator('button[data-role="rerecord"]').click();
    await page.waitForTimeout(1500);
    await row1.locator('button[data-role="stop"]').click();
    await expect(row1.locator('audio')).toBeVisible({ timeout: 20000 });
    expect(await row1.locator('audio').getAttribute('src')).not.toBe(before);
    // survives a reload (really persisted)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#mainContent')).toContainText(/Recordings to mark/i, { timeout: 60000 });
    await page.locator('#translationsTabBtn').click();
    await page.locator('#trPerek').selectOption('Bereishis|1');
    await expect(page.locator('.tr-row[data-posuk="1"] audio')).toBeVisible({ timeout: 30000 });
    // teacher Beis (other class) cannot write or read TEST-ALEF's recording
    const other = await (await browser.newContext()).newPage();
    await signInAdult(other, adult('teacher.beis@funtorahtools-staging.test'), SITE);
    expect((await writeAs(other, path('TEST-ALEF', KEY2))).ok).toBe(false);
    expect((await readAs(other, path('TEST-ALEF', KEY1))).ok).toBe(false);
    await other.context().close();
  });

  async function openPosuk(page: Page, posuk: number) {
    await page.goto(SITE + '/record_pesukim/student.html?sefer=Bereishis&perek=1&posuk=' + posuk, { waitUntil: 'domcontentloaded' });
  }

  test('class student sees Hear-it only where recorded, and can play it', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signInStudent(page, student('Test Student A1'), SITE);
    await openPosuk(page, 1);
    const btn = page.locator('.teacher-help-btn');
    const gated = page.locator('#fetchMsg', { hasText: 'not opened' });
    await page.waitForTimeout(8000);
    if (await gated.count() && await gated.isVisible()) test.info().annotations.push({ type: 'note', description: 'posuk 1 not opened for TEST-ALEF' });
    await expect(btn).toBeVisible({ timeout: 40000 });
    await expect(btn).toHaveText(/Need help\? Hear it/);
    await btn.click();
    await expect(btn).toHaveText(/Stop/);
    await btn.click();
    await expect(btn).toHaveText(/Need help\? Hear it/);
    // posuk with no recording → no button
    await openPosuk(page, 2);
    await expect(page.locator('#posukText')).toBeVisible({ timeout: 40000 });
    await page.waitForTimeout(4000);
    await expect(page.locator('.teacher-help-btn')).toHaveCount(0);
    await ctx.close();
  });

  test('another session in same class hears it; other classes cannot read it', async ({ browser }) => {
    const c2 = await browser.newContext(); const p2 = await c2.newPage();
    await signInStudent(p2, student('Test Student A1'), SITE);
    expect(await readAs(p2, path('TEST-ALEF', KEY1))).toEqual({ ok: true, has: true });
    expect((await writeAs(p2, path('TEST-ALEF', KEY2))).ok).toBe(false); // students cannot write
    await openPosuk(p2, 1);
    await expect(p2.locator('.teacher-help-btn')).toBeVisible({ timeout: 40000 });
    await c2.close();
    // same student, but signed in to a different class: must not be able to read this class's recording
    const c4 = await browser.newContext(); const p4 = await c4.newPage();
    await signInStudent(p4, { ...student('Test Student A1'), classId: 'CUSTOM-PRINCIPAL' }, SITE);
    expect((await readAs(p4, path('TEST-ALEF', KEY1))).ok).toBe(false);
    await c4.close();
    const c3 = await browser.newContext(); const p3 = await c3.newPage();
    await signInStudent(p3, student('Test Student B1'), SITE);
    expect((await readAs(p3, path('TEST-ALEF', KEY1))).ok).toBe(false);
    await c3.close();
  });

  test('after teacher deletes, student no longer sees the button', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await signInAdult(page, adult('teacher.alef@funtorahtools-staging.test'), SITE);
    await page.goto(SITE + '/record_pesukim/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#translationsTabBtn')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#mainContent')).toContainText(/Recordings to mark|No recordings|Nothing/i, { timeout: 60000 });
    await page.locator('#translationsTabBtn').click();
    await page.locator('#trPerek').selectOption('Bereishis|1');
    const row1 = page.locator('.tr-row[data-posuk="1"]');
    await expect(row1.locator('button[data-role="delete"]')).toBeVisible({ timeout: 30000 });
    page.once('dialog', d => d.accept());
    await row1.locator('button[data-role="delete"]').click();
    await expect(row1.locator('button[data-role="record"]')).toBeVisible({ timeout: 20000 });
    expect(await readAs(page, path('TEST-ALEF', KEY1))).toEqual({ ok: true, has: false });
    const sctx = await browser.newContext(); const sp = await sctx.newPage();
    await signInStudent(sp, student('Test Student A1'), SITE);
    await openPosuk(sp, 1);
    await expect(sp.locator('#posukText')).toBeVisible({ timeout: 40000 });
    await sp.waitForTimeout(4000);
    await expect(sp.locator('.teacher-help-btn')).toHaveCount(0);
    await sctx.close();
  });
});
