'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function makeDatabase(seed) {
  const root = structuredClone(seed || {});
  const transactionFailures = new Map();
  const transactionQueues = new Map();
  const parts = path => String(path || '').split('/').filter(Boolean);
  const read = path => parts(path).reduce((value, key) => value?.[key], root) ?? null;
  const write = (path, value) => {
    const keys = parts(path);
    if (!keys.length) throw new Error('Root replacement is not used by this fixture.');
    let parent = root;
    for (const key of keys.slice(0, -1)) parent = parent[key] ||= {};
    if (value == null) delete parent[keys.at(-1)];
    else parent[keys.at(-1)] = structuredClone(value);
  };
  const snapshot = value => ({ val: () => value == null ? null : structuredClone(value), exists: () => value != null });
  const ref = path => ({
    get: async () => snapshot(read(path)),
    set: async value => { write(path, value); },
    transaction: update => {
      const previous = transactionQueues.get(path) || Promise.resolve();
      const operation = previous.then(() => {
        if ((transactionFailures.get(path) || 0) > 0) {
          transactionFailures.set(path, transactionFailures.get(path) - 1);
          throw new Error('Synthetic temporary transaction failure.');
        }
        const current = read(path);
        const next = update(current == null ? null : structuredClone(current));
        if (next === undefined) return { committed: false, snapshot: snapshot(current) };
        write(path, next);
        return { committed: true, snapshot: snapshot(read(path)) };
      });
      transactionQueues.set(path, operation.then(() => undefined, () => undefined));
      return operation;
    },
    update: async updates => { for (const [key, value] of Object.entries(updates)) write(key, value); },
    orderByChild() { return this; }, endAt() { return this; }, limitToFirst() { return this; },
  });
  return { ref, read, root, failNextTransaction: path => transactionFailures.set(path, 1) };
}

function fictionalClass() {
  const seed = { b3Games: {
    workspaces: { testSchool: { classes: {
      grade3: { active: true, toolGrants: { 'multiplayer-center': true }, members: {}, teacherIds: { teacher1: true }, multiplayerGameCoins: { win: 10, finish: 4, sportsmanship: 2, computerMultiplier: 0.5 } },
      grade4: { active: true, toolGrants: { 'multiplayer-center': true }, members: {} },
    }, teachers: {} } },
    students: {},
  } };
  for (const [studentId, name] of [['avi', 'Avi'], ['benny', 'Benny']]) {
    seed.b3Games.workspaces.testSchool.classes.grade3.members[studentId] = { name, active: true };
    seed.b3Games.students[studentId] = { memberships: { 'testSchool_grade3': {
      workspaceId: 'testSchool', classId: 'grade3', active: true,
    } } };
  }
  seed.b3Games.workspaces.testSchool.classes.grade4.members.chana = { name: 'Chana', active: true };
  seed.b3Games.students.chana = { memberships: { testSchool_grade4: { workspaceId: 'testSchool', classId: 'grade4', active: true } } };
  seed.b3Games.workspaces.testSchool.teachers.teacher1 = { active: true, role: 'teacher', classIds: { grade3: true }, displayName: 'Teacher One' };
  seed.b3Private = { multiplayerGames: { workspaces: { testSchool: { classes: {
    grade3: { coins: { balances: { avi: { name: 'Avi', coins: 18 } } } },
    grade4: { coins: { balances: { chana: { name: 'Chana', coins: 4 } } } },
  } } } } };
  return seed;
}

test('callable quick play joins two fictional classmates to one room and shared countdown', async () => {
  const database = makeDatabase(fictionalClass());
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  let adminMock, onCall;
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return adminMock;
    if (request === 'firebase-functions/v2/https') return { onCall: (_options, handler) => { onCall = handler; return handler; }, HttpsError };
    return originalLoad.call(this, request, parent, isMain);
  };
  let action;
  try {
    adminMock = { apps: [], initializeApp() { this.apps.push({}); }, database: () => database };
    delete require.cache[require.resolve('../backend/functions/multiplayer-games.js')];
    action = require('../backend/functions/multiplayer-games.js').multiplayerGameAction;
  } finally { Module._load = originalLoad; }

  const request = (studentId, data, classId = 'grade3') => action({
    auth: { uid: `auth_${studentId}`, token: { b3StudentId: studentId, b3StudentName: ({ avi: 'Avi', benny: 'Benny', chana: 'Chana' })[studentId], b3ClassId: classId } },
    data: { workspaceId: 'testSchool', classId, ...data },
  });
  const requestTeacher = data => action({
    auth: { uid: 'teacher1', token: { name: 'Teacher One' } },
    data: { workspaceId: 'testSchool', classId: 'grade3', ...data },
  });

  const policyRead = await requestTeacher({ action: 'get-coin-policy' });
  assert.deepEqual(policyRead.policy, { win: 10, finish: 4, sportsmanship: 2, computerMultiplier: 0.5 });
  await assert.rejects(request('avi', { action: 'set-coin-policy', policy: policyRead.policy }), /Only this class’s teacher/);
  await assert.rejects(requestTeacher({ action: 'set-coin-policy', policy: { ...policyRead.policy, win: Number.MAX_SAFE_INTEGER + 1 } }), /whole, non-negative/);
  await assert.rejects(requestTeacher({ action: 'set-coin-policy', policy: { ...policyRead.policy, computerMultiplier: 1 } }), /not including/);
  assert.deepEqual((await requestTeacher({ action: 'set-coin-policy', policy: policyRead.policy })).policy, policyRead.policy);

  const [aviSearch, bennySearch] = await Promise.all([
    request('avi', { action: 'quick-play', gameKey: 'tic-tac-toe' }),
    request('benny', { action: 'quick-play', gameKey: 'tic-tac-toe' }),
  ]);
  assert.deepEqual([aviSearch.status, bennySearch.status].sort(), ['matched', 'waiting']);
  const matchedSearch = aviSearch.status === 'matched' ? aviSearch : bennySearch;
  const roomCreator = aviSearch.status === 'matched' ? 'avi' : 'benny';
  const roomCode = matchedSearch.roomCode;
  assert.match(roomCode, /^\d{6}$/);
  const firstPoll = await request('avi', { action: 'quick-play', gameKey: 'tic-tac-toe' });
  assert.equal(firstPoll.roomCode, roomCode);
  const cancelAfterPairing = await request('avi', { action: 'cancel-quick-play', gameKey: 'tic-tac-toe' });
  assert.equal(cancelAfterPairing.status, 'room-assigned');
  assert.equal(cancelAfterPairing.roomCode, roomCode, 'cancelling after pairing must preserve the assigned room');

  await request('benny', { action: 'join', gameKey: 'tic-tac-toe', roomCode });
  await request('avi', { action: 'join', gameKey: 'tic-tac-toe', roomCode });
  const room = database.read(`b3Private/multiplayerGames/workspaces/testSchool/classes/grade3/rooms/${roomCode}`);
  const publicRoom = database.read(`multiplayerCenter/workspaces/testSchool/classes/grade3/strategyRooms/${roomCode}`);
  assert.deepEqual(Object.keys(room.players).sort(), ['avi', 'benny']);
  assert.equal(room.state, 'countdown');
  assert.equal(publicRoom.state, 'countdown');
  assert.equal(publicRoom.playerCount, 2);
  assert.ok(room.countdownAt > room.createdAt);

  // A callable retry by the original queue creator must repair mirrors from
  // the reserved room without reverting the newly joined players/countdown.
  const retry = await request(roomCreator, { action: 'quick-play', gameKey: 'tic-tac-toe' });
  assert.equal(retry.roomCode, roomCode);
  const retriedPublicRoom = database.read(`multiplayerCenter/workspaces/testSchool/classes/grade3/strategyRooms/${roomCode}`);
  assert.equal(retriedPublicRoom.state, 'countdown');
  assert.equal(retriedPublicRoom.playerCount, 2);

  const departingStudent = roomCreator === 'avi' ? 'benny' : 'avi';
  const remainingStudent = roomCreator === 'avi' ? 'avi' : 'benny';
  await request(departingStudent, { action: 'leave', gameKey: 'tic-tac-toe', roomCode });
  const abandonedCountdown = database.read(`b3Private/multiplayerGames/workspaces/testSchool/classes/grade3/rooms/${roomCode}`);
  assert.equal(abandonedCountdown.state, 'closed');
  await assert.rejects(
    request(remainingStudent, { action: 'countdown-start', gameKey: 'tic-tac-toe', roomCode }),
    /game room has closed/,
  );

  const otherClassSearch = await request('chana', { action: 'quick-play', gameKey: 'tic-tac-toe' }, 'grade4');
  assert.equal(otherClassSearch.status, 'waiting');
  assert.equal(otherClassSearch.roomCode, undefined, 'a student in another class must not join the grade 3 match');
  const fixtureRoom = {
    roomCode: '123456', gameKey: 'tic-tac-toe', host: 'avi', hostName: 'Avi', hostRole: 'student',
    state: 'lobby', playerCount: 1, createdAt: Date.now(), updatedAt: Date.now(),
  };
  await database.ref('multiplayerCenter/workspaces/testSchool/classes/grade3/rooms/arcade-123456').set(fixtureRoom);
  await database.ref('multiplayerCenter/workspaces/testSchool/classes/grade4/rooms/arcade-654321').set({
    ...fixtureRoom, roomCode: '654321', host: 'chana',
  });
  // Older race games publish waiting rooms as <gameKey>-<code>; those are listed, but a key that does not match its own code is not.
  await database.ref('multiplayerCenter/workspaces/testSchool/classes/grade3/rooms/gematria-5831').set({ ...fixtureRoom, roomCode: '5831', gameKey: 'gematria' });
  await database.ref('multiplayerCenter/workspaces/testSchool/classes/grade3/rooms/gematria-9999').set({ ...fixtureRoom, roomCode: '1111', gameKey: 'gematria' });
  const grade3Rooms = await request('avi', { action: 'list-rooms' });
  const grade4Rooms = await request('chana', { action: 'list-rooms' }, 'grade4');
  assert.deepEqual(Object.keys(grade3Rooms.rooms).sort(), ['arcade-123456', 'gematria-5831'], 'callable room listing only returns the signed-in class, including race rooms');
  assert.deepEqual(Object.keys(grade4Rooms.rooms), ['arcade-654321'], 'another class receives only its own room list');
  const lockedRoom = await request('chana', { action: 'create', gameKey: 'tic-tac-toe' }, 'grade4');
  const grade4Class = database.read('b3Games/workspaces/testSchool/classes/grade4');
  await database.ref('b3Games/workspaces/testSchool/classes/grade4').set({ ...grade4Class, access: { mode: 'locked' } });
  await assert.rejects(request('chana', { action: 'quick-play', gameKey: 'tic-tac-toe' }, 'grade4'), /locked for your class/);
  await assert.rejects(request('chana', { action: 'create', gameKey: 'tic-tac-toe' }, 'grade4'), /locked for your class/);
  const lockedChanaLeave = await request('chana', { action: 'leave', gameKey: 'tic-tac-toe', roomCode: lockedRoom.roomCode }, 'grade4');
  assert.equal(lockedChanaLeave.roomCode, lockedRoom.roomCode, 'a locked student may still leave a room');
  await database.ref('b3Games/workspaces/testSchool/classes/grade4').set(grade4Class);
  const grade3Scores = await request('avi', { action: 'leaderboard' });
  const grade4Scores = await request('chana', { action: 'leaderboard' }, 'grade4');
  assert.deepEqual(grade3Scores.leaderboard.map(row => row.studentId), ['avi']);
  assert.deepEqual(grade4Scores.leaderboard.map(row => row.studentId), ['chana']);
  assert.deepEqual(grade3Scores.balance, { peerCoins: 18, computerCoins: 0, totalCoins: 18 });
  assert.deepEqual(grade4Scores.balance, { peerCoins: 4, computerCoins: 0, totalCoins: 4 });

  const computerRoom = await request('avi', { action: 'create', gameKey: 'tic-tac-toe', computerOpponent: true });
  let computerState = database.read(`b3Private/multiplayerGames/workspaces/testSchool/classes/grade3/rooms/${computerRoom.roomCode}`);
  assert.equal(computerState.computerOpponent, true);
  assert.equal(computerState.state, 'playing');
  const coinLedgerPath = 'b3Private/multiplayerGames/workspaces/testSchool/classes/grade3/coins';
  database.failNextTransaction(coinLedgerPath);
  let settlementFailedOnce = false;
  for (let turn = 0; turn < 9 && computerState.state !== 'finished'; turn += 1) {
    const index = computerState.game.board.findIndex(cell => !cell);
    try {
      await request('avi', { action: 'move', gameKey: 'tic-tac-toe', roomCode: computerRoom.roomCode, move: { type: 'place', index } });
    } catch { settlementFailedOnce = true; }
    computerState = database.read(`b3Private/multiplayerGames/workspaces/testSchool/classes/grade3/rooms/${computerRoom.roomCode}`);
  }
  assert.equal(computerState.state, 'finished');
  assert.equal(settlementFailedOnce, true, 'the synthetic ledger outage should occur after the completed room is published');
  const aviCoinsPath = `${coinLedgerPath}/balances/avi`;
  await request('avi', { action: 'settle', gameKey: 'tic-tac-toe', roomCode: computerRoom.roomCode });
  const aviCoins = database.read(aviCoinsPath);
  assert.ok(aviCoins.computerCoins > 0);
  assert.equal(aviCoins.coins, 18, 'computer games must not change the peer leaderboard balance');
  assert.ok(database.read(`${coinLedgerPath}/awards/${computerState.awardId}`),
    'the receipt uses the room instance id, not its reusable short room code');
  const paidComputerCoins = aviCoins.computerCoins;
  await request('avi', { action: 'settle', gameKey: 'tic-tac-toe', roomCode: computerRoom.roomCode });
  await request('avi', { action: 'settle', gameKey: 'tic-tac-toe', roomCode: computerRoom.roomCode });
  assert.equal(database.read(aviCoinsPath).computerCoins, paidComputerCoins,
    'repeated settlement requests must not duplicate the reward');
  const updatedScore = await request('avi', { action: 'leaderboard' });
  assert.equal(updatedScore.balance.peerCoins, 18);
  assert.equal(updatedScore.balance.computerCoins, paidComputerCoins);
  assert.equal(updatedScore.balance.totalCoins, 18 + paidComputerCoins);
  assert.equal(updatedScore.leaderboard[0].coins, 18, 'computer match rewards do not affect class rank');
});
