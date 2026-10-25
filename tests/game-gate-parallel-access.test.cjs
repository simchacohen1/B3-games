'use strict';
// The shared access gate decides who may open every student tool, so these
// tests execute the real source rather than matching text. They prove the
// permission-critical reads now happen at the same time instead of one after
// another, and that the decision the gate reaches is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const source = fs.readFileSync('game-gate.js', 'utf8');

function sliceBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  assert.ok(from >= 0 && to > from, 'could not locate ' + start);
  return source.slice(from, to);
}

// A fetch stub that records when each request starts and finishes, so a
// sequential waterfall is distinguishable from concurrent requests.
function recordingFetch(values, log) {
  return function (url) {
    const field = url.slice(url.lastIndexOf('/') + 1).replace('.json', '');
    log.push({ event: 'start', field });
    return new Promise(function (resolve) {
      setTimeout(function () {
        log.push({ event: 'finish', field });
        resolve(Object.prototype.hasOwnProperty.call(values, field) ? values[field] : null);
      }, 10);
    });
  };
}

function teacherContext(values, log, classIds) {
  const context = {
    console,
    URLSearchParams,
    Promise,
    setTimeout,
    DATABASE_URL: 'https://db.invalid',
    WORKSPACE_ID: 'b3-2026',
    SETTINGS_PATH: 'b3Games/siteSettings',
    gameId: 'shorashim',
    location: { search: '?class=et' },
    window: {},
    verifiedTeacherAccess: { authorized: true, role: 'teacher', classIds: classIds },
    teacherClassRecord: undefined,
    requestInFlight: false,
    refreshRequested: false,
    followActivityOpen: false,
    studentActive: false,
    lastSettings: null,
    decided: null,
    isGuestPreview: function () { return false; },
    storedTeacherBypass: function () { return false; },
    ensureStudentToolPolicy: function () { return Promise.resolve(); },
    getStoredClass: function () { return 'et'; },
    resolveStudentClass: function () { return Promise.resolve(''); },
    startFollowTeacherListener: function () {},
    showOpen: function () {},
    showClosed: function () {},
    fetchJson: recordingFetch(values, log)
  };
  context.decide = function (settings) { context.decided = settings; };
  return context;
}

async function runCheckNow(context) {
  const code = sliceBetween('  function checkNow() {', '  ["click","pointerdown"');
  vm.runInNewContext(code + '\n;globalThis.__checkNow = checkNow;', context);
  context.__checkNow();
  // Let the recorded requests and the decision settle.
  for (let i = 0; i < 40; i++) await new Promise(function (r) { setTimeout(r, 5); });
}

test('a teacher class record is read in one round of parallel requests, not four in a row', async () => {
  const log = [];
  const context = teacherContext(
    { active: true, siteEnabled: true, access: 'open', toolGrants: { shorashim: true }, siteSettings: {} },
    log,
    ['et']
  );
  await runCheckNow(context);

  const classFields = ['active', 'siteEnabled', 'access', 'toolGrants'];
  const starts = log.filter(e => e.event === 'start' && classFields.includes(e.field));
  const finishes = log.filter(e => e.event === 'finish' && classFields.includes(e.field));
  assert.equal(starts.length, 4, 'all four permission fields are still read');
  assert.equal(finishes.length, 4);

  const lastStart = log.lastIndexOf(starts[starts.length - 1]);
  const firstFinish = log.findIndex(e => e.event === 'finish' && classFields.includes(e.field));
  assert.ok(
    lastStart < firstFinish,
    'every class permission request must begin before any of them completes'
  );
});

test('the parallel read still maps each permission field to the right place', async () => {
  const log = [];
  const grants = { shorashim: true, chazara: false };
  const context = teacherContext(
    { active: true, siteEnabled: false, access: 'locked', toolGrants: grants, siteSettings: {} },
    log,
    ['et']
  );
  await runCheckNow(context);
  const record = context.teacherClassRecord;
  assert.equal(record.active, true, 'active must not shift to another field');
  assert.equal(record.siteEnabled, false, 'siteEnabled must not shift to another field');
  assert.equal(record.access, 'locked', 'access must not shift to another field');
  assert.equal(record.toolGrants, grants, 'toolGrants must not shift to another field');
  assert.deepEqual(Object.keys(record).sort(), ['access', 'active', 'siteEnabled', 'toolGrants']);
});

test('a class the teacher is not assigned to still yields no class record', async () => {
  const log = [];
  const context = teacherContext({ siteSettings: {} }, log, ['wt']);
  await runCheckNow(context);
  assert.equal(context.teacherClassRecord, null, 'unassigned classes must stay fail-closed');
  assert.equal(
    log.filter(e => e.event === 'start' && e.field !== 'siteSettings').length,
    0,
    'no class permission fields may be read for an unassigned class'
  );
});

test('a failed permission read still rejects instead of granting access', async () => {
  const log = [];
  const context = teacherContext({ siteSettings: {} }, log, ['et']);
  context.fetchJson = function (url) {
    if (url.includes('/access.json')) return Promise.reject(new Error('Access check timed out'));
    return Promise.resolve(true);
  };
  let closed = null;
  context.showClosed = function (title) { closed = title; };
  await runCheckNow(context);
  assert.equal(context.teacherClassRecord, undefined, 'a failed read must not produce a record');
  assert.equal(closed, 'Having trouble checking access');
});

test('Firebase auth and database download together rather than in a chain', async () => {
  const code = sliceBetween('  async function watchTeacherAccess()', '  function getStoredStudentId()');
  const log = [];
  const firebase = {
    apps: [],
    SDK_VERSION: '12.15.0',
    initializeApp() { this.apps.push({}); },
    auth: null,
    database: null
  };
  const context = vm.createContext({
    console, Promise, setTimeout, URL,
    rootBase: new URL('https://funtorahtools.com/'),
    window: { firebase, B3_FIREBASE_CONFIG: {}, B3SiteSettings: { onAuthStateChanged() {} } },
    document: { readyState: 'complete' },
    markAuthReady: () => {},
    checkNow: () => {},
    waitForFirebaseAuthState: async () => {},
    loadAuthScript: function (url) {
      const name = url.includes('auth') ? 'auth' : url.includes('database') ? 'database' : 'other';
      log.push({ event: 'start', name });
      return new Promise(function (resolve) {
        setTimeout(function () {
          log.push({ event: 'finish', name });
          if (name === 'auth') firebase.auth = () => ({});
          if (name === 'database') firebase.database = () => ({});
          resolve();
        }, 10);
      });
    }
  });
  firebase.auth = null; firebase.database = null;
  vm.runInContext(code, context);
  await context.watchTeacherAccess();

  const authStart = log.findIndex(e => e.event === 'start' && e.name === 'auth');
  const dbStart = log.findIndex(e => e.event === 'start' && e.name === 'database');
  const firstFinish = log.findIndex(e => e.event === 'finish' && (e.name === 'auth' || e.name === 'database'));
  assert.ok(authStart >= 0 && dbStart >= 0, 'both SDK pieces are still loaded');
  assert.ok(
    Math.max(authStart, dbStart) < firstFinish,
    'auth and database must both start before either finishes'
  );
});

test('a missing Firebase config still fails instead of continuing unconfigured', async () => {
  const code = sliceBetween('  async function watchTeacherAccess()', '  function getStoredStudentId()');
  const firebase = { apps: [], SDK_VERSION: '12.15.0', initializeApp() { this.apps.push({}); }, auth: () => ({}), database: () => ({}) };
  let initialized = false;
  firebase.initializeApp = function () { initialized = true; this.apps.push({}); };
  const warnings = [];
  const context = vm.createContext({
    Promise, setTimeout, URL,
    console: { warn: (...args) => warnings.push(args) },
    rootBase: new URL('https://funtorahtools.com/'),
    window: { firebase, B3SiteSettings: { onAuthStateChanged() {} } },
    document: { readyState: 'complete' },
    markAuthReady: () => {},
    checkNow: () => {},
    waitForFirebaseAuthState: async () => {},
    loadAuthScript: function (url) {
      if (url.includes('firebase-config.js')) return Promise.reject(new Error('blocked'));
      return Promise.resolve();
    }
  });
  vm.runInContext(code, context);
  await context.watchTeacherAccess();
  assert.equal(initialized, false, 'the app must not be initialized without its configuration');
  assert.ok(warnings.length > 0, 'the failure is reported rather than swallowed silently');
});
