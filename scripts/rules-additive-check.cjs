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

function compare(live, candidate) {
  const problems = [];
  const walk = (a, b, p) => {
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(a)) {
        if (!(k in b)) problems.push('REMOVED   /' + [...p, k].join('/'));
        else walk(a[k], b[k], [...p, k]);
      }
      for (const k of Object.keys(b)) if (!(k in a)) {
        const np = [...p, k];
        if (!allowedNew(np)) problems.push('ADDED     /' + np.join('/') + '  (not in the approved list)');
      }
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      problems.push('CHANGED   /' + p.join('/') + '\n    live:      ' + JSON.stringify(a) + '\n    candidate: ' + JSON.stringify(b));
    }
  };
  walk(live.rules || live, candidate.rules || candidate, []);
  return problems;
}

module.exports = { compare, parse, stripComments, ALLOWED_NEW };

if (require.main === module) {
  const [livePath, candPath = 'firebase-rules.json'] = process.argv.slice(2);
  if (!livePath) { console.error('Usage: node scripts/rules-additive-check.cjs <saved-live-rules.json> [candidate]'); process.exit(2); }
  const problems = compare(parse(fs.readFileSync(livePath, 'utf8')), parse(fs.readFileSync(candPath, 'utf8')));
  if (problems.length) { console.log('NOT ADDITIVE-ONLY. Do not deploy.\n' + problems.map(x => ' - ' + x).join('\n')); process.exit(1); }
  console.log('OK: ' + candPath + ' equals the live rules plus only the approved Pointer additions (' + ALLOWED_NEW.map(a => '/' + a.join('/')).join(', ') + ').');
}
