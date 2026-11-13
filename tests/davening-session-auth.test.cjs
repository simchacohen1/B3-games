'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize } = require('../backend/functions/davening-session-auth.cjs');

function fixture(overrides = {}) {
  const values = {
    'b3Games/workspaces/b3-2026/classes/et/active': true,
    'b3Games/workspaces/b3-2026/classes/et/toolGrants': { davening: true },
    'b3Games/workspaces/b3-2026/classes/et/members/boy-a': { active: true, name: 'Ari Example' },
    'b3Games/students/boy-a/profile': { active: true, name: 'Ari Example', classId: 'et' },
    'b3Games/students/boy-a/memberships': { m1: { workspaceId: 'b3-2026', classId: 'et', active: true } },
    'b3Games/workspaces/b3-2026/classes/et': { active: true, toolGrants: { davening: true } },
    'b3Games/workspaces/b3-2026/teachers/teacher-a': { active: true, classIds: { et: true } },
    'b3Games/admins/teacher-a': null
  };
  return async path => overrides[path] !== undefined ? overrides[path] : values[path] ?? null;
}

test('student must have active ET membership and the Davening tool grant', async () => {
  const get = fixture();
  const identity = { uid: 'auth-a', b3StudentRole: 'student', b3StudentId: 'boy-a', b3ClassId: 'et' };
  assert.deepEqual(await authorize(get, identity, 'et'), {
    role: 'student', classId: 'et', studentId: 'boy-a', name: 'Ari Example'
  });
  await assert.rejects(authorize(get, identity, 'wt'), /Active Davening class access/);
  await assert.rejects(authorize(fixture({
    'b3Games/workspaces/b3-2026/classes/et/toolGrants': { davening: false }
  }), identity, 'et'), /Active Davening class access/);
});

test('teacher access is limited to verified Google teachers assigned to the requested class', async () => {
  const identity = { uid: 'teacher-a', email: 'teacher@example.com', email_verified: true,
    firebase: { sign_in_provider: 'google.com' } };
  assert.deepEqual(await authorize(fixture(), identity, 'et'), { role: 'teacher', classId: 'et' });
  await assert.rejects(authorize(fixture({
    'b3Games/workspaces/b3-2026/teachers/teacher-a': { active: true, classIds: { wt: true } }
  }), identity, 'et'), /Active Davening class access/);
  await assert.rejects(authorize(fixture(), { ...identity, email_verified: false }, 'et'), /Active Davening class access/);
});

test('production never accepts a password teacher, even one marked as a staging account', async () => {
  const identity = { uid: 'teacher-a', email: 'teacher@example.com', email_verified: true,
    b3StagingAccount: true, firebase: { sign_in_provider: 'password' } };
  await assert.rejects(authorize(fixture(), identity, 'et'), /Active Davening class access/);
});

test('the staging build maps each page to one fictional class and accepts its test teachers', async () => {
  const { deploymentSource } = require('../staging/build-davening-functions.cjs');
  const load = project => {
    const module = { exports: {} };
    new Function('module', 'process', deploymentSource())(module, { env: { GCLOUD_PROJECT: project } });
    return module.exports;
  };
  const staging = load('fun-torah-tools-staging');
  const get = async path => ({
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF': { active: true, toolGrants: { davening: true } },
    'b3Games/workspaces/b3-2026/classes/TEST-BEIS': { active: true, toolGrants: { davening: true } },
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF/active': true,
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF/toolGrants': { davening: true },
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF/members/boy-a': { active: true, name: 'Test Student' },
    'b3Games/students/boy-a/profile': { active: true, name: 'Test Student', classId: 'TEST-ALEF' },
    'b3Games/students/boy-a/memberships': { m1: { workspaceId: 'b3-2026', classId: 'TEST-ALEF', active: true } },
    'b3Games/workspaces/b3-2026/teachers/teacher-a': { active: true, classIds: { 'TEST-ALEF': true } }
  })[path] ?? null;
  const teacher = { uid: 'teacher-a', email: 'teacher.alef@funtorahtools-staging.test', email_verified: true,
    b3StagingAccount: true, firebase: { sign_in_provider: 'password' } };
  assert.deepEqual(await authorize(get, teacher, 'et', staging), { role: 'teacher', classId: 'TEST-ALEF' });
  // The same teacher is not assigned to the WT page's class.
  await assert.rejects(authorize(get, teacher, 'wt', staging), /Active Davening class access/);
  // A password account without the staging marker is refused.
  await assert.rejects(authorize(get, { ...teacher, b3StagingAccount: false }, 'et', staging), /Active Davening class access/);
  // Class ids are never taken from the request: only the two page names are accepted.
  await assert.rejects(authorize(get, teacher, 'TEST-ALEF', staging), /Active Davening class access/);
  await assert.rejects(authorize(get, teacher, '__proto__', staging), /Active Davening class access/);
  const student = { uid: 'auth-a', b3StudentRole: 'student', b3StudentId: 'boy-a', b3ClassId: 'TEST-ALEF' };
  assert.equal((await authorize(get, student, 'et', staging)).classId, 'TEST-ALEF');
  await assert.rejects(authorize(get, student, 'wt', staging), /Active Davening class access/);
  // The same generated settings refuse everyone anywhere but the staging project.
  const elsewhere = load('b3-games');
  assert.deepEqual(elsewhere.classMap, {});
  assert.equal(elsewhere.stagingPasswordTeachers, false);
  await assert.rejects(authorize(get, teacher, 'et', elsewhere), /Active Davening class access/);
});

test('the staging build contains only the Davening code and its two small dependencies', () => {
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const { build, COPIED } = require('../staging/build-davening-functions.cjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'davening-staging-'));
  try {
    const result = build(out);
    assert.deepEqual(result.functions, ['daveningChazzan', 'daveningChayus']);
    assert.deepEqual(fs.readdirSync(out).sort(),
      [...COPIED, 'davening-deployment.cjs', 'index.js', 'package.json', 'package-lock.json'].sort());
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).dependencies).sort(),
      ['firebase-admin', 'firebase-functions']);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
