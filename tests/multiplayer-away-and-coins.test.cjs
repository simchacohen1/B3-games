'use strict';

// Fictional-data tests: players who leave mid-game must not leave the others stuck,
// and finished games must report and save the coins each student earned.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const core = require('../backend/functions/multiplayer-games-core.cjs');

function loadBackend(dir) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return { apps: [{}], initializeApp() {}, database() { throw new Error('Unexpected Firebase access in unit test'); } };
    if (request === 'firebase-functions/v2/https') return { onCall: (_options, handler) => handler, HttpsError: class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(`../backend/${dir}/multiplayer-games.js`)._test; }
  finally { Module._load = originalLoad; }
}

const workspaceId = 'testSchool';
const classId = 'grade3';
const roomCode = '424242';
const roomPath = `b3Private/multiplayerGames/workspaces/${workspaceId}/classes/${classId}/rooms/${roomCode}`;
const publicPath = `multiplayerCenter/workspaces/${workspaceId}/classes/${classId}/strategyRooms/${roomCode}`;
const ledgerPath = `b3Private/multiplayerGames/workspaces/${workspaceId}/classes/${classId}/coins`;
const policyPath = `b3Games/workspaces/${workspaceId}/classes/${classId}/multiplayerGameCoins`;

function memoryDb(seed) {
  const root = structuredClone(seed || {});
  const keys = path => String(path || '').split('/').filter(Boolean);
  const read = path => keys(path).reduce((value, key) => value?.[key], root) ?? null;
  const write = (path, value) => {
    const parts = keys(path); let parent = root;
    for (const key of parts.slice(0, -1)) parent = parent[key] ||= {};
    if (value == null) delete parent[parts.at(-1)]; else parent[parts.at(-1)] = structuredClone(value);
  };
  const snap = value => ({ val: () => value == null ? null : structuredClone(value), exists: () => value != null });
  return {
    read, write,
    ref: path => ({
      get: async () => snap(read(path)),
      set: async value => write(path, value),
      update: async updates => { for (const [key, value] of Object.entries(updates)) write(key, value); },
      transaction: async update => {
        const next = update(read(path) == null ? null : structuredClone(read(path)));
        if (next === undefined) return { committed: false, snapshot: snap(read(path)) };
        write(path, next);
        return { committed: true, snapshot: snap(read(path)) };
      },
    }),
  };
}

const actor = (studentId, name = studentId) => ({ studentId, name, classId, workspaceId, actorRole: 'student' });
const POLICY = { win: 10, finish: 4, sportsmanship: 0, computerMultiplier: 0.5 };

function playingRoom(gameKey, ids, extra = {}) {
  const players = Object.fromEntries(ids.map((id, index) => [id, { name: id.toUpperCase(), role: 'student', active: true, joinedAt: index + 1 }]));
  const game = core.createGameState(gameKey, players, { seed: 7 });
  core.startGameState(gameKey, game, core.participantIds(players));
  return { roomCode, gameKey, host: ids[0], hostName: ids[0].toUpperCase(), state: 'playing', createdAt: Date.now(), updatedAt: Date.now(),
    startedAt: Date.now(), awardId: 'award-1', round: 1, players, game, ...extra };
}

for (const dir of ['functions', 'functions-staging']) {
  const { mutateRoom } = loadBackend(dir);

  test(`${dir}: host leaving a game in progress hands it over instead of closing it`, async () => {
    const db = memoryDb();
    db.write(roomPath, playingRoom('connect-four', ['avi', 'benny']));
    await mutateRoom(db, actor('avi'), 'connect-four', roomCode, 'leave');
    const room = db.read(roomPath);
    assert.equal(room.state, 'playing');
    assert.equal(room.host, 'benny');
    assert.ok(room.players.avi.leftAt > 0);
    const view = db.read(publicPath);
    assert.deepEqual(view.awayPlayers.map(p => p.studentId), ['avi'], 'the remaining player is told who left');

    // Leaving from a lobby still closes the room, as before.
    const lobby = playingRoom('connect-four', ['avi', 'benny']); lobby.state = 'lobby'; delete lobby.players.benny;
    db.write(roomPath, lobby);
    await mutateRoom(db, actor('avi'), 'connect-four', roomCode, 'leave');
    assert.equal(db.read(roomPath).state, 'closed');
  });

  test(`${dir}: the student who stays wins after the grace period and is paid coins`, async () => {
    const db = memoryDb();
    db.write(policyPath, POLICY);
    db.write(roomPath, playingRoom('tic-tac-toe', ['avi', 'benny']));
    await mutateRoom(db, actor('benny'), 'tic-tac-toe', roomCode, 'leave');
    await assert.rejects(mutateRoom(db, actor('avi'), 'tic-tac-toe', roomCode, 'claim-forfeit'), /a little longer/);
    db.write(`${roomPath}/players/benny/leftAt`, Date.now() - 60_000);
    await assert.rejects(mutateRoom(db, actor('benny'), 'tic-tac-toe', roomCode, 'claim-forfeit'), /Only a player/);
    const result = await mutateRoom(db, actor('avi'), 'tic-tac-toe', roomCode, 'claim-forfeit');
    assert.equal(result.public.state, 'finished');
    assert.equal(result.public.winner, 'avi');
    assert.deepEqual(result.public.forfeitBy, ['benny']);
    assert.deepEqual(result.coins, { configured: true, earned: 10, computerGame: false, peerCoins: 10, computerCoins: 0, totalCoins: 10 });
    const ledger = db.read(ledgerPath);
    assert.equal(ledger.balances.avi.coins, 10);
    assert.equal(ledger.balances.benny, undefined, 'the student who left earns nothing');

    const settle = await mutateRoom(db, actor('avi'), 'tic-tac-toe', roomCode, 'settle');
    assert.equal(settle.coins.earned, 10, 'settling again reports the same award');
    assert.equal(db.read(ledgerPath).balances.avi.coins, 10, 'and does not pay twice');
  });

  test(`${dir}: an absent player's turn passes on in a three-player game`, async () => {
    const db = memoryDb();
    db.write(roomPath, playingRoom('uno-style', ['avi', 'benny', 'chana']));
    const turnHolder = db.read(roomPath).game.turn;
    await mutateRoom(db, actor(turnHolder), 'uno-style', roomCode, 'leave');
    const stayer = ['avi', 'benny', 'chana'].find(id => id !== turnHolder);
    db.write(`${roomPath}/players/${turnHolder}/leftAt`, Date.now() - 60_000);
    const result = await mutateRoom(db, actor(stayer), 'uno-style', roomCode, 'claim-forfeit');
    assert.equal(result.public.state, 'playing');
    assert.notEqual(result.public.turn, turnHolder);
    assert.ok(result.public.players.some(p => p.studentId === result.public.turn), 'the turn moves to a player who is still here');
  });

  test(`${dir}: Math Race moves on when only the absent player had not answered`, async () => {
    const db = memoryDb();
    db.write(roomPath, playingRoom('math-race', ['avi', 'benny', 'chana']));
    const answer = db.read(roomPath).game.questions[0].answer;
    await mutateRoom(db, actor('avi'), 'math-race', roomCode, 'move', { type: 'answer', answer });
    await mutateRoom(db, actor('benny'), 'math-race', roomCode, 'move', { type: 'answer', answer });
    await mutateRoom(db, actor('chana'), 'math-race', roomCode, 'leave');
    db.write(`${roomPath}/players/chana/leftAt`, Date.now() - 60_000);
    const result = await mutateRoom(db, actor('avi'), 'math-race', roomCode, 'claim-forfeit');
    assert.equal(result.public.question.index, 2);
  });

  test(`${dir}: a rematch after a draw pays coins again for the new round`, async () => {
    const db = memoryDb();
    db.write(policyPath, POLICY);
    db.write(ledgerPath, { balances: {}, awards: { 'award-1': { avi: 4, benny: 4 } } });
    const room = playingRoom('tic-tac-toe', ['avi', 'benny'], { round: 2 });
    db.write(roomPath, room);
    const [x, o] = room.game.playersOrder;
    for (const [player, index] of [[x, 0], [o, 3], [x, 1], [o, 4], [x, 2]]) {
      await mutateRoom(db, actor(player), 'tic-tac-toe', roomCode, 'move', { type: 'place', index });
    }
    const ledger = db.read(ledgerPath);
    assert.deepEqual(ledger.awards['award-1_r2'], { [x]: 10, [o]: 4 });
    assert.equal(ledger.balances[x].coins, 10);
  });

  test(`${dir}: games report when the class has no coin rewards set`, async () => {
    const db = memoryDb();
    db.write(roomPath, playingRoom('tic-tac-toe', ['avi', 'benny']));
    await mutateRoom(db, actor('benny'), 'tic-tac-toe', roomCode, 'leave');
    db.write(`${roomPath}/players/benny/leftAt`, Date.now() - 60_000);
    const result = await mutateRoom(db, actor('avi'), 'tic-tac-toe', roomCode, 'claim-forfeit');
    assert.deepEqual(result.coins, { configured: false });
    assert.equal(db.read(ledgerPath), null);
  });
}
