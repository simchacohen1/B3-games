'use strict';
// Issue #702: the staging package must let paid-api.js call the staging
// Functions host (and only that host), while the live file stays production-only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { stageSource } = require('../staging/prepare-site.cjs');

const root = path.resolve(__dirname, '..');
const env = {
  B3_STAGING_FIREBASE_API_KEY: 'staging-test-key',
  B3_STAGING_FIREBASE_AUTH_DOMAIN: 'fun-torah-tools-staging.firebaseapp.com',
  B3_STAGING_FIREBASE_DATABASE_URL: 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com',
  B3_STAGING_FIREBASE_PROJECT_ID: 'fun-torah-tools-staging',
  B3_STAGING_FIREBASE_STORAGE_BUCKET: 'fun-torah-tools-staging.firebasestorage.app',
  B3_STAGING_FIREBASE_MESSAGING_SENDER_ID: '1',
  B3_STAGING_FIREBASE_APP_ID: '1:1:web:staging'
};
const STAGING = 'https://us-central1-fun-torah-tools-staging.cloudfunctions.net/';
const LIVE = 'https://us-central1-b3-games.cloudfunctions.net/';

function stagedPaidApi(source = fs.readFileSync(path.join(root, 'paid-api.js'), 'utf8')) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-paid-api-'));
  try {
    fs.copyFileSync(path.join(root, 'firebase-config.js'), path.join(dir, 'firebase-config.js'));
    fs.writeFileSync(path.join(dir, 'paid-api.js'), source);
    stageSource(dir, env);
    return fs.readFileSync(path.join(dir, 'paid-api.js'), 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Runs paid-api.js in a fake browser and reports whether a URL reaches fetch.
function loader(source) {
  const sent = [];
  const window = {
    location: { pathname: '/posuk/index.html' },
    fetch: async url => { sent.push(String(url)); return { status: 200 }; }
  };
  const sessionStorage = { getItem: key => ({ b3Games_studentId: 'test_student', b3Games_classPin: '0000' })[key] || null };
  vm.runInNewContext(source, { window, sessionStorage, Headers: class { set() {} }, DOMException });
  return async url => {
    try { await window.B3PaidApi.fetch(url, {}); return sent.includes(url); }
    catch (error) { assert.match(error.message, /Unknown learning service/); return false; }
  };
}

const AI_FUNCTIONS = ['generateComprehensionQuestions', 'generateTranslationChunks', 'gradeTranslationChunk',
  'generateMishnahQuestions', 'gradeMishnahExplanation', 'synthesizeSpeech'];

test('packaged staging paid-api.js allows the staging Functions host', async () => {
  const allowed = loader(stagedPaidApi());
  for (const name of AI_FUNCTIONS) assert.equal(await allowed(STAGING + name), true, name);
});

test('packaged staging paid-api.js rejects production and every other host', async () => {
  const allowed = loader(stagedPaidApi());
  for (const url of [
    LIVE + 'generateComprehensionQuestions',
    'https://us-central1-fun-torah-tools-stagingXcloudfunctions.net/generateComprehensionQuestions',
    'https://us-central1-fun-torah-tools-staging.cloudfunctions.net.evil.test/generateComprehensionQuestions',
    'https://evil.test/generateComprehensionQuestions',
    'http://us-central1-fun-torah-tools-staging.cloudfunctions.net/generateComprehensionQuestions',
    STAGING + 'notAnAllowedFunction'
  ]) assert.equal(await allowed(url), false, url);
});

test('live paid-api.js is unchanged: production host only', async () => {
  const source = fs.readFileSync(path.join(root, 'paid-api.js'), 'utf8');
  assert.match(source, /us-central1-b3-games\\\.cloudfunctions\\\.net/);
  assert.doesNotMatch(source, /fun-torah-tools-staging/);
  const allowed = loader(source);
  assert.equal(await allowed(LIVE + 'generateComprehensionQuestions'), true);
  assert.equal(await allowed(STAGING + 'generateComprehensionQuestions'), false);
});

test('staging build fails closed if the allowlist host cannot be found', () => {
  assert.throws(() => stagedPaidApi('window.B3PaidApi = {};\n'), /learning-service host allowlist/);
});
