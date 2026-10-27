import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';

// Shared helpers for the unattended staging checks (issue #390).
// These tests only ever talk to the isolated staging project and its
// fictional accounts. Nothing here may point at production.

const requestedSite = (process.env.FTT_STAGING_SITE || 'https://fun-torah-tools-staging.web.app').replace(/\/$/, '');
if (!/^https:\/\/(?:fun-torah-tools-staging\.web\.app|fun-torah-tools-staging--homework-406-preview-[a-z0-9]+\.web\.app)$/.test(requestedSite)) {
  throw new Error('FTT_STAGING_SITE must be the staging live site or the exact issue #406 preview channel.');
}
export const SITE = requestedSite;
export const STAGING_PROJECT = 'fun-torah-tools-staging';

export const FORBIDDEN_HOSTS = [
  'b3-games.firebaseapp.com',
  'b3-games-default-rtdb.firebaseio.com',
  'b3-games.firebasestorage.app',
  'us-central1-b3-games.cloudfunctions.net',
  'b3-games.web.app',
  'posuk-scorer.onrender.com',
  'nigrisync.onrender.com',
  'simchacohen1.github.io',
  'funtorahtools.com',
];

// Student tool pages that must load on staging for an anonymous visitor.
export const TOOL_PAGES: { name: string; path: string; previewOnly?: boolean }[] = [
  { name: 'Home / sign-in', path: '/' },
  { name: 'Weekly Quiz', path: '/weekly-quiz/index.html' },
  { name: 'Chazara Chart', path: '/chazara/index.html' },
  { name: 'Shorashim', path: '/shorashim/index.html' },
  { name: 'Posuk Practice', path: '/record_pesukim/student.html' },
  { name: 'Rashi Letters', path: '/rashi-letters/student.html' },
  { name: 'Yiddish Word Explorer', path: '/yiddish/index.html' },
  { name: 'Game Show player', path: '/game-show/player.html' },
  { name: 'Class Gallery', path: '/class-gallery/index.html' },
  { name: 'Student Rewards', path: '/student-rewards/index.html' },
  { name: 'Halacha', path: '/halacha/index.html' },
  { name: 'Teacher Home', path: '/teacher-home.html' },
  { name: 'Student Report', path: '/student-report/index.html' },
  { name: 'Homework teacher center', path: '/assignment-center/teacher.html', previewOnly: true },
  { name: 'Homework student center', path: '/assignment-center/student.html', previewOnly: true },
];

export type StagingCredentials = {
  studentAccounts: { name: string; passcode: string; classId: string }[];
  adultAccounts: { role: string; email: string; password: string; classId: string | null }[];
};

// Credentials come from the FTT_STAGING_CREDENTIALS_JSON Actions secret, or
// locally from a file named by FTT_STAGING_CREDENTIALS_FILE. They are never
// read from the repository.
export function loadCredentials(): StagingCredentials | null {
  let raw = process.env.FTT_STAGING_CREDENTIALS_JSON || '';
  const file = process.env.FTT_STAGING_CREDENTIALS_FILE || '';
  if (!raw && file && fs.existsSync(file)) raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return null;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.studentAccounts) || !Array.isArray(parsed.adultAccounts)) {
    throw new Error('Staging credentials JSON is missing studentAccounts or adultAccounts.');
  }
  return parsed;
}

export type PageWatch = { productionRequests: string[]; pageErrors: string[] };

export function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { productionRequests: [], pageErrors: [] };
  page.on('request', request => {
    const url = request.url().toLowerCase();
    if (FORBIDDEN_HOSTS.some(host => url.includes(host))) {
      // Keep only the host and path; query strings can carry tokens.
      watch.productionRequests.push(url.split('?')[0]);
    }
  });
  page.on('pageerror', error => watch.pageErrors.push(String(error.message).slice(0, 200)));
  return watch;
}

// The staging guard, banner and Firebase target that every page must show.
export async function expectStagingIsolation(page: Page) {
  await expect(page.locator('script[data-b3-staging-guard]')).toHaveCount(1);
  await expect(page.locator('.b3-staging-notice')).toBeVisible({ timeout: 15000 });
  const state = await page.evaluate(() => {
    const w = window as any;
    let projectId = '';
    try { projectId = w.firebase?.apps?.[0]?.options?.projectId || ''; } catch (_) {}
    return {
      configProject: w.B3_STAGING_FIREBASE_CONFIG?.projectId || '',
      projectId,
      blocked: !!w.__B3_STAGING_BLOCKED__,
      features: w.B3_STAGING_FEATURES || null,
    };
  });
  expect(state.blocked, 'staging guard refused to start').toBe(false);
  expect(state.configProject).toBe(STAGING_PROJECT);
  if (state.projectId) expect(state.projectId).toBe(STAGING_PROJECT);
  // Audio uploads, Posuk scoring and Nigri sync must stay off on staging.
  expect(state.features).toEqual({ storage: false, posukScoring: false, nigriSync: false });
}

// Staging deploys only some Cloud Functions. Ask with a CORS preflight
// (no data, no sign-in) whether a function is there, so a tool whose server
// is missing is reported as BLOCKED instead of failing or passing.
export async function stagingFunctionAvailable(name: string): Promise<boolean> {
  try {
    const response = await fetch(`https://us-central1-${STAGING_PROJECT}.cloudfunctions.net/${name}`, {
      method: 'OPTIONS',
      headers: {
        Origin: SITE,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    });
    return response.ok && !!response.headers.get('access-control-allow-origin');
  } catch (_) {
    return false;
  }
}

export async function signInStudent(page: Page, student: { name: string; passcode: string }) {
  await page.goto(SITE + '/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#studentSignInBtn')).toBeVisible({ timeout: 30000 });
  await page.locator('#studentNameInput').fill(student.name);
  await page.locator('#classPinInput').fill(student.passcode);
  await page.locator('#studentSignInBtn').click();
  // The server can take 10-15 s to wake up.
  await expect(page.locator('#studentBar')).toBeVisible({ timeout: 45000 });
}

export async function signInAdult(page: Page, adult: { email: string; password: string }) {
  await page.goto(SITE + '/?adminPage=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).firebase?.auth, null, { timeout: 30000 });
  await page.evaluate(async ({ email, password }) => {
    await (window as any).firebase.auth().signInWithEmailAndPassword(email, password);
  }, { email: adult.email, password: adult.password });
}

export async function readClassRecord(page: Page, classId: string) {
  return page.evaluate(async id => {
    try {
      const snapshot = await (window as any).firebase.database()
        .ref('b3Games/workspaces/b3-2026/classes/' + id).once('value');
      return { allowed: true, exists: snapshot.exists() };
    } catch (error: any) {
      return { allowed: false, code: String(error?.code || error?.message || '') };
    }
  }, classId);
}
