'use strict';
// Stricter database rules may refuse a teacher's browser a student's profile or whole
// membership list (the student can also be in another teacher's class). The Chazara and
// Rashi Letters dashboards must still load, without deciding anything from data they could not see.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const scope = require('../backend/functions/teacher-class-scope');

const CLASSES = 'b3Games/workspaces/b3-2026/classes/';
const teacher = { authorized: true, role: 'teacher', classIds: ['mine'] };
function world({ deny = [] } = {}) {
  const data = {
    [CLASSES + 'mine']: { name: 'Mine', active: true, toolGrants: { chazara: true }, members: { solo: { name: 'Solo' }, shared: { name: 'Shared' }, left: { name: 'Left' }, old: { name: 'Old' } } },
    'b3Games/students/solo/profile': { name: 'Solo Full' },
    'b3Games/students/solo/memberships': { 'b3-2026_mine': { workspaceId: 'b3-2026', classId: 'mine', active: true } },
    'b3Games/students/shared/memberships': { 'b3-2026_mine': { workspaceId: 'b3-2026', classId: 'mine', active: true }, 'b3-2026_theirs': { workspaceId: 'b3-2026', classId: 'theirs', active: true } },
    'b3Games/students/shared/memberships/b3-2026_mine': { workspaceId: 'b3-2026', classId: 'mine', active: true },
    'b3Games/students/left/memberships/b3-2026_mine': { workspaceId: 'b3-2026', classId: 'mine', active: false }
  };
  const reads = [];
  const get = async p => { reads.push(p); if (deny.some(d => (d instanceof RegExp ? d.test(p) : d === p))) throw new Error('permission_denied'); return data[p] ?? null; };
  return { get, reads };
}
const refused = [/^b3Games\/students\/(shared|left|old)\/(profile|memberships)$/];

test('with every read allowed nothing changes: full membership lists are used', async () => {
  const w = world();
  const r = await scope.roster(w.get, teacher, 'mine', 'chazara', { partialMemberships: true });
  assert.deepEqual(r.students.solo.membershipClassIds, ['mine']);
  assert.deepEqual(r.students.shared.membershipClassIds.sort(), ['mine', 'theirs']);
  assert.ok(!w.reads.some(p => /memberships\/b3-2026_/.test(p)), 'no extra reads');
});

test('refused reads no longer break the dashboard when the page opts in', async () => {
  const w = world({ deny: refused });
  const r = await scope.roster(w.get, teacher, 'mine', 'chazara', { partialMemberships: true });
  assert.deepEqual(Object.keys(r.students).sort(), ['old', 'shared', 'solo']);
  assert.equal(r.students.shared.name, 'Shared', 'falls back to the name on the class list');
  assert.equal(r.students.left, undefined, 'a student whose membership of this class is off stays out');
  assert.ok(w.reads.includes('b3Games/students/shared/memberships/b3-2026_mine'), 'only this class\'s membership is read');
  assert.ok(!w.reads.some(p => /_theirs$/.test(p)), 'never another class\'s membership');
});

test('an incomplete membership list is never used to attribute classless legacy records', async () => {
  const w = world({ deny: refused });
  const r = await scope.roster(w.get, teacher, 'mine', 'chazara', { partialMemberships: true });
  assert.equal(r.students.shared.membershipClassIds, null);
  assert.equal(scope.recordAllowed(r, 'shared', { some: 'legacy record with no class' }), false);
  assert.equal(scope.recordAllowed(r, 'shared', { classId: 'mine' }), true, 'records that name this class still count');
  assert.equal(scope.recordAllowed(r, 'shared', { classId: 'theirs' }), false);
  assert.equal(scope.recordAllowed(r, 'solo', { some: 'legacy record with no class' }), true, 'a fully read single membership still attributes');
});

test('without the option a refused read still fails, so the backend never hides an error', async () => {
  await assert.rejects(scope.roster(world({ deny: refused }).get, teacher, 'mine', 'chazara'), /permission_denied/);
  await assert.rejects(scope.roster(world({ deny: refused }).get, teacher, 'mine', 'chazara', { allowAll: false }), /permission_denied/);
  for (const file of fs.readdirSync('backend/functions').filter(f => /\.(js|cjs)$/.test(f) && f !== 'teacher-class-scope.js'))
    assert.doesNotMatch(fs.readFileSync('backend/functions/' + file, 'utf8'), /partialMemberships/, file);
});

test('only the Chazara and Rashi Letters teacher pages opt in', () => {
  assert.equal(fs.readFileSync('chazara/teacher.html', 'utf8').match(/partialMemberships:true/g).length, 2);
  assert.equal(fs.readFileSync('rashi-letters/teacher.html', 'utf8').match(/partialMemberships:true/g).length, 1);
});
