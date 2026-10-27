'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const adminPages = [
  'index.html',
  'preview-pointer-repair/index.html',
  'preview-pr234/student-home.html'
];

test('administrator pages contain no legacy shared-password gate or hash', () => {
  for (const relativePath of adminPages) {
    const html = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert.doesNotMatch(html, /const\s+\w*(?:PASSWORD|PASSCODE)\w*(?:HASH|DIGEST)\s*=\s*["'][a-f0-9]{32,128}["']/i);
    assert.doesNotMatch(html, /sessionStorage\.(?:getItem|setItem|removeItem)\(["']b3AdminPasswordUnlocked["']\)/);
    assert.doesNotMatch(html, /id=["']admin[a-z0-9_-]*password(?:input|button|gate|unlocked)["']/i);
    assert.match(html, /id="signInButton" class="admin-action"/);
    assert.match(html, /settingsApi\.signInWithGoogle\(\)/);
    assert.match(html, /el\("adminControls"\)\.classList\.toggle\("hidden",!isAuthorizedTeacher\)/);
    assert.match(html, /if\(!signedIn\).*authorized Google account/s);
  }
});

test('server-side rules retain verified owner and active administrator checks', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-rules.json'), 'utf8')).rules.b3Games;
  assert.match(rules.admins['.write'], /auth\.token\.email_verified\s*==\s*true/);
  assert.match(rules.admins['.write'], /auth\.token\.email\s*==/);
  assert.match(rules.siteSettings['.write'], /auth\.token\.email_verified\s*==\s*true/);
  assert.match(rules.siteSettings['.write'], /admins\/.*active/);
});

test('sensitive admin functions verify Firebase identity tokens and server-side roles', () => {
  const shareAuth = fs.readFileSync(path.join(ROOT, 'backend/functions/class-pointer-share-auth.js'), 'utf8');
  const privateMedia = fs.readFileSync(path.join(ROOT, 'backend/functions/private-media-url.js'), 'utf8');
  assert.match(shareAuth, /admin\.auth\(\)\.verifyIdToken\(/);
  assert.match(shareAuth, /b3Games\/admins/);
  assert.match(privateMedia, /admin\.auth\(\)\.verifyIdToken\(/);
  assert.match(privateMedia, /b3Games\/admins/);
});

test('Pages configuration excludes backend source while retaining public shared helpers', () => {
  const config = fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8');
  for (const folder of ['backend', 'preview-pointer-repair/backend', 'preview-pr234/backend']) {
    assert.ok(config.includes(`- ${folder}`), `${folder} is excluded from the Pages build`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'shared/student-tool-policy.js')));
});

test('all installer entry points default to the main backend project', () => {
  const installers = [
    'backend/install-chazara-scope.ps1',
    'backend/install-login-fixes.ps1',
    'backend/install-migration.ps1'
  ];
  for (const installer of installers) {
    assert.match(fs.readFileSync(path.join(ROOT, installer), 'utf8'), /ProjectDirectory\s*=\s*\$PSScriptRoot/);
  }
  for (const installer of [
    'preview-pointer-repair/backend/install-chazara-scope.ps1',
    'preview-pointer-repair/backend/install-login-fixes.ps1',
    'preview-pointer-repair/backend/install-migration.ps1'
  ]) {
    const source = fs.readFileSync(path.join(ROOT, installer), 'utf8');
    assert.match(source, /ProjectDirectory\s*=\s*\(Join-Path\s+\$PSScriptRoot\s+'\.\.\\\.\.\\backend'\)/);
    assert.doesNotMatch(source, /C:\\B3-Games-Backend/);
  }
});

test('public preview entry pages leave Firebase Auth storage to the Firebase SDK', () => {
  for (const page of [
    'preview-pointer-repair/index.html',
    'preview-pr234/student-home.html',
    'preview-pr234/teacher-home.html',
    'preview-pr234/shorashim/index.html'
  ]) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.doesNotMatch(html, /indexedDB\s*\.\s*open\s*\(\s*["']firebaseLocalStorageDb["']/);
    assert.doesNotMatch(html, /window\.currentUserSession/);
    assert.match(html, /firebase-auth(-compat)?\.js/);
  }
});
