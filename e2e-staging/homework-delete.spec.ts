import { test, expect } from '@playwright/test';
import { HOMEWORK_SITE, loadCredentials, watchPage, signInStudent, signInAdult } from './staging-common';

// Fictional TEST-ALEF teacher and student only. Not part of the scheduled monitor (no @auth tag).
const credentials = loadCredentials();

test('teacher can permanently delete a homework with the boy\'s work', async ({ browser }) => {
  test.skip(!credentials, 'NOT VERIFIED: no staging credentials');
  const adult = credentials!.adultAccounts.find(r => r.role === 'teacher' && r.classId === 'TEST-ALEF');
  const student = credentials!.studentAccounts.find(r => r.classId === 'TEST-ALEF');
  if (!adult || !student) throw new Error('TEST-ALEF teacher and student needed');
  const tCtx = await browser.newContext(), sCtx = await browser.newContext();
  const t = await tCtx.newPage(), s = await sCtx.newPage();
  const tw = await watchPage(t), sw = await watchPage(s);
  const title = 'Delete Test ' + Date.now();
  try {
    await signInAdult(t, adult, HOMEWORK_SITE);
    await t.goto(HOMEWORK_SITE + '/assignment-center/teacher.html?class=TEST-ALEF', { waitUntil: 'domcontentloaded' });
    await expect(t.locator('#app')).toBeVisible({ timeout: 45000 });
    await t.getByRole('button', { name: /Create Homework/ }).click();
    await t.locator('#type').selectOption('shorashim');
    await t.locator('#title').fill(title);
    await t.locator('#details').fill('Fictional delete test.');
    await t.getByRole('button', { name: /Next: Choose students/ }).click();
    await t.getByRole('button', { name: /Next: Check homework/ }).click();
    await t.getByRole('button', { name: 'Save Draft' }).click();
    await expect(t.locator('#listNotice')).toContainText('Draft saved.');
    let card = t.locator('#list .card').filter({ hasText: title });
    await card.getByRole('button', { name: 'Publish to Students' }).click();
    await expect(card).toContainText('Published');

    await signInStudent(s, student, HOMEWORK_SITE);
    await s.goto(HOMEWORK_SITE + '/assignment-center/student.html', { waitUntil: 'domcontentloaded' });
    let sc = s.locator('#list .card').filter({ hasText: title });
    await sc.locator(':scope > textarea').fill('Fictional answer.');
    await sc.getByRole('button', { name: 'Hand In Homework' }).click();
    await expect(sc).toContainText('Handed in');

    // Cancel keeps it.
    let message = '';
    t.once('dialog', d => { message = d.message(); d.dismiss(); });
    await card.getByRole('button', { name: 'Delete' }).click();
    expect(message).toBe('Delete this homework? This also removes all the boys’ work and messages for it, and can’t be undone.');
    await expect(card).toBeVisible();
    // Confirm removes it.
    t.once('dialog', d => d.accept());
    await card.getByRole('button', { name: 'Delete' }).click();
    await expect(t.locator('#list .card').filter({ hasText: title })).toHaveCount(0);
    await t.reload({ waitUntil: 'domcontentloaded' });
    await t.getByRole('button', { name: /My Assignments/ }).click();
    await expect(t.locator('#list .card').filter({ hasText: title })).toHaveCount(0);
    await s.reload({ waitUntil: 'domcontentloaded' });
    await expect(s.locator('#list')).not.toContainText(title);
    expect(tw.productionRequests).toEqual([]);
    expect(sw.productionRequests).toEqual([]);
  } finally { await tCtx.close(); await sCtx.close(); }
});
