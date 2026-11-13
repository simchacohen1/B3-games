'use strict';
// Owner as a teacher (#726). HIGH RISK area: teacher access.
// These tests pin the safety rules of "Teacher view":
//   - it only ever narrows the owner's own view to the owner's own classes;
//   - owner mode (the default) is exactly as before;
//   - no other account is affected, whatever is in the browser's storage;
//   - any doubt keeps the normal owner access (the owner is never locked out).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../owner-teacher-view.js');

const ROOT = path.join(__dirname, '..');
const OWNER = 'simcha5770@gmail.com';
const INVITE_PATH = 'b3Games/workspaces/b3-2026/teacherInvites/simcha5770_gmail_com';
const owner = { uid: 'owner-uid', email: OWNER, emailVerified: true, getIdToken: async () => '' };
const teacher = { uid: 'regular', email: 'teacher@example.test', emailVerified: true, getIdToken: async () => '' };
const invite = (extra = {}) => ({ email: OWNER, name: 'Owner', role: 'teacher', active: true, schoolId: 'school_a', classIds: { kita_a: true, kita_b: true }, ...extra });
const memory = (mode) => { const m = new Map(mode ? [[V.MODE_KEY, mode]] : []); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const fakeDb = (data, reads = [], fail = false) => ({ ref: p => ({ once: async () => { reads.push(p); if (fail) throw new Error('offline'); return { val: () => data[p] ?? null }; } }) });

// ---- the shared logic -------------------------------------------------------

test('the owner invitation uses the same key Owner Admin writes', () => {
  assert.equal(V.inviteKey(' Simcha5770@Gmail.com '), 'simcha5770_gmail_com');
});

test('teaching classes come only from an active, ordinary teacher invitation for the owner email', () => {
  assert.deepEqual(V.teachingClassIds(invite()), ['kita_a', 'kita_b']);
  assert.deepEqual(V.teachingClassIds(invite({ classIds: { kita_a: true, kita_b: false, '*': true, 'bad id': true } })), ['kita_a']);
  assert.deepEqual(V.teachingClassIds(invite({ active: false })), [], 'inactive invitation');
  assert.deepEqual(V.teachingClassIds(invite({ email: 'someone@example.test' })), [], "another person's invitation");
  assert.deepEqual(V.teachingClassIds(invite({ accountType: 'principal' })), [], 'principal invitation');
  assert.deepEqual(V.teachingClassIds(invite({ role: 'principal' })), [], 'principal role');
  assert.deepEqual(V.teachingClassIds(invite({ classIds: null })), []);
  assert.deepEqual(V.teachingClassIds(null), []);
});

test('Teacher view is always a plain teacher of a subset of classes, never admin or "*"', () => {
  const access = V.teacherAccess(invite({ classIds: { kita_a: true, '*': true } }));
  assert.deepEqual(access, { authorized: true, role: 'teacher', accountType: 'teacher', supervisedTeachers: {}, classIds: ['kita_a'], inviteId: 'simcha5770_gmail_com', ownerTeacherView: true });
  assert.equal(V.teacherAccess(invite({ classIds: {} })), null, 'no classes means no Teacher view');
});

test('the mode is remembered per browser and defaults to owner', () => {
  const store = memory();
  assert.equal(V.getMode(store), 'owner');
  assert.equal(V.setMode('teacher', store), 'teacher');
  assert.equal(V.setMode('owner', store), 'owner');
  assert.equal(store.getItem(V.MODE_KEY), null);
  assert.equal(V.getMode(memory('admin')), 'owner', 'unknown values mean owner');
  assert.equal(V.getMode({ getItem() { throw new Error('blocked'); } }), 'owner', 'blocked storage means owner');
});

test('resolve: owner mode never reads the database and changes nothing', async () => {
  const reads = [];
  assert.equal(await V.resolve(fakeDb({ [INVITE_PATH]: invite() }, reads), 'b3-2026', owner, memory()), null);
  assert.deepEqual(reads, []);
});

test('resolve: Teacher view gives the owner their own classes only', async () => {
  const reads = [];
  const access = await V.resolve(fakeDb({ [INVITE_PATH]: invite() }, reads), 'b3-2026', owner, memory('teacher'));
  assert.equal(access.role, 'teacher');
  assert.deepEqual(access.classIds, ['kita_a', 'kita_b']);
  assert.deepEqual(reads, [INVITE_PATH], 'only the owner\'s own invitation is read');
});

test('resolve: Teacher view does nothing for any account that is not the verified owner', async () => {
  const data = { [INVITE_PATH]: invite(), 'b3Games/workspaces/b3-2026/teacherInvites/teacher_example_test': invite({ email: teacher.email }) };
  for (const user of [teacher, { ...owner, emailVerified: false }, { ...owner, email: 'simcha5770@gmail.com.evil.test' }, null]) {
    const reads = [];
    assert.equal(await V.resolve(fakeDb(data, reads), 'b3-2026', user, memory('teacher')), null);
    assert.deepEqual(reads, [], 'nothing is read for a non-owner');
  }
});

test('resolve: no invitation, no classes or a failed read keep the normal owner view', async () => {
  assert.equal(await V.resolve(fakeDb({}), 'b3-2026', owner, memory('teacher')), null);
  assert.equal(await V.resolve(fakeDb({ [INVITE_PATH]: invite({ classIds: {} }) }), 'b3-2026', owner, memory('teacher')), null);
  assert.equal(await V.resolve(fakeDb({ [INVITE_PATH]: invite() }, [], true), 'b3-2026', owner, memory('teacher')), null);
  assert.equal(await V.resolve(fakeDb({ [INVITE_PATH]: invite() }), '../bad', owner, memory('teacher')), null);
});

test('class lists and the messages inbox are only ever cut down', () => {
  assert.deepEqual(V.narrow(['kita_a', 'other', 'kita_b'], ['kita_a', 'kita_b', 'not_listed']), ['kita_a', 'kita_b']);
  assert.deepEqual(V.narrow([{ id: 'other', name: 'Other' }, { id: 'kita_a', name: 'A' }], ['kita_a']), [{ id: 'kita_a', name: 'A' }]);
  assert.deepEqual(V.narrow(['other'], []), []);
  const inbox = { ok: true, unread: 9, groups: [
    { id: 'kita_a', name: 'A', contacts: [{ id: 's1', unread: 2 }, { id: 's2', unread: 0 }] },
    { id: 'other', name: 'Other', contacts: [{ id: 's3', unread: 7 }] }] };
  const mine = V.narrowInbox(inbox, ['kita_a']);
  assert.deepEqual(mine.groups.map(g => g.id), ['kita_a']);
  assert.equal(mine.unread, 2, 'unread is recounted from the classes that are shown');
  assert.equal(inbox.groups.length, 2, 'the server answer is not modified');
});

// ---- site-settings.js: how every Teacher Tools page decides access ---------------

function settings(data, user, { mode = null, withView = true, scriptFails = false } = {}) {
  const reads = [], writes = [], scripts = [];
  const db = { ref: p => ({ once: async () => { reads.push(p); return { val: () => data[p] ?? null }; }, set: async v => writes.push([p, v]), update: async v => writes.push([p, v]) }) };
  const firebase = { apps: [{}], database: () => db, auth: () => ({ currentUser: user }) };
  const window = { firebase, B3_FIREBASE_CONFIG: Object.fromEntries(['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].map(k => [k, 'test'])) };
  window.self = window; window.top = window;
  const localStorage = memory(mode);
  window.localStorage = localStorage;
  const document = { readyState: 'complete', addEventListener() {}, getElementsByTagName: () => [], getElementById: () => null,
    createElement: () => ({}), head: { appendChild(tag) { scripts.push(tag.src); setTimeout(() => (scriptFails ? tag.onerror() : tag.onload()), 0); } } };
  window.document = document;
  const ctx = { window, firebase, localStorage, document, console: { log() {}, warn() {}, error() {} }, Intl, Date, URL, setTimeout };
  vm.createContext(ctx);
  if (withView) vm.runInContext(fs.readFileSync(path.join(ROOT, 'owner-teacher-view.js'), 'utf8'), ctx);
  const source = fs.readFileSync(path.join(ROOT, 'site-settings.js'), 'utf8').replace('  window.B3SiteSettings = {', '  window.readAccessForTest=readUserAccess;\n  window.B3SiteSettings = {');
  vm.runInContext(source, ctx);
  return { window, reads, writes, scripts };
}
const plain = value => JSON.parse(JSON.stringify(value));
const FULL = { authorized: true, role: 'admin', classIds: ['*'] };

test('site-settings: the owner keeps full owner access by default, with no extra reads', async () => {
  const t = settings({ [INVITE_PATH]: invite() }, owner);
  assert.deepEqual(plain(await t.window.readAccessForTest(owner)), FULL);
  assert.deepEqual(t.reads, [], 'owner mode reads nothing new');
  assert.deepEqual(t.scripts, []);
});

test('site-settings: in Teacher view the owner is a teacher of their own classes only', async () => {
  const t = settings({ [INVITE_PATH]: invite() }, owner, { mode: 'teacher' });
  const access = plain(await t.window.readAccessForTest(owner));
  assert.equal(access.role, 'teacher');
  assert.deepEqual(access.classIds, ['kita_a', 'kita_b']);
  assert.equal(access.ownerTeacherView, true);
  assert.deepEqual(t.reads, [INVITE_PATH]);
});

test('site-settings: Teacher view cannot change global settings (it is narrower, never wider)', async () => {
  const t = settings({ [INVITE_PATH]: invite() }, owner, { mode: 'teacher' });
  await assert.rejects(t.window.B3SiteSettings.updateGameEnabled('yiddish', false), /administrator/);
  assert.equal(t.writes.length, 0);
});

test('site-settings: Teacher view with no classes, or no invitation, is the normal owner view', async () => {
  for (const data of [{}, { [INVITE_PATH]: invite({ classIds: {} }) }, { [INVITE_PATH]: invite({ active: false }) }]) {
    const t = settings(data, owner, { mode: 'teacher' });
    assert.deepEqual(plain(await t.window.readAccessForTest(owner)), FULL);
  }
});

test('site-settings: the Teacher view file is fetched only when needed, and a failed load keeps owner access', async () => {
  const loaded = settings({ [INVITE_PATH]: invite() }, owner, { mode: 'teacher', withView: false, scriptFails: true });
  assert.deepEqual(plain(await loaded.window.readAccessForTest(owner)), FULL);
  assert.equal(loaded.scripts.length, 1);
  assert.match(loaded.scripts[0], /owner-teacher-view\.js/);
});

test('site-settings: other teachers are untouched, even with the Teacher view flag in their browser', async () => {
  const data = {
    'b3Games/workspaces/b3-2026/teachers/regular': { active: true, role: 'teacher', classIds: { their_class: true } },
    [INVITE_PATH]: invite()
  };
  const results = [];
  for (const mode of [null, 'teacher']) {
    const t = settings(data, teacher, { mode });
    results.push({ access: plain(await t.window.readAccessForTest(teacher)), reads: t.reads, scripts: t.scripts });
  }
  assert.deepEqual(results[0], results[1], 'identical result and identical database reads');
  assert.equal(results[0].access.role, 'teacher');
  assert.deepEqual(results[0].access.classIds, ['their_class']);
  assert.equal(results[0].access.ownerTeacherView, undefined);
  assert.ok(!results[1].reads.includes(INVITE_PATH), "the owner's invitation is never read for another teacher");
});

test('site-settings: an account that is not a teacher stays denied, flag or not', async () => {
  for (const mode of [null, 'teacher']) {
    const t = settings({ [INVITE_PATH]: invite() }, teacher, { mode });
    assert.equal((await t.window.readAccessForTest(teacher)).authorized, false);
  }
});

// ---- wiring, and what this change must not touch ---------------------------------

test('Owner Admin has the switch and uses the shared logic', () => {
  const html = fs.readFileSync(path.join(ROOT, 'owner-admin.html'), 'utf8');
  assert.match(html, /<script src="owner-teacher-view\.js\?v=[^"]+"><\/script>/);
  assert.match(html, /id="teacherViewGo"[^>]*disabled/, 'the switch starts disabled until classes are known');
  assert.match(html, /B3OwnerTeacherView\.teachingClassIds\(teacherData\[key\(OWNER\)\]\)/);
  assert.match(html, /B3OwnerTeacherView\.toTeacherView\(\)/);
  // The owner check of Owner Admin itself is the same email check as before.
  assert.match(html, /const owner=user&&String\(user\.email\|\|""\)\.toLowerCase\(\)===OWNER;/);
});

test('Homework teacher page narrows classes and messages only in Teacher view', () => {
  const html = fs.readFileSync(path.join(ROOT, 'assignment-center/teacher.html'), 'utf8');
  assert.match(html, /owner-teacher-view\.js/);
  assert.match(html, /if\(!ownClassIds\|\|\(body\.action!=='dmInbox'&&body\.action!=='dmUnread'\)\)return api\(body\);/, 'everyone else, and every other action, goes straight through');
  assert.match(html, /B3OwnerTeacherView\.narrow\(classes,ownClassIds\)/);
});

test('this change adds no owner or teacher grant to the database rules or the server', () => {
  for (const file of ['firebase-rules.json', 'firebase-rules.hardened.json', 'staging/database.rules.json', 'storage-rules.hardened.rules',
    'backend/functions/teacher-claim-core.cjs', 'backend/functions/homework-core.cjs', 'backend/functions/teacher-class-scope.js', 'teacher-class-scope.js']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, /ownerTeacherView|b3OwnerViewMode|B3OwnerTeacherView/, file + ' does not know about Teacher view');
  }
});

// ---- the switch on the pages the owner lands on (home page and Admin) --------------

function page(mode, { framed = false } = {}) {
  const added = [];
  const document = { body: { append: el => added.push(el) }, currentScript: { src: 'https://site.test/owner-teacher-view.js' },
    getElementById: id => added.find(el => el.id === id && !el.removed) || null,
    createElement: () => ({ style: {}, remove() { this.removed = true; } }) };
  const window = { document, localStorage: memory(mode), location: { href: 'https://site.test/index.html', origin: 'https://site.test' } };
  window.self = window; window.top = framed ? {} : window;
  const ctx = { window, URL };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'owner-teacher-view.js'), 'utf8'), ctx);
  return { view: window.B3OwnerTeacherView, window, shown: () => added.filter(el => !el.removed) };
}

test('switch: the owner with classes gets "Switch to Teacher view", which turns Teacher view on', async () => {
  const p = page(null), reads = [];
  await p.view.mountSwitch(fakeDb({ [INVITE_PATH]: invite() }, reads), 'b3-2026', owner, 'https://site.test/');
  assert.deepEqual(reads, [INVITE_PATH], 'one small read of the owner\'s own invitation');
  assert.equal(p.shown().length, 1);
  assert.match(p.shown()[0].textContent, /Switch to Teacher view/);
  await p.view.mountSwitch(fakeDb({ [INVITE_PATH]: invite() }, reads), 'b3-2026', owner, 'https://site.test/');
  assert.equal(p.shown().length, 1, 'never shown twice');
  p.shown()[0].onclick();
  assert.equal(p.view.getMode(), 'teacher');
  assert.equal(p.window.location.href, 'https://site.test/teacher-home.html');
});

test('switch: with no class assigned yet it leads to Owner Admin and stays in owner mode', async () => {
  for (const data of [{}, { [INVITE_PATH]: invite({ classIds: {} }) }, { [INVITE_PATH]: invite({ active: false }) }]) {
    const p = page(null);
    await p.view.mountSwitch(fakeDb(data), 'b3-2026', owner, 'https://site.test/');
    assert.match(p.shown()[0].textContent, /Set up Teacher view/);
    p.shown()[0].onclick();
    assert.equal(p.view.getMode(), 'owner');
    assert.equal(p.window.location.href, 'https://site.test/owner-admin.html');
  }
});

test('switch: never shown to another account, inside a frame, or while already in Teacher view', async () => {
  const reads = [], db = fakeDb({ [INVITE_PATH]: invite() }, reads);
  let p = page(null); await p.view.mountSwitch(db, 'b3-2026', teacher, ''); assert.equal(p.shown().length, 0);
  p = page(null); await p.view.mountSwitch(db, 'b3-2026', { ...owner, emailVerified: false }, ''); assert.equal(p.shown().length, 0);
  p = page(null, { framed: true }); await p.view.mountSwitch(db, 'b3-2026', owner, ''); assert.equal(p.shown().length, 0);
  p = page('teacher'); await p.view.mountSwitch(db, 'b3-2026', owner, ''); assert.equal(p.shown().length, 0);
  assert.deepEqual(reads, [], 'and nothing is read for them');
});

test('switch: wired into the owner home page (site-settings) and the Admin page, owner only', () => {
  const site = fs.readFileSync(path.join(ROOT, 'site-settings.js'), 'utf8');
  assert.match(site, /const offerSwitch = !acting && window\.top === window && isBootstrapAdmin\(user\) && access && access\.role === "admin" && isOwnerHomePage\(\);/);
  assert.match(site, /showOwnerTeacherView\(access, user\);/);
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(admin, /<script src="owner-teacher-view\.js\?v=[^"]+"><\/script>/);
  assert.match(admin, /if\(owner&&window\.B3OwnerTeacherView\)B3OwnerTeacherView\.mountSwitch\(/);
});
