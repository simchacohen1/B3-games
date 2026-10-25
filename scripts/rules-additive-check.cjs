'use strict';
// Proves that a rules file is the LIVE rules plus ONLY the approved Classroom Pointer additions.
// Usage: node scripts/rules-additive-check.cjs <saved-live-rules.json> [candidate=firebase-rules.json]
//   1. In the Firebase console (Realtime Database > Rules) copy the live rules text into a file, e.g. live-rules.json.
//   2. Run this script. Exit code 0 = safe to deploy as the additive step. Anything else = STOP.
// Any changed or removed existing rule, or an addition outside the approved list, is reported and fails the check.
const fs = require('node:fs');

// Paths (inside "rules") where a NEW node may appear that did not exist in the live rules.
const ALLOWED_NEW = [
  ['b3Private'],
  ['b3Games', 'workspaces', '$workspaceId', 'classes', '$classId', 'classPointerSessions'],
  // Not Pointer: already on main since a804b7e (2026-10-11, owner) but never published to the live database.
  // Approved by the owner on 2026-10-18 to go live together with the Pointer additive step.
  ['b3Games', 'workspaces', '$workspaceId', 'classes', '$classId', 'halachaAccess'],
];

// Owner-approved privacy tightenings, accepted only at this exact path with this exact value.
// 2026-10-24: Posuk Practice recording links stop being public (student, active teacher, admin, owner).
const APPROVED_CHANGES = [
  [['posukPractice', 'attempts', '.read'],
    "(auth != null && auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true) || (auth != null && root.child('b3Games/admins/' + auth.uid).exists() && root.child('b3Games/admins/' + auth.uid + '/active').val() != false)"],
  [['posukPractice', 'attempts', '$studentId', '.read'],
    "auth != null && (auth.token.b3StudentId == $studentId || (root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid).exists() && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() != false))"],
  // 2026-10-24: student records (b3Games/students) stop being public. The blanket b3Games read is
  // replaced by explicit public reads on every other b3Games child, so those stay exactly as open.
  [['b3Games', '$other'], { '.read': true }],
  ...['admins', 'teachers', 'siteSettings', 'classGalleryPresence', 'classGalleryTag', 'classGalleryPresenceSettings']
    .map(k => [['b3Games', k, '.read'], true]),
  [['b3Games', 'students', '.read'],
    "(auth != null && auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true) || (auth != null && root.child('b3Games/admins/' + auth.uid).exists() && root.child('b3Games/admins/' + auth.uid + '/active').val() != false)"],
  [['b3Games', 'students', '$studentId', '.read'],
    "auth != null && (auth.token.b3StudentId == $studentId || (root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid).exists() && root.child('b3Games/workspaces/b3-2026/teachers/' + auth.uid + '/active').val() != false))"],
  // 2026-10-24: class records (member names, class PINs) stop being public. Other workspace
  // children (teachers, invites, content grants) stay readable through $other.
  [['b3Games', 'workspaces', '$workspaceId', '$other'], { '.read': true }],
  [['b3Games', 'workspaces', '$workspaceId', '.read'],
    "(auth != null && auth.token.email == 'simcha5770@gmail.com' && auth.token.email_verified == true) || (auth != null && root.child('b3Games/admins/' + auth.uid).exists() && root.child('b3Games/admins/' + auth.uid + '/active').val() != false)"],
  [['b3Games', 'workspaces', '$workspaceId', 'classes', '.read'],
    "auth != null && root.child('b3Games/workspaces/' + $workspaceId + '/teachers/' + auth.uid).exists() && root.child('b3Games/workspaces/' + $workspaceId + '/teachers/' + auth.uid + '/active').val() != false"],
  [['b3Games', 'workspaces', '$workspaceId', 'classes', '$classId', '.read'],
    "auth != null && auth.token.b3StudentId != null && root.child('b3Games/workspaces/' + $workspaceId + '/classes/' + $classId + '/members/' + auth.token.b3StudentId).exists() && root.child('b3Games/workspaces/' + $workspaceId + '/classes/' + $classId + '/members/' + auth.token.b3StudentId + '/active').val() != false"],
];
// Approved removals, each allowed only while its replacement is present in the candidate.
const APPROVED_REMOVALS = [
  [['b3Games', '.read'], candidate => candidate.b3Games?.$other?.['.read'] === true],
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
const approvedChange = (p, value) => APPROVED_CHANGES.some(([a, v]) =>
  samePath(a, p) && JSON.stringify(value) === JSON.stringify(v));

function compare(live, candidate) {
  const problems = [];
  const candidateRules = candidate.rules || candidate;
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
  console.log('OK: ' + candPath + ' equals the live rules plus only the approved Pointer additions (' + ALLOWED_NEW.map(a => '/' + a.join('/')).join(', ') + ') and the owner-approved privacy changes (' + APPROVED_CHANGES.map(([a]) => '/' + a.join('/')).join(', ') + ').');
}
