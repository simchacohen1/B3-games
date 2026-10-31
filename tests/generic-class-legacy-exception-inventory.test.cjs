'use strict';
// DRAFT SECURITY DEBT INVENTORY — NOT A CLASS-GENERIC ACCEPTANCE TEST.
// Source: transitional firebase-rules.json. Known ET/WT fallbacks still allow
// different outcomes from an arbitrary class when the explicit tool grant is
// absent. This test only blocks NEW unreviewed exceptions; it does not prove
// that the listed exceptions are safe, or that deployed rules match this file.
// See #344. Do not delete an exception without checking ET/WT grant/lock
// migration and testing actual Firebase emulator decisions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const knownLegacyExceptions = new Set([
  '/rules/b3Games/workspaces/$workspaceId/classes/$classId/classPointerSessions/.write',
  '/rules/b3Private/classPointerSharePermissions/$workspaceId/$classId/$roomId/.write',
  '/rules/multiplayerCenter/workspaces/$workspaceId/classes/$classId/.read',
  '/rules/multiplayerCenter/workspaces/$workspaceId/classes/$classId/rooms/$roomId/.write',
  '/rules/multiplayerCenter/workspaces/$workspaceId/classes/$classId/games/$gameKey/rooms/$roomId/.write',
  '/rules/multiplayerCenter/workspaces/$workspaceId/classes/$classId/games/$gameKey/rooms/$roomId/players/$studentId/.write',
  '/rules/multiplayerCenter/workspaces/$workspaceId/classes/$classId/rashiRooms/.read',
  '/rules/multiplayerCenter/workspaces/$workspaceId/classes/$classId/rashiRooms/$roomId/.write',
  '/rules/multiplayerCenter/workspaces/$workspaceId/classes/$classId/rashiRooms/$roomId/players/$studentId/.write',
  '/rules/b3Private/multiplayerGames/workspaces/$workspaceId/classes/$classId/rooms/$roomId/hands/$studentId/.read'
]);

function legacyClassChecks() {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase-rules.json'), 'utf8'));
  const findings = [];
  const et = /\$classId\s*==\s*['"]et['"]/;
  const wt = /\$classId\s*==\s*['"]wt['"]/;
  function walk(node, at) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const location = at + '/' + key;
      if (typeof value === 'string' && (et.test(value) || wt.test(value))) {
        findings.push({ path: location, et: et.test(value), wt: wt.test(value) });
      } else if (value && typeof value === 'object') {
        walk(value, location);
      }
    }
  }
  walk(rules, '');
  return findings;
}

test('transitional RTDB rules introduce no UNREVIEWED ET/WT-only classId conditions', () => {
  const findings = legacyClassChecks();
  const unreviewed = findings.map(x => x.path).filter(x => !knownLegacyExceptions.has(x));
  assert.deepEqual(unreviewed, [],
    'New ET/WT special cases require class-generic scope review and tests; do not silently expand the exception list.');
});

test('tracked legacy classId exceptions do not single out only ET or only WT', () => {
  const asymmetric = legacyClassChecks().filter(x => x.et !== x.wt);
  assert.deepEqual(asymmetric, [],
    'One-track-only rules need explicit authorization review; ET/WT parity is not equivalent to arbitrary-class parity.');
});
