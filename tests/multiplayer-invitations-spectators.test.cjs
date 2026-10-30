'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../backend/functions/multiplayer-games-core.cjs');
const { mutateRoom } = require('../backend/functions/multiplayer-games')._test;

const classId = 'class-a', workspaceId = 'test-workspace', roomCode = '123456';
const roomPath = `b3Private/multiplayerGames/workspaces/${workspaceId}/classes/${classId}/rooms/${roomCode}`;
const actor = (studentId, name = studentId) => ({ studentId, name, classId, workspaceId });
function makeRoom(withGuest = false) {
  const players = { a: { name: 'Alef', active: true, joinedAt: 1 } };
  if (withGuest) players.b = { name: 'Beis', active: true, joinedAt: 2 };
  return {
    roomCode, gameKey: 'tic-tac-toe', host: 'a', hostName: 'Alef',
    state: 'lobby', createdAt: Date.now(), updatedAt: Date.now(),
    allowSpectators: false, players, game: core.createGameState('tic-tac-toe', players),
  };
}
function databaseWith(initial) {
  let room = structuredClone(initial);
  const writes = [];
  return {
    current: () => structuredClone(room), writes,
    ref(path) {
      if (!path) return { update: async values => writes.push(structuredClone(values)) };
      if (path !== roomPath) throw new Error('Unexpected path ' + path);
      return {
        transaction: async change => {
          const result = change(structuredClone(room));
          if (result === undefined) return { committed: false, snapshot: { val: () => structuredClone(room) } };
          room = result;
          return { committed: true, snapshot: { val: () => structuredClone(room) } };
        },
      };
    },
  };
}
const act = (db, id, action, move, validatedInvite) =>
  mutateRoom(db, actor(id), 'tic-tac-toe', roomCode, action, move, validatedInvite);

test('a full two-player room refuses a third active player', async () => {
  const db = databaseWith(makeRoom(true));
  await assert.rejects(act(db, 'c', 'join'), /full or has already started/);
  assert.equal(db.current().players.c, undefined);
});

test('the host can reserve a playing spot for one eligible classmate', async () => {
  const db = databaseWith(makeRoom());
  await act(db, 'a', 'invite-target', { studentId: 'b' }, { studentId: 'b', name: 'Beis' });
  assert.equal(db.current().invitedStudentId, 'b');
  assert.equal(db.writes.at(-1)[`multiplayerCenter/workspaces/${workspaceId}/classes/${classId}/rooms/arcade-${roomCode}`].invitedStudentId, 'b');
  await assert.rejects(act(db, 'c', 'join'), /reserved/);
  await act(db, 'b', 'join');
  assert.equal(db.current().invitedStudentId, undefined);
  assert.equal(db.current().players.b.active, true);
  await assert.rejects(act(db, 'c', 'join'), /full/);
});

test('non-hosts cannot send personal invitations, and unverified targets are rejected', async () => {
  const db = databaseWith(makeRoom());
  await assert.rejects(act(db, 'b', 'invite-target', { studentId: 'c' }, { studentId: 'c', name: 'Gimmel' }), /Only the host/);
  await assert.rejects(act(db, 'a', 'invite-target', { studentId: 'c' }), /eligible classmate/);
});

test('spectators require host permission and cannot take a playing spot or move', async () => {
  const db = databaseWith(makeRoom(true));
  await assert.rejects(act(db, 'c', 'spectate'), /Spectators are not allowed/);
  await assert.rejects(act(db, 'b', 'spectators', { allow: true }), /Only the host/);
  await act(db, 'a', 'spectators', { allow: true });
  await act(db, 'a', 'start');
  await act(db, 'c', 'spectate');
  assert.equal(db.current().spectators.c.name, 'c');
  assert.deepEqual(core.participantIds(db.current().players), ['a', 'b']);
  await assert.rejects(act(db, 'c', 'move', { type: 'place', index: 0 }), /Join this room/);
  await assert.rejects(act(db, 'c', 'join'), /full or has already started/);
});

test('spectators queue in order without duplicates and may cancel', async () => {
  const db = databaseWith(makeRoom(true));
  await act(db, 'a', 'spectators', { allow: true });
  await act(db, 'c', 'spectate');
  await act(db, 'd', 'spectate');
  await act(db, 'c', 'queue-winner');
  await act(db, 'c', 'queue-winner');
  await act(db, 'd', 'queue-winner');
  assert.deepEqual(db.current().winnerQueue, ['c', 'd']);
  await act(db, 'c', 'unqueue-winner');
  assert.deepEqual(db.current().winnerQueue, ['d']);
  await act(db, 'c', 'leave');
  assert.equal(db.current().spectators.c, undefined);
});

test('winner chooses next challenger and old opponent becomes spectator', async () => {
  const room = makeRoom(true), db = databaseWith(room);
  await act(db, 'a', 'spectators', { allow: true });
  await act(db, 'c', 'spectate');
  await act(db, 'd', 'spectate');
  await act(db, 'c', 'queue-winner');
  await act(db, 'd', 'queue-winner');
  await act(db, 'a', 'start');
  db.current(); // Intentionally obtain a copy: match end below occurs through valid moves.
  for (const [id, index] of [['a',0], ['b',3], ['a',1], ['b',4], ['a',2]])
    await act(db, id, 'move', { type: 'place', index });
  assert.equal(db.current().state, 'finished');
  assert.equal(db.current().game.winner, 'a');
  await assert.rejects(act(db, 'b', 'next-round'), /winner must choose/i);
  await act(db, 'a', 'next-round');
  const next = db.current();
  assert.equal(next.state, 'playing');
  assert.deepEqual(core.participantIds(next.players), ['a','c']);
  assert.equal(next.spectators.b.name, 'Beis');
  assert.deepEqual(next.winnerQueue, ['d']);
  assert.equal(next.game.finished, false);
  assert.equal(next.round, 2);
});

test('turning off spectators clears queue and rejects future spectators', async () => {
  const db = databaseWith(makeRoom(true));
  await act(db, 'a', 'spectators', { allow: true });
  await act(db, 'c', 'spectate');
  await act(db, 'c', 'queue-winner');
  await act(db, 'a', 'spectators', { allow: false });
  assert.deepEqual(db.current().winnerQueue, []);
  assert.deepEqual(db.current().spectators, {});
  await assert.rejects(act(db, 'd', 'spectate'), /Spectators are not allowed/);
});

test('drawn games can be restarted by players only', async () => {
  const db = databaseWith(makeRoom(true));
  await act(db, 'a', 'start');
  for (const [id,index] of [['a',0],['b',1],['a',2],['b',4],['a',3],['b',5],['a',7],['b',6],['a',8]])
    await act(db, id, 'move', { type: 'place', index });
  assert.equal(db.current().game.draw, true);
  await assert.rejects(act(db, 'c', 'rematch-draw'), /current players/);
  await act(db, 'a', 'rematch-draw');
  assert.equal(db.current().state, 'playing');
  assert.equal(db.current().game.moves || 0, 0);
});
