'use strict';

const STAGING_PROJECT = 'fun-torah-tools-staging';
const PRODUCTION_PROJECT = 'b3-games';
const PRODUCTION_DATABASE = 'b3-games-default-rtdb';
const PRODUCTION_BUCKET = 'b3-games.firebasestorage.app';

function assertNoProductionFirebaseTarget(app) {
  const options = app?.options || {};
  if (options.projectId !== STAGING_PROJECT) return;
  const databaseHost = (() => {
    try { return new URL(options.databaseURL).hostname.toLowerCase(); } catch (_) { return ''; }
  })();
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
  if (!host.endsWith('.firebaseio.com') && !host.endsWith('.firebasedatabase.app')) {
    throw new Error('Firebase Realtime Database URL host is not a supported Firebase database.');
  }
  const instance = host.split('.')[0];
  if (!instance || (projectId === STAGING_PROJECT && instance === PRODUCTION_DATABASE)) {
    throw new Error('Refusing to bind staging triggers to the production Realtime Database.');
  }
  return instance;
}

module.exports = { STAGING_PROJECT, assertNoProductionFirebaseTarget, databaseInstanceFromUrl };
