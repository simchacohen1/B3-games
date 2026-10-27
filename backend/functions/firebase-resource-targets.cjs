'use strict';

const STAGING_PROJECT = 'fun-torah-tools-staging';
const PRODUCTION_PROJECT = 'b3-games';
const PRODUCTION_DATABASE = 'b3-games-default-rtdb';
const PRODUCTION_BUCKET = 'b3-games.firebasestorage.app';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isStagingDeployment() {
  return typeof process !== 'undefined' && process.env.B3_STAGING_DEPLOYMENT === 'true';
}

function isFunctionsEmulator() {
  return typeof process !== 'undefined' && process.env.FUNCTIONS_EMULATOR === 'true';
}

function assertNoProductionFirebaseTarget(app) {
  const options = app?.options || {};
  const staging = isStagingDeployment();
  // A staging deployment must never run against another project, even if the
  // runtime was accidentally initialized with the production project ID.
  if (staging && options.projectId !== STAGING_PROJECT) {
    throw new Error('Refusing to initialize a staging function outside the staging Firebase project.');
  }
  if (options.projectId !== STAGING_PROJECT) return;
  const databaseHost = (() => {
    try { return new URL(options.databaseURL).hostname.toLowerCase(); } catch (_) { return ''; }
  })();
  if (staging && !databaseHost) {
    throw new Error('Refusing to initialize a staging function without a staging Realtime Database URL.');
  }
  if (databaseHost.startsWith(PRODUCTION_DATABASE + '.') ||
      options.storageBucket === PRODUCTION_BUCKET ||
      options.authDomain === PRODUCTION_PROJECT + '.firebaseapp.com') {
    throw new Error('Refusing to initialize a staging function with production Firebase resources.');
  }
}

function databaseInstanceFromUrl(databaseURL, projectId) {
  let parsed;
  try { parsed = new URL(databaseURL); } catch (_) { throw new Error('Firebase Realtime Database URL is missing or invalid.'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Firebase Realtime Database URL must use HTTP(S).');
  const host = parsed.hostname.toLowerCase();
  let instance;
  if (LOOPBACK_HOSTS.has(host) && isFunctionsEmulator()) {
    // Local Functions emulator: http://127.0.0.1:<port>/?ns=<instance>
    instance = String(parsed.searchParams.get('ns') || '').toLowerCase();
    if (!/^[a-z0-9-]+$/.test(instance)) {
      throw new Error('Firebase Realtime Database emulator URL is missing its namespace.');
    }
  } else if (host.endsWith('.firebaseio.com') || host.endsWith('.firebasedatabase.app')) {
    instance = host.split('.')[0];
  } else {
    throw new Error('Firebase Realtime Database URL host is not a supported Firebase database.');
  }
  if (!instance || ((projectId === STAGING_PROJECT || isStagingDeployment()) && instance === PRODUCTION_DATABASE)) {
    throw new Error('Refusing to bind staging triggers to the production Realtime Database.');
  }
  return instance;
}

module.exports = { STAGING_PROJECT, assertNoProductionFirebaseTarget, databaseInstanceFromUrl };
