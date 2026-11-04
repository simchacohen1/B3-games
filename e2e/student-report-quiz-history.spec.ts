import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Real Student Report page with a fake in-memory Firebase and made-up students.
// Nothing leaves the test machine. Covers ET, WT and a third class (SC).
const root = process.cwd();
const DAY = 86400000;
const now = Date.now();
const qs = [
  { q: 'Who went to Mitzrayim?', choices: ['Avram', 'Lot'], correctIndex: 0 },
  { q: 'How many?', choices: ['One', 'Two'], correctIndex: 1 },
];
const L = (extra: any) => ({ started: true, createdAt: now - 10 * DAY, startedAt: now - 10 * DAY, quizSnapshot: { title: 'Quiz', questions: qs }, ...extra });
const R = (i: number, ok: boolean) => ({ choiceIndex: ok ? qs[i].correctIndex : 1 - qs[i].correctIndex, correct: ok, submittedAt: now - 9 * DAY });
const member = (name: string) => ({ name, active: true });

const DB = {
  posukPractice: {
    attempts: { arik_test: { 'perek18_posuk1': { a1: { timestamp: now - 2 * DAY, hebrewFinalScore: 100 } } } },
    chazara: { students: { arik_test: { goal: 10, reviews: { '18:1': { count: 3, lastAt: now - DAY } } } }, events: { arik_test: { e1: { reviewApplied: true, perek: 18, posuk: 1, reviewNumber: 3, createdAt: now - DAY } } } },
    shorashimLearning: { students: { arik_test: { cards: { 'shoresh:halach': { learnedAt: now - DAY, itemType: 'shoresh', itemId: 'halach' } } } } },
  },
  rashiLetters: { progress: { arik_test: { currentUnitIndex: 0, units: { zayin_letter: { attempts: 6, correct: 5 } } } } },
  b3Games: {
    workspaces: { 'b3-2026': { classes: {
      et: { name: 'East Track', active: true, members: { arik_test: member('Synthetic Arik'), beni_test: member('Synthetic Beni') } },
      wt: { name: 'West Track', active: true, members: { chaim_test: member('Synthetic Chaim') } },
      sc: { name: 'Synthetic Class', active: true, members: { dovid_test: member('Synthetic Dovid') } },
    } } },
    students: { arik_test: { profile: { createdAt: now - 400 * DAY }, halacha: { siman1: { updatedAt: now - DAY, state: { a_done: true } } } } },
  },
  b3Quiz: {
    launches: {
      done: L({ classId: 'et', deliveryType: 'live', endedAt: now - 9 * DAY, attemptGroupId: 'done', quizSnapshot: { title: 'Lech Lecha Quiz', questions: qs } }),
      doneAgain: L({ classId: 'et', deliveryType: 'anytime', attemptGroupId: 'doneAgain', createdAt: now - 8 * DAY, startedAt: now - 8 * DAY, quizSnapshot: { title: 'Lech Lecha Quiz', questions: qs } }),
      half: L({ classId: 'et', deliveryType: 'anytime', targetStudents: { arik_test: true, beni_test: true }, attemptGroupId: 'half', createdAt: now - 3 * DAY, startedAt: now - 3 * DAY, quizSnapshot: { title: 'Vayeira Quiz', questions: qs } }),
      old: L({ classId: 'et', deliveryType: 'live', endedAt: now - 99 * DAY, createdAt: now - 100 * DAY, startedAt: now - 100 * DAY, attemptGroupId: 'old', quizSnapshot: { title: 'Bereishis Quiz', questions: qs } }),
      retake: L({ classId: 'et', deliveryType: 'anytime', targetStudents: { arik_test: true }, retakeOf: 'old', attemptNumber: 2, attemptGroupId: 'old', createdAt: now - 98 * DAY, startedAt: now - 98 * DAY, quizSnapshot: { title: 'Bereishis Quiz', questions: qs } }),
      beniOnly: L({ classId: 'et', deliveryType: 'anytime', targetStudents: { beni_test: true }, attemptGroupId: 'beniOnly', quizSnapshot: { title: 'Beni Private Quiz', questions: qs } }),
      wtq: L({ classId: 'wt', deliveryType: 'live', attemptGroupId: 'wtq', quizSnapshot: { title: 'West Track Noach Quiz', questions: qs } }),
    },
    responses: {
      done: { arik_test: { 0: R(0, true), 1: R(1, false) }, beni_test: { 0: R(0, true), 1: R(1, true) } },
      half: { arik_test: { 0: R(0, true) } },
      old: { arik_test: { 0: R(0, false), 1: R(1, false) } },
      retake: { arik_test: { 0: R(0, true), 1: R(1, true) } },
      beniOnly: { beni_test: { 0: R(0, true) } },
      wtq: { chaim_test: { 0: R(0, true), 1: R(1, true) } },
    },
    completions: {
      done: { arik_test: { completedAt: now - 9 * DAY, correct: 1, total: 2, pct: 50 }, beni_test: { completedAt: now - 9 * DAY, correct: 2, total: 2, pct: 100 } },
      old: { arik_test: { completedAt: now - 100 * DAY, correct: 0, total: 2, pct: 0 } },
      retake: { arik_test: { completedAt: now - 98 * DAY, correct: 2, total: 2, pct: 100 } },
      wtq: { chaim_test: { completedAt: now - 9 * DAY, correct: 2, total: 2, pct: 100 } },
    },
    practiceAttempts: { arik_test: { p1: { createdAt: now - 2 * DAY, quizType: 'translation', perek: 18, pesukim: [1, 2], questionCount: 2, correct: 1, percent: 50, results: [] } } },
    classes: { sc: {
      launches: { scq: L({ classId: 'sc', deliveryType: 'live', attemptGroupId: 'scq', endedAt: now - 9 * DAY, quizSnapshot: { title: 'SC Toldos Quiz', questions: qs } }) },
      responses: {}, completions: {},
    } },
  },
};

const fakeFirebase = (db: any) => `(function(){
  const DB=${JSON.stringify(db)};window.__reads=[];
  const read=p=>{window.__reads.push(p);let v=DB;for(const k of p.split('/').filter(Boolean)){v=v&&typeof v==='object'?v[k]:undefined}return v===undefined?null:JSON.parse(JSON.stringify(v))};
  window.firebase={apps:[],initializeApp(){this.apps.push({})},database(){return{ref:p=>({once:async()=>({val:()=>read(p)})})}},auth(){return{}}};
})();`;

async function openReport(page: any, access: any, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.route(/gstatic\.com/, (route: any) => route.fulfill({ contentType: 'text/javascript', body: /firebase-app-compat/.test(route.request().url()) ? fakeFirebase(DB) : '' }));
  await page.route('https://report.test/**', (route: any) => {
    const rel = new URL(route.request().url()).pathname;
    const stub: Record<string, string> = {
      '/firebase-config.js': 'window.B3_FIREBASE_CONFIG={};',
      '/teacher-tool-gate.js': '', // this spec tests the report page itself; the gate has its own tests
      '/site-settings.js': `window.B3SiteSettings={workspaceId:'b3-2026',signInWithGoogle(){},onAuthStateChanged(cb){setTimeout(()=>cb({uid:'synthetic_teacher',getIdToken:async()=>'x'},true,${JSON.stringify(access)}),0)}};`,
      '/guest-mode.js': '', '/yiddish/api.js': '',
    };
    if (rel in stub) return route.fulfill({ contentType: 'text/javascript', body: stub[rel] });
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: rel.endsWith('.html') ? 'text/html' : 'text/javascript', body: fs.readFileSync(file) });
  });
  await page.goto('https://report.test/student-report/index.html' + query);
  await expect(page.locator('#rows .name').first()).toBeVisible();
  return errors;
}
const csvOf = async (page: any, button: string) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  return fs.readFileSync(await download.path(), 'utf8');
};

test('ET: a boy\'s report lists every quiz, all attempts, question detail and a student-only CSV', async ({ page }) => {
  const errors = await openReport(page, { authorized: true, role: 'admin' }, '?class=et');
  await page.locator('#period').selectOption('0');
  await page.getByRole('button', { name: 'Synthetic Arik' }).click();
  const sec = page.locator('.qsec');
  await expect(sec.getByRole('heading', { name: /All Quizzes/ })).toBeVisible();
  const row = (t: string) => sec.locator('tbody > tr', { hasText: t }).first();
  await expect(row('Lech Lecha Quiz')).toContainText('Completed');
  await expect(row('Lech Lecha Quiz')).toContainText('1 / 2');
  await expect(row('Lech Lecha Quiz')).toContainText('1 of 2 times');
  await expect(row('Vayeira Quiz')).toContainText('In Progress');
  await expect(row('Bereishis Quiz')).toContainText('100%');
  await expect(sec.locator('tbody > tr', { hasText: 'Beni Private Quiz' })).toHaveCount(0);
  await expect(sec.locator('tbody > tr', { hasText: 'West Track Noach Quiz' })).toHaveCount(0);
  // average counts only the two completed quizzes: (50 + 100) / 2
  await expect(sec.locator('.qchip', { hasText: 'average of completed quizzes' })).toContainText('75%');
  await row('Bereishis Quiz').getByRole('button', { name: /Details/ }).click();
  await expect(sec.locator('.qdet .att')).toHaveCount(2);
  await expect(sec.locator('.qdet')).toContainText('Retake 2');
  await expect(sec.locator('.qdet table').first()).toContainText('Who went to Mitzrayim?');
  await expect(sec).toContainText('Practice quiz');
  if (process.env.REPORT_SHOT) await page.screenshot({ path: process.env.REPORT_SHOT, fullPage: true });
  const csv = await csvOf(page, 'Download This Student CSV');
  if (process.env.REPORT_CSV) fs.writeFileSync(process.env.REPORT_CSV, csv);
  expect(csv).toContain('Synthetic Arik');
  expect(csv).not.toContain('Synthetic Beni');
  expect(csv).not.toContain('Beni Private Quiz');
  expect(csv).toContain('In Progress');
  expect(csv).toContain('Posuk pesukim at 100%');
  for (const detail of ['"Posuk Practice","Perek 18:1","Read at 100%"', '"Chazara","Perek 18:1","Below goal (10×)","3"', '"Chazara (each one all time)","Perek 18:1"', '"Shorashim","halach"', '"Rashi Letters","Unit 1 ז (letters)","","6","5","83%"', '"Halacha","Section a","Done"']) expect(csv).toContain(detail);
  expect(csv).not.toContain('Who went to Mitzrayim?');
  // the page itself must not scroll sideways at 100% zoom
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Back to class/ }).click();
  const classCsv = await csvOf(page, 'Class CSV (whole class)');
  expect(classCsv).toContain('Synthetic Arik');
  expect(classCsv).toContain('Synthetic Beni');
  expect(classCsv).toContain('Quiz average %, completed quizzes only');
  expect(errors).toEqual([]);
});

test('ET: Last 7 days narrows the list; Show all time restores the whole history', async ({ page }) => {
  await openReport(page, { authorized: true, role: 'admin' }, '?class=et');
  await page.getByRole('button', { name: 'Synthetic Arik' }).click();
  const sec = page.locator('.qsec');
  await expect(sec.locator('.tablebox').first().locator('tbody > tr')).toHaveCount(1);
  await expect(sec).toContainText('Vayeira Quiz');
  await sec.getByRole('button', { name: 'Show all time' }).click();
  await expect(sec.locator('.tablebox').first().locator('tbody > tr')).toHaveCount(3);
});

test('WT: only West Track quizzes appear', async ({ page }) => {
  await openReport(page, { authorized: true, role: 'admin' }, '?class=wt');
  await page.locator('#period').selectOption('0');
  await page.getByRole('button', { name: 'Synthetic Chaim' }).click();
  const sec = page.locator('.qsec');
  await expect(sec.locator('.tablebox').first().locator('tbody > tr')).toHaveCount(1);
  await expect(sec).toContainText('West Track Noach Quiz');
  await expect(sec).toContainText('Completed');
});

test('third class: its teacher sees only SC, a missed quiz shows as Not Started, and no ET data is read', async ({ page }) => {
  const errors = await openReport(page, { authorized: true, role: 'teacher', classIds: ['sc'] }, '?class=et&student=arik_test');
  await expect(page.locator('#classTabs button')).toHaveText(['Synthetic Class']);
  await expect(page.locator('#report')).toBeHidden();
  await page.locator('#period').selectOption('0');
  await page.getByRole('button', { name: 'Synthetic Dovid' }).click();
  const sec = page.locator('.qsec');
  await expect(sec.locator('tbody > tr', { hasText: 'SC Toldos Quiz' })).toContainText('Not Started');
  await expect(sec.locator('.qchip', { hasText: 'average of completed quizzes' })).toContainText('—');
  const reads: string[] = await page.evaluate(() => (window as any).__reads);
  expect(reads.filter(p => /^b3Quiz\/(launches|responses|completions)/.test(p))).toEqual([]);
  expect(reads.some(p => /arik_test|beni_test|chaim_test/.test(p))).toBe(false);
  expect(errors).toEqual([]);
});


// PDF/ZIP libraries are mocked here so the test is deterministic and never
// downloads scripts or student data from third-party services.
async function mockQuizExportLibraries(page: any) {
  await page.route('https://cdn.jsdelivr.net/**', (route: any) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => {
    const host = window as any;
    host.jspdf = { jsPDF: class {
      addImage() {}
      addPage() { host.__pdfPagesAdded = (host.__pdfPagesAdded || 0) + 1; }
      output() { return new TextEncoder().encode('%PDF-synthetic-test').buffer; }
    } };
    host.JSZip = class {
      names: string[] = [];
      file(name: string) { this.names.push(name); }
      async generateAsync() { return new Blob([JSON.stringify(this.names)], { type: 'application/zip' }); }
    };
  });
}

test('single student: quizzes-only view, print choice and PDF exclude other tools', async ({ page }) => {
  await mockQuizExportLibraries(page);
  const errors = await openReport(page, { authorized: true, role: 'admin' }, '?class=et');
  await page.locator('#period').selectOption('0');
  await page.getByRole('button', { name: 'Synthetic Arik' }).click();
  await page.getByRole('button', { name: /Quizzes Only/ }).click();
  await expect(page.locator('.qsec')).toBeVisible();
  await expect(page.locator('#report .rgrid')).toBeHidden();
  await expect(page.locator('#report .rhead')).toContainText('Synthetic Arik');
  await page.evaluate(() => { (window as any).print = () => { (window as any).__didPrint = true; }; });
  await page.getByRole('button', { name: 'Print Quizzes' }).click();
  expect(await page.evaluate(() => (window as any).__didPrint)).toBe(true);
  expect(await page.evaluate(() => document.body.classList.contains('quiz-print-only'))).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  expect(await page.evaluate(() => document.body.classList.contains('quiz-print-only'))).toBe(false);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Quiz PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Synthetic-Arik-quizzes.pdf');
  expect(fs.readFileSync(await download.path(), 'utf8')).toBe('%PDF-synthetic-test');
  await page.getByRole('button', { name: 'Full Report' }).click();
  await expect(page.locator('#report .rgrid')).toBeVisible();
  expect(errors).toEqual([]);
});

test('class ZIP: one quiz PDF per student in selected class, none from other classes', async ({ page }) => {
  await mockQuizExportLibraries(page);
  const errors = await openReport(page, { authorized: true, role: 'teacher', classIds: ['et'] }, '?class=et');
  await page.locator('#period').selectOption('0');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /All Students Quiz PDFs \(ZIP\)/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^quiz-reports-East-Track-\d{4}-\d{2}-\d{2}\.zip$/);
  const names: string[] = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(names).toEqual(['Synthetic-Arik-quizzes.pdf', 'Synthetic-Beni-quizzes.pdf']);
  expect(names.join(' ')).not.toMatch(/Chaim|Dovid/);
  expect(errors).toEqual([]);
});


test('quizzes-only PDF pagination keeps multiple pages', async ({ page }) => {
  await mockQuizExportLibraries(page);
  const errors = await openReport(page, { authorized: true, role: 'admin' }, '?class=et');
  const pages = await page.evaluate(() => {
    const host = window as any;
    const z = Array.from({ length: 45 }, (_, i) => ({
      title: 'Practice of many quiz rows '+i, date: Date.now(), status:'completed',
      correct:8,total:10,pct:80,attempts:[{status:'completed'}],
    }));
    const input = {
      name:'Synthetic Student', className:'Synthetic Class', period:'All time',
      history:{
        summary:{assigned:45,completed:45,inProgress:0,notStarted:0,avg:80,pointsEarned:360,pointsPossible:450},
        quizzes:z,unavailable:[]
      },
      practice:[],
    };
    host.B3QuizExports.makePdf(input);
    return host.__pdfPagesAdded||0;
  });
  expect(pages).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
