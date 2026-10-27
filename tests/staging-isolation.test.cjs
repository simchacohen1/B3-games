'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configFromEnvironment, renderConfigScript } = require('../staging/generate-config.cjs');
const { stageSource } = require('../staging/prepare-site.cjs');
const { packageSite } = require('../staging/package-site.cjs');
const { prepareRules, OWNER_EMAIL } = require('../staging/prepare-rules.cjs');
const { assertNoProductionFirebaseTarget, databaseInstanceFromUrl } = require('../backend/functions/firebase-resource-targets.cjs');
const guard = require('../staging/staging-config.js');

const stage = {
  apiKey: 'synthetic-staging-key',
  authDomain: 'fun-torah-tools-staging.firebaseapp.com',
  databaseURL: 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com',
  projectId: 'fun-torah-tools-staging',
  storageBucket: 'fun-torah-tools-staging.firebasestorage.app',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:synthetic'
};

function envFrom(config) {
  return {
    B3_STAGING_FIREBASE_API_KEY: config.apiKey,
    B3_STAGING_FIREBASE_AUTH_DOMAIN: config.authDomain,
    B3_STAGING_FIREBASE_DATABASE_URL: config.databaseURL,
    B3_STAGING_FIREBASE_PROJECT_ID: config.projectId,
    B3_STAGING_FIREBASE_STORAGE_BUCKET: config.storageBucket,
    B3_STAGING_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId,
    B3_STAGING_FIREBASE_APP_ID: config.appId
  };
}

test('staging deployment config and database rules are isolated and deny public access', () => {
  const deploy = JSON.parse(fs.readFileSync(path.join(__dirname, '../firebase.staging.json'), 'utf8'));
  assert.equal(deploy.hosting.site, 'fun-torah-tools-staging');
  assert.equal(deploy.hosting.public, 'staging-build');
  assert.equal(deploy.database.rules, 'staging/database.rules.json');
  assert.equal(deploy.functions[0].source, 'backend/functions-staging');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-stage-rules-'));
  try {
    const rules = prepareRules(path.join(__dirname, '../firebase-rules.hardened.json'), path.join(temp, 'rules.json'));
    assert.equal(rules['.read'], false);
    assert.equal(rules['.write'], false);
    const serialized = JSON.stringify(rules);
    assert.ok(serialized.includes(OWNER_EMAIL));
    assert.doesNotMatch(serialized, /simcha5770@gmail\.com|b3-games/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('staging config generator accepts complete isolated Firebase settings', () => {
  assert.deepEqual(configFromEnvironment(envFrom(stage)), stage);
  assert.match(renderConfigScript(stage), /fun-torah-tools-staging/);
});

test('staging config generator fails closed for missing or production config', () => {
  assert.throws(() => configFromEnvironment({}), /Refusing to generate staging config/);
  assert.throws(() => configFromEnvironment(envFrom({ ...stage, projectId: 'b3-games' })), /Refusing to generate staging config/);
  assert.throws(() => configFromEnvironment(envFrom({ ...stage, databaseURL: 'https://b3-games-default-rtdb.firebaseio.com' })), /Refusing to generate staging config/);
  assert.throws(() => configFromEnvironment(envFrom({ ...stage, storageBucket: 'b3-games.firebasestorage.app' })), /Refusing to generate staging config/);
});

test('network guard recognizes production Firebase and external write endpoints', () => {
  for (const url of [
    'https://b3-games-default-rtdb.firebaseio.com/path.json',
    'https://b3-games.firebasestorage.app/file',
    'https://us-central1-b3-games.cloudfunctions.net/gradeTranslationChunk',
    'https://posuk-scorer.onrender.com/score',
    'https://nigrisync.onrender.com/sync-marks',
    'https://docs.google.com/spreadsheets/d/e/production-sheet-id/pub?output=csv'
  ]) assert.equal(guard.isBlockedRequest(url), true, url);
  assert.equal(guard.isBlockedRequest('https://example.test/api?note=b3-games'), true);
  assert.equal(guard.isBlockedRequest('https://fun-torah-tools-staging-default-rtdb.firebaseio.com/path.json'), false);
});

test('Firebase initialization is rejected unless all options match staging', () => {
  const sdk = { apps: [], initializeApp(options) { return { options }; } };
  guard.installFirebaseGuard({ firebase: sdk }, stage);
  assert.throws(() => sdk.initializeApp({ ...stage, projectId: 'b3-games' }), /anything except the configured staging project/);
  assert.equal(sdk.initializeApp(stage).options.projectId, stage.projectId);
  const deferredSdk = {};
  guard.installFirebaseGuard(deferredSdk, stage);
  deferredSdk.firebase = { apps: [], initializeApp(options) { return { options }; } };
  assert.throws(() => deferredSdk.firebase.initializeApp({ ...stage, projectId: 'b3-games' }), /anything except the configured staging project/);
});

test('staging functions derive database instances from staging config and reject production targets', () => {
  assert.equal(databaseInstanceFromUrl(stage.databaseURL, stage.projectId), 'fun-torah-tools-staging-default-rtdb');
  assert.equal(databaseInstanceFromUrl('https://b3-games-default-rtdb.firebaseio.com', 'b3-games'), 'b3-games-default-rtdb');
  assert.throws(() => databaseInstanceFromUrl('https://b3-games-default-rtdb.firebaseio.com', stage.projectId), /Refusing to bind staging triggers/);
  assert.doesNotThrow(() => assertNoProductionFirebaseTarget({ options: { ...stage } }));
  assert.throws(() => assertNoProductionFirebaseTarget({ options: { ...stage, storageBucket: 'b3-games.firebasestorage.app' } }), /Refusing to initialize/);
});

test('staging packager rewrites app endpoints and injects the guard before page code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-staging-'));
  try {
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'firebase-config.js'), 'window.cfg={apiKey:"production-api-key"};');
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head><script src="firebase-config.js"></script></head><body><script>const LEGACY_MIGRATION_CLASSES={\n et:new Set(["chaim_chaikin"]),\n wt:new Set([])\n  };</script></body></html>');
    fs.writeFileSync(path.join(root, 'nested', 'index.html'), '<html lang="en"><script src="../firebase-config.js"></script><body></body></html>');
    fs.writeFileSync(path.join(root, 'assets', 'calls.js'), [
      'apiKey: "production-api-key"',
      'authDomain: "b3-games.firebaseapp.com"',
      'databaseURL: "https://b3-games-default-rtdb.firebaseio.com"',
      'projectId: "b3-games"',
      'window.firebaseConfig={projectId:"b3-games"}',
      'storageBucket: "b3-games.firebasestorage.app"',
      'https://us-central1-b3-games.cloudfunctions.net/ping',
      'https://posuk-scorer.onrender.com/score',
      'https://nigrisync.onrender.com/sync-marks',
      'ownerEmail:"simcha5770@gmail.com"'
    ].join('\n'));
    const env = {
      B3_STAGING_FIREBASE_API_KEY: stage.apiKey,
      B3_STAGING_FIREBASE_AUTH_DOMAIN: stage.authDomain,
      B3_STAGING_FIREBASE_DATABASE_URL: stage.databaseURL,
      B3_STAGING_FIREBASE_PROJECT_ID: stage.projectId,
      B3_STAGING_FIREBASE_STORAGE_BUCKET: stage.storageBucket,
      B3_STAGING_FIREBASE_MESSAGING_SENDER_ID: stage.messagingSenderId,
      B3_STAGING_FIREBASE_APP_ID: stage.appId,
      B3_STAGING_POSUK_SCORER_URL: 'https://staging-posuk.example.test/score',
    };
    const result = stageSource(root, env);
    assert.equal(result.projectId, 'fun-torah-tools-staging');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const nestedHtml = fs.readFileSync(path.join(root, 'nested', 'index.html'), 'utf8');
    assert.ok(html.indexOf('data-b3-staging-guard') < html.indexOf('firebase-config.js'));
    assert.match(nestedHtml, /\.\.\/staging\/staging-config\.js/);
    assert.ok(nestedHtml.indexOf('data-b3-staging-guard') < nestedHtml.indexOf('../firebase-config.js'));
    assert.equal(fs.readFileSync(path.join(root, 'firebase-config.js'), 'utf8').includes('b3-games'), false);
    const calls = fs.readFileSync(path.join(root, 'assets', 'calls.js'), 'utf8');
    assert.match(calls, /fun-torah-tools-staging\.cloudfunctions\.net/);
    assert.match(calls, /projectId:"fun-torah-tools-staging"/);
    assert.match(calls, /staging-posuk\.example\.test/);
    assert.match(calls, /staging-disabled\.invalid/);
    assert.match(calls, /owner@funtorahtools-staging\.test/);
    assert.doesNotMatch(calls, /simcha5770@gmail\.com/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staging packager disables unavailable scorer and sync services without retaining production origins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-staging-'));
  try {
    fs.mkdirSync(path.join(root, 'record_pesukim'), { recursive: true });
    fs.mkdirSync(path.join(root, 'weekly-quiz'), { recursive: true });
    fs.mkdirSync(path.join(root, 'sync-to-nigri'), { recursive: true });
    fs.mkdirSync(path.join(root, 'comment-log'), { recursive: true });
    fs.writeFileSync(path.join(root, 'firebase-config.js'), 'apiKey: "production-api-key"');
    fs.writeFileSync(path.join(root, 'record_pesukim', 'student.html'), '<html><head></head><body>https://posuk-scorer.onrender.com/score</body></html>');
    fs.writeFileSync(path.join(root, 'chossid-lamdan.html'), '<html><head></head><body><script>const SYNC_URL="https://nigrisync.onrender.com/sync-marks",SYNC_KEY="production-secret";\nconst DEFAULT_DATA={date:"2026-10-26",classes:[{id:"et",label:"B3 ET",students:[["Chaikin Mayer Chaim",100,"real mark"]]}]\n};\nfunction esc(s){return s;}</script></body></html>');
    fs.writeFileSync(path.join(root, 'weekly-quiz', 'nigri-sync.js'), "const SYNC_KEY='production-secret'; const NIGRI_NAMES={person:'Chaikin Mayer Chaim'};");
    fs.writeFileSync(path.join(root, 'sync-to-nigri', 'school-marks.html'), '<html><body>Chaikin Mayer Chaim SYNC_KEY="production-secret"</body></html>');
    fs.writeFileSync(path.join(root, 'weekly-quiz', 'B3SchoolMarksBridge.html'), '<html><body>Chaikin Mayer Chaim SYNC_KEY="production-secret"</body></html>');
    fs.writeFileSync(path.join(root, 'comment-log', 'b3-comment-log.html'), '<html><head></head><body><script>const CSV_URL="https://docs.google.com/spreadsheets/d/e/production-sheet-id/pub?output=csv";</script></body></html>');
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head><body><script>const ADMIN_PASSWORD_HASH="57532c1bb37dcc8f1f9c86501590f50bcae0825fdd22a6a88605a046be7d43e3";\nconst LEGACY_MIGRATION_CLASSES={\n et:new Set(["chaim_chaikin"]),\n wt:new Set([])\n  };</script></body></html>');
    const result = stageSource(root, envFrom(stage));
    assert.equal(result.projectId, 'fun-torah-tools-staging');
    const generated = fs.readFileSync(path.join(root, 'record_pesukim', 'student.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'chossid-lamdan.html'), 'utf8');
    assert.match(generated, /staging-disabled\.invalid/);
    assert.match(app, /staging-disabled\.invalid/);
    assert.match(app, /SYNC_KEY=""/);
    assert.match(app, /Test Student A1/);
    assert.doesNotMatch(app, /Chaikin Mayer Chaim|real mark/);
    assert.doesNotMatch(app, /production-secret/);
    assert.doesNotMatch(generated, /posuk-scorer\.onrender\.com/);
    assert.doesNotMatch(app, /nigrisync\.onrender\.com/);
    const quizSync = fs.readFileSync(path.join(root, 'weekly-quiz', 'nigri-sync.js'), 'utf8');
    assert.doesNotMatch(quizSync, /Chaikin Mayer Chaim|production-secret/);
    assert.match(quizSync, /nigri-sync/);
    for (const disabledPath of ['sync-to-nigri/school-marks.html', 'weekly-quiz/B3SchoolMarksBridge.html']) {
      const disabled = fs.readFileSync(path.join(root, disabledPath), 'utf8');
      assert.match(disabled, /Integration disabled in staging/);
      assert.doesNotMatch(disabled, /Chaikin Mayer Chaim|production-secret/);
    }
    const commentLog = fs.readFileSync(path.join(root, 'comment-log', 'b3-comment-log.html'), 'utf8');
    assert.match(commentLog, /staging-disabled\.invalid/);
    assert.doesNotMatch(commentLog, /docs\.google\.com\/spreadsheets/);
    const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(home, /ADMIN_PASSWORD_HASH="staging-disabled"/);
    assert.doesNotMatch(home, /chaim_chaikin/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staging site builder copies the app, excludes server/secrets, and runs the isolation audit', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-package-'));
  const source = path.join(parent, 'source');
  const output = path.join(parent, 'output');
  try {
    fs.mkdirSync(path.join(source, 'backend', 'functions'), { recursive: true });
    fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(source, 'index.html'), '<html><head></head><body><script>const LEGACY_MIGRATION_CLASSES={\n et:new Set([]),\n wt:new Set([])\n  };</script>Staging</body></html>');
    fs.writeFileSync(path.join(source, 'firebase-config.js'), 'window.cfg={apiKey:"production-api-key"};');
    fs.writeFileSync(path.join(source, 'firebase.json'), '{"functions":[]}');
    fs.writeFileSync(path.join(source, 'package.json'), '{"projectId":"b3-games"}');
    fs.writeFileSync(path.join(source, 'package-lock.json'), '{"projectId":"b3-games"}');
    fs.writeFileSync(path.join(source, '.env'), 'PRODUCTION_SECRET=do-not-copy');
    fs.writeFileSync(path.join(source, 'backend', 'functions', 'index.js'), 'server code');
    fs.writeFileSync(path.join(source, 'backend', 'functions', 'student-tool-policy.js'), 'window.B3StudentTools={allowed(){return true;}};');
    fs.writeFileSync(path.join(source, 'assets', 'app.js'), 'https://us-central1-b3-games.cloudfunctions.net/example');
    fs.writeFileSync(path.join(source, 'assets', 'image.svg'), '<svg></svg>');
    const result = packageSite(source, output, envFrom(stage));
    assert.equal(result.projectId, 'fun-torah-tools-staging');
    assert.ok(fs.existsSync(path.join(output, 'index.html')));
    assert.ok(fs.existsSync(path.join(output, 'assets', 'image.svg')));
    assert.equal(fs.existsSync(path.join(output, '.env')), false);
    assert.equal(fs.existsSync(path.join(output, 'firebase.json')), false);
    assert.equal(fs.existsSync(path.join(output, 'package.json')), false);
    assert.equal(fs.existsSync(path.join(output, 'package-lock.json')), false);
    assert.equal(fs.existsSync(path.join(output, 'backend', 'functions', 'student-tool-policy.js')), true);
    assert.equal(fs.existsSync(path.join(output, 'backend', 'functions', 'index.js')), false);
    assert.match(fs.readFileSync(path.join(output, 'assets', 'app.js'), 'utf8'), /fun-torah-tools-staging\.cloudfunctions\.net/);
    assert.throws(() => packageSite(source, output, envFrom(stage)), /must be empty/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
