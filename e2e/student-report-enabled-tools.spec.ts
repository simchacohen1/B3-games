import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Real Student Report page with a fake in-memory Firebase and made-up students.
// The tool columns and the "X of N tools used" count must follow the tools
// that are turned on for the class, the same way the Learning Island home page does.
const root = process.cwd();
const now = Date.now();
const DAY = 86400000;
const member = (name: string) => ({ name, active: true });
const progress = (id: string) => ({
  posukPractice: {
    attempts: { [id]: { perek18_posuk1: { a1: { timestamp: now - DAY, hebrewFinalScore: 100 } } } },
    chazara: { students: { [id]: { goal: 10, reviews: { '18:1': { count: 3, lastAt: now - DAY } } } } },
  },
  rashiLetters: { progress: { [id]: { currentUnitIndex: 0, units: { zayin_letter: { attempts: 6, correct: 5 } } } } },
});
const a = progress('avi_test'), b = progress('eli_test');
const DB = {
  posukPractice: {
    attempts: { ...a.posukPractice.attempts, ...b.posukPractice.attempts },
    chazara: { students: { ...a.posukPractice.chazara.students, ...b.posukPractice.chazara.students } },
  },
  rashiLetters: { progress: { ...a.rashiLetters.progress, ...b.rashiLetters.progress } },
  b3Games: { workspaces: { 'b3-2026': { classes: {
    // Posuk Practice and Rashi Letters (legacy "rashi" grant) are on; Chazara is explicitly off.
    tg: { name: 'Granted Class', active: true, toolGrants: { 'posuk-practice-scroll': true, rashi: true, chazara: false }, members: { avi_test: member('Synthetic Avi') } },
    et: { name: 'East Track', active: true, members: { eli_test: member('Synthetic Eli') } },
  } } } },
};
// ET/WT use the site settings: Gematria is off for the whole site, Halacha is closed for ET.
const SETTINGS = { games: { gematria: false }, classGames: { et: { halacha: false } } };

const fakeFirebase = `(function(){
  const DB=${JSON.stringify(DB)};
  const read=p=>{let v=DB;for(const k of p.split('/').filter(Boolean)){v=v&&typeof v==='object'?v[k]:undefined}return v===undefined?null:JSON.parse(JSON.stringify(v))};
  window.firebase={apps:[],initializeApp(){this.apps.push({})},database(){return{ref:p=>({once:async()=>({val:()=>read(p)})})}},auth(){return{}}};
})();`;
const siteSettings = `window.B3SiteSettings={workspaceId:'b3-2026',signInWithGoogle(){},
  readOnce:async()=>(${JSON.stringify(SETTINGS)}),
  isGameEnabledForClass:(s,c,g)=>!(s.games&&s.games[g]===false)&&!(s.classGames&&s.classGames[c]&&s.classGames[c][g]===false),
  onAuthStateChanged(cb){setTimeout(()=>cb({uid:'synthetic_teacher',getIdToken:async()=>'x'},true,{authorized:true,role:'admin'}),0)}};`;

async function openReport(page: any, classId: string) {
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.route(/gstatic\.com/, (route: any) => route.fulfill({ contentType: 'text/javascript', body: /firebase-app-compat/.test(route.request().url()) ? fakeFirebase : '' }));
  await page.route('https://report.test/**', (route: any) => {
    const rel = new URL(route.request().url()).pathname;
    const stub: Record<string, string> = { '/firebase-config.js': 'window.B3_FIREBASE_CONFIG={};', '/site-settings.js': siteSettings, '/guest-mode.js': '', '/yiddish/api.js': '' };
    if (rel in stub) return route.fulfill({ contentType: 'text/javascript', body: stub[rel] });
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: rel.endsWith('.html') ? 'text/html' : 'text/javascript', body: fs.readFileSync(file) });
  });
  await page.goto('https://report.test/student-report/index.html?class=' + classId);
  await expect(page.locator('#rows .name').first()).toBeVisible();
  return errors;
}
const headers = async (page: any) => (await page.locator('#thead th').allTextContents()).map((t: string) => t.replace(/ [▲▼]$/, ''));

test('class with tool grants: only granted tools get a column and count toward "tools used"', async ({ page }) => {
  const errors = await openReport(page, 'tg');
  expect(await headers(page)).toEqual(['Student', 'Last active', '📜 Posuk Practice', 'אב Rashi Letters']);
  // He also has Chazara progress, but Chazara is off for this class, so it is not counted.
  await expect(page.locator('#rows tr').first()).toContainText('2 of 2 tools used');
  expect(errors).toEqual([]);
});

test('ET (legacy class): columns follow the site settings', async ({ page }) => {
  const errors = await openReport(page, 'et');
  expect(await headers(page)).toEqual(['Student', 'Last active', '📜 Posuk Practice', '🔁 Chazara', '🌳 Shorashim', 'אב Rashi Letters', '📝 Weekly Quiz']);
  await expect(page.locator('#rows tr').first()).toContainText('3 of 5 tools used');
  expect(errors).toEqual([]);
});
