import { test, expect } from './fixtures';
import { STUDENT_TOOLS, TEACHER_PAGES, openHomeSignedOut, watchForProblems } from './helpers';

// Read-only checks a signed-out visitor can make. Nothing here signs in,
// types a passcode, or writes anything to the database.

test.describe('Home page', () => {
  test('loads and shows the student sign-in form @phone', async ({ page, baseURL }) => {
    const problems = watchForProblems(page, new URL(baseURL!).origin);
    await openHomeSignedOut(page);
    await expect(page.locator('#studentPinInput, #classPinInput').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Fun Torah Tools' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Teacher Tools/ })).toBeVisible();
    // Signed out: the tool map must stay hidden.
    await expect(page.locator('#gamesArea')).toBeHidden();
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('empty sign-in is stopped in the browser with a clear message', async ({ page }) => {
    // Checked before any server call, so this never touches sign-in limits.
    await openHomeSignedOut(page);
    await page.getByRole('button', { name: 'Open Fun Torah Tools' }).click();
    await expect(page.locator('#loginMsg')).toHaveText(/Please type your name/);
    await expect(page.locator('#gamesArea')).toBeHidden();
  });

  test('every tool on the home page links to a page that exists', async ({ page, request }) => {
    await openHomeSignedOut(page);
    const links = await page.locator('a.game-card[data-game-id]').evaluateAll(cards =>
      cards.map(a => ({ id: a.getAttribute('data-game-id'), href: (a as HTMLAnchorElement).href })));
    expect(links.length, 'home page should list the student tools').toBeGreaterThanOrEqual(10);
    for (const { id, href } of links) {
      const response = await request.get(href);
      expect(response.status(), `${id} -> ${href}`).toBe(200);
    }
    // Every tool this suite watches is still on the home page.
    const ids = links.map(l => l.id);
    for (const tool of STUDENT_TOOLS) expect(ids, `home page is missing ${tool.id}`).toContain(tool.id);
  });
});

test.describe('Student tool pages open without errors', () => {
  for (const tool of STUDENT_TOOLS) {
    test(tool.id, async ({ page, baseURL }) => {
      const problems = watchForProblems(page, new URL(baseURL!).origin);
      const response = await page.goto(tool.path);
      expect(response?.status()).toBe(200);
      // Direct access by a signed-out visitor may correctly redirect to
      // home; do not mistake that protection for a broken tool.
      await page.waitForTimeout(5_000);
      const path = new URL(page.url()).pathname;
      if (path === '/' || path === '/index.html') {
        await expect(page).toHaveTitle(/Fun Torah Tools/i);
        await expect(page.locator('#studentNameInput')).toBeVisible();
        await expect(page.locator('#gamesArea')).toBeHidden();
      } else {
        await expect(page).toHaveTitle(tool.title);
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});

test.describe('Teacher pages show only a sign-in screen when signed out', () => {
  for (const { path, signInText } of TEACHER_PAGES) {
    test(path, async ({ page, baseURL }) => {
      const problems = watchForProblems(page, new URL(baseURL!).origin);
      await page.goto(path);
      await expect(page.locator('body')).toContainText(signInText);
      await page.waitForTimeout(5_000);
      // No student list or passcode boxes for a visitor.
      await expect(page.locator('[data-student-passcode], [data-remove-student]')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/Delete class|Delete teacher/);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
