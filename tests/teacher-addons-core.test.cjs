'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../teacher-addons-core.js');

test('add-on ids are generated in the format the database rules accept', () => {
  for (let i = 0; i < 50; i++) assert.ok(core.validId(core.newAddonId()));
  for (const bad of ['', 'ad_', 'ad_short', 'AD_abcdefgh12', 'ad_abc def gh12', 'x_abcdefgh12', 'ad_' + 'a'.repeat(41), null]) assert.equal(core.validId(bad), false, String(bad));
  // The same pattern is what the live and hardened rules require.
  for (const file of ['firebase-rules.json', 'firebase-rules.hardened.json']) {
    const owners = JSON.parse(fs.readFileSync(file, 'utf8')).rules.teacherAddons.owners.$addonId;
    assert.ok(owners['.validate'].includes('$addonId.matches(/^ad_[a-z0-9]{8,40}$/)'), file);
  }
});

test('a profile is cleaned to plain text, bounded, and limited to the classes the teacher teaches', () => {
  const ok = core.cleanProfile({ name: '  Times   Tables ', icon: '🧮', description: 'Practice', classIds: ['alpha', 'alpha'], version: 3 }, ['alpha', 'beta'], 10);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.profile, { name: 'Times Tables', icon: '🧮', classIds: { alpha: true }, version: 3, updatedAt: 10, description: 'Practice', createdAt: 10 });
  const html = core.cleanProfile({ name: '<img src=x onerror=alert(1)>', icon: '🧮', classIds: [] }, [], 1);
  assert.ok(!/[<>]/.test(html.profile.name));
  const bad = core.cleanProfile({ name: '', icon: '', classIds: ['gamma'] }, ['alpha']);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3);
  assert.equal(core.cleanProfile({ name: 'x'.repeat(200), icon: 'y'.repeat(99), classIds: ['alpha'] }, ['alpha']).profile.name.length, core.LIMITS.nameMax);
  assert.equal(core.cleanProfile({ name: 'x', icon: 'y', classIds: ['gamma'] }, null).ok, true, 'an admin may pick any class');
});

test('who may manage an add-on, and when it is switched off', () => {
  assert.equal(core.canManage('t1', 't1', false), true);
  assert.equal(core.canManage('t1', 't2', false), false);
  assert.equal(core.canManage('t1', 't2', true), true);
  assert.equal(core.canManage(null, 't2', false), false);
  assert.equal(core.status(null), 'live');
  assert.equal(core.status({ disabled: false }), 'live');
  assert.equal(core.status({ disabled: true }), 'switched-off');
});

// ---- The rules files (plain checks; the emulator test proves the behaviour) ----
const rulesOf = file => JSON.parse(fs.readFileSync(file, 'utf8')).rules;
for (const file of ['firebase-rules.json', 'firebase-rules.hardened.json']) {
  test(file + ': teacherAddons is private, students get nothing, and only the owner/admin can write the off switch', () => {
    const node = rulesOf(file).teacherAddons;
    assert.ok(node);
    const text = JSON.stringify(node);
    assert.ok(!text.includes('b3StudentId'), 'no rule mentions students');
    assert.ok(!/"\.(read|write)":\s*(true|"true")/.test(text), 'no public grant');
    assert.equal(node['.read'], undefined);
    assert.equal(node['.write'], undefined);
    assert.equal(node.$other['.validate'], false);
    const admin = node.admin.$addonId;
    assert.ok(admin['.write'].startsWith("(auth != null && auth.token.email == 'simcha5770@gmail.com'"));
    assert.ok(!admin['.write'].includes('teachers/'), 'a teacher cannot write the off switch');
    assert.equal(admin.$other['.validate'], false);
    assert.equal(node.profile.$addonId.$other['.validate'], false);
  });
}

test('the live rules and the hardened candidate carry exactly the same add-on rules', () => {
  assert.deepEqual(rulesOf('firebase-rules.json').teacherAddons, rulesOf('firebase-rules.hardened.json').teacherAddons);
});

test('the CI emulator run includes the add-on rules test', () => {
  assert.match(fs.readFileSync('.github/workflows/migration-checks.yml', 'utf8'), /node --test tests\/teacher-addons-rules-emulator\.test\.cjs/);
});
