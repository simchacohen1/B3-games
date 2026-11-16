const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../backend/functions/sols-tokens-sync-core.cjs');

// Made-up students only.
const root = () => ({
  classes: { c1: { name: 'Davening' }, c2: { name: 'Morning 1' } },
  enrollments: { c1: { 'student-a': true }, c2: { 'student-b': true } },
  students: { 'student-a': { name: 'Student A', active: true }, 'student-b': { name: 'Student B', active: true }, 'student-x': { name: 'Gone', active: false } },
  dailyAwards: {
    'student-a': { c1: { '2026-10-28': { points: 7, byCategory: { Davening: { category: 'Davening', rating: 'Excellent', points: 4 }, Learning: { category: 'Learning', rating: 'Good', points: 3 } } } } },
    'student-x': { c1: { '2026-10-28': { points: 3 } } },
  },
  pointRequests: {
    r1: { status: 'approved', rewardStudentId: 'student-b', classId: 'c2', source: 'chazara-recording', amount: 2, actualAmount: 2, reviewedAt: Date.parse('2026-10-28T15:00:00Z'), reason: 'Chazara' },
    r2: { status: 'approved', rewardStudentId: 'student-b', classId: 'c2', source: 'chazara-reject', amount: -2, actualAmount: -1, reviewedAt: Date.parse('2026-10-28T16:00:00Z'), reason: 'Reversed' },
    r3: { status: 'pending', rewardStudentId: 'student-b', classId: 'c2', source: 'reading100', amount: 3 },
    r4: { status: 'rejected', rewardStudentId: 'student-b', source: 'reading100', amount: 3 },
  },
  pointAdjustments: { a1: { studentId: 'student-a', classId: 'c1', amount: 5, reason: 'Great week', createdAt: Date.parse('2026-10-27T15:00:00Z') } },
  redemptionsByStudent: { 'student-a': { q1: { cost: 25, status: 'ready', requestedAt: '2026-10-28T10:00:00Z' } } },
  classRewardContributionsByStudent: { 'student-a': { k1: { amount: 10, classId: 'c1' } } },
});

test('daily points are sent one line per category with stable ids', () => {
  const p = core.collectPoints(root()).filter(x => x.point_id.startsWith('daily:'));
  assert.deepEqual(p.map(x => [x.point_id, x.category, x.amount, x.class]).sort(), [
    ['daily:student-a:c1:2026-10-28:Davening', 'Davening', 4, 'Davening'],
    ['daily:student-a:c1:2026-10-28:Learning', 'Learning', 3, 'Davening'],
  ]);
});
test('only approved activity points go; undone ones are negative "added" entries', () => {
  const p = core.collectPoints(root()).filter(x => x.point_id.startsWith('request:'));
  assert.deepEqual(p.map(x => [x.point_id, x.category, x.amount, x.status]).sort(),
    [['request:r1', 'Chazara', 2, 'added'], ['request:r2', 'Chazara', -1, 'added']]);
});
test('manual adjustments go; reward-store spending and class contributions never do', () => {
  const all = core.collectPoints(root());
  assert.ok(all.some(x => x.point_id === 'adjust:a1' && x.category === 'Adjustments' && x.amount === 5));
  assert.ok(!all.some(x => /redeem|class-reward|q1|k1/.test(x.point_id)));
  assert.ok(all.every(x => x.status === 'added'));
});
test('inactive students are skipped and every field fits SOLS Tokens limits', () => {
  const all = core.collectPoints(root());
  assert.ok(!all.some(x => x.student_id === 'student-x'));
  for (const x of all) {
    assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(x.amount) && Math.abs(x.amount) <= 10000);
    assert.ok(x.point_id.length <= 128 && x.reason.length <= 500 && x.category.length <= 60);
  }
});
test('a class filter limits the points to that class only', () => {
  const all = core.collectPoints(root(), { classNames: ['morning 1'] });
  assert.deepEqual([...new Set(all.map(x => x.class))], ['Morning 1']);
});
test('only new or changed points are sent again', () => {
  const pts = core.collectPoints(root());
  const sent = {};
  pts.forEach(p => { sent[core.stateKey(p.point_id)] = p.amount; });
  assert.equal(core.pointsToSend(pts, sent).length, 0);
  const resaved = root(); resaved.dailyAwards['student-a'].c1['2026-10-28'].byCategory.Davening.points = 2; resaved.dailyAwards['student-a'].c1['2026-10-28'].points = 5;
  const again = core.pointsToSend(core.collectPoints(resaved), sent);
  assert.deepEqual(again.map(x => [x.point_id, x.amount]), [['daily:student-a:c1:2026-10-28:Davening', 2]]);
});
test('batches never exceed 500', () => {
  const many = Array.from({ length: 1201 }, (_, i) => ({ point_id: 'p' + i }));
  assert.deepEqual(core.toBatches(many).map(b => b.length), [500, 500, 201]);
});
test('rejected points are retried; applied, unchanged and held are remembered', () => {
  const batch = [{ point_id: 'a', amount: 1 }, { point_id: 'b', amount: 2 }, { point_id: 'c', amount: 3 }, { point_id: 'd', amount: 4 }];
  const r = core.sentUpdatesFromReply(batch, { results: [{ status: 'applied' }, { status: 'unchanged' }, { status: 'held' }, { status: 'rejected', field: 'amount' }] });
  assert.deepEqual(Object.values(r.updates), [1, 2, 3]);
  assert.deepEqual(r.rejected.map(x => x.point_id), ['d']);
});

// ---- the runner, with a fake database and a fake SOLS Tokens ----
const { _runSync: runSync } = require('../backend/functions/sols-tokens-sync.js');
function fakeDb(tree) {
  const parts = p => p.split('/').filter(Boolean);
  const at = p => parts(p).reduce((o, k) => o?.[k], tree);
  return { tree, ref: p => ({ get: async () => ({ val: () => { const v = at(p); return v === undefined ? null : structuredClone(v); } }),
    update: async u => { const k = parts(p); let o = tree; for (const x of k) o = o[x] ??= {}; Object.assign(o, u); } }) };
}
const okReply = (batch, word = 'applied') => ({ status: 200, body: { ok: true, counts: { received: batch.length, applied: batch.length, unchanged: 0, held: 0, rejected: 0 }, results: batch.map(() => ({ status: word })) } });
const quiet = { warn() {}, info() {} };

test('practice send (dry run) never remembers anything as sent', async () => {
  const db = fakeDb({ studentRewards: root() }); const calls = [];
  const s = await runSync({ db, dryRun: true, log: quiet, sleepFn: async () => {}, send: async (b, d) => { calls.push(d); return okReply(b); } });
  assert.deepEqual(calls, [true]); assert.ok(s.applied > 0); assert.equal(db.tree.b3Private, undefined);
});
test('a real send remembers points, and a second run sends nothing', async () => {
  const db = fakeDb({ studentRewards: root() }); let n = 0;
  const send = async b => { n++; return okReply(b); };
  const first = await runSync({ db, send, log: quiet, sleepFn: async () => {} });
  const second = await runSync({ db, send, log: quiet, sleepFn: async () => {} });
  assert.equal(n, 1); assert.ok(first.toSend > 0); assert.equal(second.toSend, 0);
});
test('preview mode sends nothing at all', async () => {
  const db = fakeDb({ studentRewards: root() });
  const s = await runSync({ db, preview: true, log: quiet, send: async () => { throw new Error('must not send'); } });
  assert.ok(s.toSend > 0);
});
test('a wrong key (401) stops at once and remembers nothing', async () => {
  const db = fakeDb({ studentRewards: root() }); let n = 0;
  const s = await runSync({ db, log: quiet, sleepFn: async () => {}, send: async () => { n++; return { status: 401, body: { error: 'x' } }; } });
  assert.equal(n, 1); assert.equal(s.failedBatches, 1); assert.equal(db.tree.b3Private, undefined);
});
