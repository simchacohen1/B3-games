'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../school-scope.js');

const schools = {
  negri_shluchim: { name: 'Negri Shluchim Online School', syncsToNigri: true },
  day_school: { name: 'Example Day School', syncsToNigri: false }
};
const teacher = (extra = {}) => ({ email: 't@example.com', name: 'T', active: true, ...extra });

test('owner always sees Nigri, with or without a school', () => {
  assert.equal(S.nigriAccess({ isOwner: true }).allowed, true);
});

test('teacher in a school that syncs sees Nigri', () => {
  const r = S.nigriAccess({ invite: teacher({ schoolId: 'negri_shluchim' }), schools });
  assert.deepEqual([r.allowed, r.reason, r.schoolName], [true, 'ok', 'Negri Shluchim Online School']);
});

test('teacher in a school with sync off, with no school, or an unknown school sees nothing', () => {
  assert.equal(S.nigriAccess({ invite: teacher({ schoolId: 'day_school' }), schools }).reason, 'school-off');
  assert.equal(S.nigriAccess({ invite: teacher(), schools }).reason, 'no-school');
  assert.equal(S.nigriAccess({ invite: teacher({ schoolId: 'gone' }), schools }).reason, 'unknown-school');
  for (const id of ['day_school', undefined, 'gone']) assert.equal(S.nigriAccess({ invite: teacher({ schoolId: id }), schools }).allowed, false);
});

test('syncsToNigri must be exactly true', () => {
  const loose = { s: { name: 'S', syncsToNigri: 'yes' } };
  assert.equal(S.nigriAccess({ invite: teacher({ schoolId: 's' }), schools: loose }).allowed, false);
});

test('principals and disabled or missing invitations never see Nigri', () => {
  assert.equal(S.nigriAccess({ invite: teacher({ schoolId: 'negri_shluchim', accountType: 'principal' }), schools }).reason, 'principal');
  assert.equal(S.nigriAccess({ invite: teacher({ schoolId: 'negri_shluchim', active: false }), schools }).allowed, false);
  assert.equal(S.nigriAccess({ invite: null, schools }).allowed, false);
});

test('school ids are made from names and never clash', () => {
  assert.equal(S.newSchoolId('Example Day School', {}), 'example_day_school');
  assert.equal(S.newSchoolId('Example Day School', { example_day_school: {} }), 'example_day_school_2');
  assert.equal(S.newSchoolId('!!!', {}), 'school');
});

test('malformed school records are ignored', () => {
  const n = S.normalizeSchools({ ok: { name: ' A  b ' }, 'Bad Id': { name: 'x' }, empty: { name: '' }, junk: 5 });
  assert.deepEqual(n, { ok: { name: 'A b', syncsToNigri: false } });
});

test('one-time move puts everyone without a school (signed in or not, principals too) into the default school', () => {
  const invites = {
    a_example_com: { email: 'a@example.com', name: 'A', claimedUid: 'u1' },
    b_example_com: { email: 'b@example.com', name: 'B' },
    p_example_com: { email: 'p@example.com', name: 'P', accountType: 'principal' },
    c_example_com: { email: 'c@example.com', name: 'C', schoolId: 'day_school' }
  };
  const plan = S.planDefaultMove(invites, {}, 123);
  assert.equal(plan.createSchool, true);
  assert.deepEqual(plan.updates['schools/negri_shluchim'], { name: 'Negri Shluchim Online School', syncsToNigri: true, createdAt: 123, updatedAt: 123 });
  assert.deepEqual(plan.assign.map(x => x.inviteId), ['a_example_com', 'b_example_com', 'p_example_com']);
  assert.equal(plan.alreadyAssigned, 1);
  assert.equal(plan.updates['teacherInvites/c_example_com/schoolId'], undefined);
  // Only school fields are written; nothing else about a teacher changes.
  for (const k of Object.keys(plan.updates)) assert.match(k, /^(schools\/negri_shluchim|teacherInvites\/[a-z_]+\/schoolId)$/);
});

test('running the move again changes nothing', () => {
  const invites = { a: { email: 'a@example.com', schoolId: 'negri_shluchim' } };
  const plan = S.planDefaultMove(invites, { negri_shluchim: { name: 'Renamed', syncsToNigri: false } }, 1);
  assert.deepEqual(plan.updates, {});
  assert.equal(plan.schoolName, 'Renamed');
});

test('moving a teacher to another school marks the saved Nigri login for removal', () => {
  assert.deepEqual(S.planMoveTeacher('a', { schoolId: 'negri_shluchim' }, 'day_school', 9),
    { 'teacherInvites/a/schoolId': 'day_school', 'teacherInvites/a/nigriLoginResetAt': 9 });
  assert.deepEqual(S.planMoveTeacher('a', {}, 'day_school', 9), { 'teacherInvites/a/schoolId': 'day_school' });
  assert.deepEqual(S.planMoveTeacher('a', { schoolId: 'day_school' }, 'day_school', 9), {});
  assert.equal(S.planMoveTeacher('a', {}, 'Bad Id', 9), null);
});

test('counting teachers per school', () => {
  assert.deepEqual(S.countBySchool({ a: { schoolId: 'x' }, b: { schoolId: 'x' }, c: {} }), { x: 2 });
});

function fakeDb(data) {
  return { ref: path => ({ once: async () => ({ val: () => (path in data ? data[path] : null) }) }) };
}
const WS = 'b3Games/workspaces/b3-2026';

test('checkNigri: owner by verified email, without any reads', async () => {
  const r = await S.checkNigri({ db: fakeDb({}), user: { uid: 'o', email: 'simcha5770@gmail.com', emailVerified: true } });
  assert.equal(r.allowed, true);
  const unverified = await S.checkNigri({ db: fakeDb({}), user: { uid: 'o', email: 'simcha5770@gmail.com', emailVerified: false } });
  assert.equal(unverified.allowed, false);
});

test('checkNigri: teacher found through the invitation linked to their account', async () => {
  const db = fakeDb({
    [WS + '/teachers/u1']: { inviteId: 't_example_com', active: true },
    [WS + '/teacherInvites/t_example_com']: teacher({ schoolId: 'negri_shluchim' }),
    [WS + '/schools/negri_shluchim']: schools.negri_shluchim
  });
  assert.equal((await S.checkNigri({ db, user: { uid: 'u1', email: 't@example.com', emailVerified: true } })).allowed, true);
});

test('checkNigri: an invitation that belongs to a different email is refused', async () => {
  const db = fakeDb({
    [WS + '/teachers/u1']: { inviteId: 'other_example_com', active: true },
    [WS + '/teacherInvites/other_example_com']: { email: 'other@example.com', schoolId: 'negri_shluchim' },
    [WS + '/schools/negri_shluchim']: schools.negri_shluchim
  });
  assert.equal((await S.checkNigri({ db, user: { uid: 'u1', email: 't@example.com', emailVerified: true } })).allowed, false);
});

test('checkNigri: school with sync off is refused; signed-out is refused', async () => {
  const db = fakeDb({
    [WS + '/teacherInvites/t_example_com']: teacher({ schoolId: 'day_school' }),
    [WS + '/schools/day_school']: schools.day_school
  });
  assert.equal((await S.checkNigri({ db, user: { uid: 'u1', email: 't@example.com', emailVerified: true } })).reason, 'school-off');
  assert.equal((await S.checkNigri({ db, user: null })).reason, 'signed-out');
});
