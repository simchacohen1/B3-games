'use strict';
// Proves that a rules file is the LIVE rules plus ONLY the explicitly approved additive changes.
// Usage: node scripts/rules-additive-check.cjs <saved-live-rules.json> [candidate=firebase-rules.json]
//   1. In the Firebase console (Realtime Database > Rules) copy the live rules text into a file, e.g. live-rules.json.
//   2. Run this script. Exit code 0 = safe to deploy as the additive step. Anything else = STOP.
// Any changed or removed existing rule, or an addition outside the approved list, is reported and fails the check.
const fs = require('node:fs');
const HARDENED_RULES = JSON.parse(fs.readFileSync('firebase-rules.hardened.json', 'utf8')).rules;

// Paths (inside "rules") where a NEW node may appear that did not exist in the live rules.
const ALLOWED_NEW = [
  ['b3Private'],
  // Issue #460: isolated class-scoped rooms and invitation summaries; no broad grants at this root.
  ['multiplayerCenter'],
  ['b3Games', 'workspaces', '$workspaceId', 'classes', '$classId', 'classPointerSessions'],
  // Not Pointer: already on main since a804b7e (2026-10-11, owner) but never published to the live database.
  // Approved by the owner on 2026-10-18 to go live together with the Pointer additive step.
  ['b3Games', 'workspaces', '$workspaceId', 'classes', '$classId', 'halachaAccess'],
];

// Owner-approved privacy tightenings, accepted only at this exact path with this exact value.
// 2026-10-24: Posuk Practice recording links stop being public (student, active teacher, admin, owner).
const APPROVED_CHANGES = [
  // 2026-11-02: Chazara records are class-readable by assigned teachers and writable only by the matching student.
  [['posukPractice', 'chazara', 'students'], { '$studentId': {
    '.read': "auth != null && (auth.token.b3StudentId == $studentId || auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/students/' + $studentId + '/profile/classId').val() != null && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val()).val() == true)",
    '.write': 'auth != null && auth.token.b3StudentId == $studentId'
  }}],
  [['posukPractice', 'chazara', 'events'], { '$studentId': {
    '.read': "auth != null && (auth.token.b3StudentId == $studentId || auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/students/' + $studentId + '/profile/classId').val() != null && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val()).val() == true)",
    '.write': 'auth != null && auth.token.b3StudentId == $studentId'
  }}],
  // 2026-11-02: Legacy Posuk Practice access records (which can contain passcodes) are private to their student and owner/admin.
  [['posukPractice', 'allowedStudents', '$studentId', '.read'], "auth != null && (auth.token.b3StudentId == $studentId || auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  // 2026-11-02: Posuk Practice settings are authenticated; global controls are admin-only and class limits are assigned-class scoped.
  [['posukPractice', 'settings', '.read'], 'auth != null'],
  [['posukPractice', 'settings', 'practiceLimit', '.write'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  [['posukPractice', 'settings', 'classPracticeLimits'], { '$classId': { '.write': "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + $classId).val() == true)" } }],
  [['posukPractice', 'settings', 'accessLocked', '.write'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  [['posukPractice', 'settings', 'accessLockMessage', '.write'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  [['posukPractice', 'settings', 'appEnabled', '.write'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  [['posukPractice', 'settings', '$other', '.write'], false],
  // 2026-11-02: Posuk Practice student records are readable only by the student, owner/admin, or assigned teacher; writes by that student only.
  [['posukPractice', 'students', '$studentId', '.read'], "auth != null && (auth.token.b3StudentId == $studentId || auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/students/' + $studentId + '/profile/classId').val() != null && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val()).val() == true)"],
  [['posukPractice', 'students', '$studentId', '.write'], 'auth != null && auth.token.b3StudentId == $studentId'],
  // 2026-11-02: Posuk Practice attempt writes are limited to the matching signed-in student.
  [['posukPractice', 'attempts', '$studentId', '.write'], 'auth != null && auth.token.b3StudentId == $studentId'],
  // 2026-11-02: Rashi Letters progress follows the student's primary class and own writes.
  [['rashiLetters', 'settings', '.read'], 'auth != null'],
  [['rashiLetters', 'settings', '.write'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  [['rashiLetters', 'progress', '$studentId', '.read'], "auth != null && (auth.token.b3StudentId == $studentId || auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val()).val() == true)"],
  [['rashiLetters', 'progress', '$studentId', '.write'], 'auth != null && auth.token.b3StudentId == $studentId'],
  [['rashiLetters', 'matchRooms', '$room', '.read'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || auth.token.b3StudentRole == 'student' && auth.token.b3ClassId == data.child('classId').val() && root.child('b3Games/workspaces/b3-2026/classes/' + data.child('classId').val() + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + data.child('classId').val() + '/members/' + auth.token.b3StudentId + '/active').val() == true)"],
  [['rashiLetters', 'matchRooms', '$room', '.write'], "auth != null && auth.token.b3StudentRole == 'student' && auth.token.b3StudentId == newData.child('host').val() && auth.token.b3ClassId == newData.child('classId').val() && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/members/' + auth.token.b3StudentId + '/active').val() == true && !data.exists() || auth != null && auth.token.b3StudentRole == 'student' && auth.token.b3StudentId == data.child('host').val() && auth.token.b3ClassId == data.child('classId').val() && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/members/' + auth.token.b3StudentId + '/active').val() == true && !newData.exists()"],
  [['rashiLetters', 'matchRooms', '$room', 'players'], { '$studentId': { '.write': "auth != null && auth.token.b3StudentRole == 'student' && auth.token.b3StudentId == $studentId && auth.token.b3ClassId == data.parent().parent().child('classId').val() && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/members/' + $studentId + '/active').val() == true" } }],
  [['rashiLetters', 'matchRooms', '$room', 'state'], { '.write': "auth != null && auth.token.b3StudentRole == 'student' && auth.token.b3StudentId == data.parent().child('host').val() && auth.token.b3ClassId == data.parent().child('classId').val() && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/members/' + auth.token.b3StudentId + '/active').val() == true" }],
  [['rashiLetters', 'matchRooms', '$room', 'startedAt'], { '.write': "auth != null && auth.token.b3StudentRole == 'student' && auth.token.b3StudentId == data.parent().child('host').val() && auth.token.b3ClassId == data.parent().child('classId').val() && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + auth.token.b3ClassId + '/members/' + auth.token.b3StudentId + '/active').val() == true" }],
  // 2026-11-02: Legacy Game Show live state is authenticated; only owner/admin writes, active student reads remain.
  [['tentTrailTrivia', '.read'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || auth.token.b3StudentRole == 'student')"],
  [['tentTrailTrivia', '.write'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  // 2026-11-02: Game Show set and live state access becomes authenticated and class-scoped.
  [['questionSets', '.read'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  [['questionSets', '.write'], "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true)"],
  [['questionSets', '$setId'], { '.read': "auth != null && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && (root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/et').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/wt').val() == true)" }],
  [['questionSets', 'classes'], { '$classId': {
    set: {
      '.read': "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + $classId).val() == true)",
      '.write': "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + $classId).val() == true)"
    },
    live: {
      '.read': "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/classes/' + $classId + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + $classId + '/members/' + auth.token.b3StudentId + '/active').val() == true && auth.token.b3ClassId == $classId || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + $classId).val() == true)",
      '.write': "auth != null && (auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + $classId).val() == true)"
    }
  }}],
  // 2026-11-01: active classroom teachers may read only a student's active primary class roster record.
  [['b3Games', 'students', '$studentId', '.read'],
    "auth != null && (auth.token.b3StudentId == $studentId || auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || (root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val()).val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val() + '/active').val() != false && root.child('b3Games/workspaces/b3-2026/classes/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val() + '/members/' + $studentId + '/active').val() == true))"],
  [['posukPractice', 'attempts', '.read'],
    "(auth != null && auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true) || (auth != null && root.child('b3Games/admins/' + auth.uid).exists() && root.child('b3Games/admins/' + auth.uid + '/active').val() != false)"],
  [['posukPractice', 'attempts', '$studentId', '.read'],
    "auth != null && (auth.token.b3StudentId == $studentId || auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true || root.child('b3Games/admins/' + auth.uid + '/active').val() == true || root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() == true && root.child('b3Games/students/' + $studentId + '/profile/classId').val() != null && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/classIds/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val()).val() == true && root.child('b3Games/workspaces/b3-2026/classes/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val() + '/active').val() != false && root.child('b3Games/workspaces/b3-2026/classes/' + root.child('b3Games/students/' + $studentId + '/profile/classId').val() + '/members/' + $studentId + '/active').val() == true)"],
  // Public settings/gallery paths remain public. Teacher/workspace directories are now class-scoped.
  ...['siteSettings', 'classGalleryPresence', 'classGalleryTag', 'classGalleryPresenceSettings']
    .map(k => [['b3Games', k, '.read'], true]),
  [['b3Games', 'students', '.read'],
    "(auth != null && auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true) || (auth != null && root.child('b3Games/admins/' + auth.uid).exists() && root.child('b3Games/admins/' + auth.uid + '/active').val() != false)"],
  [['b3Games', 'students', '$studentId', '.read'],
    "auth != null && (auth.token.b3StudentId == $studentId || (root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid).exists() && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() != false))"],
];
// Approved removals, each allowed only while its replacement is present in the candidate.
const APPROVED_REMOVALS = [
  [['b3Games', '.read'], candidate => candidate.b3Games?.$other?.['.read'] === true
    || !candidate.b3Games?.$other && JSON.stringify(candidate.b3Games?.workspaces) === JSON.stringify(HARDENED_RULES.b3Games?.workspaces)
      && JSON.stringify(candidate.b3Games?.admins?.$uid) === JSON.stringify(HARDENED_RULES.b3Games?.admins?.$uid)
      && JSON.stringify(candidate.b3Games?.teachers?.$uid) === JSON.stringify(HARDENED_RULES.b3Games?.teachers?.$uid)],
  [['b3Games', '$other'], candidate => !candidate.b3Games?.$other && JSON.stringify(candidate.b3Games?.workspaces) === JSON.stringify(HARDENED_RULES.b3Games?.workspaces)],
  [['b3Games', 'admins', '.read'], candidate => !!candidate.b3Games?.admins?.$uid && JSON.stringify(candidate.b3Games.admins.$uid) === JSON.stringify(HARDENED_RULES.b3Games?.admins?.$uid)],
  [['b3Games', 'teachers', '.read'], candidate => !!candidate.b3Games?.teachers?.$uid && JSON.stringify(candidate.b3Games.teachers.$uid) === JSON.stringify(HARDENED_RULES.b3Games?.teachers?.$uid)],
  [['b3Games', 'workspaces', '.read'], candidate => JSON.stringify(candidate.b3Games?.workspaces) === JSON.stringify(HARDENED_RULES.b3Games?.workspaces)],
  [['b3Games', 'workspaces', '$workspaceId', '.write'], candidate => JSON.stringify(candidate.b3Games?.workspaces) === JSON.stringify(HARDENED_RULES.b3Games?.workspaces)],
  [['b3Games', 'workspaces', '$workspaceId', 'classes', '$classId', '.write'], candidate => JSON.stringify(candidate.b3Games?.workspaces) === JSON.stringify(HARDENED_RULES.b3Games?.workspaces)],
  [['posukPractice', 'chazara', '.read'], candidate => !!candidate.posukPractice?.chazara?.students],
  [['posukPractice', 'chazara', '$section'], candidate => !!candidate.posukPractice?.chazara?.students && !!candidate.posukPractice?.chazara?.events],
  [['posukPractice', 'shorashimLearning', '.read'], candidate => JSON.stringify(candidate.posukPractice?.shorashimLearning) === JSON.stringify(HARDENED_RULES.posukPractice?.shorashimLearning)],
  [['posukPractice', 'shorashimLearning', '.write'], candidate => JSON.stringify(candidate.posukPractice?.shorashimLearning) === JSON.stringify(HARDENED_RULES.posukPractice?.shorashimLearning)],
  [['posukPractice', 'shorashimLearning', '$section'], candidate => JSON.stringify(candidate.posukPractice?.shorashimLearning) === JSON.stringify(HARDENED_RULES.posukPractice?.shorashimLearning)],
  [['b3Quiz', '.read'], candidate => JSON.stringify(candidate.b3Quiz) === JSON.stringify(HARDENED_RULES.b3Quiz)],
  [['b3Quiz', '.write'], candidate => JSON.stringify(candidate.b3Quiz) === JSON.stringify(HARDENED_RULES.b3Quiz)],
  [['posukPractice', 'allowedStudents', '.read'], candidate => !!candidate.posukPractice?.allowedStudents?.$studentId?.['.read']],
  [['posukPractice', 'students', '.read'], candidate => !!candidate.posukPractice?.students?.$studentId?.['.read']],
  [['rashiLetters', 'progress', '.read'], candidate => !!candidate.rashiLetters?.progress?.$studentId?.['.read']],
  [['rashiLetters', 'matchRooms', '.read'], candidate => !!candidate.rashiLetters?.matchRooms?.$room?.['.read']],
  [['rashiLetters', 'matchRooms', '$room', '.write'], candidate => !!candidate.rashiLetters?.matchRooms?.$room?.players && !!candidate.rashiLetters?.matchRooms?.$room?.state],
];

function stripComments(text) { // the console allows // and /* */ comments; remove them outside strings
  let out = '', inStr = false, q = '', i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += n; i += 2; continue; } if (c === q) inStr = false; i++; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const parse = text => JSON.parse(stripComments(text));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const allowedNew = p => ALLOWED_NEW.some(a => a.length === p.length && a.every((s, i) => s === p[i]));
const samePath = (a, p) => a.length === p.length && a.every((s, i) => s === p[i]);
function atPath(root, path) { return path.reduce((node, key) => node && node[key], root); }
const approvedHardenedChange = (p, value) => (p[0] === 'posukPractice' && p[1] === 'shorashimLearning'
  || p[0] === 'b3Quiz' || p[0] === 'b3Games' && ['admins','teachers','workspaces'].includes(p[1]))
  && JSON.stringify(value) === JSON.stringify(atPath(HARDENED_RULES, p));
const approvedChange = (p, value) => APPROVED_CHANGES.some(([a, v]) =>
  samePath(a, p) && JSON.stringify(value) === JSON.stringify(v)) || approvedHardenedChange(p, value);

function compare(live, candidate) {
  const problems = [];
  const candidateRules = candidate.rules || candidate;
  const isUnconditionalRead = value => value === true || typeof value === 'string' && value.trim() === 'true';
  // The saved live baseline has this public parent read. Keep the candidate
  // from silently restoring it when ordinary baseline comparison sees no diff.
  if (isUnconditionalRead(candidateRules.b3Games?.['.read'])) {
    problems.push('PUBLIC READ /b3Games/.read (parent grant bypasses class-scoped child rules)');
  }
  const approvedRemoval = p => APPROVED_REMOVALS.some(([a, ok]) => samePath(a, p) && ok(candidateRules));
  const walk = (a, b, p) => {
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(a)) {
        if (!(k in b)) { if (!approvedRemoval([...p, k])) problems.push('REMOVED   /' + [...p, k].join('/')); }
        else walk(a[k], b[k], [...p, k]);
      }
      for (const k of Object.keys(b)) if (!(k in a)) {
        const np = [...p, k];
        if (!allowedNew(np) && !approvedChange(np, b[k])) problems.push('ADDED     /' + np.join('/') + '  (not in the approved list)');
      }
    } else if (JSON.stringify(a) !== JSON.stringify(b) && !approvedChange(p, b)) {
      problems.push('CHANGED   /' + p.join('/') + '\n    live:      ' + JSON.stringify(a) + '\n    candidate: ' + JSON.stringify(b));
    }
  };
  walk(live.rules || live, candidateRules, []);
  return problems;
}

module.exports = { compare, parse, stripComments, ALLOWED_NEW, APPROVED_CHANGES, APPROVED_REMOVALS };

if (require.main === module) {
  const [livePath, candPath = 'firebase-rules.json'] = process.argv.slice(2);
  if (!livePath) { console.error('Usage: node scripts/rules-additive-check.cjs <saved-live-rules.json> [candidate]'); process.exit(2); }
  const problems = compare(parse(fs.readFileSync(livePath, 'utf8')), parse(fs.readFileSync(candPath, 'utf8')));
  if (problems.length) { console.log('NOT ADDITIVE-ONLY. Do not deploy.\n' + problems.map(x => ' - ' + x).join('\n')); process.exit(1); }
  console.log('OK: ' + candPath + ' equals the live rules plus only the approved additive nodes (' + ALLOWED_NEW.map(a => '/' + a.join('/')).join(', ') + ') and approved privacy changes (' + APPROVED_CHANGES.map(([a]) => '/' + a.join('/')).join(', ') + ').');
}
