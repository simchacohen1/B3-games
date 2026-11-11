'use strict';
// Package only the new center; never copy the whole site or Firebase backend.
const fs = require('node:fs');
const path = require('node:path');
const PROJECT = 'fun-torah-tools-staging';
if (process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('Explicit staging project required.');
(async () => {
  const output = path.resolve('.kriah-preview');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Use an empty .kriah-preview directory.');
  fs.mkdirSync(path.join(output, 'staging'), { recursive: true });
  fs.cpSync('kriah-assessment', path.join(output, 'kriah-assessment'), { recursive: true });
  const response = await fetch('https://fun-torah-tools-staging.web.app/staging/firebase-config.generated.js');
  if (!response.ok) throw new Error('Existing staging public config unavailable.');
  const text = await response.text();
  const vm = require('node:vm'), context = { window: {} };
  vm.runInNewContext(text, context, { timeout: 1000 });
  const cfg = context.window.B3_STAGING_FIREBASE_CONFIG;
  if (cfg?.projectId !== PROJECT || cfg.authDomain !== PROJECT + '.firebaseapp.com' || cfg.databaseURL !== 'https://' + PROJECT + '-default-rtdb.firebaseio.com' || ![PROJECT + '.firebasestorage.app', PROJECT + '.appspot.com'].includes(cfg.storageBucket)) throw new Error('Refused non-staging public config.');
  fs.writeFileSync(path.join(output, 'staging/firebase-config.generated.js'), 'window.B3_STAGING_FIREBASE_CONFIG = Object.freeze(' + JSON.stringify(cfg) + ');\n');
  console.log('Packaged only Kriah center and validated staging public config. No production or backend files.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
