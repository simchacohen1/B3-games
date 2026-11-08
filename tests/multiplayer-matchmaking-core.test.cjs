'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../backend/functions/multiplayer-matchmaking-core.cjs');

test('quick play pairs only fresh students in the same queue, oldest first', () => {
  const q = core.queueKey('fictional-workspace', 'fictional-class', 'tic-tac-toe');
  assert.equal(q, 'fictional-workspace:fictional-class:tic-tac-toe');
  const now = 200_000;
  const entries = { newer: { status: 'waiting', createdAt: 199_990 }, older: { status: 'waiting', createdAt: 199_900 }, stale: { status: 'waiting', createdAt: 1 }, busy: { status: 'playing', createdAt: 199_995 }, invited: { status: 'waiting', inviteLocked: true, createdAt: 199_800 } };
  assert.deepEqual(core.availableEntries(entries, now, 'newer').map(([id]) => id), ['older']);
  assert.throws(() => core.queueKey('../other', 'fictional-class', 'tic-tac-toe'), /Invalid/);
});

test('leaderboard filters bots and limits rows without mixing ties unpredictably', () => {
  const rows = { a: { name: 'Avi', coins: 12 }, b: { name: 'Benny', coins: 12 }, c: { name: 'Chana', coins: -1 }, bot_cpu: { name: 'Computer', coins: 999 }, d: { name: 'Dovi', coins: 10, computer: true } };
  assert.deepEqual(core.leaderboard(rows).map(x => [x.studentId, x.coins]), [['a', 12], ['b', 12], ['c', 0]]);
  assert.equal(core.leaderboard(rows, 1).length, 1);
  assert.deepEqual(core.leaderboard({ avi: { name: 'Avi', coins: 0, computerCoins: 5000 } }).map(row => row.coins), [0]);
});

test('sequential queue transactions pair two fictional classmates exactly once and share one room assignment', () => {
  const first = core.enqueue({}, 'avi', 10_000);
  const second = core.enqueue(first.entries, 'benny', 10_100, 'room-123');
  assert.equal(first.status, 'waiting');
  assert.equal(second.status, 'matched');
  assert.equal(second.entries.avi.matchedWith, 'benny');
  assert.equal(second.entries.avi.roomCode, 'room-123');
  assert.equal(second.entries.benny.roomCode, 'room-123');
  const retry = core.enqueue(second.entries, 'avi', 10_200);
  assert.equal(retry.roomCode, 'room-123');
  assert.equal(Object.values(retry.entries).filter(entry => entry.matchedWith).length, 2);
});

test('direct invitation reserves both students from quick play until the invite is resolved', () => {
  let queue = core.enqueue({}, 'avi', 2_000).entries;
  queue = core.reserveForInvite(queue, ['avi', 'benny'], 2_100, 'invite-77');
  assert.deepEqual(core.availableEntries(queue, 2_200).map(([id]) => id), []);
  assert.equal(queue.avi.inviteLocked, true);
  const quickPlayAttempt = core.enqueue(queue, 'avi', 2_150, 'should-not-match');
  assert.equal(quickPlayAttempt.status, 'invite-locked');
  assert.equal(quickPlayAttempt.entries.avi.inviteId, 'invite-77');
  const cancelAttempt = core.cancelQueue(queue, 'avi', 2_160);
  assert.equal(cancelAttempt.status, 'invite-locked');
  assert.equal(cancelAttempt.entries.avi.inviteLocked, true);
  queue = core.releaseInvite(queue, 'invite-77', 2_300);
  assert.equal(queue.avi.inviteLocked, undefined);
  assert.equal(queue.benny.inviteLocked, undefined);
  assert.deepEqual(core.availableEntries(queue, 2_300).map(([id]) => id), ['avi', 'benny']);
  assert.throws(() => core.reserveForInvite(queue, ['../benny'], 2_400, 'invite-78'), /Invalid/);
});

test('quick play cancellation removes a waiter, restores unmatched partner, and keeps assigned rooms intact', () => {
  const waiting = core.enqueue({}, 'avi', 10_000).entries;
  assert.equal(core.cancelQueue(waiting, 'avi', 10_100).status, 'cancelled');
  const paired = core.enqueue(waiting, 'benny', 10_200, 'room-777').entries;
  const cancelled = core.cancelQueue(paired, 'benny', 10_300);
  assert.equal(cancelled.status, 'room-assigned');
  assert.equal(cancelled.roomCode, 'room-777');
  const unmatched = { avi: { status: 'matched', matchedWith: 'benny' }, benny: { status: 'matched', matchedWith: 'avi' } };
  const result = core.cancelQueue(unmatched, 'avi', 10_400);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.entries.benny.status, 'waiting');
  assert.equal(result.entries.avi, undefined);
});

test('a shared countdown aborts as soon as fewer than two human players remain', () => {
  const room = { state: 'countdown', players: { avi: { active: true, role: 'student' }, benny: { active: true, role: 'student' } } };
  assert.equal(core.shouldAbortCountdown(room), false);
  room.players.avi.active = false;
  assert.equal(core.shouldAbortCountdown(room), true);
  assert.equal(core.shouldAbortCountdown({ state: 'playing', players: {} }), false);
});

test('game coin ledger requires configurable policy, excludes abandons and awards a room once', () => {
  const policy = { win: 12, finish: 3, sportsmanship: 2, computerMultiplier: 0.5 };
  const results = [
    { studentId: 'avi', name: 'Avi', outcome: 'win', sportsmanship: true },
    { studentId: 'avi', name: 'Avi', outcome: 'win', sportsmanship: true },
    { studentId: 'benny', name: 'Benny', outcome: 'loss', computerOpponent: true },
    { studentId: 'bot_cpu', outcome: 'loss' },
    { studentId: 'chana', outcome: 'loss', abandoned: true },
  ];
  const first = core.awardGameCoins({}, 'room-555', results, policy);
  assert.deepEqual(first.existing, { avi: 14, benny: 1 });
  const replay = core.awardGameCoins(first.ledger, 'room-555', results, policy);
  assert.equal(replay.awarded, false);
  assert.equal(replay.ledger.balances.avi.coins, 14);
  assert.equal(replay.ledger.balances.benny.coins, 0);
  assert.equal(replay.ledger.balances.benny.computerCoins, 1);
  assert.equal(replay.ledger.balances.chana, undefined);
  assert.equal(replay.ledger.balances.bot_cpu, undefined);
  assert.throws(() => core.awardGameCoins({}, 'room-556', results, null), /not configured/);
  assert.throws(() => core.awardGameCoins({}, 'room-556', results, { ...policy, win: Number.MAX_SAFE_INTEGER + 1 }), /not configured/);
  assert.throws(() => core.awardGameCoins({}, 'room-558', results, { ...policy, computerMultiplier: 1 }), /not configured/);
  const corrupt = { balances: { avi: { coins: Number.MAX_SAFE_INTEGER } }, awards: {} };
  assert.throws(() => core.awardGameCoins(corrupt, 'room-557', [{ studentId: 'avi', outcome: 'win' }], policy), /balance limit/);
});

test('completion results include only active students and distinguish winner, draw and unfinished games', () => {
  const finished = { state: 'finished', game: { finished: true, winner: 'avi', draw: false }, players: {
    avi: { role: 'student', name: 'Avi', active: true }, benny: { role: 'student', name: 'Benny', active: true },
    teacher_1: { role: 'teacher', name: 'Teacher', active: true }, chana: { role: 'student', active: false }, bot_cpu: { role: 'computer', active: true },
  } };
  assert.deepEqual(core.completionResults(finished), [
    { studentId: 'avi', name: 'Avi', outcome: 'win', abandoned: false, computerOpponent: false },
    { studentId: 'benny', name: 'Benny', outcome: 'loss', abandoned: false, computerOpponent: false },
  ]);
  assert.deepEqual(core.completionResults({ ...finished, state: 'playing' }), []);
});
