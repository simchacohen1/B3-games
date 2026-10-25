import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, set, get } from 'firebase/database';

const ROOT = path.resolve(__dirname, '..');
const PROJECT = 'demo-ftt-readiness';
const WORKSPACE = 'b3-2026';
const CLASS_ID = 'pilot_room_alpha';
const DB_PORT = Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 19100);
const AUTH_PORT = 19099;
const FUNCTIONS_PORT = 15001;
const LOCAL_DATABASE_URL = `http://127.0.0.1:${DB_PORT}?ns=${PROJECT}`;
const LOCAL_ORIGIN = 'https://funtorahtools.com';

let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
let server: http.Server;
let origin: string;

function serveSite(): Promise<http.Server> {
  return new Promise(resolve => {
    const instance = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://local.test').pathname);
      const filename = path.resolve(ROOT, '.' + pathname);
      if (!filename.startsWith(ROOT + path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(200, {
        'content-type': filename.endsWith('.js') ? 'text/javascript; charset=utf-8' :
          filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      });
      fs.createReadStream(filename).pipe(response);
    });
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });
}

async function seedSyntheticClassroom() {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await set(ref(db, `b3Games/admins/synthetic-owner`), { email: 'owner@example.test', email_verified: true, active: true, role: 'admin' });
    await set(ref(db, `b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}`), {
      name: 'Fictional Pilot Room', active: true, siteEnabled: true,
      toolGrants: {
        'weekly-quiz': true, 'posuk-practice-scroll': true, chazara: true,
        shorashim: true, 'rashi-letters': true, yiddish: true, 'class-pointer': true
      },
      members: {}
    });
    await set(ref(db, `b3Games/workspaces/${WORKSPACE}/classes/second_room`), {
      name: 'Fictional Second Room', active: true, siteEnabled: true,
      toolGrants: { 'weekly-quiz': true, 'class-pointer': true }, members: {}
    });
    await set(ref(db, `b3Games/workspaces/${WORKSPACE}/teacherInvites`), {
      teacher_example_test: { email: 'teacher@example.test', name: 'Fictional Teacher', role: 'teacher', active: true, classIds: { [CLASS_ID]: true } },
      second_example_test: { email: 'second@example.test', name: 'Second Fictional Teacher', role: 'teacher', active: true, classIds: { second_room: true } }
    });
    await set(ref(db, `b3Quiz/classes/${CLASS_ID}/launches/quiz_one`), {
      classId: CLASS_ID, started: true, mode: 'test', showScore: true,
      quizSnapshot: { title: 'Fictional Pilot Quiz', questions: [{ q: 'Which choice is correct?', choices: ['Choice A', 'Choice B'], correctIndex: 1 }] }
    });
    await set(ref(db, `b3Games/workspaces/${WORKSPACE}/classes/et`), { name: 'Synthetic ET preservation check', active: true, members: { synthetic_et: { name: 'Synthetic ET Student', active: true } } });
    await set(ref(db, `b3Games/workspaces/${WORKSPACE}/classes/wt`), { name: 'Synthetic WT preservation check', active: true, members: { synthetic_wt: { name: 'Synthetic WT Student', active: true } } });
  });
}

async function configureBrowser(page: Page, errors: string[], failedFirebase: string[]) {
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes('gstatic.com/firebasejs/')) {
      const filename = new URL(url).pathname.split('/').pop() || '';
      const local = path.join(ROOT, 'vendor/firebase/12.15.0', filename);
      if (!fs.existsSync(local)) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(local, 'utf8') });
    }
    if (url.includes('/firebase-config.js')) {
      const body = `
        window.B3_FIREBASE_CONFIG={apiKey:'fake-api-key',authDomain:'127.0.0.1',databaseURL:${JSON.stringify(LOCAL_DATABASE_URL)},projectId:${JSON.stringify(PROJECT)},storageBucket:'synthetic.invalid',messagingSenderId:'1',appId:'synthetic'};
        window.B3_APP_CONTEXT={workspaceId:${JSON.stringify(WORKSPACE)}};
        (function(){
          var authNamespace=window.firebase.auth, realAuth=authNamespace;
          function configure(auth){
            if(!auth.__fttSyntheticConfigured){
              auth.__fttSyntheticConfigured=true;
              auth.useEmulator('http://127.0.0.1:${AUTH_PORT}',{disableWarnings:true});
              auth.signInWithPopup=function(){
                var credential=realAuth.GoogleAuthProvider.credential(JSON.stringify({sub:'fictional-teacher-id',email:'teacher@example.test',email_verified:true,name:'Fictional Teacher'}));
                return auth.signInWithCredential(credential);
              };
            }
            return auth;
          }
          function syntheticAuth(){return configure(realAuth.apply(this,arguments));}
          Object.assign(syntheticAuth,realAuth);
          window.firebase.auth=syntheticAuth;
          var originalInitializeApp=window.firebase.initializeApp;
          window.firebase.initializeApp=function(){return originalInitializeApp.apply(this,arguments);};
          window.firebase.authForApp=function(app){return configure(app.auth());};
          // The app creates a second auth instance for remembered teacher sessions.
          var originalApp=window.firebase.app;
          window.firebase.app=function(){var app=originalApp.apply(this,arguments);var auth=app.auth;app.auth=function(){return configure(auth.apply(this,arguments));};return app;};
        })();`;
      return route.fulfill({ contentType: 'text/javascript', body });
    }
    if (url.startsWith('https://us-central1-b3-games.cloudfunctions.net/')) {
      const functionName = new URL(url).pathname.split('/').pop();
      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: {
          'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '0'
        } });
      }
      const response = await route.fetch({
        url: `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT}/us-central1/${functionName}`,
        headers: { ...request.headers(), origin: LOCAL_ORIGIN }
      });
      const headers = { ...response.headers(), 'access-control-allow-origin': origin, 'vary': 'Origin' };
      if (!response.ok()) failedFirebase.push(`${response.status()} ${functionName}`);
      return route.fulfill({ response, headers });
    }
    if (url.startsWith('https://')) return route.fulfill({ status: 204, body: '' });
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) return route.continue();
    if (url.startsWith(origin)) return route.continue();
    // Fonts and nonessential external assets are not part of this synthetic run.
    return route.abort();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => {
    if (/firebase|googleapis|cloudfunctions/i.test(request.url())) failedFirebase.push(`FAILED ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('requestfailed', request => { if (request.url().startsWith(origin)) errors.push(`FAILED ${request.url()}`); });
}

test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, database: {
    host: '127.0.0.1', port: DB_PORT, rules: fs.readFileSync(path.join(ROOT, 'firebase-rules.hardened.json'), 'utf8')
  } });
  await seedSyntheticClassroom();
  server = await serveSite();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic site server did not bind a TCP port.');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await env?.cleanup();
  await new Promise<void>(resolve => server?.close(() => resolve()));
});

test('new teacher claims one assigned class, enrolls three students, and a student completes a quiz that survives reload', async ({ page }) => {
  const pageErrors: string[] = [];
  const failedFirebase: string[] = [];
  await configureBrowser(page, pageErrors, failedFirebase);
  const teacherClassReads: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith(`http://127.0.0.1:${DB_PORT}/`)) teacherClassReads.push(request.url());
  });

  await page.goto(`${origin}/teacher-home.html?signin=1`);
  await page.waitForTimeout(1000);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('#classes .class-card h2')).toHaveText(['Fictional Pilot Room']);

  const claimedTeacher = await env.withSecurityRulesDisabled(async context =>
    (await get(ref(context.database(), `b3Games/workspaces/${WORKSPACE}/teachers/${(await page.evaluate(() => window.firebase.auth().currentUser.uid))}`))).val()
  );
  expect(claimedTeacher?.classIds).toEqual({ [CLASS_ID]: true });
  expect(teacherClassReads.some(url => url.includes('/classes/et/') || url.includes('/classes/wt/'))).toBe(false);
  await expect(page.locator('#classes .class-card h2')).not.toContainText('Synthetic ET preservation check');
  await expect(page.locator('#classes .class-card h2')).not.toContainText('Synthetic WT preservation check');

  await page.getByRole('link', { name: 'Manage Class' }).click();
  const adminFrame = page.frameLocator('iframe');
  await expect(adminFrame.locator('#manageClassSelect')).toBeVisible();
  await adminFrame.locator('#showAddStudentButton').click();
  const syntheticStudents = [
    ['Ari Example', 'pilot-4101'], ['Bina Example', 'pilot-5202'], ['Carmi Example', 'pilot-6303']
  ];
  for (const [name, passcode] of syntheticStudents) {
    await adminFrame.locator('#managedStudentName').fill(name);
    await adminFrame.locator('#managedStudentPasscode').fill(passcode);
    await adminFrame.locator('#createManagedStudentButton').click();
    await expect(adminFrame.locator('#classManagementStatus')).toContainText('Student created in this class.');
  }
  const enrolled = await env.withSecurityRulesDisabled(async context =>
    (await get(ref(context.database(), `b3Games/workspaces/${WORKSPACE}/classes/${CLASS_ID}/members`))).val()
  );
  expect(Object.values(enrolled || {}).map((row: any) => row.name).sort()).toEqual(syntheticStudents.map(row => row[0]).sort());

  // Sign out the teacher identity before starting the student passcode flow.
  await page.goto(`${origin}/index.html`);
  await page.locator('#studentNameInput').fill('Ari Example');
  await page.locator('#classPinInput').fill('pilot-4101');
  await page.locator('#studentSignInBtn').click();
  await expect(page.locator('#studentNameLabel')).toHaveText('Ari Example');
  await expect(page.getByRole('link', { name: /Weekly Quiz/i })).toBeVisible();
  await page.getByRole('link', { name: /Weekly Quiz/i }).click();
  await expect(page.getByText('Fictional Pilot Quiz')).toBeVisible();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Which choice is correct?')).toBeVisible();
  await page.getByRole('button', { name: 'Choice B' }).click();
  await page.getByRole('button', { name: /submit/i }).click();
  await expect(page.getByText(/completed|100%|correct/i).first()).toBeVisible();

  const studentIds = Object.entries(enrolled || {}).map(([id, row]: [string, any]) => [id, row.name]);
  const ariId = studentIds.find(([, name]) => name === 'Ari Example')?.[0];
  expect(ariId).toBeTruthy();
  const completion = await env.withSecurityRulesDisabled(async context =>
    (await get(ref(context.database(), `b3Quiz/classes/${CLASS_ID}/completions/quiz_one/${ariId}`))).val()
  );
  expect(completion).toBeTruthy();

  await page.reload();
  await expect(page.getByText(/completed|100%|correct/i).first()).toBeVisible();
  expect(failedFirebase).toEqual([]);
  expect(pageErrors).toEqual([]);
});

