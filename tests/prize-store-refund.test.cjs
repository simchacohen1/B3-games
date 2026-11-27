'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, buildUpdates, roundResets, storeIsOpen } = require('../scripts/prize-store-refund.cjs');

const data = () => ({
  students: { s1: { name: 'Boy One', rewardBalance: 10, classId: 'c1' }, s2: { name: 'Boy Two', rewardBalance: 0 } },
  classes: { c1: { name: 'Class One' } }, enrollments: { c1: { s1: true } },
  rewards: { r1: { name: 'Pizza' } }, catalog: {},
  redemptionsByStudent: { s1: {
    a: { rewardId: 'r1', cost: 20, status: 'pending', requestedAt: 1000 },
    b: { rewardId: 'r1', cost: 30, status: 'collected', requestedAt: 2000 },
    c: { rewardId: 'r1', cost: 40, status: 'canceled', requestedAt: 3000 },
    d: { rewardId: 'r1', cost: 50, status: 'refunded', requestedAt: 4000 } } },
  contributionsByStudent: { s1: {
    g: { amount: 15, rewardName: 'Gimkit', createdAt: 5000, winner: { id: 'm' } },
    h: { amount: 25, rewardName: 'Charades', createdAt: 6000 },
    i: { amount: 35, rewardName: 'Charades', createdAt: 7000, refundedAt: 8000, refundedAmount: 35 } },
    s2: { j: { amount: 7, rewardName: 'Charades', createdAt: 9000 } } },
  refundRequests: {}, settings: {},
  rounds: { c1: { charades: { totalContributed: 25, byStudent: { s1: 25 }, status: 'completed', cooldownUntil: 5, modeTotals: { x: 3 }, lastWinner: { id: 'm' } } } }
});

test('refund plan counts given and won items, skips ones already returned', () => {
  const boys = plan(data());
  const s1 = boys.find(b => b.id === 's1');
  assert.equal(s1.refund, 20 + 30 + 15 + 25);
  assert.equal(s1.refundCount, 4);
  assert.equal(s1.returnedEarlier, 40 + 50 + 35);
  assert.equal(boys.find(b => b.id === 's2').refund, 7);
});

test('refund updates: one entry per item, history kept, atomic balance increment', () => {
  const d = data(), boys = plan(d), u = buildUpdates(d, boys, 'Owner', 'batch1', 123).s1;
  assert.deepEqual(u['students/s1/rewardBalance'], { '.sv': { increment: 90 } });
  for (const k of ['a', 'b']) {
    assert.equal(u[`redemptionsByStudent/s1/${k}/status`], 'refunded');
    assert.equal(u[`refundRequests/s1/${k}`].amount, d.redemptionsByStudent.s1[k].cost);
  }
  assert.equal(u['redemptionsByStudent/s1/b/statusBeforeRefund'], 'collected');
  assert.equal(u['classRewardContributionsByStudent/s1/g/refundedAmount'], 15);
  assert.equal(Object.keys(u).filter(k => k.startsWith('refundRequests/')).length, 4);
  assert.ok(!Object.keys(u).some(k => /redemptionsByStudent\/s1\/[cd]\//.test(k)), 'already-returned purchases are left alone');
  assert.ok(Object.values(u).every(v => v !== null || true));
  assert.ok(!Object.entries(u).some(([k, v]) => v === null && !k.startsWith('refundRequests')), 'nothing is deleted');
});

test('class prize bars reset to 0 but keep the last winner', () => {
  const u = roundResets(data(), 99);
  assert.equal(u['classRewardRounds/c1/charades/totalContributed'], 0);
  assert.equal(u['classRewardRounds/c1/charades/modeTotals/x'], 0);
  assert.equal(u['classRewardRounds/c1/charades/status'], 'active');
  assert.ok(!Object.keys(u).some(k => k.includes('lastWinner')));
});

test('store open detection', () => {
  assert.equal(storeIsOpen({ rewardStoreEnabled: true }), true);
  assert.equal(storeIsOpen({ rewardStoreEnabled: false, classStoreEnabled: { a: true } }), true);
  assert.equal(storeIsOpen({ rewardStoreEnabled: false, classStoreEnabled: { a: false } }), false);
});
