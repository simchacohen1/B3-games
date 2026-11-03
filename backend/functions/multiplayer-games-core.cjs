'use strict';

const GAMES = Object.freeze({
  'connect-four': { name: 'Connect 4', minPlayers: 2, maxPlayers: 2 },
  'tic-tac-toe': { name: 'Tic Tac Toe', minPlayers: 2, maxPlayers: 2 },
  'memory-match': { name: 'Memory Match', minPlayers: 2, maxPlayers: 4 },
  checkers: { name: 'Checkers', minPlayers: 2, maxPlayers: 2 },
  reversi: { name: 'Reversi', minPlayers: 2, maxPlayers: 2 },
  bingo: { name: 'Bingo', minPlayers: 2, maxPlayers: 8 },
  'math-race': { name: 'Math Race', minPlayers: 2, maxPlayers: 8 },
  set: { name: 'Set', minPlayers: 2, maxPlayers: 6 },
  ludo: { name: 'Ludo', minPlayers: 2, maxPlayers: 4 },
  dominoes: { name: 'Dominoes', minPlayers: 2, maxPlayers: 4 },
  'go-fish': { name: 'Go Fish', minPlayers: 2, maxPlayers: 6 },
  'uno-style': { name: 'Uno-style Cards', minPlayers: 2, maxPlayers: 6 },
});

const MEMORY_FACES = Object.freeze(['🍎', '⭐', '🐟', '🌈', '⚽', '🦁', '🚀', '🌻']);

function gameConfig(gameKey) {
  return GAMES[gameKey] || null;
}

function participantIds(players) {
  return Object.entries(players || {}).filter(([, player]) => player && player.active !== false)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0]))
    .map(([studentId]) => studentId);
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value).filter(key => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
  const result = [];
  for (const key of keys) result[Number(key)] = value[key];
  return result;
}

// RTDB omits null and empty-array children. Rebuild those in-memory defaults
// before every mutation; board empty cells are strings so the public board persists.
function hydrateGameState(gameKey, input) {
  const state = input && typeof input === 'object' ? input : {};
  const ids = asList(state.playersOrder);
  if (['connect-four', 'tic-tac-toe', 'checkers', 'reversi'].includes(gameKey)) {
    const size = gameKey === 'connect-four' ? 42 : gameKey === 'tic-tac-toe' ? 9 : 64;
    const board = asList(state.board);
    state.board = Array.from({ length: size }, (_, index) => board[index] || '');
  }
  if (gameKey === 'memory-match') { state.deck = asList(state.deck); state.matched = asList(state.matched); state.flipped = asList(state.flipped); state.scores ||= {}; }
  if (gameKey === 'reversi') state.passes ||= 0;
  if (gameKey === 'bingo') {
    state.sequence = asList(state.sequence); state.called = asList(state.called); state.cards ||= {}; state.scores ||= {};
    for (const card of Object.values(state.cards)) {
      if (!card || typeof card !== 'object') continue;
      card.board = asList(card.board);
      card.marked = asList(card.marked);
    }
  }
  if (gameKey === 'math-race') { state.questions = asList(state.questions); state.answers ||= {}; state.scores ||= {}; }
  if (gameKey === 'set') { state.deck = asList(state.deck); state.cards = asList(state.cards); state.scores ||= {}; }
  if (gameKey === 'ludo') { state.dice = asList(state.dice); state.tokens ||= {}; state.starts ||= {}; state.lastRoll ??= null; }
  if (gameKey === 'dominoes') { state.deck = asList(state.deck); state.layout = asList(state.layout); state.hands ||= {}; state.ends ||= null; state.passes ||= 0; }
  if (gameKey === 'go-fish') { state.deck = asList(state.deck); state.hands ||= {}; state.books ||= Object.fromEntries(ids.map(id => [id, []])); for (const id of ids) state.books[id] = asList(state.books[id]); }
  if (gameKey === 'uno-style') { state.deck = asList(state.deck); state.hands ||= {}; state.discard = asList(state.discard); state.color ??= null; state.drawPending ||= 0; state.direction ||= 1; }
  return state;
}

function seededShuffle(values, seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const result = values.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createGameState(gameKey, players, options = {}) {
  const ids = participantIds(players);
  if (!GAMES[gameKey]) throw new Error('Unknown multiplayer game.');
  if (gameKey === 'connect-four') return { board: Array(42).fill(''), playersOrder: ids.slice(), otherPlayer: ids[1] || '', turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0 };
  if (gameKey === 'tic-tac-toe') return { board: Array(9).fill(''), playersOrder: ids.slice(), otherPlayer: ids[1] || '', turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0 };
  if (gameKey === 'memory-match') {
    const deck = seededShuffle(MEMORY_FACES.flatMap((face, pair) => [{ face, pair }, { face, pair }]), options.seed);
    return { deck, matched: [], flipped: [], turn: ids[0] || '', scores: Object.fromEntries(ids.map(id => [id, 0])), winner: null, draw: false, finished: false, moves: 0 };
  }
  if (gameKey === 'checkers') {
    const board = Array(64).fill('');
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 8; col += 1) if ((row + col) % 2) board[row * 8 + col] = 'yellow';
    for (let row = 5; row < 8; row += 1) for (let col = 0; col < 8; col += 1) if ((row + col) % 2) board[row * 8 + col] = 'red';
    return { board, playersOrder: ids.slice(), turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0, quietMoves: 0 };
  }
  if (gameKey === 'reversi') {
    const board = Array(64).fill(null);
    board[27] = board[36] = 'red'; board[28] = board[35] = 'yellow';
    return { board, playersOrder: ids.slice(), turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0, passes: 0 };
  }
  if (gameKey === 'bingo') {
    const sequence = seededShuffle(Array.from({ length: 75 }, (_, index) => index + 1), options.seed);
    const cards = Object.fromEntries(ids.map(id => [id, makeBingoCard(options.seed, id)]));
    return { cards, called: [], sequence, turn: ids[0] || '', scores: Object.fromEntries(ids.map(id => [id, 0])), winner: null, draw: false, finished: false, moves: 0 };
  }
  if (gameKey === 'math-race') {
    const random = randomGenerator(options.seed);
    const questions = Array.from({ length: 10 }, () => makeMathQuestion(random));
    return { questions, questionIndex: 0, answers: {}, turn: ids[0] || '', scores: Object.fromEntries(ids.map(id => [id, 0])), winner: null, draw: false, finished: false, moves: 0 };
  }
  if (gameKey === 'set') {
    const deck = seededShuffle(Array.from({ length: 81 }, (_, index) => ({ id: index, props: [index % 3, Math.floor(index / 3) % 3, Math.floor(index / 9) % 3, Math.floor(index / 27) % 3] })), options.seed);
    return { deck, cards: deck.splice(0, 12), scores: Object.fromEntries(ids.map(id => [id, 0])), turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0 };
  }
  if (gameKey === 'ludo') {
    const random = randomGenerator(options.seed);
    const dice = seededShuffle(Array.from({ length: 60 }, () => Math.floor(random() * 6) + 1), options.seed + 17);
    return { playersOrder: ids.slice(), tokens: Object.fromEntries(ids.map(id => [id, [-1, -1, -1, -1]])), starts: Object.fromEntries(ids.map((id, index) => [id, index * 13])), dice, diceIndex: 0, lastRoll: null, turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0 };
  }
  if (gameKey === 'dominoes') {
    const tiles = [];
    for (let a = 0; a <= 6; a += 1) for (let b = a; b <= 6; b += 1) tiles.push({ id: `${a}-${b}`, a, b });
    return { deck: seededShuffle(tiles, options.seed), hands: {}, layout: [], ends: null, turn: ids[0] || '', playersOrder: ids.slice(), direction: 1, passes: 0, winner: null, draw: false, finished: false, moves: 0 };
  }
  if (gameKey === 'go-fish') {
    const deck = Array.from({ length: 52 }, (_, index) => ({ id: index, rank: index % 13, suit: Math.floor(index / 13) }));
    return { deck: seededShuffle(deck, options.seed), hands: {}, books: Object.fromEntries(ids.map(id => [id, []])), playersOrder: ids.slice(), turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0 };
  }
  if (gameKey === 'uno-style') {
    const deck = createUnoDeck();
    return { deck: seededShuffle(deck, options.seed), hands: {}, discard: [], color: null, playersOrder: ids.slice(), direction: 1, drawPending: 0, turn: ids[0] || '', winner: null, draw: false, finished: false, moves: 0 };
  }
  throw new Error('This multiplayer game is not available yet.');
}

function lineWinner(board, width, height, count) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const piece = board[y * width + x];
    if (!piece) continue;
    for (const [dx, dy] of dirs) {
      let n = 1;
      for (let k = 1; k < count; k += 1) {
        const nx = x + dx * k, ny = y + dy * k;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || board[ny * width + nx] !== piece) break;
        n += 1;
      }
      if (n === count) return piece;
    }
  }
  return null;
}

function reject(message) { throw new Error(message); }

function applyMove(gameKey, state, playerId, move, players) {
  if (!GAMES[gameKey]) reject('Unknown multiplayer game.');
  if (!state || state.finished) reject('This game has finished.');
  if (!players?.[playerId] || players[playerId].active === false) reject('Join this room before playing.');
  if (!move || typeof move !== 'object' || Array.isArray(move)) reject('Invalid move.');
  const ids = participantIds(players);
  if (gameKey === 'memory-match') return moveMemory(state, playerId, move, ids);
  if (gameKey === 'bingo') return moveBingo(state, playerId, move, players);
  if (gameKey === 'math-race') return moveMathRace(state, playerId, move, players);
  if (gameKey === 'set') return moveSet(state, playerId, move, ids);
  if (gameKey === 'ludo') return moveLudo(state, playerId, move, ids);
  if (['dominoes', 'go-fish', 'uno-style'].includes(gameKey) && state.turn !== playerId) reject('Wait for your turn.');
  if (gameKey === 'dominoes') return moveDominoes(state, playerId, move, ids);
  if (gameKey === 'go-fish') return moveGoFish(state, playerId, move, ids);
  if (gameKey === 'uno-style') return moveUno(state, playerId, move, ids);
  if (state.turn !== playerId) reject('Wait for your turn.');
  if (gameKey === 'connect-four') return moveConnectFour(state, playerId, move);
  if (gameKey === 'tic-tac-toe') return moveTicTacToe(state, playerId, move);
  if (gameKey === 'checkers') return moveCheckers(state, playerId, move);
  if (gameKey === 'reversi') return moveReversi(state, playerId, move);
  reject('This multiplayer game is not available yet.');
}

function moveTicTacToe(state, playerId, move) {
  if (move.type !== 'place' || !Number.isInteger(move.index) || move.index < 0 || move.index > 8) reject('Choose an open square.');
  if (state.board[move.index]) reject('That square is already taken.');
  const mark = playerId === state.playersOrder[0] ? 'X' : 'O';
  state.board[move.index] = mark;
  state.moves += 1;
  const winnerMark = lineWinner(state.board, 3, 3, 3);
  if (winnerMark) { state.winner = winnerMark === 'X' ? state.playersOrder[0] : state.playersOrder[1]; state.finished = true; }
  else if (state.moves === 9) { state.draw = true; state.finished = true; }
  else state.turn = state.playersOrder.find(id => id !== playerId);
  return state;
}

function moveConnectFour(state, playerId, move) {
  if (move.type !== 'drop' || !Number.isInteger(move.column) || move.column < 0 || move.column > 6) reject('Choose a column.');
  const y = [5, 4, 3, 2, 1, 0].find(row => !state.board[row * 7 + move.column]);
  if (y === undefined) reject('That column is full.');
  const piece = playerId === state.playersOrder[0] ? 'red' : 'yellow';
  state.board[y * 7 + move.column] = piece;
  state.moves += 1;
  const winner = lineWinner(state.board, 7, 6, 4);
  if (winner) { state.winner = winner === 'red' ? state.playersOrder[0] : state.playersOrder[1]; state.finished = true; }
  else if (state.moves === 42) { state.draw = true; state.finished = true; }
  else state.turn = state.playersOrder.find(id => id !== playerId);
  return state;
}

function moveMemory(state, playerId, move, ids) {
  if (state.turn !== playerId) reject('Wait for your turn.');
  if (move.type !== 'flip' || !Number.isInteger(move.index) || move.index < 0 || move.index >= state.deck.length) reject('Choose a card.');
  if (state.flipped.length === 2) state.flipped = [];
  if (state.matched.includes(move.index) || state.flipped.includes(move.index)) reject('That card is already face up.');
  state.flipped.push(move.index);
  state.moves += 1;
  if (state.flipped.length === 2) {
    const [a, b] = state.flipped;
    if (state.deck[a].pair === state.deck[b].pair) {
      state.matched.push(a, b);
      state.scores[playerId] = (state.scores[playerId] || 0) + 1;
      state.flipped = [];
      if (state.matched.length === state.deck.length) {
        const top = Math.max(...Object.values(state.scores));
        const winners = ids.filter(id => state.scores[id] === top);
        state.winner = winners.length === 1 ? winners[0] : null;
        state.draw = winners.length > 1;
        state.finished = true;
      }
    } else state.turn = ids[(ids.indexOf(playerId) + 1) % ids.length];
  }
  return state;
}

function makeBingoCard(seed, id) {
  const hash = Array.from(String(id)).reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), Number(seed) >>> 0);
  const columns = Array.from({ length: 5 }, (_, col) => seededShuffle(Array.from({ length: 15 }, (_, i) => col * 15 + i + 1), hash + col).slice(0, 5));
  const board = Array.from({ length: 25 }, (_, index) => columns[index % 5][Math.floor(index / 5)]);
  board[12] = 0;
  return { board, marked: [12] };
}

function checkersMoves(board, index, forcedOnly = false) {
  const piece = board[index], row = Math.floor(index / 8), col = index % 8;
  if (!piece) return [];
  const directions = piece.endsWith('-king') ? [-1, 1] : [piece === 'red' ? -1 : 1];
  const captures = [], steps = [];
  for (const dr of directions) for (const dc of [-1, 1]) {
    const r = row + dr, c = col + dc;
    if (r < 0 || r > 7 || c < 0 || c > 7) continue;
    const next = r * 8 + c;
    if (!board[next]) steps.push(next);
    else if (!board[next].startsWith(piece.split('-')[0])) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && !board[rr * 8 + cc]) captures.push({ to: rr * 8 + cc, captured: next });
    }
  }
  return forcedOnly ? captures : captures.length ? captures : steps.map(to => ({ to, captured: null }));
}

function allCheckerMoves(board, color) {
  const moves = [];
  for (let from = 0; from < board.length; from += 1) if (board[from]?.startsWith(color)) {
    for (const move of checkersMoves(board, from)) moves.push({ from, ...move });
  }
  return moves;
}

function moveCheckers(state, playerId, move) {
  const side = playerId === state.playersOrder[0] ? 'red' : 'yellow';
  if (move.type !== 'move' || !Number.isInteger(move.from) || !Number.isInteger(move.to) || move.from < 0 || move.from > 63 || move.to < 0 || move.to > 63) reject('Choose a checker and a legal square.');
  const piece = state.board[move.from];
  if (!piece?.startsWith(side)) reject('Move one of your own checkers.');
  if (state.continuingFrom != null && move.from !== state.continuingFrom) reject('Continue the same checker jump.');
  const captureAvailable = state.continuingFrom != null || allCheckerMoves(state.board, side).some(candidate => candidate.captured != null);
  const legal = checkersMoves(state.board, move.from, captureAvailable).find(candidate => candidate.to === move.to);
  if (!legal) reject(captureAvailable ? 'A capture is available; make that jump.' : 'That checker cannot move there.');
  state.board[move.from] = '';
  if (legal.captured != null) state.board[legal.captured] = '';
  const promote = side === 'red' && Math.floor(move.to / 8) === 0 || side === 'yellow' && Math.floor(move.to / 8) === 7;
  state.board[move.to] = promote ? side + '-king' : piece;
  state.moves += 1;
  state.quietMoves = legal.captured == null ? state.quietMoves + 1 : 0;
  const opponent = side === 'red' ? 'yellow' : 'red';
  if (!state.board.some(value => value?.startsWith(opponent)) || allCheckerMoves(state.board, opponent).length === 0) {
    state.winner = playerId; state.finished = true;
  } else if (state.quietMoves >= 80) { state.draw = true; state.finished = true; }
  else if (legal.captured != null && checkersMoves(state.board, move.to, true).length) { state.continuingFrom = move.to; state.turn = playerId; }
  else { state.continuingFrom = null; state.turn = state.playersOrder.find(id => id !== playerId); }
  return state;
}

const REVERSI_DIRS = Object.freeze([[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]);
function reversiFlips(board, index, color) {
  if (board[index]) return [];
  const row = Math.floor(index / 8), col = index % 8, other = color === 'red' ? 'yellow' : 'red', flips = [];
  for (const [dr, dc] of REVERSI_DIRS) {
    let r = row + dr, c = col + dc, line = [];
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === other) { line.push(r * 8 + c); r += dr; c += dc; }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === color) flips.push(...line);
  }
  return flips;
}
function finishReversi(state) {
  const red = state.board.filter(value => value === 'red').length, yellow = state.board.filter(value => value === 'yellow').length;
  state.scores = { [state.playersOrder[0]]: red, [state.playersOrder[1]]: yellow };
  if (red === yellow) state.draw = true;
  else state.winner = state.playersOrder[red > yellow ? 0 : 1];
  state.finished = true;
}
function moveReversi(state, playerId, move) {
  const color = playerId === state.playersOrder[0] ? 'red' : 'yellow';
  if (move.type === 'pass') {
    if (state.board.some((value, index) => reversiFlips(state.board, index, color).length)) reject('You have a legal move; choose a square.');
    state.passes += 1; state.moves += 1;
  } else {
    if (move.type !== 'place' || !Number.isInteger(move.index) || move.index < 0 || move.index > 63) reject('Choose a square.');
    const flips = reversiFlips(state.board, move.index, color);
    if (!flips.length) reject('That square does not capture an opposing disc.');
    state.board[move.index] = color; flips.forEach(index => { state.board[index] = color; });
    state.passes = 0; state.moves += 1;
  }
  const nextId = state.playersOrder.find(id => id !== playerId), nextColor = nextId === state.playersOrder[0] ? 'red' : 'yellow';
  const canPlay = state.board.some((value, index) => reversiFlips(state.board, index, nextColor).length);
  const canRepeat = state.board.some((value, index) => reversiFlips(state.board, index, color).length);
  if (state.board.every(Boolean) || state.passes >= 2 || !canPlay && !canRepeat) finishReversi(state);
  else state.turn = canPlay ? nextId : playerId;
  return state;
}

function moveBingo(state, playerId, move, players) {
  if (move.type !== 'draw' || playerId !== state.playersOrder[0]) reject('Only the host can draw the next number.');
  const number = state.sequence[state.called.length];
  if (number == null) { state.finished = true; state.draw = true; return state; }
  state.called.push(number); state.moves += 1;
  for (const id of state.playersOrder) {
    const card = state.cards[id], index = card.board.indexOf(number);
    if (index >= 0 && !card.marked.includes(index)) card.marked.push(index);
    if (hasBingo(card.marked)) state.scores[id] = 1;
  }
  const winners = state.playersOrder.filter(id => state.scores[id] > 0);
  if (winners.length) { state.winner = winners.length === 1 ? winners[0] : null; state.draw = winners.length > 1; state.finished = true; }
  if (state.called.length === 75 && !state.finished) { state.finished = true; state.draw = true; }
  return state;
}

function randomGenerator(seed) {
  let value = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => { value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 4294967296; };
}
function makeMathQuestion(random) {
  const kind = Math.floor(random() * 3);
  const a = Math.floor(random() * 12) + 1, b = Math.floor(random() * 12) + 1;
  if (kind === 0) return a >= b ? { prompt: `${a} − ${b} = ?`, answer: a - b } : { prompt: `${b} − ${a} = ?`, answer: b - a };
  if (kind === 1) return { prompt: `${a} + ${b} = ?`, answer: a + b };
  const x = Math.floor(random() * 10) + 1, y = Math.floor(random() * 10) + 1;
  return { prompt: `${x} × ${y} = ?`, answer: x * y };
}
function moveMathRace(state, playerId, move, players) {
  if (move.type !== 'answer' || !Number.isInteger(move.answer) || move.answer < 0 || move.answer > 144) reject('Enter a whole-number answer.');
  state.answers ||= {};
  const key = String(state.questionIndex);
  state.answers[key] ||= {};
  if (state.answers[key][playerId] != null) reject('You already answered this question.');
  const question = state.questions[state.questionIndex];
  if (!question) reject('There are no more questions.');
  state.answers[key][playerId] = move.answer === question.answer;
  if (move.answer === question.answer) state.scores[playerId] = (state.scores[playerId] || 0) + 1;
  state.moves += 1;
  const active = participantIds(players);
  if (active.every(id => state.answers[key][id] != null)) {
    if (state.questionIndex === state.questions.length - 1) {
      const high = Math.max(...Object.values(state.scores));
      const winners = active.filter(id => state.scores[id] === high);
      state.winner = winners.length === 1 ? winners[0] : null; state.draw = winners.length > 1; state.finished = true;
    } else state.questionIndex += 1;
  }
  return state;
}
function isSet(cards) {
  if (!Array.isArray(cards) || cards.length !== 3 || new Set(cards.map(card => card.id)).size !== 3) return false;
  return [0,1,2,3].every(prop => {
    const values = cards.map(card => card.props[prop]);
    return new Set(values).size === 1 || new Set(values).size === 3;
  });
}
function hasSet(cards) {
  for (let a = 0; a < cards.length; a += 1) for (let b = a + 1; b < cards.length; b += 1) for (let c = b + 1; c < cards.length; c += 1) if (isSet([cards[a], cards[b], cards[c]])) return true;
  return false;
}
function moveSet(state, playerId, move, ids) {
  if (move.type !== 'claim' || !Array.isArray(move.indices) || move.indices.length !== 3 || move.indices.some(index => !Number.isInteger(index) || index < 0 || index >= state.cards.length)) reject('Choose three cards.');
  const selected = move.indices.map(index => state.cards[index]);
  if (!isSet(selected)) { state.scores[playerId] = Math.max(0, (state.scores[playerId] || 0) - 1); state.moves += 1; return state; }
  const claimedIds = new Set(selected.map(card => card.id));
  state.cards = state.cards.filter(card => !claimedIds.has(card.id));
  while (state.cards.length < 12 && state.deck.length) state.cards.push(state.deck.shift());
  state.scores[playerId] = (state.scores[playerId] || 0) + 1; state.moves += 1;
  while (!hasSet(state.cards) && state.deck.length) state.cards.push(...state.deck.splice(0, Math.min(3, state.deck.length)));
  if (!hasSet(state.cards) && !state.deck.length) {
    const high = Math.max(...Object.values(state.scores)); const winners = ids.filter(id => state.scores[id] === high);
    state.winner = winners.length === 1 ? winners[0] : null; state.draw = winners.length > 1; state.finished = true;
  }
  return state;
}
function moveLudo(state, playerId, move, ids) {
  if (state.turn !== playerId) reject('Wait for your turn.');
  if (move.type === 'roll') {
    if (state.lastRoll != null) reject('Move one of your tokens first.');
    state.lastRoll = state.dice[state.diceIndex++ % state.dice.length]; state.moves += 1;
    const tokens = state.tokens[playerId];
    const canMove = tokens.some(position => position < 0 ? state.lastRoll === 6 : position + state.lastRoll <= 57);
    if (!canMove) { state.lastRoll = null; state.turn = ids[(ids.indexOf(playerId) + 1) % ids.length]; }
    return state;
  }
  if (move.type !== 'token' || !Number.isInteger(move.token) || move.token < 0 || move.token > 3 || state.lastRoll == null) reject('Roll the die and choose one token.');
  const tokens = state.tokens[playerId], current = tokens[move.token], roll = state.lastRoll;
  if (current < 0 && roll !== 6 || current >= 0 && current + roll > 57) reject('That token cannot move with this roll.');
  const next = current < 0 ? 0 : current + roll;
  tokens[move.token] = next;
  if (next < 51) {
    const global = (state.starts[playerId] + next) % 52;
    const safeSpaces = [0,8,13,21,26,34,39,47];
    if (!safeSpaces.includes(global)) for (const other of ids.filter(id => id !== playerId)) state.tokens[other] = state.tokens[other].map(pos => pos >= 0 && pos < 51 && (state.starts[other] + pos) % 52 === global ? -1 : pos);
  }
  state.lastRoll = null;
  if (tokens.every(position => position === 57)) { state.finished = true; state.winner = playerId; return state; }
  if (roll !== 6) state.turn = ids[(ids.indexOf(playerId) + 1) % ids.length];
  state.moves += 1;
  return state;
}

function createUnoDeck() {
  const cards = [], colors = ['red','yellow','green','blue'];
  for (const color of colors) {
    cards.push({ id: `${color}-0`, color, value: '0', kind: 'number' });
    for (let copy = 1; copy <= 2; copy += 1) for (let n = 1; n <= 9; n += 1) cards.push({ id: `${color}-${n}-${copy}`, color, value: String(n), kind: 'number' });
    for (let copy = 1; copy <= 2; copy += 1) for (const action of ['skip','reverse','draw2']) cards.push({ id: `${color}-${action}-${copy}`, color, value: action, kind: action });
  }
  for (let copy = 1; copy <= 4; copy += 1) {
    cards.push({ id: `wild-${copy}`, color: null, value: 'wild', kind: 'wild' });
    cards.push({ id: `wild4-${copy}`, color: null, value: 'wild4', kind: 'wild4' });
  }
  return cards;
}
function refillUnoDeck(state) {
  if (state.deck.length) return true;
  if (state.discard.length <= 1) return false;
  const top = state.discard.pop();
  state.deck = seededShuffle(state.discard.splice(0), state.moves + 73);
  state.discard = [top];
  return state.deck.length > 0;
}
function dealHands(state, ids, count) {
  state.playersOrder = ids.slice(); state.hands = Object.fromEntries(ids.map(id => [id, state.deck.splice(0, count)]));
}
function advanceTurn(state, ids, steps = 1) { const index = ids.indexOf(state.turn); state.turn = ids[(index + state.direction * steps + ids.length * 2) % ids.length]; }
function moveDominoes(state, playerId, move, ids) {
  const hand = state.hands[playerId];
  if (!hand) reject('Your domino hand is not ready.');
  if (move.type === 'draw') {
    if (state.deck.length && !hand.some(tile => tile.a === state.ends?.[0] || tile.b === state.ends?.[0] || tile.a === state.ends?.[1] || tile.b === state.ends?.[1])) {
      hand.push(state.deck.shift()); state.passes = 0;
    } else if (!state.deck.length) state.passes += 1;
    else reject('You already have a tile you can play.');
    state.moves += 1;
    if (!state.deck.length && state.passes >= ids.length) finishDominoes(state, ids);
    else advanceTurn(state, ids);
    return state;
  }
  if (move.type !== 'play' || !Number.isInteger(move.index) || move.index < 0 || move.index >= hand.length || !['left','right'].includes(move.end)) reject('Choose a tile and a matching end.');
  const tile = hand[move.index];
  if (!state.layout.length) { state.layout.push({ ...tile }); state.ends = [tile.a, tile.b]; }
  else {
    const side = move.end === 'left' ? 0 : 1, target = state.ends[side], other = side === 0 ? 1 : 0;
    if (tile.a !== target && tile.b !== target) reject('That tile does not match either end.');
    const exposed = tile.a === target ? tile.b : tile.a;
    state.ends[side] = exposed; state.layout.push({ ...tile, flipped: tile.b === target, end: move.end });
    if (other < 0) reject('Invalid domino end.');
  }
  hand.splice(move.index, 1); state.passes = 0; state.moves += 1;
  if (!hand.length) { state.winner = playerId; state.finished = true; }
  else advanceTurn(state, ids);
  return state;
}
function finishDominoes(state, ids) {
  const totals = Object.fromEntries(ids.map(id => [id, state.hands[id].reduce((sum, tile) => sum + tile.a + tile.b, 0)]));
  const low = Math.min(...Object.values(totals)), winners = ids.filter(id => totals[id] === low);
  state.scores = totals; state.winner = winners.length === 1 ? winners[0] : null; state.draw = winners.length > 1; state.finished = true;
}
function finishGoFish(state, ids) {
  const high = Math.max(...ids.map(id => state.books[id].length)), winners = ids.filter(id => state.books[id].length === high);
  state.scores = Object.fromEntries(ids.map(id => [id, state.books[id].length])); state.winner = winners.length === 1 ? winners[0] : null; state.draw = winners.length > 1; state.finished = true;
}
function advanceGoFish(state, ids, playerId) {
  for (let step = 1; step <= ids.length; step += 1) {
    const candidate = ids[(ids.indexOf(playerId) + step) % ids.length];
    if (state.hands[candidate].length || state.deck.length) { state.turn = candidate; return; }
  }
  finishGoFish(state, ids);
}
function collectBooks(state, playerId) {
  const hand = state.hands[playerId], counts = new Map();
  for (const card of hand) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  for (const [rank, count] of counts) if (count === 4) {
    state.hands[playerId] = state.hands[playerId].filter(card => card.rank !== rank);
    state.books[playerId].push(rank);
  }
}
function moveGoFish(state, playerId, move, ids) {
  const hand = state.hands[playerId];
  if (!hand) reject('Your cards are not ready.');
  if (move.type === 'ask') {
    if (!Number.isInteger(move.rank) || move.rank < 0 || move.rank > 12 || !hand.some(card => card.rank === move.rank) || !ids.includes(move.target) || move.target === playerId || !state.hands[move.target].length) reject('Ask for a rank in your hand from a classmate.');
    const targetHand = state.hands[move.target], taken = targetHand.filter(card => card.rank === move.rank);
    if (taken.length) { state.hands[move.target] = targetHand.filter(card => card.rank !== move.rank); hand.push(...taken); collectBooks(state, playerId); }
    else {
      if (state.deck.length) hand.push(state.deck.shift());
      collectBooks(state, playerId);
      const drawnMatch = hand.some(card => card.rank === move.rank);
      if (!drawnMatch) advanceGoFish(state, ids, playerId);
    }
  } else reject('Choose a card rank to ask for.');
  state.moves += 1;
  if (ids.every(id => state.hands[id].length === 0) || !state.deck.length && ids.filter(id => state.hands[id].length).length <= 1) finishGoFish(state, ids);
  else if (!state.hands[playerId].length) {
    if (state.deck.length) state.hands[playerId].push(state.deck.shift());
    else advanceGoFish(state, ids, playerId);
  }
  return state;
}
function moveUno(state, playerId, move, ids) {
  const hand = state.hands[playerId];
  if (!hand) reject('Your card hand is not ready.');
  if (state.drawPending) {
    if (move.type !== 'draw-penalty') reject('Draw the penalty cards first.');
    for (let i = 0; i < state.drawPending; i += 1) { if (!refillUnoDeck(state)) break; hand.push(state.deck.shift()); }
    state.drawPending = 0; advanceTurn(state, ids, 2); state.moves += 1; return state;
  }
  if (move.type === 'draw') {
    if (refillUnoDeck(state)) hand.push(state.deck.shift());
    advanceTurn(state, ids); state.moves += 1; return state;
  }
  if (move.type !== 'play' || !Number.isInteger(move.index) || move.index < 0 || move.index >= hand.length) reject('Choose one card from your hand.');
  const card = hand[move.index], top = state.discard[state.discard.length - 1];
  if (card.kind === 'wild4' && hand.some(other => other.color === state.color)) reject('Use a Wild Draw Four only when you have no card in the current color.');
  if (card.kind !== 'wild' && card.kind !== 'wild4' && card.color !== state.color && card.value !== top.value) reject('Match the current color or number, or use a wild card.');
  if ((card.kind === 'wild' || card.kind === 'wild4') && !['red','yellow','green','blue'].includes(move.color)) reject('Choose a color for your wild card.');
  hand.splice(move.index, 1); state.discard.push(card); state.moves += 1;
  if (!hand.length) { state.winner = playerId; state.finished = true; return state; }
  if (card.kind === 'wild' || card.kind === 'wild4') state.color = move.color;
  if (card.kind === 'draw2' || card.kind === 'wild4') { state.drawPending = card.kind === 'draw2' ? 2 : 4; advanceTurn(state, ids); }
  else if (card.kind === 'skip') advanceTurn(state, ids, 2);
  else if (card.kind === 'reverse') { state.direction *= -1; advanceTurn(state, ids, ids.length === 2 ? 2 : 1); }
  else advanceTurn(state, ids);
  return state;
}
function hasBingo(marked) {
  const set = new Set(marked);
  for (let row = 0; row < 5; row += 1) if (Array.from({ length: 5 }, (_, col) => row * 5 + col).every(index => set.has(index))) return true;
  for (let col = 0; col < 5; col += 1) if (Array.from({ length: 5 }, (_, row) => row * 5 + col).every(index => set.has(index))) return true;
  return [0,1,2,3,4].every(index => set.has(index * 6)) || [0,1,2,3,4].every(index => set.has(index * 4 + 4));
}

function startGameState(gameKey, state, ids) {
  const config = GAMES[gameKey];
  if (!config) reject('Unknown multiplayer game.');
  if (ids.length < config.minPlayers) reject('Wait for another player to join.');
  if (ids.length > config.maxPlayers) reject('This room is full.');
  state.turn = ids[0];
  if (gameKey === 'tic-tac-toe' || gameKey === 'connect-four') {
    state.playersOrder = ids.slice();
    state.otherPlayer = ids[1];
  }
  if (gameKey === 'memory-match') state.scores = Object.fromEntries(ids.map(id => [id, 0]));
  if (gameKey === 'checkers' || gameKey === 'reversi') state.playersOrder = ids.slice();
  if (gameKey === 'bingo') {
    state.playersOrder = ids.slice(); state.turn = ids[0]; state.scores = Object.fromEntries(ids.map(id => [id, 0]));
    for (const id of ids) state.cards[id] ||= makeBingoCard(1, id);
  }
  if (gameKey === 'dominoes') { dealHands(state, ids, 7); if (!state.layout.length) { const tile = state.hands[ids[0]].shift(); state.layout.push({ ...tile }); state.ends = [tile.a, tile.b]; } state.turn = ids[1]; }
  if (gameKey === 'go-fish') { dealHands(state, ids, ids.length === 2 ? 7 : 5); state.books = Object.fromEntries(ids.map(id => [id, []])); for (const id of ids) collectBooks(state, id); }
  if (gameKey === 'uno-style') { dealHands(state, ids, 7); let first = state.deck.shift(); while (first?.kind !== 'number') { state.deck.push(first); first = state.deck.shift(); } state.discard.push(first); state.color = first.color; }
  if (gameKey === 'math-race') state.scores = Object.fromEntries(ids.map(id => [id, 0]));
  if (gameKey === 'set') state.scores = Object.fromEntries(ids.map(id => [id, 0]));
  if (gameKey === 'ludo') { state.playersOrder = ids.slice(); state.tokens = Object.fromEntries(ids.map(id => [id, [-1, -1, -1, -1]])); state.starts = Object.fromEntries(ids.map((id, index) => [id, index * 13])); state.turn = ids[0]; }
  return state;
}

function publicView(gameKey, state, room, now = Date.now()) {
  const players = Object.entries(room.players || {}).filter(([, player]) => player && player.active !== false)
    .map(([studentId, player]) => ({ studentId, name: String(player.name || 'Student'), role: player.role === 'teacher' ? 'teacher' : 'student', score: state.scores?.[studentId] || 0 }));
  const view = {
    roomCode: room.roomCode, gameKey, gameName: GAMES[gameKey].name, host: room.host,
    hostName: room.hostName, state: room.state, createdAt: room.createdAt, updatedAt: now,
    players, playerCount: players.length, turn: state.turn, finished: !!state.finished,
    winner: state.winner || null, draw: !!state.draw, moves: state.moves || 0,
  };
  if (gameKey === 'connect-four' || gameKey === 'tic-tac-toe') {
    view.board = state.board.slice();
    if (gameKey === 'connect-four') view.playersOrder = state.playersOrder.slice();
    if (gameKey === 'tic-tac-toe') view.playersOrder = state.playersOrder.slice();
  } else if (gameKey === 'memory-match') {
    view.cardCount = state.deck.length;
    view.matched = state.matched.slice();
    view.flipped = state.flipped.slice();
    view.visibleCards = state.matched.concat(state.flipped)
      .map(index => ({ index, face: state.deck[index].face }));
    view.scores = Object.assign({}, state.scores);
  } else if (gameKey === 'checkers' || gameKey === 'reversi') {
    view.board = state.board.slice(); view.playersOrder = state.playersOrder.slice();
    if (gameKey === 'reversi') view.scores = Object.assign({}, state.scores || {});
  } else if (gameKey === 'bingo') {
    view.called = state.called.slice(); view.scores = Object.assign({}, state.scores);
  } else if (gameKey === 'math-race') {
    const question = state.questions[state.questionIndex];
    view.question = question ? { prompt: question.prompt, index: state.questionIndex + 1, total: state.questions.length, answered: Object.keys(state.answers?.[String(state.questionIndex)] || {}).length } : null;
    view.scores = Object.assign({}, state.scores);
  } else if (gameKey === 'set') {
    view.cards = state.cards.map(card => ({ id: card.id, props: card.props.slice() })); view.scores = Object.assign({}, state.scores);
  } else if (gameKey === 'ludo') {
    view.playersOrder = state.playersOrder.slice(); view.tokens = structuredClone(state.tokens); view.lastRoll = state.lastRoll; view.scores = Object.assign({}, state.scores || {});
  } else if (gameKey === 'dominoes') {
    view.layout = structuredClone(state.layout); view.ends = state.ends; view.handCounts = Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.length])); view.boneyardCount = state.deck.length;
  } else if (gameKey === 'go-fish') {
    view.handCounts = Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.length])); view.bookCounts = Object.fromEntries(Object.entries(state.books).map(([id, books]) => [id, books.length])); view.deckCount = state.deck.length;
  } else if (gameKey === 'uno-style') {
    view.topCard = state.discard[state.discard.length - 1] || null; view.color = state.color; view.handCounts = Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.length])); view.drawPending = state.drawPending;
  }
  return view;
}

function privateView(gameKey, state, studentId) {
  if (gameKey === 'bingo') {
    const card = state.cards?.[studentId];
    return card ? { card: { board: asList(card.board), marked: asList(card.marked) } } : {};
  }
  if (gameKey === 'dominoes' || gameKey === 'go-fish' || gameKey === 'uno-style') return { hand: (state.hands?.[studentId] || []).map(card => ({ ...card })) };
  return {};
}

module.exports = { GAMES, gameConfig, participantIds, hydrateGameState, createGameState, startGameState, applyMove, publicView, privateView, lineWinner, checkersMoves, reversiFlips, hasBingo, makeBingoCard, isSet, hasSet };
