'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../backend/functions/multiplayer-games-core.cjs');

function players(...ids) {
  return Object.fromEntries(ids.map((id, index) => [id, { name: id, active: true, joinedAt: index + 1 }]));
}
function start(gameKey, ids, seed = 3) {
  const group = players(...ids);
  const state = core.createGameState(gameKey, group, { seed });
  core.startGameState(gameKey, state, core.participantIds(group));
  return { group, state };
}

test('RTDB-omitted empty arrays and null-only boards hydrate to safe game defaults', () => {
  assert.deepEqual(core.hydrateGameState('connect-four', { turn: 'a' }).board, Array(42).fill(''));
  const sparseBoard = core.hydrateGameState('reversi', { board: { 27: 'red', 28: 'yellow', 35: 'yellow', 36: 'red' } }).board;
  assert.deepEqual([sparseBoard[20], sparseBoard[27], sparseBoard[28], sparseBoard[36]], ['', 'red', 'yellow', 'red']);
  assert.deepEqual(core.hydrateGameState('memory-match', { deck: [], turn: 'a' }).matched, []);
  const books = core.hydrateGameState('go-fish', { playersOrder: ['a', 'b'], hands: {} }).books;
  assert.deepEqual(books, { a: [], b: [] });
});

test('hand-based games do not publish empty private paths during room creation', () => {
  const group = players('a');
  for (const gameKey of ['dominoes', 'go-fish', 'uno-style']) {
    const state = core.createGameState(gameKey, group, { seed: 11 });
    assert.deepEqual(core.privateView(gameKey, state, 'a'), { hand: [] });
    assert.equal(core.privateView(gameKey, state, 'a').hand.length, 0);
  }
});

test('Uno restores its RTDB-omitted null color before the next public room update', () => {
  const state = core.hydrateGameState('uno-style', { deck: [], discard: [], hands: {}, playersOrder: ['a', 'b'] });
  const room = { roomCode: '123456', gameKey: 'uno-style', host: 'a', hostName: 'a', state: 'lobby', createdAt: 1, players: players('a', 'b') };
  assert.equal(state.color, null);
  assert.equal(core.publicView('uno-style', state, room, 2).color, null);
});

test('Connect 4 drops into the lowest open cell and detects a horizontal four', () => {
  const { group, state } = start('connect-four', ['a', 'b']);
  for (const column of [0, 1, 0, 1, 0, 1, 0]) {
    const actor = state.turn;
    core.applyMove('connect-four', state, actor, { type: 'drop', column }, group);
  }
  assert.equal(state.finished, true);
  assert.equal(state.winner, 'a');
  assert.equal(state.board[5 * 7], 'red');
  assert.throws(() => core.applyMove('connect-four', state, 'b', { type: 'drop', column: 0 }, group), /finished/);
});

test('Connect 4 rejects full columns, out-of-turn moves, and invalid columns', () => {
  const { group, state } = start('connect-four', ['a', 'b']);
  assert.throws(() => core.applyMove('connect-four', state, 'b', { type: 'drop', column: 0 }, group), /turn/);
  assert.throws(() => core.applyMove('connect-four', state, 'a', { type: 'drop', column: 7 }, group), /column/);
  for (let i = 0; i < 6; i += 1) state.board[i * 7 + 3] = 'yellow';
  assert.throws(() => core.applyMove('connect-four', state, 'a', { type: 'drop', column: 3 }, group), /full/);
});

test('Tic Tac Toe assigns marks on the server and detects a diagonal win', () => {
  const { group, state } = start('tic-tac-toe', ['a', 'b']);
  for (const [actor, index] of [['a', 0], ['b', 1], ['a', 4], ['b', 2], ['a', 8]]) {
    core.applyMove('tic-tac-toe', state, actor, { type: 'place', index, mark: 'O' }, group);
  }
  assert.deepEqual(state.board, ['X', 'O', 'O', '', 'X', '', '', '', 'X']);
  assert.equal(state.winner, 'a');
  assert.equal(state.finished, true);
});

test('Tic Tac Toe rejects a taken square and records a draw', () => {
  const { group, state } = start('tic-tac-toe', ['a', 'b']);
  core.applyMove('tic-tac-toe', state, 'a', { type: 'place', index: 0 }, group);
  assert.throws(() => core.applyMove('tic-tac-toe', state, 'b', { type: 'place', index: 0 }, group), /taken/);
  for (const [actor, index] of [['b',1],['a',2],['b',4],['a',3],['b',5],['a',7],['b',6],['a',8]]) {
    core.applyMove('tic-tac-toe', state, actor, { type: 'place', index }, group);
  }
  assert.equal(state.draw, true);
  assert.equal(state.finished, true);
  assert.equal(state.winner, null);
});

test('Memory Match hides the deck, scores pairs, rotates after a miss, and ends cleanly', () => {
  const { group, state } = start('memory-match', ['a', 'b'], 17);
  const view = core.publicView('memory-match', state, { roomCode: '123456', state: 'playing', players: group });
  assert.equal('deck' in view, false);
  assert.equal('solution' in view, false);
  const pairs = new Map();
  state.deck.forEach((card, index) => pairs.set(card.pair, [...(pairs.get(card.pair) || []), index]));
  const [firstPair, firstPairOther] = [...pairs.values()].find(indexes => indexes.length === 2);
  const missA = state.deck.findIndex((card, index) => index !== firstPair && index !== firstPairOther && card.pair !== state.deck[firstPair].pair);
  const missB = state.deck.findIndex((card, index) => index !== missA && index !== firstPair && index !== firstPairOther && card.pair !== state.deck[missA].pair);
  core.applyMove('memory-match', state, 'a', { type: 'flip', index: missA }, group);
  core.applyMove('memory-match', state, 'a', { type: 'flip', index: missB }, group);
  assert.equal(state.turn, 'b');
  core.applyMove('memory-match', state, 'b', { type: 'flip', index: firstPair }, group);
  assert.equal(state.flipped.length, 1, 'a new turn hides the old unmatched cards');
  core.applyMove('memory-match', state, 'b', { type: 'flip', index: firstPairOther }, group);
  assert.equal(state.scores.b, 1);
  assert.equal(state.turn, 'b', 'a found pair earns another turn');
  const matchedView = core.publicView('memory-match', state, { roomCode: '123456', state: 'playing', players: group });
  assert.equal(matchedView.visibleCards.find(card => card.index === firstPair).face, state.deck[firstPair].face);
  assert.equal('deck' in matchedView, false);
  assert.equal(core.privateView('memory-match', state, 'a').hand, undefined);
});

test('Memory Match rejects duplicate cards, illegal turns, and impossible player counts', () => {
  const group = players('a', 'b');
  const state = core.createGameState('memory-match', group, { seed: 99 });
  core.startGameState('memory-match', state, core.participantIds(group));
  core.applyMove('memory-match', state, 'a', { type: 'flip', index: 0 }, group);
  assert.throws(() => core.applyMove('memory-match', state, 'a', { type: 'flip', index: 0 }, group), /face up/);
  assert.throws(() => core.applyMove('memory-match', state, 'b', { type: 'flip', index: 1 }, group), /turn/);
  assert.throws(() => core.startGameState('memory-match', state, ['a']), /another player/);
  assert.throws(() => core.createGameState('not-a-game', group), /Unknown/);
});

test('Memory Match can finish all pairs and declares the highest score the winner', () => {
  const { group, state } = start('memory-match', ['a', 'b'], 123);
  const pairs = new Map();
  state.deck.forEach((card, index) => pairs.set(card.pair, [...(pairs.get(card.pair) || []), index]));
  for (const indexes of pairs.values()) {
    const player = state.turn;
    core.applyMove('memory-match', state, player, { type: 'flip', index: indexes[0] }, group);
    core.applyMove('memory-match', state, player, { type: 'flip', index: indexes[1] }, group);
  }
  assert.equal(state.finished, true);
  assert.equal(state.winner, 'a');
  assert.equal(state.scores.a, 8);
});

test('Checkers enforces turn ownership, required captures, continuing jumps, and promotion', () => {
  const { group, state } = start('checkers', ['a', 'b']);
  state.board.fill('');
  state.board[42] = 'red'; state.board[40] = 'red'; state.board[33] = 'yellow'; state.board[17] = 'yellow'; state.board[7] = 'yellow';
  assert.throws(() => core.applyMove('checkers', state, 'a', { type: 'move', from: 40, to: 32 }, group), /capture/);
  core.applyMove('checkers', state, 'a', { type: 'move', from: 42, to: 24 }, group);
  assert.equal(state.turn, 'a');
  assert.equal(state.continuingFrom, 24);
  assert.throws(() => core.applyMove('checkers', state, 'a', { type: 'move', from: 24, to: 17 }, group), /capture/);
  core.applyMove('checkers', state, 'a', { type: 'move', from: 24, to: 10 }, group);
  assert.equal(state.board[17], '');
  assert.equal(state.turn, 'b');
  assert.throws(() => core.applyMove('checkers', state, 'b', { type: 'move', from: 10, to: 1 }, group), /own/);
  state.board.fill(null); state.board[9] = 'red'; state.board[7] = 'yellow'; state.turn = 'a'; state.finished = false; state.winner = null;
  core.applyMove('checkers', state, 'a', { type: 'move', from: 9, to: 2 }, group);
  assert.equal(state.board[2], 'red-king');
});

test('Reversi validates captures, flips discs, skips a blocked turn, and scores the finish', () => {
  const { group, state } = start('reversi', ['a', 'b']);
  assert.throws(() => core.applyMove('reversi', state, 'a', { type: 'place', index: 0 }, group), /capture/);
  core.applyMove('reversi', state, 'a', { type: 'place', index: 20 }, group);
  assert.equal(state.board[28], 'red');
  assert.equal(state.turn, 'b');
  assert.deepEqual(core.reversiFlips(state.board, 0, 'yellow'), []);
  state.board.fill('red'); state.board[63] = ''; state.turn = 'a';
  state.board[62] = 'yellow'; state.board[61] = 'red';
  core.applyMove('reversi', state, 'a', { type: 'place', index: 63 }, group);
  assert.equal(state.finished, true);
  assert.equal(state.winner, 'a');
  state.board.fill(null); state.board[0] = 'red'; state.board[1] = 'yellow'; state.turn = 'b'; state.finished = false; state.winner = null; state.passes = 0;
  core.applyMove('reversi', state, 'b', { type: 'pass' }, group);
  assert.equal(state.turn, 'a', 'a blocked player passes the turn');
  core.applyMove('reversi', state, 'a', { type: 'place', index: 2 }, group);
  assert.equal(state.board[1], 'red');
});

test('Bingo deals different cards, marks called numbers, and declares a line winner', () => {
  const { group, state } = start('bingo', ['a', 'b'], 55);
  assert.equal(state.cards.a.board.length, 25);
  assert.equal(state.cards.a.board[12], 0);
  assert.notDeepEqual(state.cards.a.board, state.cards.b.board);
  state.sequence = state.cards.a.board.slice(0, 5);
  assert.throws(() => core.applyMove('bingo', state, 'b', { type: 'draw' }, group), /host/);
  for (let i = 0; i < 5; i += 1) core.applyMove('bingo', state, 'a', { type: 'draw' }, group);
  assert.equal(state.finished, true);
  assert.equal(state.winner, 'a');
  assert.equal(state.scores.a, 1);
  assert.equal(core.hasBingo([0, 1, 2, 3, 4]), true);
});

test('Math Race keeps answers private, rejects duplicates, and scores a full round', () => {
  const { group, state } = start('math-race', ['a', 'b'], 71);
  const view = core.publicView('math-race', state, { roomCode: '246810', state: 'playing', players: group });
  assert.match(view.question.prompt, /\?/);
  assert.equal('answer' in view.question, false);
  core.applyMove('math-race', state, 'a', { type: 'answer', answer: state.questions[0].answer }, group);
  assert.throws(() => core.applyMove('math-race', state, 'a', { type: 'answer', answer: 1 }, group), /already answered/);
  core.applyMove('math-race', state, 'b', { type: 'answer', answer: state.questions[0].answer }, group);
  assert.equal(state.questionIndex, 1);
  for (let question = 1; question < 10; question += 1) {
    for (const id of ['a', 'b']) core.applyMove('math-race', state, id, { type: 'answer', answer: state.questions[question].answer }, group);
  }
  assert.equal(state.finished, true);
  assert.equal(state.scores.a, 10);
  assert.equal(state.draw, true);
});

test('Set finds standard sets, penalizes invalid claims, and hides the remaining deck', () => {
  const { group, state } = start('set', ['a', 'b'], 27);
  assert.equal(state.cards.length, 12);
  assert.equal('deck' in core.publicView('set', state, { roomCode: '222222', state: 'playing', players: group }), false);
  const valid = [];
  for (let a = 0; a < state.cards.length && !valid.length; a += 1) for (let b = a + 1; b < state.cards.length && !valid.length; b += 1) for (let c = b + 1; c < state.cards.length && !valid.length; c += 1) if (core.isSet([state.cards[a], state.cards[b], state.cards[c]])) valid.push(a,b,c);
  assert.equal(valid.length, 3);
  const invalid = [0, 1, 2];
  if (core.isSet(invalid.map(index => state.cards[index]))) invalid[2] = 3;
  core.applyMove('set', state, 'a', { type: 'claim', indices: invalid }, group);
  assert.equal(state.scores.a, 0);
  const chosen = [];
  for (let a = 0; a < state.cards.length && !chosen.length; a += 1) for (let b = a + 1; b < state.cards.length && !chosen.length; b += 1) for (let c = b + 1; c < state.cards.length && !chosen.length; c += 1) if (core.isSet([state.cards[a], state.cards[b], state.cards[c]])) chosen.push(a,b,c);
  core.applyMove('set', state, 'b', { type: 'claim', indices: chosen }, group);
  assert.equal(state.scores.b, 1);
  assert.equal(state.cards.length, 12);
});

test('Ludo requires a six to leave home, validates rolls, and allows exact home arrival', () => {
  const { group, state } = start('ludo', ['a', 'b'], 13);
  state.dice[0] = 6;
  core.applyMove('ludo', state, 'a', { type: 'roll' }, group);
  assert.equal(state.lastRoll, 6);
  core.applyMove('ludo', state, 'a', { type: 'token', token: 0 }, group);
  assert.equal(state.tokens.a[0], 0);
  assert.equal(state.turn, 'a', 'a six earns an extra turn');
  state.tokens.a[0] = 56; state.dice[1] = 1;
  core.applyMove('ludo', state, 'a', { type: 'roll' }, group);
  core.applyMove('ludo', state, 'a', { type: 'token', token: 0 }, group);
  assert.equal(state.tokens.a[0], 57);
  assert.equal(state.turn, 'b');
  core.applyMove('ludo', state, 'b', { type: 'roll' }, group);
});

test('Dominoes deals private hands and only accepts a tile matching either table end', () => {
  const { group, state } = start('dominoes', ['a', 'b'], 18);
  assert.equal(state.hands.a.length, 6, 'the opening tile is placed from the first hand');
  assert.equal(state.hands.b.length, 7);
  assert.equal(state.turn, 'b');
  assert.equal('hands' in core.publicView('dominoes', state, { roomCode: '444444', state: 'playing', players: group }), false);
  assert.equal(core.privateView('dominoes', state, 'b').hand.length, 7);
  assert.throws(() => core.applyMove('dominoes', state, 'a', { type: 'draw' }, group), /turn/);
  state.hands.b[0] = { id: 'test', a: state.ends[1], b: 6 };
  core.applyMove('dominoes', state, 'b', { type: 'play', index: 0, end: 'right' }, group);
  assert.equal(state.ends[1], 6);
  assert.equal(state.turn, 'a');
});

test('Go Fish deals private cards, validates requests, collects matching cards and books', () => {
  const { group, state } = start('go-fish', ['a', 'b'], 31);
  assert.equal(state.hands.a.length, 7);
  assert.equal('deck' in core.publicView('go-fish', state, { roomCode: '555555', state: 'playing', players: group }), false);
  assert.equal(core.privateView('go-fish', state, 'a').hand.length, 7);
  const rank = state.hands.a[0].rank;
  state.hands.b[0] = { id: 'target-card', rank, suit: 3 };
  const before = state.hands.a.length;
  core.applyMove('go-fish', state, 'a', { type: 'ask', rank, target: 'b' }, group);
  assert.equal(state.hands.a.length, before + 1);
  assert.equal(state.hands.b.some(card => card.rank === rank), false);
  assert.equal(state.turn, 'a', 'a successful request keeps the turn');
  assert.throws(() => core.applyMove('go-fish', state, 'a', { type: 'ask', rank: 12, target: 'b' }, group), /Ask for a rank/);
});

test('Uno-style play matches color, applies action cards, and keeps hands off the public room', () => {
  const { group, state } = start('uno-style', ['a', 'b'], 42);
  assert.equal(state.hands.a.length, 7);
  const view = core.publicView('uno-style', state, { roomCode: '666666', state: 'playing', players: group });
  assert.equal('hands' in view, false);
  assert.equal('deck' in view, false);
  assert.equal(core.privateView('uno-style', state, 'a').hand.length, 7);
  state.hands.a[0] = { id: 'test-red', color: state.color, value: '5', kind: 'number' };
  core.applyMove('uno-style', state, 'a', { type: 'play', index: 0 }, group);
  assert.equal(state.discard.at(-1).value, '5');
  assert.equal(state.turn, 'b');
  state.turn = 'b'; state.color = 'blue'; state.discard.push({ id: 'blue-top', color: 'blue', value: '2', kind: 'number' });
  state.hands.b[0] = { id: 'wild-test', color: null, value: 'wild', kind: 'wild' };
  core.applyMove('uno-style', state, 'b', { type: 'play', index: 0, color: 'green' }, group);
  assert.equal(state.color, 'green');
  assert.equal(state.turn, 'a');
});
