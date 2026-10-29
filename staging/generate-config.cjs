'use strict';

const REQUIRED_PROJECT = 'fun-torah-tools-staging';
const BLOCKED = [
  'b3-games',
  'b3-games.firebaseapp.com',
  'b3-games.firebasestorage.app',
  'b3-games-default-rtdb.firebaseio.com',
  'us-central1-b3-games.cloudfunctions.net',
  'posuk-scorer.onrender.com',
  'nigrisync.onrender.com'
];

function configFromEnvironment(env) {
  const config = {
    apiKey: env.B3_STAGING_FIREBASE_API_KEY,
    authDomain: env.B3_STAGING_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.B3_STAGING_FIREBASE_DATABASE_URL,
    projectId: env.B3_STAGING_FIREBASE_PROJECT_ID,
    storageBucket: env.B3_STAGING_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.B3_STAGING_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.B3_STAGING_FIREBASE_APP_ID
  };
  const expectedDb = 'https://' + REQUIRED_PROJECT + '-default-rtdb.firebaseio.com';
  if (config.projectId !== REQUIRED_PROJECT ||
      config.authDomain !== REQUIRED_PROJECT + '.firebaseapp.com' ||
      config.databaseURL !== expectedDb ||
      typeof config.storageBucket !== 'string' ||
      !config.storageBucket.startsWith(REQUIRED_PROJECT + '.')) {
    throw new Error('Refusing to generate staging config: project, Auth, RTDB, or Storage does not match the approved staging project.');
  }
  for (const field of ['apiKey', 'messagingSenderId', 'appId']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) {
      throw new Error('Refusing to generate incomplete staging config: missing ' + field + '.');
    }
  }
  const serialized = JSON.stringify(config).toLowerCase();
  if (BLOCKED.some(value => serialized.includes(value))) {
    throw new Error('Refusing to generate staging config containing production Firebase or third-party values.');
  }
  return Object.freeze(config);
}

function renderConfigScript(config) {
  const validated = configFromEnvironment({
    B3_STAGING_FIREBASE_API_KEY: config.apiKey,
    B3_STAGING_FIREBASE_AUTH_DOMAIN: config.authDomain,
    B3_STAGING_FIREBASE_DATABASE_URL: config.databaseURL,
    B3_STAGING_FIREBASE_PROJECT_ID: config.projectId,
    B3_STAGING_FIREBASE_STORAGE_BUCKET: config.storageBucket,
    B3_STAGING_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId,
    B3_STAGING_FIREBASE_APP_ID: config.appId
  });
  return 'window.B3_STAGING_FIREBASE_CONFIG = Object.freeze(' + JSON.stringify(validated) + ');\n';
}

module.exports = { REQUIRED_PROJECT, configFromEnvironment, renderConfigScript };
