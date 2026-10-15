'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyze, collectUnconditionalGrants } = require('../scripts/security-rule-audit.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('current committed rules have no newly added public grants', () => {
  const result = analyze(read('firebase-rules.json'), read('security/public-permissions-baseline.json'));
  assert.deepEqual(result.unexpected, []);
  assert.deepEqual(result.sensitiveExposures, []);
  // Explicitly acknowledge the debt: this test does not certify safe rules.
  assert.ok(result.grants.length > 0);
});

test('adding public access to a new student or teacher path fails the guard', () => {
  const rules = { rules: { students: { '.read': true, '.write': true } } };
  const result = analyze(rules, { permissions: [] });
  assert.deepEqual(result.unexpected, [
    { path: '/students', permission: '.read' },
    { path: '/students', permission: '.write' }
  ]);
});

test('an open parent grants access even when a child rule appears to deny it', () => {
  const rules = { rules: {
    '.read': true,
    b3Private: { '.read': false, passcodes: { '.read': 'auth != null' } }
  } };
  const result = analyze(rules, { permissions: [{ path: '/', permission: '.read' }] });
  assert.ok(result.sensitiveExposures.some(e => e.sensitive === '/b3Private'));
});

test('private backend paths stay blocked by default', () => {
  const rules = { rules: {
    b3Games: { '.read': true },
    b3Private: { '.read': false, '.write': false },
    yiddishPrivate: { '.read': 'auth != null' }
  } };
  const result = analyze(rules, { permissions: [{ path: '/b3Games', permission: '.read' }] });
  assert.deepEqual(result.sensitiveExposures, []);
});

test('string true counts as public and rules without permissions reject by default', () => {
  const grants = collectUnconditionalGrants({
    open: { '.write': '  true  ' },
    closed: { '.read': 'auth != null' }
  });
  assert.deepEqual(grants, [{ path: '/open', permission: '.write' }]);
});

test('a reviewed restriction cannot be bypassed by exposing its parent', () => {
  const rules = { rules: {
    studentRewards: {
      '.read': true,
      privateAuth: { '.read': false, '.write': false }
    }
  } };
  const result = analyze(rules, { permissions: [{ path: '/studentRewards', permission: '.read' }] });
  assert.ok(result.sensitiveExposures.some(e => e.sensitive === '/studentRewards/privateAuth'));
});
