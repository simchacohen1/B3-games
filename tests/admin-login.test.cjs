'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const pages = [
  'index.html',
  'preview-pointer-repair/index.html',
  'preview-pr234/student-home.html'
];

function authView(page, user, authorized) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const start = html.indexOf('  function renderAdminAuthState(){');
  const end = html.indexOf('\n  function syncAdminPanelLayout(){', start);
  assert.ok(start >= 0 && end > start, `${page} exposes the production admin auth view helper`);
  const source = html.slice(start, end);
  const nodes = Object.fromEntries(['signInButton', 'signOutButton', 'adminControls', 'adminStatus'].map(id => [id, {
    textContent: '',
    classes: new Set(),
    classList: {
      toggle(name, force) {
        const enabled = force === undefined ? !nodes[id].classes.has(name) : Boolean(force);
        if (enabled) nodes[id].classes.add(name);
        else nodes[id].classes.delete(name);
      }
    }
  }]));
  const context = { currentUser: user, isAuthorizedTeacher: authorized, el: id => nodes[id] };
  const result = vm.runInNewContext(`${source}\nrenderAdminAuthState();`, context);
  return { result, nodes };
}

for (const page of pages) {
  test(`${page}: signed-out visitors see Google sign-in, not admin controls`, () => {
    const { result, nodes } = authView(page, null, false);
    assert.equal(result, false);
    assert.equal(nodes.signInButton.classes.has('hidden'), false);
    assert.equal(nodes.signOutButton.classes.has('hidden'), true);
    assert.equal(nodes.adminControls.classes.has('hidden'), true);
    assert.match(nodes.adminStatus.textContent, /authorized Google account/);
  });

  test(`${page}: a signed-in but unauthorized account cannot see admin controls`, () => {
    const { result, nodes } = authView(page, { email: 'unauthorized@example.test' }, false);
    assert.equal(result, false);
    assert.equal(nodes.signInButton.classes.has('hidden'), true);
    assert.equal(nodes.signOutButton.classes.has('hidden'), false);
    assert.equal(nodes.adminControls.classes.has('hidden'), true);
    assert.match(nodes.adminStatus.textContent, /cannot edit settings/);
  });

  test(`${page}: Firebase-authorized teachers can proceed to their scoped controls`, () => {
    const { result, nodes } = authView(page, { email: 'teacher@example.test' }, true);
    assert.equal(result, true);
    assert.equal(nodes.signInButton.classes.has('hidden'), true);
    assert.equal(nodes.signOutButton.classes.has('hidden'), false);
    assert.equal(nodes.adminControls.classes.has('hidden'), false);
  });
}

test('inline website scripts still parse after the administrator login migration', () => {
  for (const relativePath of pages) {
    const html = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
    let checked = 0;
    for (const [, attributes, source] of scripts) {
      if (/\bsrc\s*=|\btype\s*=\s*["']module["']/i.test(attributes) || !source.trim()) continue;
      new vm.Script(source, { filename: relativePath });
      checked += 1;
    }
    assert.ok(checked > 0, `${relativePath} contains inline scripts to validate`);
  }
});
