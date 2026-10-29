'use strict';
// Execute the real owner-side principal reconciliation against synthetic RTDB
// snapshots. No Firebase network, production records, or credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PrincipalScope = require('../principal-scope.js');

const source = fs.readFileSync('owner-admin.html', 'utf8');
const begin = source.indexOf('function sameMap(');
const end = source.indexOf('function renderPrincipalAssignments()', begin);
assert.ok(begin >= 0 && end > begin, 'principal reconciliation must remain testable');
const makeReconcile = new Function('db', 'WS', 'B3PrincipalScope',
  source.slice(begin, end) + '\nreturn reconcilePrincipals;');

const ROOT = 'b3Games/workspaces/b3-2026';
function fixture(principal, existing) {
  const writes = [];
  const db = {
    ref(path) {
      if (path === ROOT + '/teachers') return {
        once: async () => ({ val: () => ({ 'principal-uid': existing }) })
      };
      if (path === undefined) return {
        update: async changes => { writes.push(changes); }
      };
      throw new Error('Unexpected Firebase path: ' + path);
    }
  };
  const invites = {
    teacherA: { name: 'Synthetic Teacher A', active: true, role: 'teacher',
      classIds: { et: true, wt: true } },
    teacherB: { name: 'Synthetic Teacher B', active: true, role: 'teacher',
      classIds: { pilot: true } },
    principal: { email: 'synthetic-principal@example.test', role: 'principal',
      accountType: 'principal', claimedUid: 'principal-uid',
      active: true, classIds: { et: true, wt: true }, ...principal }
  };
  const classes = { et: { active: true }, wt: { active: true },
    pilot: { active: true } };
  return { invites, classes, writes,
    reconcile: makeReconcile(db, 'b3-2026', PrincipalScope) };
}

test('removing one supervised teacher atomically revokes old class grants and adds only the new class', async () => {
  const f = fixture({ supervisedTeacherIds: { teacherB: true } }, {
    email: 'synthetic-principal@example.test', accountType: 'principal',
    active: true, classIds: { et: true, wt: true },
    supervisedTeachers: { teacherA: { name: 'Synthetic Teacher A',
      classIds: { et: true, wt: true } } }
  });
  await f.reconcile(f.invites, f.classes);
  assert.equal(f.writes.length, 1, 'one atomic root update, not partial per-class writes');
  const u = f.writes[0];
  assert.deepEqual(u[ROOT + '/teachers/principal-uid/classIds'], { pilot: true });
  assert.equal(u[ROOT + '/classes/et/teacherIds/principal-uid'], null);
  assert.equal(u[ROOT + '/classes/wt/teacherIds/principal-uid'], null);
  assert.equal(u[ROOT + '/classes/pilot/teacherIds/principal-uid'], true);
  assert.deepEqual(u[ROOT + '/teacherInvites/principal/classIds'], { pilot: true });
  assert.deepEqual(Object.keys(f.invites.principal.supervisedTeachers), ['teacherB']);
  assert.ok(Object.keys(u).every(k => !k.includes('/teacherIds/teacherA') &&
    !k.includes('/teacherIds/teacherB')), 'other teachers are never modified');
});

test('removing all supervision deactivates the claimed principal and deletes all prior class grants', async () => {
  const f = fixture({ supervisedTeacherIds: {} }, {
    email: 'synthetic-principal@example.test', accountType: 'principal',
    active: true, classIds: { et: true, wt: true }
  });
  await f.reconcile(f.invites, f.classes);
  assert.equal(f.writes.length, 1);
  const u = f.writes[0];
  assert.equal(u[ROOT + '/teachers/principal-uid/active'], false);
  assert.equal(u[ROOT + '/teacherInvites/principal/active'], false);
  assert.equal(u[ROOT + '/teachers/principal-uid/classIds'], null);
  assert.equal(u[ROOT + '/teacherInvites/principal/classIds'], null);
  assert.equal(u[ROOT + '/classes/et/teacherIds/principal-uid'], null);
  assert.equal(u[ROOT + '/classes/wt/teacherIds/principal-uid'], null);
  assert.equal(f.invites.principal.active, false);
});

test('unclaimed principal invitations never create a synthetic teacher record', async () => {
  const f = fixture({ claimedUid: null, supervisedTeacherIds: { teacherB: true } }, {
    email: 'synthetic-principal@example.test', active: true,
    classIds: { et: true, wt: true }
  });
  await f.reconcile(f.invites, f.classes);
  assert.equal(f.writes.length, 1);
  const u = f.writes[0];
  assert.deepEqual(u[ROOT + '/teacherInvites/principal/classIds'], { pilot: true });
  assert.ok(!Object.keys(u).some(k => k.includes('/teachers/') ||
    k.includes('/teacherIds/')), 'no claimed identity, no account grants');
});
