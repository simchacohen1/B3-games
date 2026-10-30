'use strict';
// DRAFT/RED: fictional-only server-side principal revocation regression.
// Unlike site-settings.js tests, these execute the actual Chazara backend
// requireTeacher authorization function. No Firebase network or live data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const teacherScope = require('../backend/functions/teacher-class-scope');

const ROOT = 'b3Games/workspaces/b3-2026';
const source = fs.readFileSync('backend/functions/student-rewards-auto-award.js', 'utf8');
const start = source.indexOf('async function requireTeacher(req){');
const end = source.indexOf('async function authorizeChazaraAction(', start);
assert.ok(start >= 0 && end > start, 'Real Chazara teacher authorizer must be located');
const buildAuthorizer = new Function(
  'admin', 'rtdb', 'teacherClassScope', 'ADMIN_EMAIL', 'console',
  source.slice(start, end) + '\nreturn requireTeacher;'
);

function baseData() {
  return {
    [ROOT + '/teachers/principal']: {
      active: true, accountType: 'principal', classIds: { alpha: true },
      supervisedTeachers: { teacherA: { classIds: { alpha: true } } }
    },
    [ROOT + '/classes/alpha']: {
      active: true, toolGrants: { chazara: true },
      members: { fictional_child: { active: true } }
    },
    'b3Games/students/fictional_child/profile': {
      name: 'Fictional Child', active: true
    },
    'b3Games/students/fictional_child/memberships': {
      a: { workspaceId: 'b3-2026', classId: 'alpha', active: true }
    }
  };
}

async function authorize(data, uid = 'principal') {
  const reads = [];
  const rtdb = { ref(path) {
    return { get: async () => {
      reads.push(path);
      return { val: () => Object.prototype.hasOwnProperty.call(data, path)
        ? data[path] : null };
    } };
  } };
  const admin = { auth: () => ({ verifyIdToken: async () => ({
    uid, email: uid + '@example.test', email_verified: true
  }) }) };
  const fn = buildAuthorizer(admin, rtdb, teacherScope, 'owner@example.test', console);
  const result = await fn({
    headers: { authorization: 'Bearer fictional' },
    body: { action: 'list-chazara-pending', classId: 'alpha' }
  });
  return { result, reads };
}

test('RED: principal Chazara API denies disabled sole supervised teacher despite stale classIds', async () => {
  const data = baseData();
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: false, role: 'teacher', classIds: { alpha: true }
  };
  const { result } = await authorize(data);
  assert.equal(result.ok, false,
    'backend must not authorize a principal from stale classIds after supervisor disablement');
});

test('RED: principal Chazara API denies class removed from active supervisor', async () => {
  const data = baseData();
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: true, role: 'teacher', classIds: { beta: true }
  };
  const { result } = await authorize(data);
  assert.equal(result.ok, false,
    'backend must intersect principal classIds with live supervised teacher classes');
});

test('control: principal with a live supervised teacher retains their valid class', async () => {
  const data = baseData();
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: true, role: 'teacher', classIds: { alpha: true }
  };
  const { result } = await authorize(data);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.scope.selected, 'alpha');
  assert.ok(result.scope.students.fictional_child);
});

test('control: ordinary assigned teacher retains legitimate Chazara access', async () => {
  const data = baseData();
  data[ROOT + '/teachers/teacher'] = { active: true, classIds: { alpha: true } };
  const { result } = await authorize(data, 'teacher');
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.scope.selected, 'alpha');
});
