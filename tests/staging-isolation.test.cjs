'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configFromEnvironment, renderConfigScript } = require('../staging/generate-config.cjs');
const { stageSource } = require('../staging/prepare-site.cjs');
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
    'https://nigrisync.onrender.com/sync-marks'
  ]) assert.equal(guard.isBlockedRequest(url), true, url);
  assert.equal(guard.isBlockedRequest('https://example.test/api?note=b3-games'), true);
  assert.equal(guard.isBlockedRequest('https://fun-torah-tools-staging-default-rtdb.firebaseio.com/path.json'), false);
});

test('Firebase initialization is rejected unless all options match staging', () => {
  const sdk = { apps: [], initializeApp(options) { return { options }; } };
  guard.installFirebaseGuard({ firebase: sdk }, stage);
  assert.throws(() => sdk.initializeApp({ ...stage, projectId: 'b3-games' }), /anything except the configured staging project/);
  assert.equal(sdk.initializeApp(stage).options.projectId, stage.projectId);
});

test('staging packager rewrites app endpoints and injects the guard before page code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-staging-'));
  try {
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'firebase-config.js'), 'window.cfg={apiKey:"production-api-key"};');
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head><script src="firebase-config.js"></script></head><body></body></html>');
    fs.writeFileSync(path.join(root, 'nested', 'index.html'), '<html><head></head><body></body></html>');
    fs.writeFileSync(path.join(root, 'assets', 'calls.js'), [
      'apiKey: "production-api-key"',
      'authDomain: "b3-games.firebaseapp.com"',
      'databaseURL: "https://b3-games-default-rtdb.firebaseio.com"',
      'projectId: "b3-games"',
      'storageBucket: "b3-games.firebasestorage.app"',
      'https://us-central1-b3-games.cloudfunctions.net/ping',
      'https://posuk-scorer.onrender.com/score',
      'https://nigrisync.onrender.com/sync-marks'
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
      B3_STAGING_SYNC_URL: 'https://staging-sync.example.test/sync-marks'
    };
    const result = stageSource(root, env);
    assert.equal(result.projectId, 'fun-torah-tools-staging');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const nestedHtml = fs.readFileSync(path.join(root, 'nested', 'index.html'), 'utf8');
    assert.ok(html.indexOf('data-b3-staging-guard') < html.indexOf('firebase-config.js'));
    assert.match(nestedHtml, /\.\.\/staging\/staging-config\.js/);
    assert.equal(fs.readFileSync(path.join(root, 'firebase-config.js'), 'utf8').includes('b3-games'), false);
    const calls = fs.readFileSync(path.join(root, 'assets', 'calls.js'), 'utf8');
    assert.match(calls, /fun-torah-tools-staging\.cloudfunctions\.net/);
    assert.match(calls, /staging-posuk\.example\.test/);
    assert.match(calls, /staging-sync\.example\.test/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('staging packager refuses to substitute production third-party services', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-staging-'));
  try {
    fs.writeFileSync(path.join(root, 'firebase-config.js'), 'apiKey: "production-api-key"');
    assert.throws(() => stageSource(root, envFrom(stage)), /B3_STAGING_POSUK_SCORER_URL/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
