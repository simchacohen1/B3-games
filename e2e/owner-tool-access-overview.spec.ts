import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

const fixture = {
  schools: { north: { name: 'Fictional North' }, south: { name: 'Fictional South' } },
  classes: {
    alpha: { name: 'Room Alpha', schoolId: 'north', toolGrants: { 'weekly-quiz': true, yiddish: false } },
    beta: { name: 'Room Beta', schoolId: 'north', toolGrants: { halacha: true } },
    retired: { name: 'Room Retired', schoolId: 'north', active: false, toolGrants: { gematria: true } },
    gamma: { name: 'Room Gamma', schoolId: 'south', toolGrants: { yiddish: true } }
  },
  teacherInvites: {
    teacher_example_test: { name: 'Ari, Fictional', email: 'teacher@example.test', schoolId: 'north', active: true, classIds: { alpha: true, beta: true, retired: true } },
    bina_example_test: { name: 'Bina Fictional', email: 'bina@example.test', schoolId: 'south', active: true, classIds: { gamma: true } },
    carmi_example_test: { name: 'Carmi Fictional', email: 'carmi@example.test', active: false }
  }
};
const origin = 'https://tool-overview.test';

async function openAdministration(page: Page, email: string, emailVerified: boolean, hash = '') {
  const reads: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('recordRead', (path: string) => { reads.push(path); });
  await page.route('https://www.gstatic.com/**', route => route.fulfill({ body: '' }));
  await page.route(origin + '/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/firebase-config.js') {
      // Run the real Owner Admin page against a read-only fictional workspace.
      return route.fulfill({ contentType: 'text/javascript', body: `
        const user = ${JSON.stringify({ email, emailVerified })};
        const fixture = ${JSON.stringify(fixture)};
        const auth = { currentUser: null, onAuthStateChanged(callback) { this.callback = callback; callback(null); },
          signInWithPopup() { this.currentUser = user; return this.callback(user); } };
        window.firebase = {
          apps: [{}], auth: Object.assign(() => auth, { GoogleAuthProvider: class {} }),
          database: () => ({ ref: path => ({
            async once() {
              await window.recordRead(path);
              return { val: () => fixture[path.split('/').pop()] || null };
            }
          }) })
        };
      ` });
    }
    if (path === '/owner-admin.html') {
      const html = await fs.readFile('owner-admin.html', 'utf8');
      return route.fulfill({ contentType: 'text/html', body: html.replaceAll('simcha5770@gmail.com', 'owner@example.test') });
    }
    if (path.endsWith('.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile('.' + path) });
    }
    return route.fulfill({ status: 204 });
  });
  await page.goto(origin + '/owner-admin.html?embedded=1' + hash);
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  return { reads, errors };
}

test('owner can filter and export the read-only overview', async ({ page }) => {
  const { reads, errors } = await openAdministration(page, 'owner@example.test', true);
  await page.getByRole('button', { name: 'Tool access overview' }).click();

  const table = page.getByRole('table', { name: 'Tool access overview' });
  await expect(table.getByRole('rowheader')).toHaveText(['Ari, Fictional', 'Bina Fictional', 'Carmi Fictional']);
  await expect(table.getByRole('columnheader', { name: 'Name', exact: true })).toHaveCSS('position', 'sticky');
  const ari = table.getByRole('row').filter({ hasText: 'Ari, Fictional' });
  await expect(ari).toContainText('Room Alpha, Room Beta, Room Retired');
  const headers = await table.getByRole('columnheader').allTextContents();
  for (const [tool, mark] of [['Weekly Quiz', '✓'], ['Halacha', '✓'], ['Yiddish', ''], ['Gematria', '']]) {
    await expect(ari.getByRole('cell').nth(headers.indexOf(tool) - 1)).toHaveText(mark);
  }

  await page.getByRole('searchbox', { name: 'Search teachers' }).fill('BINA');
  await expect(table.getByRole('rowheader')).toHaveText(['Bina Fictional']);
  await page.getByRole('searchbox', { name: 'Search teachers' }).clear();
  await page.getByRole('combobox', { name: 'Filter by class' }).selectOption('beta');
  await expect(table.getByRole('rowheader')).toHaveText(['Ari, Fictional']);
  await page.getByRole('combobox', { name: 'Filter by school' }).selectOption('south');
  await expect(table.getByRole('rowheader')).toHaveText(['Bina Fictional']);
  await page.getByRole('combobox', { name: 'Filter by school' }).selectOption('north');
  await page.getByRole('combobox', { name: 'Filter by class' }).selectOption('alpha');
  await expect(ari.getByRole('cell').nth(headers.indexOf('Halacha') - 1)).toHaveText('✓');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tool-access-overview.csv');
  const csv = await fs.readFile((await download.path())!, 'utf8');
  expect(csv.split('\r\n')).toEqual([
    '\uFEFF' + headers.join(','),
    ['"Ari, Fictional"', 'Fictional North', '"Room Alpha, Room Beta, Room Retired"', ...headers.slice(3).map(tool => ['Weekly Quiz', 'Halacha'].includes(tool) ? '✓' : '')].join(','),
    ''
  ]);

  await page.getByRole('searchbox', { name: 'Search teachers' }).fill('no match');
  await expect(page.getByText('No teachers match.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();

  expect(reads.map(path => path.split('/').pop())).toEqual(['teacherInvites', 'classes', 'schools', 'students']);
  expect(errors).toEqual([]);
});

for (const [email, verified] of [['teacher@example.test', true], ['owner@example.test', false]] as const) {
  test(`overview rejects ${verified ? 'a teacher' : 'an unverified owner email'}`, async ({ page }) => {
    const { reads, errors } = await openAdministration(page, email, verified, '#tool-access-overview/');
    await expect(page.locator('#gateMsg')).toContainText('This Google account is not');
    await expect(page.getByRole('table', { name: 'Tool access overview' })).toBeHidden();
    await expect(page.locator('#toolAccessRows tr')).toHaveCount(0);
    expect(reads).toEqual([]);
    expect(errors).toEqual([]);
  });
}
