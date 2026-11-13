'use strict';
// Teacher pages must read only the teacher's own classes, never the whole class list.
// Listing every class downloads other teachers' rosters, and the stricter database
// rules (firebase-rules.hardened.json) allow a teacher their own classes only.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const CLASSES = 'b3Games/workspaces/b3-2026/classes';

function siteSettings(data, denied = []) {
  const reads = [];
  const db = { ref: p => ({ once: async () => { reads.push(p); if (denied.includes(p)) throw new Error('permission_denied'); return { val: () => data[p] ?? null }; } }) };
  const firebase = { apps: [{}], database: () => db, auth: () => ({ currentUser: null }) };
  const window = { firebase, B3_FIREBASE_CONFIG: Object.fromEntries(['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].map(k => [k, 'test'])) };
  window.self = window; window.top = window;
  const store = new Map(), localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  window.localStorage = localStorage;
  const document = { readyState: 'complete', addEventListener() {}, getElementsByTagName: () => [], getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } };
  window.document = document;
  const ctx = { window, firebase, localStorage, document, console: { log() {}, warn() {}, error() {} }, Intl, Date, URL, setTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'site-settings.js'), 'utf8'), ctx);
  return { api: window.B3SiteSettings, reads };
}
const plain = v => JSON.parse(JSON.stringify(v));
const data = {
  [CLASSES]: { a: { name: 'A' }, b: { name: 'B' }, other: { name: 'Other teacher' } },
  [CLASSES + '/a']: { name: 'A' }, [CLASSES + '/b']: { name: 'B' }, [CLASSES + '/other']: { name: 'Other teacher' }
};

test('a teacher reads only their own classes, one by one, never the whole list', async () => {
  const t = siteSettings(data);
  const classes = await t.api.readClassesFor({ authorized: true, role: 'teacher', classIds: ['a', 'b', 'a', '*', 'bad id', null] });
  assert.deepEqual(plain(classes), { a: { name: 'A' }, b: { name: 'B' } });
  assert.deepEqual(t.reads.sort(), [CLASSES + '/a', CLASSES + '/b']);
});

test('the owner still gets every class with one list read', async () => {
  const t = siteSettings(data);
  const classes = await t.api.readClassesFor({ authorized: true, role: 'admin', classIds: ['*'] });
  assert.deepEqual(Object.keys(plain(classes)).sort(), ['a', 'b', 'other']);
  assert.deepEqual(t.reads, [CLASSES]);
});

test('a class the teacher may not read, or that no longer exists, is left out; nobody signed in gets nothing', async () => {
  const t = siteSettings(data, [CLASSES + '/b']);
  assert.deepEqual(plain(await t.api.readClassesFor({ authorized: true, role: 'teacher', classIds: ['a', 'b', 'gone'] })), { a: { name: 'A' } });
  const none = siteSettings(data);
  assert.deepEqual(plain(await none.api.readClassesFor(null)), {});
  assert.deepEqual(plain(await none.api.readClassesFor({ authorized: false, role: '', classIds: [] })), {});
  assert.deepEqual(none.reads, []);
});

test('the teacher pages use the shared reader instead of listing every class', () => {
  const wholeList = /\/classes["']\)\s*\.once\(/;
  for (const file of ['student-report/index.html', 'gematria/teacher.html', 'halacha/index.html', 'word-bank/teacher.html']) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(html, /readClassesFor\(/, file);
    assert.doesNotMatch(html, wholeList, file + ' does not list every class');
  }
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /const allClasses=await window\.B3SiteSettings\.readClassesFor\(currentAccess\);/, 'Manage Class');
  // Halacha teacher: the one remaining list read is inside the owner-only branch.
  const halacha = fs.readFileSync(path.join(ROOT, 'halacha/teacher.html'), 'utf8');
  assert.match(halacha, /async function editableClassIds\(access\)\{\s*const classes=await window\.B3SiteSettings\.readClassesFor\(access\);/);
  assert.equal(halacha.match(/\/classes"\)\.once\(/g).length, 1);
  assert.match(halacha, /if\(access\?\.role==="admin"\)\{\s*const classesSnap=await db\.ref\("b3Games\/workspaces\/"\+workspaceId\+"\/classes"\)\.once/);
});
