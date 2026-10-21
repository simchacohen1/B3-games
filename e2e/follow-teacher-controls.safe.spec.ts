import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const core = fs.readFileSync(path.resolve(__dirname, '../follow-teacher/core.js'), 'utf8');

test('synthetic teacher controls change student navigation independently for ET and WT', async ({ page }) => {
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><html><body>
    <label>Class <select id="class"><option value="et">ET</option><option value="wt">WT</option></select></label>
    <button id="lock">Lock to Shorashim</button>
    <button id="independent">Independent</button>
    <output id="result"></output>
  </body></html>`);
  await page.addScriptTag({ content: core });
  await page.evaluate(() => {
    const doc = document;
    const C = (window as any).FTTFollowTeacherCore;
    const modes: Record<string,string> = {et:'independent',wt:'independent'};
    const now = Date.now();
    const assess = () => {
      const cls = (doc.querySelector('#class') as HTMLSelectElement).value;
      const mode = modes[cls];
      const state = {workspaceId:'b3-2026',classId:cls,teacherUid:'fake_teacher',mode,destination:'shorashim',revision:'test1',targets:'all',issuedAt:now-1000,heartbeatAt:now-1000,expiresAt:now+60000};
      const verdict = C.decide(state,{studentAuthorized:true,studentId:'fake_student',workspaceId:'b3-2026',classId:cls,now,allowedTools:{shorashim:true},currentUrl:'/chazara/'});
      (doc.querySelector('#result') as HTMLOutputElement).textContent = verdict.action;
    };
    (doc.querySelector('#class') as HTMLSelectElement).onchange = assess;
    (doc.querySelector('#lock') as HTMLButtonElement).onclick = () => {modes[(doc.querySelector('#class') as HTMLSelectElement).value]='locked';assess();};
    (doc.querySelector('#independent') as HTMLButtonElement).onclick = () => {modes[(doc.querySelector('#class') as HTMLSelectElement).value]='independent';assess();};
    assess();
  });
  await expect(page.locator('#result')).toHaveText('none');
  await page.getByRole('button',{name:'Lock to Shorashim'}).click();
  await expect(page.locator('#result')).toHaveText('navigate');
  await page.locator('#class').selectOption('wt');
  await expect(page.locator('#result')).toHaveText('none');
  await page.getByRole('button',{name:'Lock to Shorashim'}).click();
  await expect(page.locator('#result')).toHaveText('navigate');
  await page.locator('#class').selectOption('et');
  await page.getByRole('button',{name:'Independent'}).click();
  await expect(page.locator('#result')).toHaveText('none');
  await page.locator('#class').selectOption('wt');
  await expect(page.locator('#result')).toHaveText('navigate');
});
