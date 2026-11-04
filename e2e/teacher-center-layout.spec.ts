import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const withoutScripts = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const admin = read('admin.html');
const main = admin.match(/<script>\s*(const tabs=[\s\S]*?)<\/script>/)![1];

for (const role of ['admin', 'teacher']) {
  test(`Teacher Tools organizes tasks and limits administrative tabs for ${role}`, async ({ page }) => {
    const errors: string[] = [];
    // WebKit reports a harmless "ResizeObserver loop" notice when the layout resizes; it is not a page failure.
    page.on('pageerror', error => { if (!/ResizeObserver loop/.test(error.message)) errors.push(error.message); });
    await page.route('https://teacher-center.test/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let html = '';
      if (path === '/admin.html') {
        html = withoutScripts(admin) + '<script>window.B3TeacherPreview={list:async()=>[]};</script><script>' + main + '</script><script>' + read('admin-teacher-preview.js') + '</script>';
      } else if (path === '/index.html') {
        html = withoutScripts(read('index.html')) + `<script>
          const access={authorized:true,role:${JSON.stringify(role)},classIds:${JSON.stringify(role === 'admin' ? ['*'] : ['mine'])}};
          const settings={siteEnabled:true,games:{},classGames:{},classAccess:{et:{mode:'open',lockWindows:{}},wt:{mode:'open',lockWindows:{}}}};
          window.B3SiteSettings={workspaceId:'b3-2026',getCurrentAccess:()=>access,subscribe:cb=>cb(settings),normalizeSettings:s=>s,describeClassAccess:()=>({open:true}),isClassOpen:()=>true,activeLockedGameList:()=>[]};
          window.firebase={auth:()=>({currentUser:{uid:'test',email:'test@example.test'}}),database:()=>({ref:()=>({once:async()=>({val:()=>({name:'My Class',active:true})})})})};
          document.getElementById('adminControls').classList.remove('hidden');
          document.getElementById('classMemberList').textContent='Test Student';
          document.getElementById('studentToolChoices').textContent='Individual student tool choices';
          document.getElementById('classControls').innerHTML='<div class="class-card">Recess schedule controls</div>';
        </script>`;
      } else if (path === '/owner-admin.html') {
        html = withoutScripts(read('owner-admin.html')) + '<script>document.querySelector("header").style.display="none";document.getElementById("gate").classList.add("hidden");document.getElementById("ownerArea").classList.remove("hidden");</script>';
      } else return route.abort();
      await route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('https://teacher-center.test/admin.html');
    const content = page.frameLocator('#adminFrame');
    await expect(page.getByRole('button', { name: /Class Access/ })).toBeVisible();
    await page.getByRole('button', { name: /Students.*Roster/ }).click();
    await expect(content.getByText('Test Student', { exact: true })).toBeVisible();
    await expect(content.getByText('Individual student tool choices')).toBeVisible();
    await expect(content.getByText('Recess schedule controls')).toBeHidden();
    await expect(content.getByRole('button', { name: 'Add teacher', exact: true })).toHaveCount(0);
    await expect(content.getByRole('button', { name: 'Add class', exact: true })).toHaveCount(0);
    if (role === 'admin') {
      await page.getByRole('button', { name: /Activities.*Show/ }).click();
      await expect(content.getByText('Active & Inactive Activities', { exact: true })).toBeVisible();
      await expect(content.getByText('Test Student', { exact: true })).toBeHidden();
      await page.getByRole('button', { name: /Class Access/ }).click();
      await expect(content.getByText('Recess schedule controls')).toBeVisible();
      await expect(content.getByText('Test Student', { exact: true })).toBeHidden();
      await page.getByRole('button', { name: /Administration.*Teachers/ }).click();
      const administration = page.frameLocator('#administrationFrame');
      await expect(administration.getByRole('heading', { name: 'Teachers', exact: true })).toBeVisible();
      await expect(administration.getByRole('heading', { name: 'Classes', exact: true })).toBeVisible();
      await expect(page.locator('#adminFrame')).toBeHidden();
      await page.getByRole('button', { name: /View as Teacher/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    } else {
      await expect(page.locator('#activitiesNav')).toBeHidden();
      await expect(page.locator('#administrationNav')).toBeHidden();
      await expect(page.locator('#viewAsTeacher')).toBeHidden();
      await page.evaluate(() => (window as any).showTab('administration'));
      await expect(page.locator('#administrationFrame')).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Class Access', exact: true })).toHaveText('Class Access');
    }
    expect(errors).toEqual([]);
  });
}
