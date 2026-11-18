'use strict';
// A staging-only page to sign in to the fictional test accounts (owner, teachers) with email and password.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'staging', 'owner-signin.template'), 'utf8');
const prepare = fs.readFileSync(path.join(root, 'staging', 'prepare-site.cjs'), 'utf8');

test('the page works only on the staging project and says so', () => {
  assert.match(page, /config\.projectId !== 'fun-torah-tools-staging'/);
  assert.match(page, /This page only works on the staging site/);
  assert.match(page, /STAGING ONLY/);
});

test('the staging build writes it as a page; the repository keeps it as a .template so the live site never serves it', () => {
  assert.match(prepare, /owner-signin\.template'\), path\.join\(stageDir, 'owner-signin\.html'\)/);
  assert.ok(!fs.existsSync(path.join(root, 'staging', 'owner-signin.html')));
});

test('no password is written in the page, the password is cleared after each try, and no production identity appears', () => {
  assert.doesNotMatch(page, /password"?\s*[:=]\s*['"][^'"]{3,}['"]/i);
  assert.match(page, /\$\('password'\)\.value = ''/);
  assert.ok(!/simcha5770|b3-games/i.test(page));
  assert.match(page, /value="owner@funtorahtools-staging\.test"/);
});

test('"next" can only be a page on this site, never another address', () => {
  const m = page.match(/var safeNext = (\/[\s\S]*?\/\.test\(next\) \|\| \/[\s\S]*?\/\.test\(next\)) \? next : ''/);
  assert.ok(m, 'safeNext rule found');
  const [, expr] = m;
  const [a, b] = expr.split('.test(next) || ');
  const re1 = eval(a), re2 = eval(b.replace('.test(next)', ''));
  const ok = s => re1.test(s) || re2.test(s);
  for (const good of ['../owner-admin.html', '../admin.html?tab=students', '/owner-admin.html']) assert.ok(ok(good), good);
  for (const bad of ['https://evil.example/x.html', '//evil.example/x.html', 'javascript:alert(1)', '../../x.html', '../a.html#"><script>', 'owner-admin.html', '']) assert.ok(!ok(bad), bad);
});
