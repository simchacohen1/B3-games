'use strict';
// Owner on Teacher Home with an owner-only admin sidebar. HIGH RISK area: teacher access.
// Rules pinned here:
//   - the owner always has full owner access, so every tool opens with ONE Google sign-in;
//   - there is no Owner Admin / Teacher view switch any more;
//   - the sidebar is drawn for the verified owner only, never for a teacher;
//   - nothing here adds a grant to the database rules or the server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const V = require('../owner-teacher-view.js');
const S = require('../owner-sidebar.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const OWNER = 'simcha5770@gmail.com';
const INVITE_PATH = 'b3Games/workspaces/b3-2026/teacherInvites/simcha5770_gmail_com';
const owner = { uid: 'owner-uid', email: OWNER, emailVerified: true };
const teacher = { uid: 'regular', email: 'teacher@example.test', emailVerified: true };
const invite = (extra = {}) => ({ email: OWNER, name: 'Owner', role: 'teacher', active: true, classIds: { kita_a: true, kita_b: true }, ...extra });
const fakeDb = (data, fail = false) => ({ ref: p => ({ once: async () => { if (fail) throw new Error('offline'); return { val: () => data[p] ?? null }; } }) });

test('the owner invitation uses the same key Owner Admin writes', () => {
  assert.equal(V.inviteKey(' Simcha5770@Gmail.com '), 'simcha5770_gmail_com');
});

test('own classes come only from an active, ordinary teacher invitation for the owner email', () => {
  assert.deepEqual(V.teachingClassIds(invite()), ['kita_a', 'kita_b']);
  assert.deepEqual(V.teachingClassIds(invite({ classIds: { kita_a: true, kita_b: false, '*': true, 'bad id': true } })), ['kita_a']);
  assert.deepEqual(V.teachingClassIds(invite({ active: false })), []);
  assert.deepEqual(V.teachingClassIds(invite({ email: 'someone@example.test' })), []);
  assert.deepEqual(V.teachingClassIds(invite({ accountType: 'principal' })), []);
  assert.deepEqual(V.teachingClassIds(null), []);
});

test('readTeaching reads only the verified owner, and never throws', async () => {
  const db = fakeDb({ [INVITE_PATH]: invite() });
  assert.deepEqual((await V.readTeaching(db, 'b3-2026', owner)).classIds, ['kita_a', 'kita_b']);
  assert.deepEqual((await V.readTeaching(db, 'b3-2026', teacher)).classIds, []);
  assert.deepEqual((await V.readTeaching(db, 'b3-2026', { ...owner, emailVerified: false })).classIds, []);
  assert.deepEqual((await V.readTeaching(db, '../bad', owner)).classIds, []);
  assert.deepEqual((await V.readTeaching(fakeDb({}, true), 'b3-2026', owner)).classIds, []);
});

test('there is no mode any more: it is always owner, and a leftover value is cleared', async () => {
  const m = new Map([[V.MODE_KEY, 'teacher']]);
  const store = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  assert.equal(V.getMode(store), 'owner');
  assert.equal(V.setMode('teacher', store), 'owner');
  assert.equal(m.size, 0);
  assert.equal(await V.resolve(fakeDb({ [INVITE_PATH]: invite() }), 'b3-2026', owner, store), null);
});

test('site-settings gives the owner full access always, with no switch or banner', () => {
  const text = read('site-settings.js');
  assert.match(text, /function readOwnerAccess\(\) \{\s*return Promise\.resolve\(\{ authorized:true, role:"admin", classIds:\["\*"\] \}\);/);
  assert.doesNotMatch(text, /b3OwnerViewMode|mountSwitch|mountBanner|showOwnerTeacherView|ownerTeacherViewWanted/);
});

test('Owner Admin and Class Access have no Teacher view switch', () => {
  const oa = read('owner-admin.html'), admin = read('admin.html');
  assert.doesNotMatch(oa, /teacherViewGo|teacherViewBar|toTeacherView|renderTeacherViewBar/);
  assert.doesNotMatch(admin, /mountSwitch/);
  assert.match(admin, /location\.href="teacher-home\.html"/);
});

test('Teacher Home draws the owner classes and the sidebar for the verified owner only', () => {
  const html = read('teacher-home.html');
  assert.match(html, /owner-teacher-view\.js/);
  assert.match(html, /owner-sidebar\.js/);
  assert.match(html, /B3OwnerTeacherView\.isOwnerUser\(user\)/);
  assert.match(html, /if\(ownerHome&&window\.B3OwnerSidebar\)B3OwnerSidebar\.mount\(/);
  // any other admin still goes to the old home; a regular teacher never reaches this branch
  assert.match(html, /else\{location\.replace\("index\.html"\);return\}/);
});

test('the owner is sent to Teacher Home once per tab from the plain home page', () => {
  const html = read('index.html');
  assert.match(html, /b3OwnerLanded/);
  assert.match(html, /"simcha5770@gmail\.com"/);
});

// ---- the sidebar -------------------------------------------------------------

function page() {
  const nodes = [];
  const make = tag => {
    const el = { tag, id: '', children: [], classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {},
      appendChild(c) { this.children.push(c); return c; }, append(...c) { c.forEach(x => this.children.push(x)); }, remove() { this.removed = true; } };
    nodes.push(el); return el;
  };
  const body = make('body');
  body.classList = { add: () => { body.marked = true; }, remove() {} };
  const document = { body, head: make('head'), createElement: make, getElementById: id => nodes.find(n => n.id === id && !n.removed) || null };
  const ctx = { document, B3OwnerTeacherView: V };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('owner-sidebar.js'), ctx);
  return { api: ctx.B3OwnerSidebar, document, body };
}

test('sidebar is drawn for the owner', () => {
  const p = page();
  p.api.mount({ user: owner, registry: null, classId: '' });
  assert.ok(p.document.getElementById('b3OwnerSidebar'));
  assert.equal(p.body.marked, true);
});

test('sidebar is never drawn for a teacher, an unverified owner or nobody', () => {
  for (const user of [teacher, { ...owner, emailVerified: false }, null]) {
    const p = page();
    p.api.mount({ user, registry: null, classId: '' });
    assert.equal(p.document.getElementById('b3OwnerSidebar'), null);
  }
});

test('sidebar holds the admin tools: Owner Admin, Class Access, Weekly Quiz and the other admin-only tools', () => {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('shared/home-tool-registry.js'), ctx);
  const list = S.items(ctx.B3HomeToolRegistry, 'et');
  const ids = list.map(i => i.id);
  for (const id of ['owner-admin', 'class-access', 'class-locks', 'quiz-dash', 'game-show-host', 'class-dashboard']) assert.ok(ids.includes(id), id);
  assert.equal(list.find(i => i.id === 'quiz-dash').href, 'weekly-quiz/teacher.html?class=et');
  assert.ok(!ids.includes('homework'), 'teacher tools stay on Teacher Home, not in the admin list');
  assert.equal(new Set(ids).size, ids.length);
});

test('this change adds no owner or teacher grant to the database rules or the server', () => {
  for (const file of ['firebase-rules.json', 'firebase-rules.hardened.json', 'staging/database.rules.json', 'storage-rules.hardened.rules',
    'backend/functions/teacher-claim-core.cjs', 'backend/functions/homework-core.cjs', 'backend/functions/teacher-class-scope.js', 'teacher-class-scope.js']) {
    assert.doesNotMatch(read(file), /ownerTeacherView|b3OwnerViewMode|B3OwnerTeacherView|B3OwnerSidebar/, file);
  }
});
