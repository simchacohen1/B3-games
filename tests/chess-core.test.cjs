'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../backend/functions/multiplayer-games-core.cjs');
const chess = require('../backend/functions/chess-core.cjs');

const PIECES = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
function fromFen(fen) {
  const [placement, side, castling, ep] = fen.split(' ');
  const board = [];
  for (const ch of placement.replace(/\//g, '')) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i += 1) board.push('');
    else board.push((ch === ch.toLowerCase() ? 'b' : 'w') + PIECES[ch.toLowerCase()]);
  }
  const epIndex = ep && ep !== '-' ? (8 - Number(ep[1])) * 8 + (ep.charCodeAt(0) - 97) : -1;
  return { state: { board, castling: castling === '-' ? '-' : castling, ep: epIndex, halfmove: 0, captured: { w: [], b: [] }, moves: 0 }, side };
}
// Count positions after N moves (promotion counts as 4 moves). Known totals prove the rules are right.
function perft(state, color, depth) {
  if (depth === 0) return 1;
  let total = 0;
  for (const move of chess.allLegalMoves(state, color)) {
    const next = { ...state, board: state.board.slice(), captured: { w: [], b: [] } };
    const options = move.promotion ? ['Q', 'R', 'B', 'N'] : [undefined];
    for (const promotion of options) {
      const copy = { ...next, board: state.board.slice(), captured: { w: [], b: [] } };
      chess.playChessMove(copy, color, { from: move.from, to: move.to, promotion }, message => { throw new Error(message); });
      total += depth === 1 ? 1 : perft(copy, color === 'w' ? 'b' : 'w', depth - 1);
    }
  }
  return total;
}

test('standard start position has the known move counts', () => {
  const { state } = fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  assert.equal(perft(state, 'w', 1), 20);
  assert.equal(perft(state, 'w', 2), 400);
  assert.equal(perft(state, 'w', 3), 8902);
});

test('castling, en passant and pins match the known counts (Kiwipete position)', () => {
  const { state } = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
  assert.equal(perft(state, 'w', 1), 48);
  assert.equal(perft(state, 'w', 2), 2039);
});

test('promotion, check evasion and en passant edge cases match the known counts', () => {
  const a = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
  assert.equal(perft(a.state, 'w', 3), 2812);
  const b = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -');
  assert.equal(perft(b.state, 'w', 2), 264);
  const c = fromFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -');
  assert.equal(perft(c.state, 'w', 2), 1486);
});

function newRoom(gameKey) {
  const players = { a: { name: 'A', joinedAt: 1 }, b: { name: 'B', joinedAt: 2 } };
  const state = core.createGameState(gameKey, players, { seed: 7 });
  core.startGameState(gameKey, state, ['a', 'b'], 1000);
  return { players, state };
}
const mv = (gameKey, room, id, from, to, extra = {}, now = 2000) =>
  core.applyMove(gameKey, room.state, id, { type: 'move', from, to, ...extra }, room.players, { now });
const sq = name => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

test("fool's mate ends the game with a win for the second player", () => {
  const room = newRoom('chess');
  mv('chess', room, 'a', sq('f2'), sq('f3')); mv('chess', room, 'b', sq('e7'), sq('e5'));
  mv('chess', room, 'a', sq('g2'), sq('g4')); mv('chess', room, 'b', sq('d8'), sq('h4'));
  assert.equal(room.state.finished, true);
  assert.equal(room.state.winner, 'b');
  assert.equal(room.state.endReason, 'checkmate');
});

test('a player cannot move out of turn, move the other side\'s pieces or make an illegal move', () => {
  const room = newRoom('chess');
  assert.throws(() => mv('chess', room, 'b', sq('e7'), sq('e5')), /Wait for your turn/);
  assert.throws(() => mv('chess', room, 'a', sq('e7'), sq('e5')), /own pieces/);
  assert.throws(() => mv('chess', room, 'a', sq('e2'), sq('e5')), /cannot move/);
});

test('castling, en passant and promotion work in a real game', () => {
  const room = newRoom('chess');
  const play = (id, a, b, extra) => mv('chess', room, id, sq(a), sq(b), extra);
  play('a', 'e2', 'e4'); play('b', 'a7', 'a6');
  play('a', 'g1', 'f3'); play('b', 'a6', 'a5');
  play('a', 'f1', 'c4'); play('b', 'a5', 'a4');
  play('a', 'e1', 'g1'); // castle king side
  assert.equal(room.state.board[sq('g1')], 'wK');
  assert.equal(room.state.board[sq('f1')], 'wR');
});

test('en passant captures the passed pawn', () => {
  const room = newRoom('chess');
  const play = (id, a, b) => mv('chess', room, id, sq(a), sq(b));
  play('a', 'e2', 'e4'); play('b', 'a7', 'a6'); play('a', 'e4', 'e5'); play('b', 'd7', 'd5');
  play('a', 'e5', 'd6');
  assert.equal(room.state.board[sq('d5')], '');
  assert.equal(room.state.board[sq('d6')], 'wP');
  assert.deepEqual(room.state.captured.w, ['P']);
});

test('promotion lets the player choose the new piece and defaults to a queen', () => {
  const { state } = fromFen('8/P6k/8/8/8/8/8/K7 w - -');
  const fail = message => { throw new Error(message); };
  const copy = { ...state, board: state.board.slice(), captured: { w: [], b: [] }, moves: 0 };
  chess.playChessMove(copy, 'w', { from: sq('a7'), to: sq('a8'), promotion: 'N' }, fail);
  assert.equal(copy.board[sq('a8')], 'wN');
  const copy2 = { ...state, board: state.board.slice(), captured: { w: [], b: [] }, moves: 0 };
  chess.playChessMove(copy2, 'w', { from: sq('a7'), to: sq('a8') }, fail);
  assert.equal(copy2.board[sq('a8')], 'wQ');
  assert.throws(() => chess.playChessMove({ ...state, board: state.board.slice(), captured: { w: [], b: [] }, moves: 0 }, 'w', { from: sq('a7'), to: sq('a8'), promotion: 'K' }, fail), /Choose Queen/);
});

test('stalemate is a draw', () => {
  const { state } = fromFen('7k/8/6K1/8/8/8/8/5Q2 w - -');
  const copy = { ...state, board: state.board.slice(), captured: { w: [], b: [] }, moves: 0 };
  chess.playChessMove(copy, 'w', { from: sq('f1'), to: sq('f7') }, message => { throw new Error(message); });
  assert.equal(copy.finished, true);
  assert.equal(copy.draw, true);
  assert.equal(copy.endReason, 'stalemate');
});

test('king vs king is a draw by insufficient material', () => {
  assert.equal(chess.insufficientMaterial(['wK', 'bK', ...Array(62).fill('')]), true);
  assert.equal(chess.insufficientMaterial(['wK', 'bK', 'wQ', ...Array(61).fill('')]), false);
});

test('5-minute game: nobody wins by checkmate, so the player with more captured points wins', () => {
  const room = newRoom('chess-5min');
  assert.equal(room.state.endsAt, 1000 + 300000);
  mv('chess-5min', room, 'a', sq('e2'), sq('e4'), {}, 5000); mv('chess-5min', room, 'b', sq('d7'), sq('d5'), {}, 6000);
  mv('chess-5min', room, 'a', sq('e4'), sq('d5'), {}, 7000); // white wins a pawn
  assert.equal(room.state.finished, false);
  assert.throws(() => core.applyMove('chess-5min', room.state, 'b', { type: 'timeout' }, room.players, { now: 100000 }), /still time left/);
  core.applyMove('chess-5min', room.state, 'b', { type: 'timeout' }, room.players, { now: 301000 });
  assert.equal(room.state.finished, true);
  assert.equal(room.state.endReason, 'time');
  assert.equal(room.state.winner, 'a');
  assert.equal(room.state.draw, false);
});

test('5-minute game: equal points is a draw, and a late move cannot be played', () => {
  const room = newRoom('chess-5min');
  mv('chess-5min', room, 'a', sq('e2'), sq('e4'), {}, 5000);
  core.applyMove('chess-5min', room.state, 'a', { type: 'move', from: sq('d2'), to: sq('d4') }, room.players, { now: 400000 });
  assert.equal(room.state.finished, true);
  assert.equal(room.state.draw, true);
  assert.equal(room.state.winner, null);
  assert.equal(room.state.board[sq('d4')], '', 'the late move was not played');
});

test('untimed chess has no clock', () => {
  const room = newRoom('chess');
  assert.equal(room.state.endsAt, 0);
  assert.throws(() => core.applyMove('chess', room.state, 'a', { type: 'timeout' }, room.players, { now: 9e12 }), /still time left/);
});

test('captured points: pawn 1, knight 3, bishop 3, rook 5, queen 9', () => {
  assert.deepEqual(['P', 'N', 'B', 'R', 'Q'].map(t => chess.VALUES[t]), [1, 3, 3, 5, 9]);
  assert.equal(chess.points({ captured: { w: ['P', 'N', 'R', 'Q'], b: [] } }, 'w'), 18);
});

test('the public view lists legal targets, points and the clock, and survives the database round trip', () => {
  const room = newRoom('chess-5min');
  const view = core.publicView('chess-5min', room.state, { players: room.players, roomCode: 'X', host: 'a', state: 'playing' }, 5);
  assert.equal(view.legal['s' + sq('e2')].length, 2);
  assert.equal(view.endsAt, 301000);
  assert.equal(view.timeLimitMs, 300000);
  const stored = JSON.parse(JSON.stringify(room.state));
  stored.captured = { w: {}, b: {} };
  const hydrated = core.hydrateGameState('chess-5min', stored);
  assert.deepEqual(hydrated.captured, { w: [], b: [] });
});
