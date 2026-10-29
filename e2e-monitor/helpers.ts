import { expect, Page } from '@playwright/test';

export const DATABASE_URL = 'https://b3-games-default-rtdb.firebaseio.com';
export const FUNCTIONS_URL = 'https://us-central1-b3-games.cloudfunctions.net';

/** Every student tool linked from the home page (path, expected title text). */
export const STUDENT_TOOLS: { id: string; path: string; title: RegExp }[] = [
  { id: 'posuk-practice-scroll', path: 'record_pesukim/student.html', title: /Posuk Practice/i },
  { id: 'chazara', path: 'chazara/index.html', title: /Chazara/i },
  { id: 'shorashim', path: 'shorashim/index.html', title: /Shorashim/i },
  { id: 'rashi-letters', path: 'rashi-letters/student.html', title: /Rashi/i },
  { id: 'yiddish', path: 'yiddish/index.html', title: /Yiddish/i },
  { id: 'gematria', path: 'gematria/index.html', title: /Gematria/i },
  { id: 'halacha', path: 'halacha/index.html', title: /Halacha/i },
  { id: 'sefer-hamitzvos', path: 'sefer-hamitzvos/index.html', title: /.+/ },
  { id: 'class-gallery', path: 'class-gallery/index.html', title: /Wall of Learning|Gallery/i },
  { id: 'student-rewards', path: 'student-rewards/student.html', title: /Rewards/i },
  { id: 'weekly-quiz', path: 'weekly-quiz/index.html', title: /Quiz/i },
  { id: 'game-show', path: 'game-show/player.html', title: /Game Show/i },
];

/** Teacher/admin pages: a signed-out visitor must only see a sign-in screen. */
export const TEACHER_PAGES: { path: string; signInText: RegExp }[] = [
  { path: 'teacher-home.html', signInText: /Checking your teacher account|Sign in with Google|Teacher .* sign in/i },
  { path: 'owner-admin.html', signInText: /Owner access/i },
];

/**
 * Collects problems a visitor would hit: uncaught script errors and missing
 * files on our own site. Outside services (fonts, Firebase) are left out so a
 * Google hiccup does not look like a site bug; the access tests cover Firebase.
 */
export function watchForProblems(page: Page, siteOrigin: string) {
  const problems: string[] = [];
  page.on('pageerror', e => problems.push('Script error: ' + e.message));
  page.on('response', r => {
    const url = r.url();
    // Cloudflare's RUM analytics POST is deliberately blocked with 503 by
    // the read-only monitor. It is not a missing site asset or a broken tool.
    // Keep logging all other site errors, including failed GETs.
    if (r.status() === 503 && r.request().method() === 'POST'
        && url.startsWith(siteOrigin)
        && new URL(url).pathname === '/cdn-cgi/rum') return;
    if (r.status() >= 400 && url.startsWith(siteOrigin)) problems.push(`Missing file (${r.status()}): ${url}`);
  });
  return problems;
}

/** The home page shows the student sign-in form once its startup check finishes. */
export async function openHomeSignedOut(page: Page) {
  await page.goto('./');
  await expect(page).toHaveTitle(/Fun Torah Tools/);
  // The startup check can take 10-15 s when the server is waking up.
  await expect(page.locator('#studentNameInput')).toBeVisible({ timeout: 60_000 });
}
