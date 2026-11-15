#!/usr/bin/env node
'use strict';
// Builds quick sign-in links for FICTIONAL TEST STUDENTS (issue #619) and,
// optionally, a .bat file that opens each one in its own private window.
//
//   One link:
//     node scripts/make-test-login-link.cjs --name "Test Student A1" --passcode 1234 [--site https://fun-torah-tools-staging.web.app/]
//   Every student in a staging credentials file, written to a .bat file:
//     node scripts/make-test-login-link.cjs --from staging/test-credentials.local.json --bat staging/test-students.local.bat
//
// The links contain the passcode (encoded, not encrypted). Keep them and the
// .bat file on your own computer; never commit or post them. Files ending in
// .local.bat inside staging/ are already ignored by git.
const fs = require('node:fs');
const path = require('node:path');
const linkTools = require('../test-login-link.js');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function batFile(rows) {
  // Chrome incognito keeps each test student apart from a signed-in teacher.
  // "%%" is how a .bat file writes a single "%".
  const lines = ['@echo off', 'REM Fun Torah Tools test students only. Do not share this file.'];
  rows.forEach((row, i) => {
    lines.push('REM ' + row.name);
    lines.push('start "" chrome --incognito --new-window "' + row.url.replace(/%/g, '%%') + '"');
    if (i < rows.length - 1) lines.push('timeout /t 2 /nobreak >nul');
  });
  return lines.join('\r\n') + '\r\n';
}

function main() {
  const from = arg('from');
  let site = arg('site');
  let rows;
  if (from) {
    const data = JSON.parse(fs.readFileSync(from, 'utf8'));
    site = site || data.website || 'https://fun-torah-tools-staging.web.app/';
    rows = (data.studentAccounts || []).map(s => ({ name: s.name, url: linkTools.link(site, s.name, s.passcode) }));
  } else {
    const name = arg('name');
    const passcode = arg('passcode');
    if (!name || !passcode) {
      console.error('Usage: --name "Test Student" --passcode 1234 [--site URL]  or  --from credentials.json [--bat out.bat]');
      process.exit(2);
    }
    rows = [{ name, url: linkTools.link(site || 'https://funtorahtools.com/', name, passcode) }];
  }
  const bat = arg('bat');
  if (bat) {
    fs.writeFileSync(bat, batFile(rows));
    console.log('Wrote ' + rows.length + ' link(s) to ' + path.resolve(bat));
  } else {
    rows.forEach(row => console.log(row.name + '\n' + row.url + '\n'));
  }
}

if (require.main === module) main();
module.exports = { batFile };
