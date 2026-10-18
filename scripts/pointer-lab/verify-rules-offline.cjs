'use strict';
// Offline version of verify-rules.cjs: evaluates a rules FILE against the same 25 scenarios with the
// "targaryen" rules simulator, so it needs no emulator, no Java, no network and no real data.
// Usage:  node scripts/pointer-lab/verify-rules-offline.cjs [rules-file ...]
// Default: runs firebase-rules.json (live rules + Pointer additions) and firebase-rules.hardened.json.
// Requires:  npm install --no-save targaryen@3.1.0
// Exit code 0 only if the HARDENED file passes everything; the live file is reported for comparison.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const targaryen = require('targaryen');

const ROOT = path.resolve(__dirname, '..', '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['firebase-rules.json', 'firebase-rules.hardened.json'];

const WS = 'b3-2026', CLASS = 'pointer-test', OTHER = 'other-class';
const CP = 'b3Games/workspaces/' + WS + '/classes/' + CLASS;
const sid = id => 'student_' + crypto.createHash('sha256').update(id).digest('hex').slice(0, 28);
const TEACHER_UID = 'teacher-uid-1', OTHER_TEACHER_UID = 'teacher-uid-2', OWNER_UID = 'owner-uid-1';

// Synthetic data shaped like scripts/pointer-lab/seed.cjs (plus a second class and an unassigned teacher).
const data = {
  b3Games: {
    siteSettings: { studentWebsiteEnabled: true },
    students: {
      studentA: { profile: { id: 'studentA', name: 'Pointer Test Student A', active: true, classId: CLASS }, memberships: { [WS + '_' + CLASS]: { workspaceId: WS, classId: CLASS, active: true } } },
      studentB: { profile: { id: 'studentB', name: 'Pointer Test Student B', active: true, classId: CLASS }, memberships: { [WS + '_' + CLASS]: { workspaceId: WS, classId: CLASS, active: true } } },
      studentX: { profile: { id: 'studentX', name: 'Other Class Student', active: true, classId: OTHER }, memberships: { [WS + '_' + OTHER]: { workspaceId: WS, classId: OTHER, active: true } } },
    },
    workspaces: { [WS]: {
      teachers: {
        [TEACHER_UID]: { active: true, email: 'teacher@pointer.lab', name: 'Lab Teacher', classIds: { [CLASS]: true } },
        [OTHER_TEACHER_UID]: { active: true, email: 'other@pointer.lab', name: 'Other Teacher', classIds: { [OTHER]: true } },
      },
      classes: {
        [CLASS]: { id: CLASS, name: 'Pointer Test', active: true, members: { studentA: { active: true, name: 'A' }, studentB: { active: true, name: 'B' } }, teacherIds: { [TEACHER_UID]: true }, toolGrants: { 'class-pointer': true, shorashim: true } },
        [OTHER]: { id: OTHER, name: 'Other', active: true, members: { studentX: { active: true, name: 'X' } }, teacherIds: { [OTHER_TEACHER_UID]: true }, toolGrants: { 'class-pointer': true } },
      },
    } },
  },
  b3Private: { passcodes: { studentA: { passcode: '1111' }, studentB: { passcode: '2222' } } },
};

const studentAuth = (id, cls) => ({ uid: sid(id), token: { b3StudentId: id, b3ClassId: cls, b3StudentRole: 'student' } });
const googleAuth = (uid, email) => ({ uid, provider: 'google.com', token: { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } } });

function run(file) {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const db = targaryen.database(rules, JSON.parse(JSON.stringify(data)), Date.now());
  const results = [];
  const read = (who, p) => db.as(who).read('/' + p).allowed;
  const write = (who, p, v) => db.as(who).write('/' + p, v).allowed;
  const check = (name, ok) => results.push({ name, ok });

  const anon = null, A = studentAuth('studentA', CLASS), X = studentAuth('studentX', OTHER);
  const teacher = googleAuth(TEACHER_UID, 'teacher@pointer.lab'), otherTeacher = googleAuth(OTHER_TEACHER_UID, 'other@pointer.lab'), owner = googleAuth(OWNER_UID, 'simcha5770@gmail.com');
  const room = 'class-pointer-00000000-0000-0000-0000-000000000000';
  const perm = 'b3Private/classPointerSharePermissions/' + WS + '/' + CLASS + '/' + room;

  // 1. strangers
  for (const p of ['b3Games/students', 'b3Games/students/studentA/profile', 'b3Games/workspaces/' + WS + '/classes', CP, CP + '/toolGrants', 'b3Games/workspaces/' + WS + '/teachers', 'b3Games/admins'])
    check('anonymous cannot read ' + p, !read(anon, p));
  check('anonymous can read the public student-website switch', read(anon, 'b3Games/siteSettings/studentWebsiteEnabled'));
  // 2. student reads for own class
  for (const f of ['name', 'active', 'toolGrants', 'access', 'siteEnabled', 'members/studentA']) check('student can read own class ' + f, read(A, CP + '/' + f));
  check('student can read own profile', read(A, 'b3Games/students/studentA/profile'));
  check('student cannot read the whole student list', !read(A, 'b3Games/students'));
  check('student cannot read a classmate profile', !read(A, 'b3Games/students/studentB/profile'));
  check('student cannot read private passcodes', !read(A, 'b3Private/passcodes'));
  check('student cannot write class settings', !write(A, CP + '/toolGrants', { gematria: true }));
  // 3. Pointer rows
  check('assigned teacher can write private Pointer permissions', write(teacher, perm, { studentA: { screenSharingDenied: false } }));
  check('assigned teacher can publish a Pointer session', write(teacher, CP + '/classPointerSessions/' + room, { roomId: room, createdAt: Date.now(), teacherUid: TEACHER_UID, studentScreenSharing: false }));
  check('student cannot write private Pointer permissions', !write(A, perm, { studentA: { screenSharingDenied: true } }));
  check('anonymous cannot write private Pointer permissions', !write(anon, perm, { x: 1 }));
  check('student can read the Pointer session of own class', read(A, CP + '/classPointerSessions'));
  check('anonymous cannot read Pointer sessions', !read(anon, CP + '/classPointerSessions'));
  // 4. extra isolation cases (not in the lab script): other class / unassigned teacher / admin
  check('student of ANOTHER class cannot read this class', !read(X, CP + '/name'));
  check('student of ANOTHER class cannot read this class Pointer sessions', !read(X, CP + '/classPointerSessions'));
  check('student cannot publish a Pointer session', !write(A, CP + '/classPointerSessions/' + room, { roomId: room }));
  check('UNASSIGNED teacher cannot write this class private Pointer permissions', !write(otherTeacher, perm, { studentA: { screenSharingDenied: false } }));
  check('UNASSIGNED teacher cannot publish a session in this class', !write(otherTeacher, CP + '/classPointerSessions/' + room, { roomId: room }));
  check('owner can write private Pointer permissions', write(owner, perm, { studentA: { screenSharingDenied: false } }));
  check('nobody (even teacher) can read private join/share tickets', !read(teacher, 'b3Private/classPointerJoinTickets') && !read(teacher, 'b3Private/classPointerShareTickets'));
  check('student cannot read private join tickets', !read(A, 'b3Private/classPointerJoinTickets'));
  return results;
}

let hardenedFailed = 0;
for (const f of files) {
  if (!fs.existsSync(path.join(ROOT, f))) { console.log('SKIP (missing) ' + f); continue; }
  const results = run(f), failed = results.filter(r => !r.ok);
  console.log('\n=== ' + f + ': ' + (results.length - failed.length) + ' of ' + results.length + ' checks passed ===');
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name);
  if (/hardened/.test(f)) hardenedFailed += failed.length;
}
process.exit(hardenedFailed ? 1 : 0);