// The staging check for the Class Pointer teacher dashboard's fictional data: it must find every gap
// and only ever fill blanks (never overwrite), and it must stay locked to the staging project.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { diagnose, diagnoseGoogleTeacher, checkGoogleTeacher, inviteIdFor, spawnOptions, PROJECT } = require('../staging/class-pointer-test-data.cjs');

const ws = 'b3-2026', uid = 'uidA';
const role = { email: 'teacher.alef@funtorahtools-staging.test', displayName: 'Test Teacher Alef', classId: 'TEST-ALEF', className: 'Test Class Alef',
  students: [{ id: 's1', name: 'Test Student A1' }, { id: 's2', name: 'Test Student A2' }] };
const good = () => ({
  teacher: { uid, active: true, classIds: { 'TEST-ALEF': true } },
  cls: { active: true, toolGrants: { 'class-pointer': true }, teacherIds: { [uid]: true }, members: { s1: { active: true }, s2: { active: true } } },
  students: { s1: { profile: {}, membership: {} }, s2: { profile: {}, membership: {} } }, passcodes: { s1: true, s2: true }
});
const run = have => diagnose({ workspaceId: ws, role, uid, have });

test('complete data: no problems, nothing to write', () => {
  const r = run(good()); assert.deepEqual(r.problems, []); assert.deepEqual(r.patch, {});
});
test('nothing seeded: finds every gap and writes one non-overlapping update', () => {
  const r = run({ teacher: null, cls: null, students: {}, passcodes: {} });
  const paths = Object.keys(r.patch);
  assert.ok(r.problems.length >= 6);
  assert.equal(r.patch['b3Games/workspaces/b3-2026/classes/TEST-ALEF'].toolGrants['class-pointer'], true);
  assert.deepEqual(Object.keys(r.patch['b3Games/workspaces/b3-2026/classes/TEST-ALEF'].members), ['s1', 's2']);
  for (const a of paths) for (const b of paths) if (a !== b) assert.ok(!b.startsWith(a + '/'), a + ' overlaps ' + b);
  assert.ok(r.problems.some(p => /no passcode/.test(p)) && !paths.some(p => /passcode/i.test(p)), 'passcodes are reported, never written');
});
test('teacher inactive, class tool off, student missing: fills only those blanks', () => {
  const h = good(); h.teacher.active = false; delete h.cls.toolGrants['class-pointer']; delete h.cls.members.s2;
  const r = run(h);
  assert.deepEqual(Object.keys(r.patch).sort(), [
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF/members/s2',
    'b3Games/workspaces/b3-2026/classes/TEST-ALEF/toolGrants/class-pointer',
    'b3Games/workspaces/b3-2026/teachers/uidA/active'].sort());
});
test('never overwrites: existing values and other classes are left alone', () => {
  const h = good(); h.teacher.classIds = { 'OTHER': true };
  const r = run(h);
  assert.deepEqual(Object.keys(r.patch), ['b3Games/workspaces/b3-2026/teachers/uidA/classIds/TEST-ALEF']);
});
test('locked to the staging project and never prints credentials', () => {
  assert.equal(PROJECT, 'fun-torah-tools-staging');
  const src = fs.readFileSync('staging/class-pointer-test-data.cjs', 'utf8');
  assert.doesNotMatch(src, /b3-games\.firebaseio|b3-games-default-rtdb|b3-games\.firebaseapp/);
  assert.doesNotMatch(src, /console\.log\([^)]*(password|passcode\b)/i);
});

test('gcloud is started through a shell on Windows only (gcloud.cmd), never on Mac/Linux', () => {
  assert.equal(spawnOptions('win32').shell, true);
  assert.equal(spawnOptions('linux').shell, false);
  assert.equal(spawnOptions('darwin').shell, false);
});

// ---- --google-teacher: make a real Google account a teacher of the fictional class (staging only) ----
const googleUser = { email: 'me@gmail.com', emailVerified: true, providerUserInfo: [{ providerId: 'google.com' }] };
const gRole = { ...role };
const gRun = have => diagnoseGoogleTeacher({ workspaceId: ws, role: gRole, email: 'Me@Gmail.com', uid: 'googleUid', displayName: 'Me', have });
const gHave = () => ({ ...good(), teacher: { uid: 'googleUid', active: true, classIds: { 'TEST-ALEF': true } }, invite: { email: 'me@gmail.com', active: true, classIds: { 'TEST-ALEF': true } },
  cls: { active: true, toolGrants: { 'class-pointer': true }, teacherIds: { googleUid: true }, members: { s1: { active: true }, s2: { active: true } } } });

test('invitation id matches the one the site looks up', () => {
  assert.equal(inviteIdFor('Some.One+x@Gmail.com'), 'some_one_x_gmail_com');
});
test('google teacher: a brand-new account gets a teacher record, class link and invitation on the FICTIONAL class only', () => {
  const have = { ...good(), teacher: null, invite: null };
  have.cls = { active: true, toolGrants: { 'class-pointer': true }, teacherIds: {}, members: { s1: { active: true }, s2: { active: true } } };
  const r = gRun(have), p = r.patch;
  const t = p['b3Games/workspaces/b3-2026/teachers/googleUid'];
  assert.deepEqual(t.classIds, { 'TEST-ALEF': true });
  assert.equal(t.email, 'me@gmail.com'); assert.equal(t.active, true); assert.equal(t.role, 'teacher');
  assert.equal(p['b3Games/workspaces/b3-2026/classes/TEST-ALEF/teacherIds/googleUid'], true);
  assert.deepEqual(p['b3Games/workspaces/b3-2026/teacherInvites/me_gmail_com'], { email: 'me@gmail.com', name: 'Me', active: true, classIds: { 'TEST-ALEF': true } });
  const all = JSON.stringify(p);
  assert.doesNotMatch(all, /admins|"\*"|\*:true/, 'never grants admin or all classes');
  for (const a of Object.keys(p)) for (const b of Object.keys(p)) if (a !== b) assert.ok(!b.startsWith(a + '/'), a + ' overlaps ' + b);
});
test('google teacher: already set up means nothing to write; existing other classes are kept', () => {
  assert.deepEqual(gRun(gHave()).patch, {});
  const h = gHave(); h.teacher.classIds = { OTHER: true }; h.invite.classIds = { OTHER: true };
  assert.deepEqual(Object.keys(gRun(h).patch).sort(), [
    'b3Games/workspaces/b3-2026/teacherInvites/me_gmail_com/classIds/TEST-ALEF',
    'b3Games/workspaces/b3-2026/teachers/googleUid/classIds/TEST-ALEF'].sort());
});
test('google teacher: refuses bad addresses, fictional staging addresses, unknown, unverified and non-Google accounts', () => {
  assert.throws(() => checkGoogleTeacher('not-an-email', googleUser), /full email address/);
  assert.throws(() => checkGoogleTeacher('', googleUser), /full email address/);
  assert.throws(() => checkGoogleTeacher('teacher.alef@funtorahtools-staging.test', googleUser), /fictional staging address/);
  assert.throws(() => checkGoogleTeacher('me@gmail.com', null), /Sign in with Google" once/);
  assert.throws(() => checkGoogleTeacher('me@gmail.com', { ...googleUser, emailVerified: false }), /unverified/);
  assert.throws(() => checkGoogleTeacher('me@gmail.com', { ...googleUser, providerUserInfo: [{ providerId: 'password' }] }), /did not sign in with Google/);
  assert.doesNotThrow(() => checkGoogleTeacher('me@gmail.com', googleUser));
});
test('the email is taken from the command line and is not hard-coded anywhere in the repo script', () => {
  const src = fs.readFileSync('staging/class-pointer-test-data.cjs', 'utf8');
  assert.match(src, /--google-teacher=/);
  assert.doesNotMatch(src, /@gmail\.com|@googlemail\.com/i);
});

test('google teacher: a stray admin record is reported, and only switched off (never deleted) when asked', () => {
  const h = gHave(); h.admin = { active: true, role: 'admin' };
  const plain = gRun(h);
  assert.ok(plain.problems.some(p => /ADMIN record/.test(p)));
  assert.deepEqual(plain.patch, {}, 'nothing changes unless --remove-staging-admin is given');
  const fix = diagnoseGoogleTeacher({ workspaceId: ws, role: gRole, email: 'me@gmail.com', uid: 'googleUid', displayName: 'Me', have: h, removeAdmin: true });
  assert.deepEqual(fix.patch, { 'b3Games/admins/googleUid/active': false });
  const none = gHave(); none.admin = null; assert.deepEqual(gRun(none).problems, []);
  const off = gHave(); off.admin = { active: false }; assert.deepEqual(gRun(off).problems, []);
});
