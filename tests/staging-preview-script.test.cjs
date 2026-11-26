'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('the general preview script always builds with the staging config, whatever the channel is called', () => {
  const script = read('scripts/deploy-staging-preview.ps1');
  assert.match(script, /staging\/package-site\.cjs/, 'builds with the staging packager');
  assert.doesNotMatch(script, /robocopy/i, 'does not copy the raw site');
  assert.match(script, /firebase\.staging\.json/);
  // It refuses to publish unless the packaged config is staging's and has no production project name.
  assert.match(script, /b3-games/);
  assert.match(script, /refusing to deploy/);
  // Never the main staging address, never functions.
  assert.match(script, /previews never use the main staging address/);
  assert.doesNotMatch(script, /deploy',\s*'--only/i);
  assert.doesNotMatch(script, /functions:/);
  // Must be current with main before publishing.
  assert.match(script, /merge-base --is-ancestor origin\/main HEAD/);
});

test('the homework preview script cannot publish a channel name that would get the production config', () => {
  const script = read('scripts/deploy-homework-staging-preview.ps1');
  assert.match(script, /-notin @\('homework-406-preview', 'pr-597-homework-notes'\)/);
  assert.match(script, /deploy-staging-preview\.ps1/);
});

test('the packaged config really is staging-only for any channel name', () => {
  const { packageSite } = require('../staging/package-site.cjs');
  const os = require('node:os');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-preview-')), 'build');
  const env = {
    B3_STAGING_FIREBASE_API_KEY: 'test-key', B3_STAGING_FIREBASE_AUTH_DOMAIN: 'fun-torah-tools-staging.firebaseapp.com',
    B3_STAGING_FIREBASE_DATABASE_URL: 'https://fun-torah-tools-staging-default-rtdb.firebaseio.com',
    B3_STAGING_FIREBASE_PROJECT_ID: 'fun-torah-tools-staging', B3_STAGING_FIREBASE_STORAGE_BUCKET: 'fun-torah-tools-staging.firebasestorage.app',
    B3_STAGING_FIREBASE_MESSAGING_SENDER_ID: '1', B3_STAGING_FIREBASE_APP_ID: '1:1:web:1'
  };
  packageSite(root, out, { ...process.env, ...env });
  const config = fs.readFileSync(path.join(out, 'firebase-config.js'), 'utf8');
  assert.doesNotMatch(config, /b3-games/i);
  assert.match(config, /window\.B3_FIREBASE_CONFIG = window\.B3_STAGING_FIREBASE_CONFIG/);
  const generated = fs.readFileSync(path.join(out, 'staging/firebase-config.generated.js'), 'utf8');
  assert.match(generated, /"projectId":"fun-torah-tools-staging"/);
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
});
