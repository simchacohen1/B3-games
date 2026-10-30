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
      email: 'principal@example.test', inviteId: 'principalInvite',
      supervisedTeachers: { teacherA: { classIds: { alpha: true } } }
    },
    [ROOT + '/teacherInvites/principalInvite']: {
      active: true, accountType: 'principal', email: 'principal@example.test',
      claimedUid: 'principal', classIds: { alpha: true },
      supervisedTeacherIds: { teacherA: true }
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


test('principal retains a class supervised by a second active teacher', async () => {
  const data = baseData();
  data[ROOT + '/teachers/principal'].supervisedTeachers.teacherB = {
    classIds: { alpha: true }
  };
  data[ROOT + '/teacherInvites/principalInvite'].supervisedTeacherIds.teacherB = true;
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: false, role: 'teacher', classIds: { alpha: true }
  };
  data[ROOT + '/teacherInvites/teacherB'] = {
    active: true, role: 'teacher', classIds: { alpha: true }
  };
  const { result, reads } = await authorize(data);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.scope.selected, 'alpha');
  assert.ok(reads.includes(ROOT + '/teacherInvites/teacherB'));
  assert.ok(!reads.includes(ROOT + '/teacherInvites'),
    'authorization must read named supervisors, not enumerate all invitations');
});

test('principal denies a disabled claimed supervisor even with an active invitation', async () => {
  const data = baseData();
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: true, role: 'teacher', classIds: { alpha: true }, claimedUid: 'claimedA'
  };
  data[ROOT + '/teachers/claimedA'] = {
    active: false, classIds: { alpha: true }
  };
  const { result, reads } = await authorize(data);
  assert.equal(result.ok, false);
  assert.ok(reads.includes(ROOT + '/teachers/claimedA'));
});

test('principal denies missing supervisors rather than trusting cached classIds', async () => {
  const data = baseData();
  data[ROOT + '/teachers/principal'].supervisedTeachers = {};
  const { result } = await authorize(data);
  assert.equal(result.ok, false);
});

test('principal denies an expired claimed teacher class while retaining ordinary teacher access', async () => {
  const data = baseData();
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: true, role: 'teacher', classIds: { alpha: true }, claimedUid: 'claimedA'
  };
  data[ROOT + '/teachers/claimedA'] = {
    active: true, classIds: { beta: true }
  };
  const principalResult = await authorize(data);
  assert.equal(principalResult.result.ok, false);
  data[ROOT + '/teachers/teacher'] = { active: true, classIds: { alpha: true } };
  const teacherResult = await authorize(data, 'teacher');
  assert.equal(teacherResult.result.ok, true, JSON.stringify(teacherResult.result));
});


test('principal loses Chazara access immediately when owner unassigns sole supervisor', async () => {
  const data = baseData();
  data[ROOT + '/teacherInvites/principalInvite'].supervisedTeacherIds = {};
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: true, role: 'teacher', classIds: { alpha: true }
  };
  const { result, reads } = await authorize(data);
  assert.equal(result.ok, false, 'stale cached supervision must not override owner removal');
  assert.ok(reads.includes(ROOT + '/teacherInvites/principalInvite'));
});

test('principal denies revoked or missing own invitation even with stale teacher record', async () => {
  for (const mode of ['inactive', 'missing']) {
    const data = baseData();
    data[ROOT + '/teacherInvites/teacherA'] = {
      active: true, role: 'teacher', classIds: { alpha: true }
    };
    if (mode === 'inactive') data[ROOT + '/teacherInvites/principalInvite'].active = false;
    else delete data[ROOT + '/teacherInvites/principalInvite'];
    const { result } = await authorize(data);
    assert.equal(result.ok, false, mode);
  }
});

test('principal denies mismatched claimed UID or invitation email', async () => {
  for (const mode of ['claimedUid', 'email']) {
    const data = baseData();
    data[ROOT + '/teacherInvites/teacherA'] = {
      active: true, role: 'teacher', classIds: { alpha: true }
    };
    data[ROOT + '/teacherInvites/principalInvite'][mode] = mode === 'claimedUid'
      ? 'anotherPrincipal' : 'another@example.test';
    const { result } = await authorize(data);
    assert.equal(result.ok, false, mode);
  }
});

test('principal denies a class removed from their own invitation before reconciliation', async () => {
  const data = baseData();
  data[ROOT + '/teacherInvites/principalInvite'].classIds = {};
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: true, role: 'teacher', classIds: { alpha: true }
  };
  const { result } = await authorize(data);
  assert.equal(result.ok, false);
});

test('principal keeps alpha through another owner-assigned active supervisor', async () => {
  const data = baseData();
  data[ROOT + '/teachers/principal'].supervisedTeachers.teacherB = {
    classIds: { alpha: true }
  };
  data[ROOT + '/teacherInvites/principalInvite'].supervisedTeacherIds = { teacherB: true };
  data[ROOT + '/teacherInvites/teacherA'] = {
    active: true, role: 'teacher', classIds: { alpha: true }
  };
  data[ROOT + '/teacherInvites/teacherB'] = {
    active: true, role: 'teacher', classIds: { alpha: true }
  };
  const { result } = await authorize(data);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.scope.selected, 'alpha');
});
