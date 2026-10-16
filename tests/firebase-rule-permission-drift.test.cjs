'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  collectPermissionExpressions,
  compareReviewedPermissions
} = require('../scripts/security-rule-audit.cjs');

const repo = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(repo, name), 'utf8'));
const reviewed = rules => ({ permissions: collectPermissionExpressions(rules.rules) });

test('all 99 repository permission expressions match their reviewed baseline', () => {
  const result = compareReviewedPermissions(
    read('firebase-rules.json'),
    read('security/reviewed-permission-expressions.json')
  );
  assert.equal(result.total, 99);
  assert.deepEqual(result.changed, []);
});

test('weakening a conditional teacher class rule is detected', () => {
  const rules = { rules: { classes: { '.read': "auth != null && auth.uid == 'assigned'" } } };
  const baseline = reviewed(rules);
  rules.rules.classes['.read'] = 'auth != null';
  assert.deepEqual(compareReviewedPermissions(rules, baseline).changed.map(x => x.change), ['modified']);
});

test('changing an existing false permission to public true is detected', () => {
  const rules = { rules: { confidential: { '.write': false } } };
  const baseline = reviewed(rules);
  rules.rules.confidential['.write'] = true;
  assert.deepEqual(compareReviewedPermissions(rules, baseline).changed.map(x => x.change), ['modified']);
});

test('adding a new conditional permission requires review too', () => {
  const rules = { rules: { students: { '.read': false } } };
  const baseline = reviewed(rules);
  rules.rules.students['.write'] = "auth != null";
  assert.deepEqual(compareReviewedPermissions(rules, baseline).changed.map(x => x.change), ['new']);
});

test('removing a permission rule requires deliberate review', () => {
  const rules = { rules: { students: { '.read': "auth != null" } } };
  const baseline = reviewed(rules);
  delete rules.rules.students['.read'];
  assert.deepEqual(compareReviewedPermissions(rules, baseline).changed.map(x => x.change), ['removed']);
});

test('reject duplicate or invalid reviewed entries rather than silently overwrite', () => {
  const rules = { rules: { students: { '.read': 'auth != null' } } };
  const baseline = reviewed(rules);
  baseline.permissions.push({ ...baseline.permissions[0] });
  assert.throws(() => compareReviewedPermissions(rules, baseline), /duplicate/);
  baseline.permissions.pop();
  baseline.permissions[0].expression = null;
  assert.throws(() => compareReviewedPermissions(rules, baseline), /Invalid/);
});
