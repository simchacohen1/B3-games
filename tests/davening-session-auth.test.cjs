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
