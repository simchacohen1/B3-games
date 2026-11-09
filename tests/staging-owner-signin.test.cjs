'use strict';
// Issue #710: the one-click "Sign in as staging owner" button must exist only
// on the staging site, and can only ever sign in the fictional staging owner.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stageSource } = require('../staging/prepare-site.cjs');
const core = require('../backend/functions-staging/staging-owner-signin-core.cjs');
const client = require('../staging/owner-signin.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const env = {
  B3_STAGING_FIREBASE_API_KEY: 'staging-test-key',
  B3_STAGING_FIREBASE_AUTH_DOMAIN: 'fun-torah-tools-staging.firebaseapp.com',
  B3_STAGING_FIREBASE_DATABASE_URL: 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com',
  B3_STAGING_FIREBASE_PROJECT_ID: 'fun-torah-tools-staging',
  B3_STAGING_FIREBASE_STORAGE_BUCKET: 'fun-torah-tools-staging.firebasestorage.app',
  B3_STAGING_FIREBASE_MESSAGING_SENDER_ID: '1',
  B3_STAGING_FIREBASE_APP_ID: '1:1:web:staging'
};

// ---------- Server: staging-only function ----------
const OWNER = { uid: 'owner-uid', email: 'owner@funtorahtools-staging.test', emailVerified: true, disabled: false,
  customClaims: { b3StagingAccount: true, b3StagingRole: 'owner' } };
function fakeAuth(user = OWNER) {
  const minted = [], lookedUp = [];
  return { minted, lookedUp,
    getUserByEmail: async email => { lookedUp.push(email); if (!user) throw new Error('auth/user-not-found'); return user; },
    createCustomToken: async (uid, claims) => { minted.push({ uid, claims }); return 'token-for-' + uid; } };
}
const STAGING = { projectId: 'fun-torah-tools-staging', origin: 'https://fun-torah-tools-staging.web.app' };

test('server: signs in the fictional staging owner, and nobody else', async () => {
  const auth = fakeAuth();
  assert.deepEqual(await core.stagingOwnerToken(auth, STAGING), { customToken: 'token-for-owner-uid' });
  assert.deepEqual(auth.lookedUp, ['owner@funtorahtools-staging.test']);
  assert.deepEqual(auth.minted, [{ uid: 'owner-uid', claims: undefined }]);
});

test('server: refuses to run in any project except staging', async () => {
  for (const projectId of ['b3-games', '', undefined, 'fun-torah-tools-staging-2', 'FUN-TORAH-TOOLS-STAGING']) {
    const auth = fakeAuth();
    await assert.rejects(core.stagingOwnerToken(auth, { ...STAGING, projectId }), { code: 404 });
    assert.equal(auth.lookedUp.length + auth.minted.length, 0, 'no account lookup or token for ' + projectId);
  }
});

test('server: refuses requests that do not come from the staging site', async () => {
  for (const origin of ['https://funtorahtools.com', 'https://www.funtorahtools.com', 'https://simchacohen1.github.io', '',
    undefined, 'http://fun-torah-tools-staging.web.app', 'https://fun-torah-tools-staging--pr-1-abc.web.app', 'https://fun-torah-tools-staging.web.app.evil.test']) {
    const auth = fakeAuth();
    await assert.rejects(core.stagingOwnerToken(auth, { ...STAGING, origin }), { code: 403 });
    assert.equal(auth.minted.length, 0);
  }
});

test('server: refuses unless the account is the provisioned fictional owner', async () => {
  const bad = [null, { ...OWNER, emailVerified: false }, { ...OWNER, disabled: true }, { ...OWNER, uid: '' },
    { ...OWNER, email: 'someone@example.com' }, { ...OWNER, customClaims: undefined },
    { ...OWNER, customClaims: { b3StagingAccount: true, b3StagingRole: 'teacher' } },
    { ...OWNER, customClaims: { b3StagingRole: 'owner' } }];
  for (const user of bad) {
    const auth = fakeAuth(user);
    await assert.rejects(core.stagingOwnerToken(auth, STAGING), { code: 503 });
    assert.equal(auth.minted.length, 0);
  }
});

// ---------- Production is untouched ----------
function filesUnder(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, out);
    else if (/\.(?:js|cjs|mjs|json|html)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

test('production: the live Owner Admin page has no staging owner button or script', () => {
  const html = read('owner-admin.html');
  assert.doesNotMatch(html, /owner-signin|stagingOwnerSignIn|staging owner|signInWithCustomToken/i);
});

test('production: no live page loads the staging owner script', () => {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.html$/i.test(entry.name)) assert.doesNotMatch(read(entry.name), /owner-signin\.js/, entry.name);
  }
});

test('production: the production Functions codebase has no staging owner sign-in', () => {
  for (const file of filesUnder(path.join(root, 'backend', 'functions'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /stagingOwnerSignIn|staging-owner-signin/i, path.relative(root, file));
  }
  const production = JSON.parse(read('firebase.json'));
  assert.doesNotMatch(JSON.stringify(production), /functions-staging/);
  assert.match(read('backend/functions-staging/index.js'), /exports\.stagingOwnerSignIn\s*=/);
});

// ---------- Staging package ----------
function stagedOwnerAdmin(source = read('owner-admin.html')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-owner-signin-'));
  try {
    fs.copyFileSync(path.join(root, 'firebase-config.js'), path.join(dir, 'firebase-config.js'));
    fs.writeFileSync(path.join(dir, 'owner-admin.html'), source);
    stageSource(dir, env);
    return { html: fs.readFileSync(path.join(dir, 'owner-admin.html'), 'utf8'),
      script: fs.readFileSync(path.join(dir, 'staging', 'owner-signin.js'), 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('staging package: Owner Admin loads the staging owner script exactly once', () => {
  const { html, script } = stagedOwnerAdmin();
  assert.equal(html.split('<script data-b3-staging-owner-signin src="staging/owner-signin.js"></script>').length, 2);
  assert.ok(html.indexOf('staging/staging-config.js') < html.indexOf('staging/owner-signin.js'), 'staging guard loads first');
  assert.equal(script, read('staging/owner-signin.js'));
});

test('staging package: build fails closed if the sign-in box cannot be found', () => {
  assert.throws(() => stagedOwnerAdmin('<!doctype html><html><head></head><body><p>No sign-in box</p></body></html>'), /staging owner sign-in button/);
});

// ---------- Browser script ----------
function fakeWindow(overrides = {}) {
  const elements = {};
  const make = tag => ({ tag, style: {}, children: [], listeners: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); if (child.id) elements[child.id] = child; for (const c of child.children || []) if (c.id) elements[c.id] = c; return child; },
    addEventListener(type, handler) { this.listeners[type] = handler; } });
  elements.gate = make('div');
  const staging = { projectId: 'fun-torah-tools-staging' };
  const signedIn = [], fetched = [];
  const win = {
    location: { protocol: 'https:', hostname: 'fun-torah-tools-staging.web.app' },
    B3_STAGING_MODE: true, B3_STAGING_FIREBASE_CONFIG: staging, B3_FIREBASE_CONFIG: staging,
    firebase: { apps: [{}], app: () => ({ options: staging }), auth: () => ({ signInWithCustomToken: async token => { signedIn.push(token); } }) },
    document: { readyState: 'complete', getElementById: id => elements[id] || null, createElement: make },
    fetch: async (url, init) => { fetched.push({ url, init }); return { ok: true, json: async () => ({ customToken: 'staging-token' }) }; },
    console: { error() {} },
    ...overrides
  };
  return { win, elements, signedIn, fetched };
}
const LIVE_CONFIG = { projectId: 'b3-games' };
const liveFirebase = { apps: [{}], app: () => ({ options: LIVE_CONFIG }), auth: () => ({}) };

test('browser: the button never appears outside the staging site', () => {
  const cases = {
    'live site': { location: { protocol: 'https:', hostname: 'funtorahtools.com' }, B3_STAGING_MODE: undefined, B3_STAGING_FIREBASE_CONFIG: undefined, B3_FIREBASE_CONFIG: LIVE_CONFIG, firebase: liveFirebase },
    'live www site': { location: { protocol: 'https:', hostname: 'www.funtorahtools.com' }, B3_STAGING_MODE: undefined, B3_STAGING_FIREBASE_CONFIG: undefined, B3_FIREBASE_CONFIG: LIVE_CONFIG, firebase: liveFirebase },
    'GitHub Pages': { location: { protocol: 'https:', hostname: 'simchacohen1.github.io' }, B3_STAGING_MODE: undefined, B3_STAGING_FIREBASE_CONFIG: undefined, B3_FIREBASE_CONFIG: LIVE_CONFIG, firebase: liveFirebase },
    'live host even with staging flags set': { location: { protocol: 'https:', hostname: 'funtorahtools.com' } },
    'staging host connected to the live project': { B3_FIREBASE_CONFIG: LIVE_CONFIG, firebase: liveFirebase },
    'staging host, live Firebase app': { firebase: liveFirebase },
    'staging flag missing': { B3_STAGING_MODE: undefined },
    'staging flag truthy but not true': { B3_STAGING_MODE: 'true' },
    'not https': { location: { protocol: 'http:', hostname: 'fun-torah-tools-staging.web.app' } },
    'preview channel': { location: { protocol: 'https:', hostname: 'fun-torah-tools-staging--pr-1-abc123.web.app' } },
    'look-alike host': { location: { protocol: 'https:', hostname: 'fun-torah-tools-staging.web.app.evil.test' } },
    'localhost': { location: { protocol: 'http:', hostname: 'localhost' } },
    'Firebase not loaded': { firebase: undefined },
    'no location': { location: undefined }
  };
  for (const [name, overrides] of Object.entries(cases)) {
    const { win, elements } = fakeWindow(overrides);
    assert.equal(client.isStagingSite(win), false, name);
    assert.equal(client.mount(win), false, name);
    assert.equal(elements.gate.children.length, 0, name + ': nothing added to the page');
  }
});

test('browser: on staging the button is added once and signs in with one click', async () => {
  const { win, elements, signedIn, fetched } = fakeWindow();
  assert.equal(client.mount(win), true);
  assert.equal(client.mount(win), false, 'second mount adds nothing');
  assert.equal(elements.gate.children.length, 1);
  const button = elements.stagingOwnerSignIn;
  assert.equal(button.textContent, 'Sign in as staging owner');
  button.listeners.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/stagingOwnerSignIn');
  assert.equal(fetched[0].init.method, 'POST');
  assert.deepEqual(signedIn, ['staging-token']);
  assert.equal(button.disabled, false);
});

test('browser: a failed sign-in shows a message and signs nobody in', async () => {
  const { win, elements, signedIn } = fakeWindow({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Not available.' }) }) });
  client.mount(win);
  elements.stagingOwnerSignIn.listeners.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(signedIn, []);
  assert.match(elements.stagingOwnerSignInMsg.textContent, /Could not sign in as staging owner\. Not available\./);
  assert.equal(elements.stagingOwnerSignIn.disabled, false);
});

test('browser: the script only ever talks to the staging project', () => {
  const source = read('staging/owner-signin.js');
  assert.doesNotMatch(source, /b3-games|funtorahtools\.com|github\.io/i);
  assert.equal(client.ENDPOINT, 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/stagingOwnerSignIn');
});

// ---------- After signing in: Owner Admin has to work on staging ----------
test('staging student tools accept the button sign-in; production code never does', async () => {
  const staging = require('../backend/functions-staging/student-management-core.cjs').manageStudents;
  const production = require('../backend/functions/student-management-core.cjs').manageStudents;
  const store = { get: async p => (p === 'b3Games/admins/stage_owner' ? { active: true } : null), update: async () => {} };
  const id = { uid: 'stage_owner', email: 'owner@funtorahtools-staging.test', email_verified: true, b3StagingAccount: true, firebase: { sign_in_provider: 'custom' } };
  const old = process.env.B3_STAGING_DEPLOYMENT;
  try {
    delete process.env.B3_STAGING_DEPLOYMENT;
    await assert.rejects(staging(store, id, { action: 'auditLog' }), /Google/, 'needs the staging deployment flag');
    process.env.B3_STAGING_DEPLOYMENT = 'true';
    await assert.rejects(production(store, id, { action: 'auditLog' }), /Google/, 'production never accepts it');
    await assert.rejects(staging(store, { ...id, b3StagingAccount: undefined }, { action: 'auditLog' }), /Google/, 'student-style custom sign-in is refused');
    await assert.rejects(staging(store, { ...id, email_verified: false }, { action: 'auditLog' }), /Google/);
    await assert.rejects(staging(store, { ...id, uid: 'not_admin' }, { action: 'auditLog' }), /Owner or administrator/);
    assert.equal((await staging(store, id, { action: 'auditLog' })).ok, true);
  } finally {
    if (old === undefined) delete process.env.B3_STAGING_DEPLOYMENT; else process.env.B3_STAGING_DEPLOYMENT = old;
  }
  assert.doesNotMatch(read('backend/functions/student-management-core.cjs'), /'custom'/);
});

test('staging database rules cover what Owner Admin loads: Schools, Students, Content', () => {
  const owner = "auth != null && auth.token.email == 'owner@funtorahtools-staging.test' && auth.token.email_verified == true";
  const workspace = JSON.parse(read('staging/database.rules.json')).rules.b3Games.workspaces.$workspaceId;
  const schools = workspace.schools;
  assert.deepEqual(schools, { '.read': owner, '.write': owner, $schoolId: { '.read': 'auth != null' } });
  const ownerOrAdmin = "auth != null && (auth.token.email == 'owner@funtorahtools-staging.test' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)";
  assert.deepEqual(workspace.students, { '.read': ownerOrAdmin, '.write': ownerOrAdmin });
  assert.deepEqual(workspace.contentGrants, { '.read': ownerOrAdmin, '.write': ownerOrAdmin, $classId: { '.read': 'auth != null' } });
});
