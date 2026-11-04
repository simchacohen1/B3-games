'use strict';

// Chess rules for the Multiplayer Arcade. Pure functions: no database, no clock.
// Board: 64 strings, index = row * 8 + col, row 0 is rank 8 (black's back row).
// A piece is a color letter ('w' or 'b') plus a type letter: P N B R Q K. Empty = ''.

const VALUES = Object.freeze({ P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 });
const BACK_ROW = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function initialBoard() {
  const board = Array(64).fill('');
  for (let col = 0; col < 8; col += 1) {
    board[col] = 'b' + BACK_ROW[col];
    board[8 + col] = 'bP';
    board[48 + col] = 'wP';
    board[56 + col] = 'w' + BACK_ROW[col];
  }
  return board;
}

function newChessFields() {
  return {
    board: initialBoard(), castling: 'KQkq', ep: -1, halfmove: 0, check: false, endReason: '',
    captured: { w: [], b: [] }, lastMove: { from: -1, to: -1 },
  };
}

const colorOf = piece => piece ? piece[0] : '';
const typeOf = piece => piece ? piece[1] : '';
const other = color => color === 'w' ? 'b' : 'w';
const rowOf = index => index >> 3;
const colOf = index => index & 7;
const inside = (row, col) => row >= 0 && row < 8 && col >= 0 && col < 8;

function findKing(board, color) { return board.indexOf(color + 'K'); }

// Is square `index` attacked by any piece of color `by`?
function isAttacked(board, index, by) {
  const row = rowOf(index), col = colOf(index);
  const pawnRow = row + (by === 'w' ? 1 : -1);
  for (const dc of [-1, 1]) if (inside(pawnRow, col + dc) && board[pawnRow * 8 + col + dc] === by + 'P') return true;
  for (const [dr, dc] of KNIGHT_STEPS) if (inside(row + dr, col + dc) && board[(row + dr) * 8 + col + dc] === by + 'N') return true;
  for (const [dr, dc] of KING_STEPS) if (inside(row + dr, col + dc) && board[(row + dr) * 8 + col + dc] === by + 'K') return true;
  for (const [dirs, kinds] of [[BISHOP_DIRS, 'BQ'], [ROOK_DIRS, 'RQ']]) {
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      while (inside(r, c)) {
        const piece = board[r * 8 + c];
        if (piece) { if (colorOf(piece) === by && kinds.includes(typeOf(piece))) return true; break; }
        r += dr; c += dc;
      }
    }
  }
  return false;
}

function inCheck(board, color) {
  const king = findKing(board, color);
  return king >= 0 && isAttacked(board, king, other(color));
}

// Moves that follow piece movement rules, before checking whether the mover's king is left in check.
function pseudoMoves(state, from) {
  const board = state.board, piece = board[from];
  if (!piece) return [];
  const color = colorOf(piece), type = typeOf(piece), row = rowOf(from), col = colOf(from), moves = [];
  const add = (to, extra) => moves.push({ from, to, ...extra });
  if (type === 'P') {
    const dir = color === 'w' ? -1 : 1, start = color === 'w' ? 6 : 1, last = color === 'w' ? 0 : 7;
    const one = row + dir;
    if (inside(one, col) && !board[one * 8 + col]) {
      add(one * 8 + col, one === last ? { promotion: true } : {});
      if (row === start && !board[(row + 2 * dir) * 8 + col]) add((row + 2 * dir) * 8 + col, { double: true });
    }
    for (const dc of [-1, 1]) {
      if (!inside(one, col + dc)) continue;
      const to = one * 8 + col + dc, target = board[to];
      if (target && colorOf(target) !== color) add(to, one === last ? { promotion: true } : {});
      else if (!target && state.ep === to) add(to, { enPassant: true });
    }
  } else if (type === 'N' || type === 'K') {
    for (const [dr, dc] of type === 'N' ? KNIGHT_STEPS : KING_STEPS) {
      const r = row + dr, c = col + dc;
      if (inside(r, c) && colorOf(board[r * 8 + c]) !== color) add(r * 8 + c);
    }
    if (type === 'K') {
      const home = color === 'w' ? 60 : 4, enemy = other(color);
      if (from === home && !isAttacked(board, home, enemy)) {
        const rights = String(state.castling || '');
        const kingSide = color === 'w' ? 'K' : 'k', queenSide = color === 'w' ? 'Q' : 'q';
        if (rights.includes(kingSide) && board[home + 3] === color + 'R' && !board[home + 1] && !board[home + 2]
          && !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)) add(home + 2, { castle: 'K' });
        if (rights.includes(queenSide) && board[home - 4] === color + 'R' && !board[home - 1] && !board[home - 2] && !board[home - 3]
          && !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)) add(home - 2, { castle: 'Q' });
      }
    }
  } else {
    const dirs = type === 'B' ? BISHOP_DIRS : type === 'R' ? ROOK_DIRS : BISHOP_DIRS.concat(ROOK_DIRS);
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      while (inside(r, c)) {
        const target = board[r * 8 + c];
        if (!target) add(r * 8 + c);
        else { if (colorOf(target) !== color) add(r * 8 + c); break; }
        r += dr; c += dc;
      }
    }
  }
  return moves;
}

// Play a move on a copy of the board (used to test whether the mover's king would be safe).
function boardAfter(board, move, color) {
  const next = board.slice();
  next[move.to] = next[move.from]; next[move.from] = '';
  if (move.enPassant) next[move.to + (color === 'w' ? 8 : -8)] = '';
  if (move.castle === 'K') { next[move.to - 1] = next[move.to + 1]; next[move.to + 1] = ''; }
  if (move.castle === 'Q') { next[move.to + 1] = next[move.to - 2]; next[move.to - 2] = ''; }
  return next;
}

function legalMovesFrom(state, from) {
  const piece = state.board[from];
  if (!piece) return [];
  const color = colorOf(piece);
  return pseudoMoves(state, from).filter(move => !inCheck(boardAfter(state.board, move, color), color));
}

function allLegalMoves(state, color) {
  const moves = [];
  for (let from = 0; from < 64; from += 1) if (colorOf(state.board[from]) === color) moves.push(...legalMovesFrom(state, from));
  return moves;
}

function points(state, color) {
  return (state.captured?.[color] || []).reduce((sum, type) => sum + (VALUES[type] || 0), 0);
}

// Neither side can possibly checkmate: king vs king, or king and one minor piece vs king.
function insufficientMaterial(board) {
  const pieces = board.filter(Boolean).filter(piece => typeOf(piece) !== 'K');
  if (pieces.length === 0) return true;
  return pieces.length === 1 && 'NB'.includes(typeOf(pieces[0]));
}

// Applies one move. Throws (via `fail`) on any illegal move. `move` = { from, to, promotion? }.
function playChessMove(state, color, move, fail) {
  const { from, to } = move;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) fail('Choose a piece and a legal square.');
  const piece = state.board[from];
  if (!piece || colorOf(piece) !== color) fail('Move one of your own pieces.');
  const found = legalMovesFrom(state, from).find(candidate => candidate.to === to);
  if (!found) fail(inCheck(state.board, color) ? 'Your king is in check. Move it out of check.' : 'That piece cannot move there.');
  let promoteTo = '';
  if (found.promotion) {
    promoteTo = String(move.promotion || 'Q').toUpperCase();
    if (!['Q', 'R', 'B', 'N'].includes(promoteTo)) fail('Choose Queen, Rook, Bishop or Knight.');
  }
  const type = typeOf(piece), enemy = other(color);
  const victimIndex = found.enPassant ? to + (color === 'w' ? 8 : -8) : to;
  const victim = state.board[victimIndex];
  if (victim) state.captured[color].push(typeOf(victim));
  state.board = boardAfter(state.board, found, color);
  if (promoteTo) state.board[to] = color + promoteTo;
  // Castling rights vanish when a king or rook moves, or a rook is captured.
  let rights = String(state.castling || '');
  const drop = chars => { for (const ch of chars) rights = rights.replace(ch, ''); };
  if (type === 'K') drop(color === 'w' ? 'KQ' : 'kq');
  for (const [square, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (from === square || to === square) drop(ch);
  state.castling = rights || '-';
  state.ep = found.double ? (from + to) / 2 : -1;
  state.halfmove = type === 'P' || victim ? 0 : (state.halfmove || 0) + 1;
  state.lastMove = { from, to };
  state.moves = (state.moves || 0) + 1;
  state.check = inCheck(state.board, enemy);
  const replies = allLegalMoves(state, enemy);
  if (!replies.length) {
    state.finished = true;
    if (state.check) { state.endReason = 'checkmate'; state.winnerColor = color; }
    else { state.endReason = 'stalemate'; state.draw = true; }
  } else if (insufficientMaterial(state.board)) { state.finished = true; state.draw = true; state.endReason = 'insufficient'; }
  else if (state.halfmove >= 100) { state.finished = true; state.draw = true; state.endReason = 'fifty-move'; }
  return state;
}

// When the clock runs out: more captured points wins; equal points is a draw.
function finishOnTime(state) {
  const white = points(state, 'w'), black = points(state, 'b');
  state.finished = true; state.endReason = 'time';
  if (white === black) state.draw = true;
  else state.winnerColor = white > black ? 'w' : 'b';
  return state;
}

// Legal targets for the side to move, as { 's52': [44, 36], ... } (string keys survive the database).
function legalMap(state, color) {
  const map = {};
  for (const move of allLegalMoves(state, color)) (map['s' + move.from] ||= []).push(move.to);
  for (const key of Object.keys(map)) map[key] = Array.from(new Set(map[key]));
  return map;
}

module.exports = {
  VALUES, initialBoard, newChessFields, colorOf, typeOf, inCheck, isAttacked, legalMovesFrom, allLegalMoves,
  legalMap, playChessMove, finishOnTime, points, insufficientMaterial,
};
