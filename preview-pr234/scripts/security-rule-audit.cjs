#!/usr/bin/env node
'use strict';

/*
 * Static guard for the Firebase Realtime Database rules in this repository.
 *
 * IMPORTANT: The October 15 baseline documents existing unsafe rules.
 * Passing this guard DOES NOT mean the database is secure, that these rules
 * have been deployed, or that the live data is backed up. It prevents new
 * unconditional public grants while the student-auth migration proceeds.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function collectUnconditionalGrants(node, parent = '') {
  const found = [];
  if (!node || typeof node !== 'object') return found;
  for (const [name, value] of Object.entries(node)) {
    if (name === '.read' || name === '.write') {
      if (value === true || (typeof value === 'string' && value.trim() === 'true')) {
        found.push({ path: parent || '/', permission: name });
      }
    } else if (value && typeof value === 'object') {
      found.push(...collectUnconditionalGrants(value, parent + '/' + name));
    }
  }
  return found;
}

function grantKey(entry) {
  return entry.path + '|' + entry.permission;
}

function isAncestorOrSame(prefix, destination) {
  if (prefix === '/') return true;
  return destination === prefix || destination.startsWith(prefix + '/');
}

function analyze(rules, baseline) {
  if (!rules || !rules.rules || typeof rules.rules !== 'object') {
    throw new Error('Invalid Firebase Realtime Database rules document.');
  }
  if (!baseline || !Array.isArray(baseline.permissions)) {
    throw new Error('Missing reviewed public-permissions baseline.');
  }
  const grants = collectUnconditionalGrants(rules.rules);
  const known = new Set(baseline.permissions.map(grantKey));
  const unexpected = grants.filter(entry => !known.has(grantKey(entry)));
  const sensitiveRoots = ['/b3Private', '/yiddishPrivate', '/studentRewards/privateAuth'];
  // RTDB ancestor grants override descendant restrictions, so check parents too.
  const sensitiveExposures = [];
  for (const sensitive of sensitiveRoots) {
    for (const grant of grants) {
      if (isAncestorOrSame(grant.path, sensitive) || isAncestorOrSame(sensitive, grant.path)) {
        sensitiveExposures.push({ sensitive, ...grant });
      }
    }
  }
  return { grants, unexpected, sensitiveExposures };
}


/*
 * Detect permission-expression drift, including changed conditional rules.
 * This is a review tripwire, not semantic proof of safety; reviewers must
 * validate any paired baseline update and the active deployed Firebase rules.
 */
function collectPermissionExpressions(node, parent = '') {
  const found = [];
  if (!node || typeof node !== 'object' || Array.isArray(node)) return found;
  for (const [name, value] of Object.entries(node)) {
    if (name === '.read' || name === '.write') {
      if (typeof value !== 'boolean' && typeof value !== 'string') {
        throw new Error('Invalid permission expression at ' + (parent || '/') + ' ' + name);
      }
      found.push({ path: parent || '/', permission: name, expression: value });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      found.push(...collectPermissionExpressions(value, parent + '/' + name));
    }
  }
  return found.sort((a,b) =>
    (a.path + '|' + a.permission).localeCompare(b.path + '|' + b.permission));
}

function compareReviewedPermissions(rules, reviewed) {
  if (!rules || !rules.rules || !reviewed || !Array.isArray(reviewed.permissions)) {
    throw new Error('Invalid database rules or reviewed permission baseline.');
  }
  const actual = collectPermissionExpressions(rules.rules);
  const expected = reviewed.permissions;
  const id = row => String(row.path) + '|' + String(row.permission);
  const expectedById = new Map();
  for (const row of expected) {
    if (!row || typeof row.path !== 'string' || !['.read','.write'].includes(row.permission)
        || !['string','boolean'].includes(typeof row.expression)
        || expectedById.has(id(row))) {
      throw new Error('Invalid or duplicate reviewed permission entry.');
    }
    expectedById.set(id(row), row.expression);
  }
  const actualById = new Map(actual.map(row => [id(row), row.expression]));
  const changed = [];
  for (const row of actual) {
    const key = id(row);
    if (!expectedById.has(key)) changed.push({ ...row, change: 'new' });
    else if (expectedById.get(key) !== row.expression) {
      changed.push({ ...row, change: 'modified' });
    }
  }
  for (const row of expected) {
    if (!actualById.has(id(row))) changed.push({ ...row, change: 'removed' });
  }
  return { total: actual.length, changed };
}

function main() {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-rules.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'security/public-permissions-baseline.json'), 'utf8'));
  const result = analyze(rules, baseline);
  const reviewed = JSON.parse(fs.readFileSync(path.join(ROOT, 'security/reviewed-permission-expressions.json'), 'utf8'));
  const drift = compareReviewedPermissions(rules, reviewed);
  const show = grant => grant.path + ' ' + grant.permission;
  console.log('Firebase rules audit: ' + result.grants.length + ' unconditional public grants (' + result.unexpected.length + ' new).');
  if (result.grants.length) {
    console.warn('SECURITY DEBT: existing public grants remain. Passing this check is NOT a security certification.');
    for (const grant of result.grants) console.warn('  PUBLIC ' + show(grant));
  }
  if (result.unexpected.length) {
    console.error('BLOCK: New public database permissions require removal or an explicit reviewed baseline change:');
    for (const grant of result.unexpected) console.error('  ' + show(grant));
  }
  if (result.sensitiveExposures.length) {
    console.error('BLOCK: A private backend or authentication data path would be publicly exposed:');
    for (const grant of result.sensitiveExposures) {
      console.error('  ' + grant.sensitive + ' via ' + show(grant));
    }
  }
  console.log('Reviewed permission expressions: ' + drift.total + ' (' + drift.changed.length + ' changes needing review).');
  if (drift.changed.length) {
    console.error('BLOCK: Database permission expressions changed without an updated reviewed baseline:');
    for (const row of drift.changed) {
      console.error('  ' + row.change.toUpperCase() + ' ' + row.path + ' ' + row.permission);
    }
  }
  if (result.grants.some(g => g.path === '/b3Games' && g.permission === '.read')) {
    console.warn('HIGH PRIORITY: /b3Games remains publicly readable, including any profiles or passcodes still stored there.');
  }
  if (result.unexpected.length || result.sensitiveExposures.length || drift.changed.length) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { collectUnconditionalGrants, analyze, isAncestorOrSame, collectPermissionExpressions, compareReviewedPermissions };
