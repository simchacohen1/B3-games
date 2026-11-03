'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const core = require('../backend/functions/multiplayer-games-core.cjs');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'firebase-admin') return { apps: [{}], initializeApp() {}, database() { throw new Error('Unexpected Firebase access in unit test'); } };
  if (request === 'firebase-functions/v2/https') return { onCall: (_options, handler) => handler, HttpsError: class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } } };
  return originalLoad.call(this, request, parent, isMain);
};
const { mutateRoom, reserveMatchmakingRoom, publishMatchmakingMirror } = require('../backend/functions/multiplayer-games')._test;
Module._load = originalLoad;

const workspaceId = 'test-workspace';
const classId = 'test-class';
const roomCode = '123456';
const roomPath = 'b3Private/multiplayerGames/workspaces/' + workspaceId + '/classes/' + classId + '/rooms/' + roomCode;
const handsPath = roomPath + '/hands';

function databaseWith(room) {
  let current = structuredClone(room);
  const writes = [];
  return {
    writes,
    current: () => structuredClone(current),
    ref(path) {
      if (!path) return { update: async values => { writes.push(structuredClone(values)); } };
      if (path !== roomPath) throw new Error('Unexpected database path: ' + path);
      return {
        transaction: async update => {
          const next = update(structuredClone(current));
          if (next === undefined) return { committed: false, snapshot: { val: () => structuredClone(current) } };
          current = next;
          return { committed: true, snapshot: { val: () => structuredClone(current) } };
        },
      };
    },
  };
}

function actor(studentId, name) {
  return { studentId, name, classId, workspaceId };
}

test('concurrent matchmaking room reservations preserve the first room state', async () => {
  const path = '/private/match/123456';
  let current = null;
  let serial = Promise.resolve();
  const db = { ref: requestedPath => {
    assert.equal(requestedPath, path);
    return { transaction: update => {
      const run = serial.then(() => {
        const next = update(structuredClone(current));
        if (next !== undefined) current = next;
        return { committed: next !== undefined, snapshot: { val: () => structuredClone(current) } };
      });
      serial = run.then(() => undefined);
      return run;
    } };
  } };
  const initial = { roomCode: '123456', gameKey: 'tic-tac-toe', host: 'avi', matchmaking: true, state: 'lobby', players: { avi: { active: true } } };
  const changed = { ...initial, state: 'playing', players: { ...initial.players, benny: { active: true } } };
  const [first, retry] = await Promise.all([
    reserveMatchmakingRoom(db, path, initial, 'tic-tac-toe', 'avi'),
    reserveMatchmakingRoom(db, path, changed, 'tic-tac-toe', 'avi'),
  ]);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(current, initial);
});

test('matchmaking retry repairs a missing mirror and rejects stale mirror state', async () => {
  let current = null;
  const db = { ref: () => ({ transaction: async update => {
    const next = update(structuredClone(current));
    if (next !== undefined) current = next;
    return { committed: next !== undefined, snapshot: { val: () => structuredClone(current) } };
  } }) };
  await publishMatchmakingMirror(db, '/public/match', { state: 'lobby', updatedAt: 10 }, 10);
  assert.deepEqual(current, { state: 'lobby', updatedAt: 10 });
  await publishMatchmakingMirror(db, '/public/match', { state: 'playing', updatedAt: 20 }, 20);
  await publishMatchmakingMirror(db, '/public/match', { state: 'lobby', updatedAt: 10 }, 10);
  assert.deepEqual(current, { state: 'playing', updatedAt: 20 });
});

test('a student can leave and rejoin a playing room without losing private cards or game progress', async () => {
  const players = {
    host: { name: 'Host', active: true, joinedAt: 1 },
    guest: { name: 'Guest', active: true, joinedAt: 2 },
  };
  const game = {
    deck: [{ id: 3, rank: 3, suit: 0 }],
    hands: { host: [{ id: 0, rank: 0, suit: 0 }], guest: [{ id: 1, rank: 1, suit: 0 }] },
    books: { host: [], guest: [2] },
    playersOrder: ['host', 'guest'],
    turn: 'guest',
    winner: null,
    draw: false,
    finished: false,
    moves: 4,
  };
  const db = databaseWith({
    roomCode, gameKey: 'go-fish', host: 'host', hostName: 'Host', state: 'playing',
    createdAt: Date.now(), updatedAt: Date.now(), startedAt: Date.now(), players, game,
  });

  await mutateRoom(db, actor('guest', 'Guest'), 'go-fish', roomCode, 'leave');
  let room = db.current();
  assert.equal(room.state, 'playing', 'a non-host leaving does not close the room');
  assert.equal(room.players.guest.active, false);
  assert.deepEqual(core.participantIds(room.players), ['host']);
  assert.equal(db.writes.at(-1)[handsPath + '/guest'], null, 'leaving clears the private hand path');

  await mutateRoom(db, actor('guest', 'Guest'), 'go-fish', roomCode, 'join');
  room = db.current();
  assert.equal(room.state, 'playing');
  assert.equal(room.players.guest.active, true);
  assert.deepEqual(core.participantIds(room.players), ['host', 'guest']);
  assert.deepEqual(room.game.hands.guest, [{ id: 1, rank: 1, suit: 0 }]);
  assert.deepEqual(room.game.books.guest, [2]);
  assert.equal(room.game.moves, 4);
  assert.deepEqual(db.writes.at(-1)[handsPath + '/guest'], { hand: [{ id: 1, rank: 1, suit: 0 }] },
    'rejoining restores the student-only hand path');
});

test('a new student cannot join after a room has started', async () => {
  const players = {
    host: { name: 'Host', active: true, joinedAt: 1 },
    guest: { name: 'Guest', active: true, joinedAt: 2 },
  };
  const db = databaseWith({
    roomCode, gameKey: 'connect-four', host: 'host', state: 'playing', createdAt: Date.now(), updatedAt: Date.now(),
    players,
    game: core.createGameState('connect-four', players),
  });

  await assert.rejects(
    mutateRoom(db, actor('new-student', 'New Student'), 'connect-four', roomCode, 'join'),
    /This game is full or has already started/,
  );
  assert.equal(db.current().players['new-student'], undefined);
});
