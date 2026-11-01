import { test, expect, type Page } from '@playwright/test';
import { SITE, loadCredentials, watchPage, signInStudent } from './staging-common';

// Class Gallery (#206) with fictional staging students. Needs the staging posts
// seeded as "fictional-seed-206" in TEST-ALEF and TEST-BEIS.
const credentials = loadCredentials();
test.describe('staging Class Gallery #206 @auth', () => {
  test.skip(!credentials, 'NOT VERIFIED: FTT_STAGING_CREDENTIALS_JSON secret is not configured');

  async function openGallery(classId: string, expected: string[]) {
    const student = credentials!.studentAccounts.find(row => row.classId === classId)!;
    return async (browser: any) => {
      const page: Page = await browser.newPage();
      const watch = watchPage(page);
      await signInStudent(page, student);
      const reads: { status: number; posts: any[] }[] = [];
      page.on('response', async response => {
        if (!response.url().includes('/classGalleryRead')) return;
        let posts: any[] = [];
        try { posts = Object.values((await response.json()).posts || {}); } catch (_) {}
        reads.push({ status: response.status(), posts });
      });
      await page.goto(SITE + '/class-gallery/', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => reads.some(r => r.status === 200 && r.posts.length), { timeout: 45000 }).toBe(true);
      const posts = reads.find(r => r.status === 200 && r.posts.length)!.posts;
      expect(posts.map(p => p.title).sort()).toEqual(expected.slice().sort());
      expect(posts.every(p => p.classId === classId)).toBe(true);
      await expect(page.locator('body')).not.toContainText('could not load saved posts');
      expect(watch.productionRequests).toEqual([]);
      await page.close();
    };
  }

  test('A1 sees approved class posts and his own pending post only', async ({ browser }) => {
    await (await openGallery('TEST-ALEF', ['A1 hallway picture', 'A1 chumash project', 'A2 hallway picture', 'A1 pending picture', 'Old A1 torah post (no ID)', 'Old A1 halacha post (name spacing/case)', 'Old A1 parsha post (ID)', 'Old A2 post (no ID)', 'Conflict: A2 ID but A1 name', 'Partial name only']))(browser);
  });
  test('B1 sees only Class Beis posts', async ({ browser }) => {
    await (await openGallery('TEST-BEIS', ['B1 hallway picture', 'B1 pending picture']))(browser);
  });
  // Personal rooms: every approved post of one boy, whichever wall it was posted
  // on, with no cross-boy leakage. Runs the page's own matcher on live data.
  test('A1 personal room holds all of his approved historical work and no other boy work', async ({ browser }) => {
    const student = credentials!.studentAccounts.find(row => row.classId === 'TEST-ALEF')!;
    const page: Page = await browser.newPage();
    const watch = watchPage(page);
    await signInStudent(page, student);
    await page.goto(SITE + '/class-gallery/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => (window as any).eval('posts.length')), { timeout: 45000 }).toBeGreaterThan(5);
    const room = await page.evaluate(() => (window as any).eval("approvedPostsForStudentGallery('Test Student A1').map(p=>p.title)"));
    expect(room.slice().sort()).toEqual([
      'A1 chumash project', 'A1 hallway picture', 'Old A1 halacha post (name spacing/case)',
      'Old A1 parsha post (ID)', 'Old A1 torah post (no ID)',
    ]);
    const a2 = await page.evaluate(() => (window as any).eval("approvedPostsForStudentGallery('Test Student A2').map(p=>p.title)"));
    expect(a2.slice().sort()).toEqual(['A2 hallway picture', 'Conflict: A2 ID but A1 name', 'Old A2 post (no ID)']);
    // Opening the room must draw without a page error.
    await page.evaluate(() => (window as any).eval("buildStudentGallery('Test Student A1')"));
    expect(watch.pageErrors).toEqual([]);
    expect(watch.productionRequests).toEqual([]);
    await page.close();
  });
});
