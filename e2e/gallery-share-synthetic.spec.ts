import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Isolated browser exercise of the real Add to Gallery button. All requests
// are intercepted: no production Firebase, Cloud Functions or student records.
const galleryScript = readFileSync(resolve(process.cwd(), 'gallery-share.js'), 'utf8');
const fakePage = 'https://example.test/shorashim/index.html';
const endpoint = 'https://us-central1-b3-games.cloudfunctions.net/classGallerySubmit';

async function openFictionalStudentPage(
  page: Page,
  onPost: (route: Route) => Promise<void>,
  mode: 'student' | 'teacher' = 'student'
) {
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await page.route('https://example.test/**', route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><title>Fictional Shorashim</title></head><body><main>Fictional learning work</main></body></html>'
  }));
  await page.route(endpoint, async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok:true, ready:true})});
    }
    if (route.request().method() === 'POST') return onPost(route);
    return route.abort('blockedbyclient');
  });
  await page.goto(fakePage);
  await page.evaluate((isTeacher) => {
    sessionStorage.setItem('b3Games_studentId', 'fictional_et');
    sessionStorage.setItem('b3Games_studentName', 'Fictional ET Student');
    sessionStorage.setItem('b3Games_studentClass', 'et');
    sessionStorage.setItem('b3Games_classPin', 'fictional-passcode');
    if (isTeacher) document.body.classList.add('teacherMode');
    (window as any).FTTGalleryCaptureImage = () => ({
      toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD'
    });
  }, mode === 'teacher');
  await page.addScriptTag({content: galleryScript});
  return page.locator('#fttGalleryShareButton');
}

async function captureFictionalWork(page: Page) {
  await page.locator('#fttGalleryShareButton').click();
  const dialog = page.locator('#fttGalleryShareDialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input').fill('Fictional Chumash work');
  return dialog;
}

test('Gallery screenshot button sends fictional work once with the correct class and identity', async ({page}) => {
  const submitted: any[] = [];
  const button = await openFictionalStudentPage(page, async route => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({status: 201, contentType:'application/json', body: JSON.stringify({ok:true, pending:true})});
  });
  await expect(button).toBeVisible();
  const dialog = await captureFictionalWork(page);
  await dialog.locator('[data-send]').click();
  await expect(dialog.locator('[role=status]')).toContainText('Sent!');
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({
    studentId:'fictional_et', studentName:'Fictional ET Student',
    classId:'et', pin:'fictional-passcode', source:'shorashim',
    title:'Fictional Chumash work'
  });
  expect(submitted[0].image.startsWith('data:image/jpeg;base64,')).toBe(true);
});

test('Gallery screenshot refuses to submit another student\'s captured work after Switch Student', async ({page}) => {
  const submitted: any[] = [];
  await openFictionalStudentPage(page, async route => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({status:201, contentType:'application/json', body:JSON.stringify({ok:true})});
  });
  const dialog = await captureFictionalWork(page);
  await page.evaluate(() => {
    sessionStorage.setItem('b3Games_studentId', 'fictional_wt');
    sessionStorage.setItem('b3Games_studentName', 'Fictional WT Student');
    sessionStorage.setItem('b3Games_studentClass', 'wt');
  });
  await dialog.locator('[data-send]').click();
  await expect(dialog.locator('[role=status]')).toContainText('Student sign-in changed');
  expect(submitted).toHaveLength(0);
});

test('Gallery screenshot reports a failed submission and allows retry without recapturing', async ({page}) => {
  let attempts = 0;
  await openFictionalStudentPage(page, async route => {
    attempts++;
    await route.fulfill({
      status: attempts === 1 ? 503 : 201, contentType:'application/json',
      body:JSON.stringify(attempts === 1 ? {error:'Synthetic service interruption'} : {ok:true, pending:true})
    });
  });
  const dialog = await captureFictionalWork(page);
  const send = dialog.locator('[data-send]');
  await send.click();
  await expect(dialog.locator('[role=status]')).toContainText('Synthetic service interruption');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(dialog.locator('[role=status]')).toContainText('Sent!');
  expect(attempts).toBe(2);
});

test('Gallery screenshot button stays hidden in teacher mode', async ({page}) => {
  const button = await openFictionalStudentPage(page, async route => {
    await route.abort('blockedbyclient');
  }, 'teacher');
  await expect(button).toBeHidden();
});
