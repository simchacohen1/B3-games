import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Issue 769: the three round teacher buttons (Class Access, Follow the Teacher,
// Class Pointer) must do something on EVERY page that shows them. This opens
// every page of the site as a signed-in teacher with two classes and no class
// in the link, then really clicks each button (a mouse click at the button's
// position, so anything covering the button makes the click miss).
// Synthetic and local only: no Firebase, no network, no real classes.
const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://quickbar.test';
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const SKIP_DIR = /^(node_modules|\.git|\.claude|\.github|docs|vendor|e2e|e2e-monitor|tests|test-results|playwright-report|backend|scripts)$|^preview-|backup/i;
// QUICKBAR_BASELINE=1 serves the toolbar as it was before the fix, to show what was broken.
const BASELINE = process.env.QUICKBAR_BASELINE === '1';
const OLD_TOOLBAR = BASELINE ? execFileSync('git', ['show', '96380c59:teacher-global-controls.js'], { cwd: ROOT }) : null;

test.skip(({ browserName }) => browserName !== 'chromium', 'One browser is enough for this page sweep');

function pages(dir = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { if (!SKIP_DIR.test(entry.name)) out.push(...pages(rel)); }
    else if (entry.name.endsWith('.html')) out.push(rel);
  }
  return out.sort();
}

async function wire(context: BrowserContext, role: 'teacher' | 'admin') {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE) {
      // Firebase and other outside scripts are replaced by nothing; the stand-ins below take their place.
      if (/\.js(\?|$)/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: '' });
      // The activity gate reads the class record over REST: an active class, nothing locked.
      if (/\.json$/.test(url.pathname)) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: /\/active\.json$/.test(url.pathname) ? 'true' : 'null' });
      return route.abort();
    }
    const p = decodeURIComponent(url.pathname);
    if (p.endsWith('/site-settings.js') || p.endsWith('/guest-mode.js') || p.startsWith('/vendor/firebase/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    // Stand-in tool policy: every tool is switched on for the synthetic class.
    if (p.endsWith('/student-tool-policy.js')) return route.fulfill({ contentType: 'text/javascript', body: 'window.B3StudentTools={aliases:function(t){return[t]},granted:function(){return true},allowed:function(){return true},studentActivities:[]};' });
    if (OLD_TOOLBAR && p === '/teacher-global-controls.js') return route.fulfill({ contentType: 'text/javascript', body: OLD_TOOLBAR });
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await context.addInitScript((role) => {
    const w = window as any;
    // The teacher came from the Teacher home with ET in use, but the link names no class.
    try { sessionStorage.setItem('b3Games_studentClass', 'et'); } catch (_) {}
    const noop = () => {};
    const classes = { et: { name: 'ET', active: true }, wt: { name: 'WT', active: true } };
    const snap = (p: string) => { const v = /\/classes$/.test(p) ? classes : null; return { val: () => v, exists: () => v !== null, forEach: noop, key: p.split('/').pop(), numChildren: () => 0 }; };
    const ref = (p: string): any => ({
      child: (c: string) => ref(p + '/' + c), set: async () => {}, update: async () => {}, remove: async () => {}, push: () => ref(p + '/x'), transaction: async () => ({}),
      once: async () => snap(p), get: async () => snap(p), on: (_e: string, cb: Function) => { setTimeout(() => cb(snap(p)), 0); return cb; }, off: noop,
      orderByChild: () => ref(p), orderByKey: () => ref(p), orderByValue: () => ref(p), equalTo: () => ref(p), limitToLast: () => ref(p), limitToFirst: () => ref(p), startAt: () => ref(p), endAt: () => ref(p),
      onDisconnect: () => ({ remove: async () => {}, set: async () => {}, update: async () => {}, cancel: async () => {} }), key: 'x', toString: () => p,
    });
    const user = { uid: 'synthetic-teacher', email: 'teacher@example.test', displayName: 'Synthetic Teacher', getIdToken: async () => 'synthetic', getIdTokenResult: async () => ({ claims: {} }) };
    const auth: any = { currentUser: user, onAuthStateChanged: (cb: Function) => { setTimeout(() => cb(user), 0); return noop; }, onIdTokenChanged: (cb: Function) => { setTimeout(() => cb(user), 0); return noop; }, signOut: async () => {}, setPersistence: async () => {}, useDeviceLanguage: noop };
    const authFn: any = Object.assign(() => auth, { GoogleAuthProvider: function () { return { setCustomParameters: noop, addScope: noop }; }, Auth: { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } } });
    const database: any = Object.assign(() => ({ ref: (p?: string) => ref(p || ''), goOffline: noop, goOnline: noop }), { ServerValue: { TIMESTAMP: 0, increment: () => 0 } });
    const storage: any = () => ({ ref: (p?: string) => ({ ...ref(p || ''), getDownloadURL: async () => '', put: async () => ({}), listAll: async () => ({ items: [], prefixes: [] }) }) });
    const app = { auth: authFn, database, storage, functions: () => ({ httpsCallable: () => async () => ({ data: {} }) }), options: {} };
    w.firebase = { apps: [app], app: () => app, initializeApp: () => app, auth: authFn, database, storage, functions: app.functions };
    w.B3_FIREBASE_CONFIG = {}; w.B3_APP_CONTEXT = { workspaceId: 'b3-2026' };
    const access = { authorized: true, role, classIds: ['et', 'wt'], email: user.email };
    const known: any = {
      workspaceId: 'b3-2026',
      onAuthStateChanged: (cb: Function) => { setTimeout(() => cb(user, true, access), 0); return noop; },
      getActingStudent: () => null, getAccess: () => access, isOwner: () => role === 'admin',
    };
    // Any other helper a page asks for exists and resolves to nothing.
    w.B3SiteSettings = new Proxy(known, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k !== 'then' ? async () => null : undefined) });
  }, role);
}

type Row = { page: string; bar: string; lock?: string; follow?: string; pointer?: string };
const BAR = '#fttTeacherQuickBar';
const BUTTONS = { lock: BAR + ' #fttTeacherQuickLock', follow: BAR + ' button[aria-label^="Open or close Follow"]', pointer: BAR + ' #fttTeacherQuickPointer' } as const;

// A real mouse click where the button is drawn; reports what is in the way if it is covered.
async function realClick(page: Page, selector: string): Promise<string> {
  const state = await page.evaluate((sel) => {
    const b = document.querySelector(sel) as HTMLElement | null;
    if (!b) return { problem: 'button missing' };
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') return { problem: 'button not shown' };
    if ((b as HTMLButtonElement).disabled) return { problem: 'button disabled' };
    if (b.closest('[inert]')) return { problem: 'page still locked (inert)' };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { problem: 'button off screen' };
    const top = document.elementFromPoint(x, y) as HTMLElement | null;
    if (top !== b && !(top && b.contains(top))) return { problem: 'covered by ' + (top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\s+/).join('.') : '') + ' (z-index ' + getComputedStyle(top).zIndex + ') "' + (top.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70) + '"' : 'nothing') };
    return { x, y };
  }, selector);
  if ('problem' in state) return state.problem as string;
  await page.mouse.click(state.x!, state.y!);
  return '';
}
const MODAL = '#fttTeacherQuickModal';
async function pickClassIfAsked(page: Page) {
  const choice = page.locator(MODAL + ' .ftt-quick-classes button').first();
  if (await choice.isVisible().catch(() => false)) { await choice.click(); return true; }
  return false;
}
async function closeModal(page: Page) {
  if (await page.locator(MODAL).isVisible().catch(() => false)) await page.locator(MODAL + ' .ftt-quick-close').click();
  await expect(page.locator(MODAL)).toBeHidden();
}
async function tryPanel(page: Page, selector: string, frameTitle: string, file: string): Promise<string> {
  const miss = await realClick(page, selector);
  if (miss) return miss;
  await page.waitForTimeout(150);
  if (!(await page.locator(MODAL).isVisible().catch(() => false))) return 'click did nothing';
  if (process.env.QUICKBAR_SHOTS && /teacher-home|yiddish\/index\.html/.test(page.url())) await page.screenshot({ path: path.join(process.env.QUICKBAR_SHOTS, frameTitle.replace(/\W+/g, '_') + '-' + path.basename(path.dirname(new URL(page.url()).pathname)) + '.png') });
  const asked = await pickClassIfAsked(page);
  const frame = page.locator(`${MODAL} iframe[title="${frameTitle}"]`);
  const src = (await frame.getAttribute('src')) || '';
  const shown = await frame.isVisible();
  await closeModal(page);
  if (!shown || !src.includes(file) || !/[?&]class=(et|wt)\b/.test(src)) return 'panel opened without its tool';
  return asked ? 'works (asks which class first)' : 'works';
}
// Class Pointer opens in its own tab: wait for a real new tab and check where it went.
async function tryPointer(page: Page, selector: string): Promise<string> {
  if (/\/class-pointer-prototype\/classroom\.html$/.test(new URL(page.url()).pathname)) return 'works (already on Class Pointer)';
  const popup = page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null);
  const miss = await realClick(page, selector);
  if (miss) return miss;
  await page.waitForTimeout(150);
  const asked = await pickClassIfAsked(page);
  const tab = await popup;
  if (tab) await tab.waitForURL(/classroom\.html/, { timeout: 4000, waitUntil: 'commit' }).catch(() => {});
  const url = tab ? tab.url() : '';
  if (tab) await tab.close().catch(() => {});
  await closeModal(page).catch(() => {});
  if (!/class-pointer-prototype\/classroom\.html\?class=(et|wt)&dashboard=teacher$/.test(url)) return 'click did nothing';
  return asked ? 'works (asks which class first)' : 'works';
}
// Pages with their own "confirm your class" screen cover everything until the teacher answers.
async function answerClassGate(page: Page) {
  const gate = page.locator('#b3ClassGate');
  if (!(await gate.isVisible().catch(() => false))) return false;
  const select = gate.locator('select');
  if (!(await select.isVisible().catch(() => false))) await gate.getByRole('button', { name: /different class/i }).click();
  await gate.locator('select').selectOption('et');
  await gate.getByRole('button', { name: 'Open this class' }).click();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return true;
}
async function waitForBar(page: Page, selector: string) {
  let gate = false;
  for (let i = 0; i < 30; i++) {
    if (await answerClassGate(page).catch(() => false)) gate = true;
    if (await page.locator(selector).first().isVisible().catch(() => false)) {
      // The activity gate shows a "checking" cover for a moment while it confirms the teacher's class.
      await page.locator('#b3-gate-overlay').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
      return { shown: true, gate };
    }
    await page.waitForTimeout(200);
  }
  return { shown: false, gate };
}

function report(rows: Row[], name: string) {
  if (!process.env.QUICKBAR_REPORT) return;
  fs.mkdirSync(process.env.QUICKBAR_REPORT, { recursive: true });
  fs.writeFileSync(path.join(process.env.QUICKBAR_REPORT, name + (BASELINE ? '-before' : '-after') + '.json'), JSON.stringify(rows, null, 1));
}

// Pages a teacher works from every day: the sweep must find the buttons on these,
// so it can never pass by finding no buttons anywhere.
const MUST_SHOW = (process.env.QUICKBAR_MUST_SHOW || 'teacher-home.html,all-pages.html').split(',').filter(Boolean);

// Class Pointer only opens from its dashboard link, which always names the class.
// Class Gallery is a 3D page: without its 3D library (blocked here, like all outside scripts)
// it shows its own full-screen "could not load" message, so there is nothing to click.
const NOT_TESTABLE_HERE = new Set(['class-gallery/index.html']);
const LINK: Record<string, string> = { 'class-pointer-prototype/classroom.html': '?class=et&dashboard=teacher' };

test.describe('teacher: Class Access, Follow and Class Pointer buttons work on every page that shows them', () => {
  test.describe.configure({ mode: 'parallel' });
  for (const rel of pages()) {
    test(rel, async ({ context }) => {
      test.setTimeout(60_000);
      test.skip(NOT_TESTABLE_HERE.has(rel) && !BASELINE, 'Needs the outside 3D library');
      await wire(context, 'teacher');
      const page = await context.newPage();
      if (process.env.QUICKBAR_DEBUG) { page.on('console', m => console.log('[console]', m.text().slice(0, 300))); page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300))); }
      const row: Row = { page: rel, bar: '' };
      await page.goto(BASE + '/' + rel + (LINK[rel] || ''), { waitUntil: 'domcontentloaded' });
      const { shown, gate } = await waitForBar(page, BAR);
      if (!shown) {
        row.bar = await page.evaluate(() => {
          if (!(window as any).__fttGlobalTeacherControls) return 'page does not load the teacher buttons';
          const bar = document.getElementById('fttTeacherQuickBar');
          if (!bar) return 'not shown (buttons never set up)';
          if (bar.hidden) return 'not shown (bar kept hidden)';
          for (let n: HTMLElement | null = bar; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return 'not shown (page hides ' + n.tagName.toLowerCase() + ')'; }
          return 'not shown';
        }).catch(() => 'not shown');
      } else {
        row.bar = gate ? 'shown (after the page\'s own class screen)' : 'shown';
        row.lock = await tryPanel(page, BUTTONS.lock, 'Class Access', 'admin.html');
        row.follow = await tryPanel(page, BUTTONS.follow, 'Follow the Teacher controls', 'follow-teacher/teacher.html');
        row.pointer = await tryPointer(page, BUTTONS.pointer);
      }
      report([row], 'teacher-' + rel.replace(/[^a-z0-9]+/gi, '_'));
      if (BASELINE) return;
      if (MUST_SHOW.includes(rel)) expect(row.bar, 'teacher buttons on ' + rel).toMatch(/^shown/);
      if (shown) expect([row.lock, row.follow, row.pointer].filter(v => !v || !v.startsWith('works')), JSON.stringify(row)).toEqual([]);
    });
  }
});

test('owner home page: Follow and Class Pointer buttons in the home class bar work', async ({ context }) => {
  await wire(context, 'admin');
  const page = await context.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  const home = '#homeClassBar .ftt-home-follow';
  const { shown } = await waitForBar(page, home + ', ' + BAR);
  test.skip(!shown || !(await page.locator(home).first().isVisible().catch(() => false)), 'Owner home bar needs the real sign-in; covered by the teacher sweep above');
  const follow = await tryPanel(page, home + '[aria-label^="Open or close Follow"]', 'Follow the Teacher controls', 'follow-teacher/teacher.html');
  const pointer = await tryPointer(page, home + '[aria-label^="Open Class Pointer"]');
  report([{ page: 'index.html (owner)', bar: 'home class bar', follow, pointer }], 'owner-home');
  if (!BASELINE) { expect(follow).toMatch(/^works/); expect(pointer).toMatch(/^works/); }
});
